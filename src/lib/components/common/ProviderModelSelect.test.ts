import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProviderModels } from '$lib/apis/providers';
import {
	providerModelsForPurpose,
	verificationLabel,
	type ProviderCatalogModel
} from '$lib/utils/provider-models';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'ProviderModelSelect.svelte'), 'utf8');

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('provider model select', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
		vi.stubGlobal('localStorage', { token: 'test-token' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('offers only the models that declare the requested purpose', () => {
		const models: ProviderCatalogModel[] = [
			{ id: 'a', upstream_id: 'asr-1.0', uses: { transcription: 'minimax-transcription' } },
			{ id: 'b', upstream_id: 'gpt-4o', uses: { chat: 'openai-chat' } },
			{ id: 'c', upstream_id: 'mystery', uses: {} }
		];
		expect(providerModelsForPurpose(models, 'transcription').map((model) => model.id)).toEqual([
			'a'
		]);
		expect(providerModelsForPurpose(models, 'chat').map((model) => model.id)).toEqual(['b']);
	});

	it('keeps a model without a use record out of every list', () => {
		expect(providerModelsForPurpose([{ id: 'x' }], 'chat')).toEqual([]);
		expect(providerModelsForPurpose(undefined, 'chat')).toEqual([]);
	});

	it('asks the server for the models of that purpose', async () => {
		(fetch as any).mockResolvedValue(jsonResponse({ data: [], errors: [] }));
		await getProviderModels('transcription');
		const [url] = (fetch as any).mock.calls[0];
		expect(url).toContain('/providers/models?purpose=transcription');
	});

	it('marks a model as untested until the purpose was tested', () => {
		expect(verificationLabel(undefined, 'chat')).toBe('untested');
		expect(verificationLabel({ chat: { status: 'untested' } }, 'chat')).toBe('untested');
		expect(verificationLabel({ chat: { status: 'passed' } }, 'chat')).toBe('passed');
		expect(verificationLabel({ chat: { status: 'failed' } }, 'chat')).toBe('failed');
		expect(verificationLabel({ chat: { status: 'passed' } }, 'speech')).toBe('untested');
	});

	it('offers a way into the provider settings when the list is empty', () => {
		expect(SOURCE).toContain('data-testid="provider-model-select-settings"');
		expect(SOURCE).toContain("showSettings.set('connections')");
		expect(SOURCE).toContain('Open the provider settings');
	});
});
