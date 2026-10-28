import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/constants', () => ({ WEBUI_API_BASE_URL: '/api/v1' }));
vi.mock('$lib/apis/providers', () => ({ testProviderModel: vi.fn().mockResolvedValue({ status: 'passed' }) }));
import { testProviderModel } from '$lib/apis/providers';
import { runProviderTestSession } from './provider-test-session';

function response(frames: unknown[]) {
	return new Response(new ReadableStream({
		start(controller) {
			const bytes = new TextEncoder().encode(frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
			controller.enqueue(bytes.slice(0, 17));
			controller.enqueue(bytes.slice(17));
			controller.close();
		}
	}), { headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('provider test stream', () => {
	it('parses split frames until a terminal event without a second request', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
			{ test_id: 'x', seq: 1, phase: 'accepted', elapsed_ms: 0, data: {} },
			{ test_id: 'x', seq: 2, phase: 'completed', elapsed_ms: 30, data: { status: 'passed' } }
		])));
		const events: string[] = [];
		const result = await runProviderTestSession('a', {}, new AbortController().signal, (event) => events.push(event.phase));
		expect(events).toEqual(['accepted', 'completed']);
		expect(result).toEqual({ result: { status: 'passed' }, fallback: false });
		expect(testProviderModel).not.toHaveBeenCalled();
	});
	it('falls back only when the endpoint is unavailable before establishing a stream', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
		const result = await runProviderTestSession('a', {}, new AbortController().signal, () => {});
		expect(result.fallback).toBe(true);
		expect(testProviderModel).toHaveBeenCalledTimes(1);
	});
	it('does not retry a broken stream', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([
			{ test_id: 'x', seq: 1, phase: 'accepted', elapsed_ms: 0, data: {} }
		])));
		await expect(runProviderTestSession('a', {}, new AbortController().signal, () => {})).rejects.toThrow('ended before completion');
		expect(testProviderModel).not.toHaveBeenCalled();
	});
});
