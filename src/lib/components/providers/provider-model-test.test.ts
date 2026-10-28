import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testProviderModel } from '$lib/apis/providers';
import { providerErrorHint, providerErrorSummary } from '$lib/utils/provider-errors';

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('the explicit provider model test', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
		vi.stubGlobal('localStorage', { token: 'test-token' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends exactly one request with the purpose and the input', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ status: 'passed', elapsed_ms: 12 }));
		await testProviderModel('connection-1', {
			upstream_id: 'asr-1.0',
			purpose: 'transcription',
			audio_base64: 'YXVkaW8=',
			filename: 'sample.mp3',
			response_format: 'verbose_json'
		});
		expect((fetch as any).mock.calls.length).toBe(1);
		const [url, options] = (fetch as any).mock.calls[0];
		expect(url).toContain('/providers/connections/connection-1/model-test');
		expect(options.method).toBe('POST');
		const body = JSON.parse(options.body);
		expect(body.purpose).toBe('transcription');
		expect(body.audio_base64).toBe('YXVkaW8=');
		expect(body.filename).toBe('sample.mp3');
		expect(body.response_format).toBe('verbose_json');
	});

	it('sends the voice and the size of the service under test', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ status: 'passed' }));
		await testProviderModel('connection-1', {
			upstream_id: 'speech-2.8-hd',
			purpose: 'speech',
			voice: 'voice-id'
		});
		await testProviderModel('connection-1', {
			upstream_id: 'image-01',
			purpose: 'image',
			size: '1024x1024',
			count: 2
		});
		const first = JSON.parse((fetch as any).mock.calls[0][1].body);
		const second = JSON.parse((fetch as any).mock.calls[1][1].body);
		expect(first.voice).toBe('voice-id');
		expect(second.size).toBe('1024x1024');
		expect(second.count).toBe(2);
	});

	it('reports which service and model the request really used', async () => {
		(fetch as any).mockResolvedValue(
			jsonResponse({
				status: 'passed',
				elapsed_ms: 10,
				service: {
					purpose: 'transcription',
					endpoint: 'https://api.minimax.cn/v1/speech_to_text',
					model: 'asr-1.0'
				}
			})
		);
		const result = await testProviderModel('connection-1', {
			upstream_id: 'asr-1.0',
			purpose: 'transcription'
		});
		expect(result.service.endpoint).toBe('https://api.minimax.cn/v1/speech_to_text');
		// The internal adapter name never reaches the interface.
		expect(JSON.stringify(result)).not.toContain('minimax-transcription');
	});

	it('keeps the taxonomy of a failed test', async () => {
		const failure = {
			category: 'authentication',
			reason: 'invalid_credentials',
			suggested_action: 'replace_key',
			hint: '厂商拒绝了当前凭据，请重新填写 API Key。',
			upstream_code: '1004',
			upstream_http_status: 200
		};
		(fetch as any).mockResolvedValue(jsonResponse({ status: 'failed', error: failure }));
		const result = await testProviderModel('connection-1', {
			upstream_id: 'asr-1.0',
			purpose: 'transcription'
		});
		expect(result.status).toBe('failed');
		expect(providerErrorSummary(result.error)).toContain('凭据无效');
		expect(providerErrorHint(result.error)).toBe('厂商拒绝了当前凭据，请重新填写 API Key。');
		expect(result.error.upstream_code).toBe('1004');
		expect(result.error.upstream_http_status).toBe(200);
	});
});
