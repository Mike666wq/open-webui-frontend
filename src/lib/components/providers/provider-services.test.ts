import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createProviderConnection,
	fetchProviderModels,
	fetchProviderVoices,
	updateProviderConnection
} from '$lib/apis/providers';
import {
	buildServiceConfig,
	buildServicesPayload,
	type ProviderServiceTemplate
} from '$lib/utils/provider-services';

const TEMPLATE: ProviderServiceTemplate = {
	id: 'minimax',
	services: {
		chat: {
			supported: true,
			adapters: ['openai-chat'],
			discovery: 'remote',
			model_requirement: 'required',
			endpoint: { kind: 'base_url', url: 'https://api.minimax.chat/v1' },
			preset_models: [],
			limits: {},
			options: {}
		},
		transcription: {
			supported: true,
			adapters: ['minimax-transcription'],
			discovery: 'preset',
			model_requirement: 'defaulted',
			endpoint: { kind: 'base_url', url: 'https://api.minimax.cn/v1' },
			preset_models: [
				{
					upstream_id: 'asr-1.0',
					display_name: 'asr-1.0',
					uses: { transcription: 'minimax-transcription' }
				}
			],
			limits: { max_seconds: 500 },
			options: { response_format: ['json', 'verbose_json'] }
		}
	}
};

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('provider service configuration', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
		vi.stubGlobal('localStorage', { token: 'test-token' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends the services and the model selections when a connection is created', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ id: 'connection-1' }));
		const services = buildServicesPayload(TEMPLATE, {
			transcription: buildServiceConfig(TEMPLATE, 'transcription', {
				enabled: true,
				endpoint: {
					kind: 'endpoint_url',
					url: 'https://api.minimax.cn/v1/speech_to_text'
				}
			})
		});
		await createProviderConnection({
			provider_template: 'minimax',
			name: 'Media only',
			api_key: 'sk-test',
			config: { services },
			model_selections: [
				{
					upstream_id: 'asr-1.0',
					uses: { transcription: 'minimax-transcription' },
					source: 'preset'
				}
			]
		});
		const [, options] = (fetch as any).mock.calls[0];
		const body = JSON.parse(options.body);
		expect(body.config.services.transcription.endpoint).toEqual({
			kind: 'endpoint_url',
			url: 'https://api.minimax.cn/v1/speech_to_text'
		});
		expect(body.model_selections[0].uses).toEqual({ transcription: 'minimax-transcription' });
		expect(body.provider_template).toBe('minimax');
	});

	it('keeps the service block when a connection is updated', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ id: 'connection-1' }));
		await updateProviderConnection('connection-1', {
			config: {
				base_url: 'https://api.minimax.chat/v1',
				services: {
					transcription: buildServiceConfig(TEMPLATE, 'transcription', {
						enabled: true,
						endpoint: {
							kind: 'base_url',
							url: 'https://api.minimax.cn/v1'
						}
					})
				}
			}
		});
		const [url, options] = (fetch as any).mock.calls[0];
		expect(url).toContain('/providers/connections/connection-1');
		expect(JSON.parse(options.body).config.services.transcription.adapter).toBe(
			'minimax-transcription'
		);
	});

	it('asks a preset service for its models without a catalog call', async () => {
		(fetch as any).mockResolvedValue(
			jsonResponse({
				candidates: [{ upstream_id: 'asr-1.0', uses: { transcription: 'minimax-transcription' } }],
				error: null,
				status: 'not_applicable',
				fetched_at: 1
			})
		);
		const result = await fetchProviderModels('connection-1', 'transcription');
		const [url, options] = (fetch as any).mock.calls[0];
		expect(url).toContain('purpose=transcription');
		expect(options.method).toBe('POST');
		expect(result.status).toBe('not_applicable');
		expect(result.candidates[0].upstream_id).toBe('asr-1.0');
	});

	it('keeps the old request when no purpose is given', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ candidates: [], error: null }));
		await fetchProviderModels('connection-1');
		const [url] = (fetch as any).mock.calls[0];
		expect(url).not.toContain('purpose=');
	});

	it('asks for the voices of a speech service', async () => {
		(fetch as any).mockResolvedValue(
			jsonResponse({ data: [{ id: 'v1', name: 'Voice One', source: 'system' }], error: null })
		);
		const result = await fetchProviderVoices('connection-1', 'speech', 'system');
		const [url, options] = (fetch as any).mock.calls[0];
		expect(url).toContain('/connections/connection-1/voices/fetch');
		expect(JSON.parse(options.body)).toEqual({ purpose: 'speech', voice_type: 'system' });
		expect(result.data[0].id).toBe('v1');
	});
});
