#!/usr/bin/env node
/**
 * API-only fixture for the real bundled Svelte frontend.
 *
 * Static files and every HTML page come from the verified frontend bundle.
 * This process never substitutes application HTML.
 */
import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
const port = Number(process.env.FIXTURE_PORT || 8765);
const origin = `http://127.0.0.1:${port}`;
const startedAt = Date.now();
const events = [];
const upgradedSockets = new Set();
let providerConnection = null;
let recordingListReads = 0;
let recordingSummaryAttempts = 0;
let recordingKnowledgeUpdateAttempts = 0;
let recordingNoteMissing = false;
let recordingRemoved = false;
let kimiConnection = null;
let chatgptConnection = null;
let minimaxConnection = null;

const chatgptAttempts = [];
const kimiAttempts = [];

// Per-service metadata mirrored from the backend registry
// (backend/open_webui/utils/provider_registry.py). The fixture keeps the same
// shapes so the wizard exercises the real per-service UI paths.
const ADAPTER_OPERATIONS = {
	'openai-image': ['generate', 'edit'],
	'siliconflow-image': ['generate'],
	'minimax-image': ['generate']
};
const MEDIA_UNSUPPORTED_OAUTH = '账号登录仅覆盖文本推理，不能用于语音转写、语音合成或生图。';
const MEDIA_UNSUPPORTED_NONE = '该提供商未提供此服务。';
const MEDIA_UNSUPPORTED_LATER = '该提供商的原生媒体接口本期未接入。';
const TEMPLATE_UNSUPPORTED_REASON = '该提供商类型尚未实装，请改用 OpenAI 兼容端点接入。';

function serviceDeclaration(overrides = {}) {
	const declaration = {
		supported: true,
		unsupported_reason: null,
		adapters: [],
		auth_types: ['api_key'],
		discovery: 'remote',
		model_requirement: 'required',
		endpoint: { kind: 'base_url', url: '' },
		preset_models: [],
		limits: {},
		options: {},
		notes: null,
		...overrides
	};
	const operations = [
		...new Set(declaration.adapters.flatMap((adapter) => ADAPTER_OPERATIONS[adapter] ?? []))
	].sort();
	if (operations.length) declaration.operations = operations;
	return declaration;
}

function unsupportedService(reason) {
	return serviceDeclaration({ supported: false, unsupported_reason: reason, discovery: 'none' });
}

const minimaxMediaRoot = 'https://api.minimax.cn/v1';
const minimaxChatService = serviceDeclaration({
	adapters: ['openai-chat'],
	endpoint: { kind: 'base_url', url: 'https://api.minimax.chat/v1' }
});
const openaiChatService = serviceDeclaration({
	adapters: ['openai-chat', 'responses'],
	endpoint: { kind: 'base_url', url: 'https://api.openai.com/v1' }
});
const minimaxTranscriptionService = serviceDeclaration({
	adapters: ['minimax-transcription'],
	discovery: 'preset',
	model_requirement: 'defaulted',
	endpoint: { kind: 'base_url', url: minimaxMediaRoot },
	preset_models: [
		{
			upstream_id: 'asr-1.0',
			display_name: 'asr-1.0',
			uses: { transcription: 'minimax-transcription' }
		}
	],
	limits: {
		max_bytes: 52428800,
		max_seconds: 500,
		input_formats: ['wav', 'aiff', 'flac', 'm4a', 'mp3', 'aac', 'opus', 'ogg']
	},
	options: { response_format: ['json', 'verbose_json'] },
	notes: 'model 仍必须随请求发送；语言走请求头，未指定即混合语言识别。'
});
const minimaxSpeechService = serviceDeclaration({
	adapters: ['minimax-speech'],
	discovery: 'preset',
	endpoint: { kind: 'base_url', url: minimaxMediaRoot },
	preset_models: [
		'speech-2.8-hd',
		'speech-2.8-turbo',
		'speech-2.6-hd',
		'speech-2.6-turbo',
		'speech-02-hd',
		'speech-02-turbo',
		'speech-01-hd',
		'speech-01-turbo'
	].map((upstreamId) => ({
		upstream_id: upstreamId,
		display_name: upstreamId,
		uses: { speech: 'minimax-speech' }
	})),
	limits: { max_text_chars: 10000 },
	options: { format: ['mp3'], output_format: ['hex'], voice_id: 'manual' },
	notes: '同步非流式合成；音色 ID 独立于模型，不自动激活或克隆音色。'
});
const minimaxImageService = serviceDeclaration({
	adapters: ['minimax-image'],
	discovery: 'preset',
	endpoint: { kind: 'base_url', url: minimaxMediaRoot },
	preset_models: ['image-01', 'image-01-live'].map((upstreamId) => ({
		upstream_id: upstreamId,
		display_name: upstreamId,
		uses: { image: 'minimax-image' }
	})),
	limits: {
		max_prompt_chars: 1500,
		min_dimension: 512,
		max_dimension: 2048,
		dimension_multiple: 8,
		max_images: 9
	},
	options: {
		response_format: ['base64', 'url'],
		aspect_ratio: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
		n: [1, 2, 3, 4, 5, 6, 7, 8, 9]
	},
	notes: '本期仅文生图，不支持图生图或图片编辑；国际区只登记已确认的 image-01。'
});

if (!root || !statSync(root).isDirectory()) {
	console.error('Usage: node frontend-api-server.mjs <verified-frontend-directory>');
	process.exit(2);
}

