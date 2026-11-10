#!/usr/bin/env node
/**
 * Scripted OpenAI-compatible provider for the agent-tool end-to-end check.
 *
 * The point of this fixture is to make the *model* deterministic while
 * everything else stays real: the backend still builds the tool specs, parses
 * the function call, dispatches the tool, enforces permissions and writes the
 * result. Only "which tool does the model ask for" is scripted here.
 *
 * It is stateful on purpose. Each chat turn is independent (no conversation is
 * replayed), so the knowledge-base id and the confirmation token are remembered
 * from the tool results the backend hands back between turns.
 *
 * Usage:
 *   node scripts/fixtures/agent-e2e-mock-provider.mjs [--port 8095] [--json]
 */

import { createServer } from 'node:http';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 8095;
const JSON_MODE = args.includes('--json');

const state = {
	step: 'create',
	knowledgeId: '',
	token: '',
	requests: [],
	results: []
};

/** Steps the driver walks through, in order. */
export const STEPS = [
	'create',
	'add_text',
	'delete_no_token',
	'preview',
	'delete_with_token',
	'replay'
];

function decision(body) {
	const messages = body.messages || [];
	const last = messages[messages.length - 1] || {};

	// A tool result is only "the thing that just happened" when it is the
	// newest message — it stays in the list for every later turn.
	if (last.role === 'tool') return { text: '已收到工具结果。' };

	// The scripted step is inferred from the newest user instruction, so the
	// driver never has to keep the fixture in sync out of band.
	const lastUser = [...messages].reverse().find((m) => m.role === 'user');
	const text = String(lastUser?.content ?? '');

	if (/跳过确认|直接删除|不要确认/.test(text)) {
		// Deliberately omits the token: the guard must refuse this.
		return {
			tool: 'delete_knowledge_base',
			arguments: { knowledge_id: state.knowledgeId, confirmation_token: '' }
		};
	}
	if (/确认|同意/.test(text) && state.token) {
		return {
			tool: 'delete_knowledge_base',
			arguments: { knowledge_id: state.knowledgeId, confirmation_token: state.token }
		};
	}
	if (/创建|新建|建.*知识库/i.test(text)) {
		const name = (text.match(/知识库[「"']?([^「」"'\s，,。]+)/) || [])[1] || '端到端验收库';
		return {
			tool: 'create_knowledge_base',
			arguments: { name, description: '由 E2E 脚本创建' }
		};
	}
	if (/写入|加.*内容|添加文本/i.test(text)) {
		return {
			tool: 'add_text_to_knowledge',
			arguments: {
				knowledge_id: state.knowledgeId,
				filename: '端到端.md',
				content: '# 端到端\n\n这是脚本写入的内容。'
			}
		};
	}
	if (/删除|删掉|影响/i.test(text)) {
		return {
			tool: 'preview_delete',
			arguments: { resource_type: 'knowledge', resource_id: state.knowledgeId }
		};
	}

	return { text: '收到。需要我创建知识库、写入内容，还是删除？' };
}

function record(body) {
	state.requests.push(body);
	const messages = body.messages || [];
	const last = messages[messages.length - 1] || {};
	if (last.role !== 'tool') return;
	let parsed = {};
	try {
		parsed = JSON.parse(last.content || '{}');
	} catch {
		return;
	}
	state.results.push(parsed);
	const data = parsed.data || {};
	const impact = data.impact || {};
	if (impact.resource_id) state.knowledgeId = impact.resource_id;
	if (data.knowledge_id && parsed.status === 'success') state.knowledgeId = data.knowledge_id;
	if (data.confirmation_token) state.token = data.confirmation_token;
}

function inline(text, first = false) {
	return {
		role: 'assistant',
		content: first ? '' : undefined,
		...(first ? {} : { content: text })
	};
}

function sseChunk(delta, finish) {
	return `data: ${JSON.stringify({
		id: 'chatcmpl-agent-e2e',
		object: 'chat.completion.chunk',
		created: 0,
		model: 'agent-e2e-model',
		choices: [{ index: 0, delta, finish_reason: finish ?? null }]
	})}\n\n`;
}

const server = createServer((req, res) => {
	let body = '';
	req.on('data', (chunk) => (body += chunk));
	req.on('end', () => {
		const url = req.url || '';

		if (url.endsWith('/v1/models') || url.includes('/models')) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ object: 'list', data: [{ id: 'agent-e2e-model', object: 'model' }] }));
			return;
		}

		if (!url.includes('/chat/completions')) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'not found' }));
			return;
		}

		let parsed = {};
		try {
			parsed = JSON.parse(body);
		} catch {}
		record(parsed);
		const act = decision(parsed);

		let message;
		let finish;
		if (act.tool) {
			message = {
				role: 'assistant',
				content: null,
				tool_calls: [
					{
						id: `call_${state.requests.length}`,
						type: 'function',
						function: { name: act.tool, arguments: JSON.stringify(act.arguments) }
					}
				]
			};
			finish = 'tool_calls';
		} else {
			message = { role: 'assistant', content: act.text };
			finish = 'stop';
		}

		if (!parsed.stream) {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(
				JSON.stringify({
					id: 'chatcmpl-agent-e2e',
					object: 'chat.completion',
					created: 0,
					model: 'agent-e2e-model',
					choices: [{ index: 0, message, finish_reason: finish }]
				})
			);
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		});
		res.write(sseChunk({ role: 'assistant', content: '' }, null));
		res.write(sseChunk(act.tool ? { tool_calls: message.tool_calls.map((c, i) => ({ ...c, index: i })) } : { content: act.text }, finish));
		res.write('data: [DONE]\n\n');
		res.end();
	});
});

server.listen(PORT, '127.0.0.1', () => {
	const info = `{"event":"ready","port":${PORT}}`;
	console.log(JSON_MODE ? info : `[mock-provider] listening on http://127.0.0.1:${PORT}/v1`);
});

/** Exposed for the driver when imported rather than spawned. */
export function getState() {
	return state;
}

export function setStep(step) {
	state.step = step;
}

export function snapshot() {
	return {
		requests: state.requests.length,
		results: state.results.map((r) => ({ status: r.status, code: r.code })),
		knowledgeId: state.knowledgeId,
		hasToken: Boolean(state.token),
		toolCount: (state.requests[0]?.tools || []).length
	};
}

export function close() {
	server.close();
}
