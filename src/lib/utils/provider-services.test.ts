import { describe, expect, it } from 'vitest';
import {
	buildModelSelections,
	buildServiceConfig,
	buildServicesPayload,
	defaultServiceEndpoint,
	discoveryLabelKey,
	endpointKindLabelKey,
	serviceAdapters,
	serviceDeclaration,
	serviceDiscovery,
	serviceEndpointPreview,
	serviceNeedsModel,
	serviceOperations,
	servicePresetModels,
	serviceSendsDefaultedModel,
	serviceStatus,
	serviceStatusLabelKey,
	serviceSupportsOperation,
	supportedServicePurposes,
	supportsServicePurpose,
	type ProviderServiceTemplate
} from './provider-services';

const MINIMAX: ProviderServiceTemplate = {
	id: 'minimax',
	services: {
		chat: {
			supported: true,
			adapters: ['openai-chat'],
			auth_types: ['api_key'],
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
			auth_types: ['api_key'],
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
			limits: { max_bytes: 52428800, max_seconds: 500 },
			options: { response_format: ['json', 'verbose_json'] }
		},
		speech: {
			supported: true,
			adapters: ['minimax-speech'],
			auth_types: ['api_key'],
			discovery: 'preset',
			model_requirement: 'required',
			endpoint: { kind: 'base_url', url: 'https://api.minimax.cn/v1' },
			preset_models: [],
			limits: {},
			options: { format: ['mp3'], output_format: ['hex'], voice_id: 'manual' }
		},
		image: {
			supported: false,
			unsupported_reason: '该提供商未提供此服务。',
			adapters: [],
			auth_types: [],
			discovery: 'none',
			model_requirement: 'none',
			preset_models: [],
			limits: {},
			options: {}
		}
	}
};