const manifestBytes = await readFile(path.join(root, 'frontend-manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestRoot = path.resolve(root);
const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
const files = new Map(manifest.files.map((file) => [file.path, file]));
const routes = manifest.pageRoutes.map((pattern) => new RegExp(pattern));

const now = Math.floor(Date.now() / 1000);
const userId = 'fixture-user';

// A connection whose model list could not be fetched: the address of the
// provider resolves into a reserved range and the local policy blocks it.
// The catalog carries the same taxonomy the backend sends.
const blockedCatalogError = {
	category: 'provider_network',
	status: 502,
	http_status: 502,
	upstream_status: null,
	retryable: true,
	at: now,
	hint: '连接被服务器的安全策略拦截，请检查地址解析结果与代理配置。',
	stage: 'catalog',
	reason: 'address_blocked',
	suggested_action: 'check_server_network'
};
const blockedConnection = {
	id: 'fixture-blocked-connection',
	provider_id: 'siliconflow',
	provider_template: 'siliconflow',
	protocol: 'openai-compatible',
	name: 'SiliconFlow',
	auth_type: 'api_key',
	visibility: 'private',
	owner_id: userId,
	config: { base_url: 'https://api.siliconflow.cn/v1' },
	models: [
		{
			id: 'provider:fixture-blocked-connection:fixture-model',
			upstream_id: 'fixture-model',
			name: 'Fixture model',
			uses: { chat: 'openai-chat' },
			enabled: true
		}
	],
	status: 'configured',
	configured: true,
	is_enabled: true,
	catalog: { updated_at: null, stale: true, error: blockedCatalogError, request_path: 'server' }
};
const assistantId = 'fixture-assistant';
const conversationId = 'layout-fixture';
const socketSid = 'fixture-socket';

const longParagraph =
	'这是一段用于验证手机布局的长文本。它包含中文、English words、较长的不可拆分标识符以及足够多的内容，用来确认助手卡片会在可用宽度内换行，正文、表格和代码不会把页面整体推向右侧，同时卡片标题和操作按钮仍保持可触达。'.repeat(
		3
	);

const messages = {
	'fixture-user-message': {
		id: 'fixture-user-message',
		parentId: null,
		childrenIds: [assistantId],
		role: 'user',
		content: '请检查移动端长消息、代码块、表格、操作按钮和输入框是否都完整落在视口内。',
		timestamp: now - 80,
		models: ['fixture-model'],
		done: true
	},
	[assistantId]: {
		id: assistantId,
		parentId: 'fixture-user-message',
		childrenIds: [],
		role: 'assistant',
		content: `${longParagraph}\n\n| 组件 | 检查项 | 状态 |\n| --- | --- | --- |\n| 消息卡片 | 不越过右边界 | 通过 |\n| 输入框 | 固定且可操作 | 通过 |\n| 表格 | 只在自身容器内滚动 | 通过 |\n\n\`\`\`bash\nkubectl port-forward pod/mypod 18080:8080\ncurl -v http://127.0.0.1:18080/healthz\n\`\`\`\n\n${longParagraph}`,
		timestamp: now - 60,
		model: 'fixture-model',
		modelName: 'Fixture model',
		modelIdx: 0,
		done: true,
		usage: { prompt_tokens: 80, completion_tokens: 240, total_tokens: 320 }
	}
};

const chat = {
	id: conversationId,
	user_id: userId,
	title: '安卓布局专项验收',
	created_at: now - 120,
	updated_at: now - 60,
	currentId: assistantId,
	chat: {
		id: conversationId,
		user_id: userId,
		title: '安卓布局专项验收',
		models: ['fixture-model'],
		params: {},
		history: { messages, currentId: assistantId },
		tags: [],
		timestamp: now - 120,
		files: []
	},
	last_read_at: now - 60,
	active: true,
	folder_id: null,
	tags: []
};

const config = {
	status: true,
	name: 'Fixture Open WebUI',
	version: '0.12.2',
	default_locale: 'zh-CN',
	features: {
		enable_signup: false,
		enable_login_form: true,
		enable_websocket: true,
		enable_direct_connections: false,
		enable_provider_connections: true,
		enable_provider_model_capabilities: true,
		enable_tool_servers: false,
		enable_notes: true,
		enable_recording_documents: true,
		enable_channels: false,
		enable_folders: false,
		enable_automations: false,
		enable_calendar: false,
		enable_version_update_check: false,
		enable_admin_analytics: false
	},
	oauth: { providers: {} },
	ui: { default_interface_settings: {} },
	permissions: {},
	audio: {},
	file: { max_size: 20 * 1024 * 1024, max_count: 4 },
	metadata: {}
};

// Layout and gesture tests start with onboarding already acknowledged. Otherwise
// the async changelog modal can appear after navigation readiness and eat swipes.
let userSettings = {
	ui: { theme: 'light', chatDirection: 'ltr', version: config.version },
	keybindings: {}
};

const user = {
	id: userId,
	name: 'Fixture User',
	email: 'fixture@example.invalid',
	role: 'admin',
	token: 'fixture-token',
	profile_image_url: '/static/favicon.png',
	permissions: {
		features: {
			notes: false,
			channels: false,
			folders: false,
			direct_tool_servers: false
		},
		workspace: { models: true, knowledge: true, prompts: true, tools: false },
		chat: { temporary_enforced: false }
	}
};

const recordingNotes = new Map([
	[
		'recording-note',
		{
			id: 'recording-note',
			user_id: userId,
			title: '课堂录音',
			data: { content: { md: '老师讲课。\n\n同学提问。' } },
			meta: { recording_id: 'recording-fixture' },
			access_grants: [],
			created_at: now * 1e9,
			updated_at: now * 1e9
		}
	]
]);
const readingNote = {
	id: 'reading-note',
	user_id: userId,
	title: '目录与全屏验收',
	write_access: false,
	data: {
		content: {
			html:
				'<h1>课程概览</h1><p>' +
				'课堂正文。'.repeat(1200) +
				'</p><h2>重点回顾</h2><p>本节结论。</p>',
			md: '# 课程概览\n\n课堂正文。\n\n## 重点回顾\n\n本节结论。'
		}
	},
	meta: {},
	access_grants: [],
	created_at: now * 1e9,
	updated_at: now * 1e9
};
recordingNotes.set('reading-note', readingNote);
const readingFile = {
	id: 'reading-file',
	filename: '阅读验收.pdf',
	meta: { name: '阅读验收.pdf', content_type: 'application/pdf', size: 600 },
	has_original: true,
	data: { status: 'completed' }
};
function readingPdf() {
	const stream = 'BT /F1 24 Tf 60 720 Td (Reading preview fixture) Tj ET';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
	];
	let text = '%PDF-1.4\n';
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(text));
		text += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(text);
	text += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((n) => String(n).padStart(10, '0') + ' 00000 n ')
		.join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(text);
}
const recording = {
	id: 'recording-fixture',
	title: '课堂录音.wav',
	state: 'completed',
	duration: 3000,
	size_bytes: 32044,
	source_present: false,
	completed_chunks: 5,
	total_chunks: 5,
	note_id: 'recording-note',
	summary_note_ids: [],
	speaker_names: {},
	text: '老师讲课。\n\n同学提问。',
	segments: [
		{ text: '老师讲课。', start: 0, end: 2, speaker: 'part-1:0' },
		{ text: '同学提问。', start: 600, end: 602, speaker: 'part-2:0' }
	],
	capabilities: { timestamps: true, speakers: true, cross_chunk_speakers: false }
};
const model = {
	id: 'fixture-model',
	name: 'Fixture model',
	object: 'model',
	owned_by: 'fixture',
	created: now,
	info: { id: 'fixture-model', meta: { capabilities: { status_updates: true } } }
};
const transcriptionModel = {
	id: 'provider:fixture-provider-connection:asr-fixture',
	connection_id: 'fixture-provider-connection',
	connection_name: 'Fixture SiliconFlow',
	upstream_id: 'asr-fixture',
	name: 'Fixture ASR',
	uses: { transcription: 'openai-transcription' },
	verification: { transcription: { status: 'untested' } }
};

