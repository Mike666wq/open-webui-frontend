import { WEBUI_API_BASE_URL } from '$lib/constants';
import { testProviderModel } from '$lib/apis/providers';

export type TestEvent = {
	test_id: string;
	seq: number;
	phase: 'accepted' | 'request_started' | 'response_headers' | 'output_delta' | 'completed' | 'failed';
	elapsed_ms: number;
	data: any;
};

/** An HTTP 404/405/501 is the only safe fallback: no stream was established. */
export async function runProviderTestSession(
	id: string,
	payload: Record<string, unknown>,
	signal: AbortSignal,
	onEvent: (event: TestEvent) => void
): Promise<{ result: any; fallback: boolean }> {
	const token = typeof localStorage !== 'undefined' ? localStorage.token : '';
	const response = await fetch(`${WEBUI_API_BASE_URL}/providers/connections/${encodeURIComponent(id)}/model-test-stream`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(payload), signal
	});
	if ([404, 405, 501].includes(response.status)) {
		if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
		const result = await testProviderModel(id, payload, signal);
		return { result, fallback: true };
	}
	if (!response.ok) throw new Error(`Test could not start (${response.status})`);
	if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Invalid test stream');
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentId = '';
	let lastSeq = 0;
	let terminal: any = null;
	try {
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			if (buffer.length > 3_000_000) throw new Error('Test stream event is too large');
			let end: number;
			while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
				const match = buffer.slice(end).match(/^\r?\n\r?\n/)!;
				const frame = buffer.slice(0, end);
				buffer = buffer.slice(end + match[0].length);
				const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
				if (!data) continue;
				const event = JSON.parse(data) as TestEvent;
				if (!event.test_id || !Number.isInteger(event.seq) || event.seq !== lastSeq + 1 || (currentId && event.test_id !== currentId)) throw new Error('Invalid test stream order');
				if (!['accepted', 'request_started', 'response_headers', 'output_delta', 'completed', 'failed'].includes(event.phase)) throw new Error('Invalid test phase');
				currentId = event.test_id;
				lastSeq = event.seq;
				onEvent(event);
				if (event.phase === 'completed' || event.phase === 'failed') terminal = event.data;
				if (terminal) return { result: terminal, fallback: false };
			}
			if (done) throw new Error('Test stream ended before completion');
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
}