describe('provider service declarations', () => {
	it('reads the services of a template instead of guessing from the protocol', () => {
		expect(supportedServicePurposes(MINIMAX)).toEqual(['chat', 'transcription', 'speech']);
		expect(supportsServicePurpose(MINIMAX, 'image')).toBe(false);
		expect(serviceDeclaration(MINIMAX, 'image').unsupported_reason).toBe(
			'该提供商未提供此服务。'
		);
	});

	it('keeps the chat service for a template that declares nothing', () => {
		const legacy: ProviderServiceTemplate = { id: 'openai' };
		expect(supportedServicePurposes(legacy)).toEqual(['chat']);
		expect(serviceDiscovery(legacy, 'image')).toBe('none');
		expect(serviceAdapters(legacy, 'image')).toEqual([]);
	});

	it('separates the discovery modes', () => {
		expect(serviceDiscovery(MINIMAX, 'chat')).toBe('remote');
		expect(serviceDiscovery(MINIMAX, 'transcription')).toBe('preset');
		expect(discoveryLabelKey('remote')).toBe('Fetch the model list');
		expect(discoveryLabelKey('preset')).toBe('Use the official presets');
		expect(discoveryLabelKey('manual')).toBe('Add the model by hand');
		expect(discoveryLabelKey('none')).toBe('This service takes no model');
	});

	it('keeps a defaulted model in the request', () => {
		expect(serviceNeedsModel(MINIMAX, 'transcription')).toBe(true);
		expect(serviceSendsDefaultedModel(MINIMAX, 'transcription')).toBe(true);
		expect(servicePresetModels(MINIMAX, 'transcription')[0].upstream_id).toBe('asr-1.0');
	});

	it('builds the service configuration with the declared adapter', () => {
		const config = buildServiceConfig(MINIMAX, 'transcription', {
			enabled: true,
			endpoint: {
				kind: 'endpoint_url',
				url: 'https://api.minimax.cn/v1/speech_to_text'
			},
			serviceOptions: { response_format: 'verbose_json', unknown: 'x' }
		});
		expect(config).toEqual({
			enabled: true,
			adapter: 'minimax-transcription',
			endpoint: { kind: 'endpoint_url', url: 'https://api.minimax.cn/v1/speech_to_text' },
			options: { response_format: 'verbose_json' }
		});
	});

	it('omits the address when the service has none', () => {
		const config = buildServiceConfig(MINIMAX, 'chat', { enabled: true, endpoint: null });
		expect(config.endpoint).toBeUndefined();
		expect(config.adapter).toBe('openai-chat');
	});

	it('reads the default address of a service', () => {
		expect(defaultServiceEndpoint(MINIMAX, 'transcription')).toEqual({
			kind: 'base_url',
			url: 'https://api.minimax.cn/v1'
		});
		expect(endpointKindLabelKey('base_url')).toBe('API root address');
		expect(endpointKindLabelKey('endpoint_url')).toBe('Complete request address');
	});

	it('only sends the services the operator enabled', () => {
		const payload = buildServicesPayload(MINIMAX, {
			chat: buildServiceConfig(MINIMAX, 'chat', { enabled: true, endpoint: null }),
			transcription: buildServiceConfig(MINIMAX, 'transcription', {
				enabled: true,
				endpoint: { kind: 'base_url', url: 'https://api.minimax.cn/v1' }
			})
		});
		expect(Object.keys(payload)).toEqual(['chat', 'transcription']);
	});

	it('records the purpose of every selected model', () => {
		const selections = buildModelSelections([
			{
				upstream_id: 'asr-1.0',
				display_name: 'asr-1.0',
				purpose: 'transcription',
				adapter: 'minimax-transcription',
				source: 'preset'
			},
			{ upstream_id: 'speech-2.8-hd', purpose: 'speech', adapter: 'minimax-speech' }
		]);
		expect(selections).toEqual([
			{
				upstream_id: 'asr-1.0',
				display_name: 'asr-1.0',
				uses: { transcription: 'minimax-transcription' },
				source: 'preset'
			},
			{
				upstream_id: 'speech-2.8-hd',
				uses: { speech: 'minimax-speech' },
				source: 'manual'
			}
		]);
	});

	it('keeps a generate-only image service away from the editing entry', () => {
		const template: ProviderServiceTemplate = {
			id: 'minimax',
			services: {
				image: {
					supported: true,
					adapters: ['minimax-image'],
					discovery: 'preset',
					model_requirement: 'required',
					operations: ['generate']
				}
			}
		};
		expect(serviceOperations(template, 'image')).toEqual(['generate']);
		expect(serviceSupportsOperation(template, 'image', 'generate')).toBe(true);
		expect(serviceSupportsOperation(template, 'image', 'edit')).toBe(false);

		const editing: ProviderServiceTemplate = {
			id: 'openai',
			services: {
				image: {
					supported: true,
					adapters: ['openai-image'],
					discovery: 'remote',
					model_requirement: 'required',
					operations: ['edit', 'generate']
				}
			}
		};
		expect(serviceSupportsOperation(editing, 'image', 'edit')).toBe(true);
	});

	it('treats a service without operations as its single purpose', () => {
		expect(serviceOperations(MINIMAX, 'transcription')).toEqual([]);
		expect(serviceSupportsOperation(MINIMAX, 'transcription', 'transcription')).toBe(true);
		expect(serviceSupportsOperation(MINIMAX, 'transcription', 'edit')).toBe(false);
	});

	it('keeps the status layers apart', () => {
		const connection = {
			service_statuses: {
				transcription: { configuration: 'valid', catalog: 'not_applicable', probe: 'not_available' }
			},
			resolved_services: { transcription: { endpoint: 'https://api.minimax.cn/v1/speech_to_text' } }
		};
		expect(serviceStatus(connection, 'transcription').catalog).toBe('not_applicable');
		expect(serviceStatus(connection, 'speech')).toEqual({});
		expect(serviceEndpointPreview(connection, 'transcription')).toBe(
			'https://api.minimax.cn/v1/speech_to_text'
		);
		expect(serviceStatusLabelKey(serviceStatus(connection, 'transcription'))).toBe(
			'Uses the official presets'
		);
		expect(serviceStatusLabelKey({ configuration: 'invalid' })).toBe('The address needs to be fixed');
		expect(serviceStatusLabelKey({ configuration: 'missing' })).toBe('Not configured yet');
		expect(serviceStatusLabelKey({})).toBe('Configured, not tested yet');
	});
});