const usage = {
	totals: {
		lifetime_tokens: 320,
		input_tokens: 80,
		output_tokens: 240,
		peak_daily_tokens: 320,
		longest_chat_seconds: 60,
		current_streak: 1,
		longest_streak: 1,
		total_chats: 1,
		active_days: 1,
		models_used: 1,
		messages: 2,
		user_messages: 1,
		assistant_messages: 1
	},
	heatmap: [],
	weekly_heatmap: [],
	cumulative_heatmap: [],
	insights: {
		most_used_model: 'fixture-model',
		average_tokens_per_chat: 320,
		average_messages_per_active_day: 2,
		user_message_share: 50,
		assistant_message_share: 50
	},
	top_models: [
		{
			model_id: 'fixture-model',
			messages: 2,
			input_tokens: 80,
			output_tokens: 240,
			total_tokens: 320
		}
	],
	top_tools: [],
	period: { start_date: now - 86_400, end_date: now, days: 1 }
};

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
	const bytes = Buffer.isBuffer(body)
		? body
		: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
	response.writeHead(status, {
		'Content-Type': contentType,
		'Content-Length': bytes.length,
		'Cache-Control': 'no-store',
		'X-Fixture-Frontend-Commit': manifest.sourceCommit
	});
	response.end(bytes);
}

function event(kind, details = {}) {
	events.push({ kind, elapsed: Date.now() - startedAt, ...details });
	if (events.length > 500) events.splice(0, events.length - 500);
}

function api(pathname) {
	if (pathname === '/api/v1/providers')
		return {
			object: 'list',
			service_contract_version: 1,
			data: [
				{
					id: 'openai',
					name: 'OpenAI',
					protocol: 'openai-compatible',
					protocol_label: 'OpenAI 兼容',
					group: 'official',
					group_label: '官方',
					auth_types: ['api_key'],
					default_base_url: 'https://api.openai.com/v1',
					docs_url: '',
					supported: true,
					unsupported_reason: null,
					services: {
						chat: openaiChatService,
						transcription: serviceDeclaration({
							adapters: ['openai-transcription'],
							endpoint: { kind: 'base_url', url: 'https://api.openai.com/v1' },
							options: { response_format: ['json', 'text', 'verbose_json'] }
						}),
						speech: serviceDeclaration({
							adapters: ['openai-speech'],
							endpoint: { kind: 'base_url', url: 'https://api.openai.com/v1' },
							options: { response_format: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] }
						}),
						image: serviceDeclaration({
							adapters: ['openai-image'],
							endpoint: { kind: 'base_url', url: 'https://api.openai.com/v1' },
							options: {
								size: ['auto', '1024x1024', '1024x1536', '1536x1024'],
								response_format: ['b64_json', 'url']
							}
						})
					}
				},
				{
					id: 'deepseek',
					name: 'DeepSeek',
					protocol: 'openai-compatible',
					protocol_label: 'OpenAI 兼容',
					group: 'cn',
					group_label: '国产',
					auth_types: ['api_key'],
					default_base_url: 'https://api.deepseek.com/v1',
					docs_url: '',
					supported: true,
					unsupported_reason: null,
					services: {
						chat: serviceDeclaration({
							adapters: ['openai-chat'],
							endpoint: { kind: 'base_url', url: 'https://api.deepseek.com/v1' }
						}),
						transcription: unsupportedService(MEDIA_UNSUPPORTED_NONE),
						speech: unsupportedService(MEDIA_UNSUPPORTED_NONE),
						image: unsupportedService(MEDIA_UNSUPPORTED_NONE)
					}
				},
				{
					id: 'kimi',
					name: 'Kimi Code',
					protocol: 'openai-compatible',
					protocol_label: 'OpenAI 兼容',
					group: 'cn',
					group_label: '国产',
					auth_types: ['oauth'],
					default_base_url: '',
					docs_url: '',
					supported: true,
					unsupported_reason: null,
					services: {
						chat: serviceDeclaration({
							adapters: ['openai-chat'],
							auth_types: ['oauth'],
							endpoint: { kind: 'base_url', url: 'https://api.kimi.com/coding/v1' }
						}),
						transcription: unsupportedService(MEDIA_UNSUPPORTED_OAUTH),
						speech: unsupportedService(MEDIA_UNSUPPORTED_OAUTH),
						image: unsupportedService(MEDIA_UNSUPPORTED_OAUTH)
					}
				},
				{
					id: 'chatgpt',
					name: 'ChatGPT',
					protocol: 'openai-responses',
					protocol_label: 'OpenAI Responses',
					group: 'official',
					group_label: '官方',
					auth_types: ['oauth'],
					default_base_url: '',
					docs_url: '',
					supported: true,
					unsupported_reason: null,
					services: {
						chat: serviceDeclaration({
							adapters: ['responses'],
							auth_types: ['oauth'],
							endpoint: { kind: 'base_url', url: '' }
						}),
						transcription: unsupportedService(MEDIA_UNSUPPORTED_OAUTH),
						speech: unsupportedService(MEDIA_UNSUPPORTED_OAUTH),
						image: unsupportedService(MEDIA_UNSUPPORTED_OAUTH)
					}
				},
				{
					id: 'minimax',
					name: 'MiniMax',
					protocol: 'openai-compatible',
					protocol_label: 'OpenAI 兼容',
					group: 'cn',
					group_label: '国产',
					auth_types: ['api_key'],
					default_base_url: 'https://api.minimax.chat/v1',
					docs_url: 'https://platform.minimaxi.com/document',
					supported: true,
					unsupported_reason: null,
					services: {
						chat: minimaxChatService,
						transcription: minimaxTranscriptionService,
						speech: minimaxSpeechService,
						image: minimaxImageService
					}
				},
				{
					id: 'anthropic',
					name: 'Anthropic',
					protocol: 'anthropic-messages',
					protocol_label: 'Anthropic Messages',
					group: 'official',
					group_label: '官方',
					auth_types: ['api_key'],
					default_base_url: '',
					docs_url: '',
					supported: false,
					unsupported_reason: '该提供商类型暂未实装。',
					services: {
						chat: unsupportedService(TEMPLATE_UNSUPPORTED_REASON),
						transcription: unsupportedService(TEMPLATE_UNSUPPORTED_REASON),
						speech: unsupportedService(TEMPLATE_UNSUPPORTED_REASON),
						image: unsupportedService(TEMPLATE_UNSUPPORTED_REASON)
					}
				}
			],
			groups: [
				{ id: 'official', label: '官方', order: 0 },
				{ id: 'cn', label: '国产', order: 1 }
			]
		};
	if (pathname === '/api/v1/providers/calls/history')
		return { data: [], summary: [], retention_days: 30 };
	if (pathname === '/api/v1/providers/legacy-migration/preview')
		return { sources: [], conflicts: {} };
	if (pathname === '/api/v1/providers/connections')
		return [
			providerConnection,
			kimiConnection,
			chatgptConnection,
			minimaxConnection,
			blockedConnection
		].filter(Boolean);
	if (pathname === '/api/v1/providers/models')
		return { object: 'list', data: [transcriptionModel] };
	if (pathname === '/api/config') return config;
	if (pathname === '/api/version') return { version: '0.12.2', deployment_id: 'fixture' };
	if (pathname === '/api/v1/auths/') return user;
	if (pathname === '/api/v1/users/user/settings') {
		return userSettings;
	}
	if (pathname === '/api/models') {
		return {
			object: 'list',
			data: [model],
			catalogs: [
				{
					connection_id: blockedConnection.id,
					connection_name: blockedConnection.name,
					updated_at: null,
					stale: true,
					error: blockedCatalogError,
					request_path: 'server'
				}
			]
		};
	}
	if (pathname === '/api/usage') return usage;
	if (pathname === '/api/v1/tools/') return [];
	if (pathname === '/api/v1/configs/banners') return [];
	if (pathname === '/api/v1/skills/') return [];
	if (pathname === '/api/v1/terminals/') return [];
	if (pathname === '/api/v1/chats/') return [chat];
	if (pathname === `/api/v1/chats/${conversationId}`) return chat;
	if (pathname === `/api/v1/chats/${conversationId}/tags`) return [];
	if (pathname === `/api/v1/chats/${conversationId}/messages/fixture-assistant`) {
		return {
			id: 'fixture-assistant',
			role: 'assistant',
			content: messages[assistantId].content,
			done: true
		};
	}
	if (pathname === '/api/v1/chats/pinned') return [];
	if (pathname === '/api/v1/folders/') return [];
	if (pathname === '/api/v1/channels/') return [];
	if (pathname === '/api/v1/notes/pinned') return [];
	if (pathname === '/api/v1/knowledge/reading-kb')
		return {
			id: 'reading-kb',
			name: '课堂资料',
			description: '可读性验收',
			user_id: userId,
			data: { file_ids: ['reading-file'] },
			access_grants: [],
			write_access: false
		};
	if (pathname === '/api/v1/knowledge/reading-kb/files')
		return { items: [readingFile], directories: [], breadcrumbs: [], total: 1 };
	if (pathname === '/api/v1/knowledge/reading-kb/files/pending') return [];

	if (pathname === '/api/v1/notes/search') return { items: [readingNote], total: 1 };
	if (pathname === '/api/v1/knowledge/search')
		return {
			items: [
				{
					id: 'reading-kb',
					name: '课堂资料',
					description: '可读性验收',
					user_id: userId,
					created_at: now,
					updated_at: now,
					file_count: 1
				}
			],
			total: 1
		};
	if (pathname === '/api/v1/recordings/config')
		return {
			max_size_mb: 500,
			max_duration_seconds: 7200,
			response_format: 'json',
			configured: true,
			can_delete_tasks: true,
			default_model_ref: transcriptionModel.id
		};
	if (pathname === '/api/v1/recordings') return recordingRemoved ? [] : [recording];
	if (pathname === '/api/v1/recordings/recording-fixture') return recording;
	if (pathname === '/api/v1/knowledge/')
		return [{ id: 'recording-kb', name: '课程资料', write_access: true }];
	if (pathname.startsWith('/api/v1/notes/') && recordingNotes.has(pathname.split('/').pop()))
		return recordingNotes.get(pathname.split('/').pop());

	if (pathname === '/api/version/updates') return { current: '0.12.2', latest: '0.12.2' };
	if (pathname === '/api/models/default') {
		return { model: 'fixture-model', params: {} };
	}
	if (pathname === '/api/v1/models/model/profile/image') return Buffer.alloc(0);
	if (pathname.startsWith('/api/v1/users/user/status')) {
		return { status: 'online', last_active_at: now };
	}
	return undefined;
}

function staticFile(pathname) {
	const clean = decodeURIComponent(pathname).replace(/^\/+/, '');
	if (!clean || clean.includes('..') || clean.includes('\\')) return null;
	const record = files.get(clean);
	if (!record) return null;
	const filename = path.resolve(manifestRoot, clean);
	if (!filename.startsWith(`${manifestRoot}${path.sep}`)) return null;
	return { filename, record };
}

function isPage(pathname) {
	return routes.some((route) => route.test(pathname));
}

// The provider routes are matched exactly: a page route such as /workspace/models
// must never be answered with an API payload.
const PROVIDER_CONNECTION_MODELS = /^\/api\/v1\/providers\/connections\/[^/]+\/models$/;
const PROVIDER_CONNECTION_MODELS_FETCH =
	/^\/api\/v1\/providers\/connections\/[^/]+\/models\/fetch$/;
const PROVIDER_CONNECTION_MODEL_ITEM =
	/^\/api\/v1\/providers\/connections\/[^/]+\/models\/([^/]+)$/;
const PROVIDER_CONNECTION_ENABLED = /^\/api\/v1\/providers\/connections\/[^/]+\/enabled$/;
const PROVIDER_CONNECTION_VOICES = /^\/api\/v1\/providers\/connections\/[^/]+\/voices\/fetch$/;
const PROVIDER_CONNECTION_MODEL_TEST = /^\/api\/v1\/providers\/connections\/[^/]+\/model-test$/;

function connectionForPath(pathname) {
	const id = decodeURIComponent(pathname.split('/')[5] ?? '');
	if (id === 'fixture-minimax-connection') return minimaxConnection;
	if (id === 'fixture-provider-connection') return providerConnection;
	return null;
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url || '/', origin);
	if (request.method === 'GET' && url.pathname === '/api/v1/files/reading-file/content') {
		event('reading-pdf-load');
		response.writeHead(200, { 'Content-Type': 'application/pdf' });
		response.end(readingPdf());
		return;
	}

	try {
		if (request.method === 'POST' && url.pathname === '/__fixture_missing_recording_note') {
			recordingNoteMissing = true;
			send(response, 200, {});
			return;
		}
		if (
			request.method === 'GET' &&
			url.pathname === '/api/v1/notes/recording-note' &&
			recordingNoteMissing
		) {
			event('missing-recording-note');
			send(response, 404, { detail: 'Synthetic deleted note' });
			return;
		}
		if (request.method === 'DELETE' && url.pathname === '/api/v1/recordings/recording-fixture') {
			recordingRemoved = true;
			send(response, 200, { deleted: true, notes_retained: true });
			return;
		}
		if (request.method === 'GET' && url.pathname === '/api/v1/recordings') {
			recordingListReads += 1;
			if (recordingListReads === 2) {
				send(response, 502, { detail: 'Synthetic transient status gateway failure' });
				return;
			}
		}
		if (url.pathname === '/api/v1/providers/auth/chatgpt/start' && request.method === 'POST') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (payload.mode !== 'browser') {
				send(response, 400, { detail: 'Browser mode required' });
				return;
			}
			const attempt = {
				attempt_id: 'chatgpt-fixture-' + (chatgptAttempts.length + 1),
				status: 'pending',
				authorization_url: 'https://auth.openai.com/api/accounts/authorize?state=fixture-state',
				redirect_uri: 'http://127.0.0.1:1455/auth/callback',
				expires_at: now + 600
			};
			chatgptAttempts.push(attempt);
			event('chatgpt-browser-started');
			send(response, 200, attempt);
			return;
		}
		if (url.pathname.startsWith('/api/v1/providers/auth/chatgpt/chatgpt-fixture-')) {
			const attempt = chatgptAttempts.find((item) =>
				url.pathname.split('/').includes(item.attempt_id)
			);
			if (!attempt) {
				send(response, 404, {});
				return;
			}
			if (request.method === 'POST' && url.pathname.endsWith('/callback')) {
				const chunks = [];
				for await (const chunk of request) chunks.push(chunk);
				const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				if (
					payload.callback_url !==
					'http://127.0.0.1:1455/auth/callback?code=fixture-code&state=fixture-state&client_id=oaiapp_fixture'
				) {
					send(response, 400, { detail: 'This callback belongs to a different sign-in.' });
					return;
				}
				attempt.status = 'complete';
				chatgptConnection = {
					id: 'fixture-chatgpt-connection',
					provider_id: 'chatgpt',
					name: 'ChatGPT',
					auth_type: 'oauth',
					visibility: 'private',
					owner_id: userId,
					config: {},
					models: [],
					status: 'connected'
				};
				event('chatgpt-browser-complete');
			} else if (request.method === 'DELETE') {
				attempt.status = 'cancelled';
				event('chatgpt-browser-cancelled');
			}
			send(response, 200, { status: attempt.status, connection_id: chatgptConnection?.id });
			return;
		}
		if (url.pathname === '/api/v1/providers/auth/kimi/start' && request.method === 'POST') {
			const attempt = {
				attempt_id: 'kimi-fixture-' + (kimiAttempts.length + 1),
				status: 'pending',
				user_code: 'TEST-1234',
				verification_uri_complete: 'https://www.kimi.com/device?code=TEST-1234',
				expires_at: now + 600,
				interval: 1
			};
			kimiAttempts.push(attempt);
			event('kimi-started', { attempt_id: attempt.attempt_id });
			send(response, 200, attempt);
			return;
		}
		if (url.pathname.startsWith('/api/v1/providers/auth/kimi/kimi-fixture-')) {
			const attempt = kimiAttempts.find((item) => url.pathname.endsWith('/' + item.attempt_id));
			if (!attempt) {
				send(response, 404, {});
				return;
			}
			if (request.method === 'DELETE') {
				attempt.status = 'cancelled';
				event('kimi-cancelled', { attempt_id: attempt.attempt_id });
			} else if (attempt === kimiAttempts[1]) {
				attempt.status = 'denied';
			} else if (attempt === kimiAttempts[2]) {
				attempt.status = 'complete';
				attempt.connection_id = 'fixture-kimi-connection';
				kimiConnection = {
					id: attempt.connection_id,
					provider_id: 'kimi',
					name: 'Kimi Code',
					auth_type: 'oauth',
					visibility: 'private',
					owner_id: userId,
					config: {},
					status: 'connected',
					models: [],
					configured: true
				};
				event('kimi-completed', { attempt_id: attempt.attempt_id });
			}
			send(response, 200, attempt);
			return;
		}

		if (
			request.method === 'POST' &&
			['/api/v1/providers/connections/verify', '/api/v1/providers/connections'].includes(
				url.pathname
			)
		) {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (!payload.name || !payload.api_key) {
				send(response, 422, { detail: 'Missing provider name/key' });
				return;
			}
			if (payload.provider_template === 'minimax') {
				const services = payload.config?.services ?? {};
				const enabledPurposes = Object.keys(services).sort();
				if (url.pathname.endsWith('/verify')) {
					if (
						JSON.stringify(enabledPurposes) !==
							JSON.stringify(['chat', 'speech', 'transcription']) ||
						!services.transcription?.endpoint?.url ||
						!services.speech?.endpoint?.url
					) {
						send(response, 422, {
							detail: 'Expected transcription and speech enabled and image disabled'
						});
						return;
					}
					send(response, 200, {
						ok: true,
						status: 'connected',
						models: [
							{
								id: 'provider:temporary:minimax-fixture-chat',
								upstream_id: 'minimax-fixture-chat',
								name: 'Fixture MiniMax Chat'
							}
						]
					});
					return;
				}
				const minimaxModelIds = Array.isArray(payload.config?.model_ids)
					? payload.config.model_ids
					: [];
				if (
					minimaxModelIds.some((id) => String(id).startsWith('provider:temporary:')) ||
					!minimaxModelIds.includes('minimax-fixture-chat')
				) {
					send(response, 422, {
						detail: 'Expected upstream model IDs rather than temporary connection IDs'
					});
					return;
				}
				const selections = payload.model_selections ?? [];
				// The backend refuses a request whose model_ids and model_selections
				// state different model sets, and every selection states its
				// purpose in `uses`. The fixture enforces the same contract.
				const modelIds = Array.isArray(payload.config?.model_ids)
					? payload.config.model_ids
					: [];
				const selectionIds = new Set(selections.map((entry) => entry.upstream_id));
				if (
					selections.length > 0 &&
					modelIds.length > 0 &&
					(selectionIds.size !== new Set(modelIds).size ||
						[...selectionIds].some((id) => !modelIds.includes(id)))
				) {
					send(response, 422, {
						detail: '模型选择与 model_ids 不一致，请只提交其中一种'
					});
					return;
				}
				const byPurpose = (purpose) =>
					selections.filter((entry) => entry.uses?.[purpose]);
				const chatSelections = byPurpose('chat');
				const transcriptionSelections = byPurpose('transcription');
				const speechSelections = byPurpose('speech');
				if (
					chatSelections.length !== 1 ||
					chatSelections[0].upstream_id !== 'minimax-fixture-chat' ||
					chatSelections[0].uses.chat !== 'openai-chat' ||
					chatSelections[0].source !== 'provider' ||
					transcriptionSelections.length !== 1 ||
					transcriptionSelections[0].upstream_id !== 'asr-1.0' ||
					transcriptionSelections[0].uses.transcription !== 'minimax-transcription' ||
					transcriptionSelections[0].source !== 'preset' ||
					speechSelections.length !== 8 ||
					!speechSelections.every(
						(entry) => entry.uses.speech === 'minimax-speech' && entry.source === 'preset'
					) ||
					selections.some((entry) => entry.uses?.image)
				) {
					send(response, 422, { detail: 'Unexpected model selections for MiniMax' });
					return;
				}
				const resolved = (declaration, enabled, endpointUrl) => ({
					supported: declaration.supported,
					unsupported_reason: declaration.unsupported_reason,
					adapters: declaration.adapters,
					adapter: declaration.adapters[0] ?? null,
					...(declaration.operations ? { operations: declaration.operations } : {}),
					enabled,
					discovery: declaration.discovery,
					model_requirement: declaration.model_requirement,
					limits: declaration.limits,
					options: declaration.options,
					preset_models: declaration.preset_models,
					notes: declaration.notes,
					endpoint: endpointUrl,
					endpoint_kind: endpointUrl ? 'base_url' : null,
					configured: enabled
				});
				minimaxConnection = {
					id: 'fixture-minimax-connection',
					provider_id: 'minimax',
					provider_template: 'minimax',
					protocol: 'openai-compatible',
					name: payload.name,
					auth_type: payload.auth_type ?? 'api_key',
					visibility: payload.visibility ?? 'private',
					owner_id: userId,
					config: payload.config,
					status: 'configured',
					configured: true,
					is_enabled: true,
					models: selections.map((entry) => ({
						id: `provider:fixture-minimax-connection:${entry.upstream_id}`,
						upstream_id: entry.upstream_id,
						name: entry.display_name ?? entry.upstream_id,
						uses: entry.uses,
						enabled: true,
						capability_source: entry.source
					})),
					catalog: { updated_at: now, error: null, stale: false },
					resolved_services: {
						chat: resolved(minimaxChatService, true, payload.config.base_url ?? 'https://api.minimax.chat/v1'),
						transcription: resolved(minimaxTranscriptionService, true, minimaxMediaRoot),
						speech: resolved(minimaxSpeechService, true, minimaxMediaRoot),
						image: resolved(minimaxImageService, false, null)
					},
					service_statuses: {
						chat: { configuration: 'valid', catalog: 'ok', probe: 'not_available' },
						transcription: {
							configuration: 'valid',
							catalog: 'not_applicable',
							probe: 'not_available'
						},
						speech: { configuration: 'valid', catalog: 'not_applicable', probe: 'not_available' },
						image: { configuration: 'missing', catalog: 'not_applicable', probe: 'not_available' }
					}
				};
				event('provider-saved', {
					provider_id: 'minimax',
					model_ids: payload.config.model_ids,
					visibility: payload.visibility,
					services: Object.keys(services),
					model_selections: selections
				});
				send(response, 200, minimaxConnection);
				return;
			}
			if (url.pathname.endsWith('/verify')) {
				send(response, 200, {
					ok: true,
					status: 'connected',
					models: [
						{
							id: 'provider:temporary:deepseek-fixture',
							upstream_id: 'deepseek-fixture',
							name: 'Fixture DeepSeek'
						}
					]
				});
				return;
			}
			const genericSelections = payload.model_selections ?? [];
			const genericModelIds = Array.isArray(payload.config?.model_ids)
				? payload.config.model_ids
				: [];
			// The backend refuses a request whose model_ids and model_selections
			// state different model sets.
			const genericSelectionIds = new Set(genericSelections.map((entry) => entry.upstream_id));
			if (
				genericSelections.length > 0 &&
				genericModelIds.length > 0 &&
				(genericSelectionIds.size !== new Set(genericModelIds).size ||
					[...genericSelectionIds].some((id) => !genericModelIds.includes(id)))
			) {
				send(response, 422, {
					detail: '模型选择与 model_ids 不一致，请只提交其中一种'
				});
				return;
			}
			if (JSON.stringify(payload.config?.model_ids) !== JSON.stringify(['deepseek-fixture'])) {
				send(response, 422, {
					detail: 'Expected upstream model IDs rather than temporary connection IDs'
				});
				return;
			}
			providerConnection = {
				id: 'fixture-provider-connection',
				provider_id: payload.provider_id ?? payload.provider_template,
				provider_template: payload.provider_template ?? payload.provider_id,
				protocol: 'openai-compatible',
				name: payload.name,
				auth_type: payload.auth_type ?? 'api_key',
				visibility: payload.visibility ?? 'private',
				owner_id: userId,
				config: payload.config,
				status: 'configured',
				configured: true,
				is_enabled: true,
				// The models picked in the wizard become the curated whitelist.
				models: (genericSelections.length
					? genericSelections.map((entry) => ({
							id: `provider:fixture-provider-connection:${entry.upstream_id}`,
							upstream_id: entry.upstream_id,
							name:
								entry.display_name ??
								(entry.upstream_id === 'deepseek-fixture' ? 'Fixture DeepSeek' : entry.upstream_id),
							uses: entry.uses,
							enabled: true,
							capability_source: entry.source
						}))
					: (payload.config?.model_ids ?? []).map((upstreamId) => ({
							id: `provider:fixture-provider-connection:${upstreamId}`,
							upstream_id: upstreamId,
							name: upstreamId === 'deepseek-fixture' ? 'Fixture DeepSeek' : upstreamId,
							uses: { chat: 'openai-chat' },
							enabled: true,
							capability_source: 'provider-adapter'
						}))
				)
			};
			event('provider-saved', {
				provider_id: payload.provider_id ?? payload.provider_template,
				model_ids: payload.config.model_ids,
				visibility: payload.visibility,
				model_selections: genericSelections
			});
			send(response, 200, providerConnection);
			return;
		}
		if (PROVIDER_CONNECTION_VOICES.test(url.pathname) && request.method === 'POST') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (payload.purpose !== 'speech') {
				send(response, 400, { detail: 'Voice listing is only available for speech' });
				return;
			}
			send(response, 200, {
				data: [
					{ id: 'female-shaonv', name: '少青-少女音', source: 'system' },
					{ id: 'male-qn-qingse', name: '青涩青年音', source: 'system' }
				],
				error: null,
				fetched_at: now
			});
			return;
		}
		if (PROVIDER_CONNECTION_MODEL_TEST.test(url.pathname) && request.method === 'POST') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const serviceEndpoints = {
				transcription: 'https://api.minimax.cn/v1/speech_to_text',
				speech: 'https://api.minimax.cn/v1/t2a_v2',
				image: 'https://api.minimax.cn/v1/image_generation',
				chat: 'chat/completions'
			};
			const result = {
				status: 'passed',
				tested_at: Math.floor(Date.now() / 1000),
				fingerprint: 'fixture-fingerprint',
				elapsed_ms: 120,
				error: null
			};
			if (payload.purpose && payload.purpose !== 'chat') {
				result.service = {
					purpose: payload.purpose,
					endpoint: serviceEndpoints[payload.purpose],
					model: payload.upstream_id
				};
			}
			event('provider-model-tested', { purpose: payload.purpose });
			send(response, 200, result);
			return;
		}
		if (PROVIDER_CONNECTION_MODELS_FETCH.test(url.pathname) && request.method === 'POST') {
			// Fetching only refreshes the candidate pool; the whitelist is untouched.
			const connection = connectionForPath(url.pathname);
			const candidates = (connection?.models ?? []).map((model) => ({
				upstream_id: model.upstream_id,
				display_name: model.name,
				capabilities: ['TG']
			}));
			send(response, 200, { candidates, error: null, fetched_at: now });
			return;
		}
		if (PROVIDER_CONNECTION_MODELS.test(url.pathname) && request.method === 'GET') {
			send(response, 200, { models: connectionForPath(url.pathname)?.models ?? [] });
			return;
		}
		if (PROVIDER_CONNECTION_MODELS.test(url.pathname) && request.method === 'POST') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const connection = connectionForPath(url.pathname);
			for (const upstreamId of payload.upstream_ids ?? []) {
				if (
					connection &&
					!connection.models.some((model) => model.upstream_id === upstreamId)
				) {
					connection.models.push({
						id: `provider:${connection.id}:${upstreamId}`,
						upstream_id: upstreamId,
						name: upstreamId,
						uses: { chat: 'openai-chat' },
						enabled: true
					});
				}
			}
			event('provider-models-added', { upstream_ids: payload.upstream_ids ?? [] });
			send(response, 200, connection);
			return;
		}
		const whitelistModel = url.pathname.match(PROVIDER_CONNECTION_MODEL_ITEM);
		if (whitelistModel) {
			const upstreamId = decodeURIComponent(whitelistModel[1]);
			const connection = connectionForPath(url.pathname);
			if (request.method === 'PUT') {
				const chunks = [];
				for await (const chunk of request) chunks.push(chunk);
				const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				const model = connection?.models.find((m) => m.upstream_id === upstreamId);
				if (model) {
					if (payload.enabled !== undefined) model.enabled = payload.enabled;
					if (payload.uses !== undefined) model.uses = payload.uses;
					if (payload.display_name !== undefined) model.name = payload.display_name;
				}
				event('provider-model-updated', { upstream_id: upstreamId, ...payload });
				send(response, 200, connection);
				return;
			}
			if (request.method === 'DELETE') {
				if (connection) {
					connection.models = connection.models.filter((m) => m.upstream_id !== upstreamId);
				}
				event('provider-model-removed', { upstream_id: upstreamId });
				send(response, 200, connection);
				return;
			}
		}
		if (PROVIDER_CONNECTION_ENABLED.test(url.pathname) && request.method === 'PUT') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			const connection = connectionForPath(url.pathname) ?? providerConnection;
			if (connection) connection.is_enabled = payload.enabled;
			event('provider-connection-enabled', { enabled: payload.enabled });
			send(response, 200, connection);
			return;
		}
		if (request.method === 'POST' && url.pathname === '/api/v1/auths/signin') {
			send(response, 200, user);
			return;
		}
		if (request.method === 'POST' && url.pathname === '/api/v1/users/user/settings/update') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			userSettings = {
				...userSettings,
				...payload,
				ui: { ...userSettings.ui, ...payload.ui }
			};
			send(response, 200, userSettings);
			return;
		}
		if (request.method === 'POST' && url.pathname === '/api/v1/users/user/status/update') {
			send(response, 200, { status: 'online', last_active_at: now });
			return;
		}
		if (request.method === 'POST' && url.pathname === '/__fixture_state') {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			try {
				event('page-state', JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				event('page-state-invalid');
			}
			send(response, 204, '');
			return;
		}
		if (request.method === 'GET' && url.pathname === '/__fixture_provenance') {
			send(response, 200, {
				schema: 1,
				sourceCommit: manifest.sourceCommit,
				manifestSha256Digest: manifestDigest,
				entry: manifest.entry,
				routes: manifest.pageRoutes.length,
				files: manifest.files.length,
				events
			});
			return;
		}

		if (
			request.method === 'GET' &&
			url.pathname === '/api/v1/files/recording-file/process/status'
		) {
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.end('data: {"status":"completed"}\n\n');
			return;
		}
		if (
			['POST', 'PATCH'].includes(request.method) &&
			(url.pathname.startsWith('/api/v1/recordings') ||
				url.pathname.startsWith('/api/v1/notes/recording-') ||
				url.pathname.startsWith('/api/v1/knowledge/recording-kb/') ||
				url.pathname === '/api/v1/files/' ||
				url.pathname === '/api/v1/files/recording-file/rename' ||
				url.pathname === '/api/v1/files/recording-file/data/content/update')
		) {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const raw = Buffer.concat(chunks).toString('utf8');
			const payload = request.headers['content-type']?.includes('application/json')
				? JSON.parse(raw)
				: {
						model_ref: /name="model_ref"\r\n\r\n([^\r\n]*)/.exec(raw)?.[1] ?? ''
					};
			event('recording-action', { path: url.pathname, payload });
			if (url.pathname === '/api/v1/recordings') {
				send(response, 202, recording);
				return;
			}
			if (url.pathname.endsWith('/speakers')) {
				recording.speaker_names = payload.names;
				send(response, 200, recording);
				return;
			}
			if (url.pathname.endsWith('/summary')) {
				if (++recordingSummaryAttempts === 1) {
					send(response, 502, { detail: 'Synthetic summary failure' });
					return;
				}
				recordingNotes.set('recording-summary', {
					...recordingNotes.get('recording-note'),
					id: 'recording-summary',
					title: '课堂笔记',
					data: { content: { md: '课堂知识点整理' } }
				});
				recording.summary_note_ids = ['recording-summary'];
				send(response, 200, { note_id: 'recording-summary' });
				return;
			}
			if (url.pathname.startsWith('/api/v1/notes/')) {
				const id = url.pathname.split('/')[4];
				const note = { ...recordingNotes.get(id), ...payload };
				recordingNotes.set(id, note);
				send(response, 200, note);
				return;
			}
			if (url.pathname === '/api/v1/files/') {
				send(response, 200, { id: 'recording-file', data: { status: 'completed' } });
				return;
			}
			if (url.pathname.endsWith('/file/update') && ++recordingKnowledgeUpdateAttempts === 1) {
				send(response, 502, { detail: 'Synthetic knowledge update failure' });
				return;
			}
			send(response, 200, {});
			return;
		}
		const body = api(url.pathname);
		if (body !== undefined) {
			event('api', { path: url.pathname });
			send(response, 200, body);
			return;
		}

		if (url.pathname.startsWith('/static/')) {
			const file = staticFile(url.pathname);
			if (file) {
				event('static', { path: url.pathname });
				response.writeHead(200, {
					'Content-Type': file.record.mime,
					'Content-Length': file.record.size,
					'Cache-Control': 'no-store'
				});
				createReadStream(file.filename).pipe(response);
				return;
			}
		}

		if (url.pathname === '/ws/socket.io/' || url.pathname === '/ws/socket.io') {
			send(response, 404, { detail: 'Polling transport is not enabled in the fixture' });
			return;
		}

		const asset = staticFile(url.pathname);
		if (asset) {
			response.writeHead(200, {
				'Content-Type': asset.record.mime,
				'Content-Length': asset.record.size,
				'Cache-Control': 'no-store',
				'X-OWC-Frontend-Commit': manifest.sourceCommit
			});
			createReadStream(asset.filename).pipe(response);
			return;
		}

		if (isPage(url.pathname)) {
			event('page', { path: url.pathname });
			const entry = files.get(manifest.entry);
			response.writeHead(200, {
				'Content-Type': entry.mime,
				'Content-Length': entry.size,
				'Cache-Control': 'no-store',
				'X-OWC-Frontend-Commit': manifest.sourceCommit
			});
			createReadStream(path.join(manifestRoot, manifest.entry)).pipe(response);
			return;
		}
		event('not-found', { path: url.pathname });
		send(response, 404, { detail: 'Not found' });
	} catch (error) {
		event('server-error', { message: String(error) });
		send(response, 500, { detail: 'Fixture failure' });
	}
});

server.on('upgrade', (request, socket) => {
	upgradedSockets.add(socket);
	const requestUrl = new URL(request.url || '/', origin);
	if (requestUrl.pathname !== '/ws/socket.io/') {
		socket.destroy();
		return;
	}
	const key = request.headers['sec-websocket-key'];
	if (typeof key !== 'string') {
		socket.destroy();
		return;
	}
	const accept = createHash('sha1')
		.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
		.digest('base64');
	socket.write(
		`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
	);
	event('socket-open', { path: requestUrl.pathname });
	const sendText = (message) => {
		const payload = Buffer.from(message);
		const header =
			payload.length < 126
				? Buffer.from([0x81, payload.length])
				: Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
		socket.write(Buffer.concat([header, payload]));
	};
	sendText(
		`0${JSON.stringify({
			sid: socketSid,
			upgrades: [],
			pingInterval: 25_000,
			pingTimeout: 20_000,
			maxPayload: 1_000_000
		})}`
	);
	socket.on('data', (chunk) => {
		if (chunk[0] === 0x88) {
			socket.end(Buffer.from([0x88, 0]));
			return;
		}
		if ((chunk[0] & 0x0f) === 0x1) {
			const masked = Boolean(chunk[1] & 0x80);
			let length = chunk[1] & 0x7f;
			let offset = 2;
			if (length === 126) {
				length = chunk.readUInt16BE(offset);
				offset += 2;
			}
			const mask = masked ? chunk.subarray(offset, offset + 4) : null;
			if (masked) offset += 4;
			const payload = Buffer.from(chunk.subarray(offset, offset + length));
			if (mask) {
				for (let index = 0; index < payload.length; index += 1) {
					payload[index] ^= mask[index % 4];
				}
			}
			const frame = payload.toString('utf8');
			if (frame === '2') {
				sendText('3');
			} else if (frame === '40') {
				sendText(`40${JSON.stringify({ sid: socketSid })}`);
			}
		}
	});
	socket.on('close', () => {
		upgradedSockets.delete(socket);
		event('socket-close');
	});
	socket.on('error', () => {});
});

server.listen(port, '127.0.0.1', () => {
	console.log(
		JSON.stringify({
			origin,
			frontendRoot: root,
			sourceCommit: manifest.sourceCommit,
			manifestSha256: manifestDigest,
			files: manifest.files.length
		})
	);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		for (const socket of upgradedSockets) socket.destroy();
		server.closeAllConnections();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 250).unref();
	});
}
