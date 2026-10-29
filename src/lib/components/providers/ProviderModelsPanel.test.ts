import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	classifiedResult,
	createProviderResultCache,
	catalogResult,
	requestFailureResult,
	successfulResult,
	createFetchFeedbackCache,
	errorFeedback,
	formatFetchTime,
	successFeedback,
	thrownFeedback
} from './provider-models-feedback';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = readFileSync(join(HERE, 'ProviderModelsPanel.svelte'), 'utf8');
const SERVICES_SOURCE = readFileSync(join(HERE, 'ProviderServices.svelte'), 'utf8');
const RESULTS_SOURCE = readFileSync(join(HERE, 'ProviderResultsPanel.svelte'), 'utf8');
const TEST_SOURCE = readFileSync(join(HERE, 'ProviderModelTestDialog.svelte'), 'utf8');

describe('provider models fetch feedback', () => {
	it('reports the fetched count and time on success', () => {
		const feedback = successFeedback(2, 1_700_000_000_000);
		expect(feedback.kind).toBe('success');
		expect(feedback.count).toBe(2);
		expect(feedback.at).toBe(1_700_000_000_000);
		expect(feedback.summary).toBe('');
		expect(feedback.actionKey).toBeNull();
		expect(feedback.hint).toBeNull();
	});

	it('keeps the candidate count when the provider answered with a classified error', () => {
		const feedback = errorFeedback(
			{
				candidates: [{ upstream_id: 'a' }],
				error: {
					category: 'auth',
					reason: 'invalid_key',
					hint: 'The key was rejected by the upstream provider.'
				}
			},
			{ authType: 'api_key' },
			1_700_000_000_000
		);
		expect(feedback.kind).toBe('error');
		expect(feedback.count).toBe(1);
		expect(feedback.summary).not.toBe('');
		expect(feedback.actionKey).toBeTruthy();
		expect(feedback.hint).toContain('rejected');
	});

	it('reports a thrown request failure without an action key', () => {
		const feedback = thrownFeedback(new Error('upstream connect error'), 1_700_000_000_000);
		expect(feedback.kind).toBe('error');
		expect(feedback.count).toBe(0);
		expect(feedback.summary).toBe('upstream connect error');
		expect(feedback.actionKey).toBeNull();
		expect(feedback.hint).toBeNull();
	});

	it('formats the completion time as HH:mm', () => {
		// 2023-11-14 22:13:20 UTC — locale may render 12h or 24h.
		expect(formatFetchTime(1_700_000_000_000)).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)?$/i);
	});

	it('serves the last feedback per connection from the cache', () => {
		const cache = createFetchFeedbackCache();
		expect(cache.get('conn-1')).toBeNull();
		expect(cache.get(undefined)).toBeNull();

		const feedback = successFeedback(3, 1_700_000_000_000);
		cache.set('conn-1', feedback);
		expect(cache.get('conn-1')).toBe(feedback);
		expect(cache.get('conn-2')).toBeNull();

		// Switching away and back returns the most recent result.
		const next = thrownFeedback(new Error('boom'), 1_700_000_001_000);
		cache.set('conn-1', next);
		expect(cache.get('conn-1')).toBe(next);

		// Unknown connection ids are ignored, never throw.
		cache.set(undefined, feedback);
		expect(cache.get(undefined)).toBeNull();
	});
});

describe('provider result cards', () => {
	it('keeps the latest operation per connection across tab switches and clears it explicitly', () => {
		const cache = createProviderResultCache();
		let snapshot: Record<string, ReturnType<typeof successfulResult>> = {};
		const unsubscribe = cache.subscribe((value) => (snapshot = value));
		const fetched = successfulResult('fetch', '3 models', 1_700_000_000_000);
		const tested = successfulResult('test', 'passed', 1_700_000_002_000, 'Chat', 'alpha');
		cache.set('a', fetched);
		cache.set('b', tested);
		expect(snapshot.a).toEqual(fetched);
		expect(snapshot.b).toEqual(tested);
		cache.set('a', tested);
		expect(snapshot.a).toEqual(tested);
		expect(snapshot.b).toEqual(tested);
		cache.clear('a');
		expect(snapshot.a).toBeUndefined();
		expect(snapshot.b).toEqual(tested);
		unsubscribe();
	});

	it('uses the existing error taxonomy for classified operations and retains transport failures', () => {
		const error = { category: 'authentication', reason: 'invalid_credentials', hint: 'Replace this key.' };
		const classified = classifiedResult('verify', error, { authType: 'api_key' }, 100);
		expect(classified.summary).toContain('凭据');
		expect(classified.actionKey).toBe('Replace the API key');
		expect(classified.hint).toBe('Replace this key.');
		expect(requestFailureResult('test', new Error('offline'), 200).summary).toBe('offline');
	});

	it('falls back to the server catalog state after local feedback is cleared', () => {
		const failed = catalogResult({ auth_type: 'api_key', catalog: {
			error: { category: 'authentication', reason: 'invalid_credentials', at: 123 }, updated_at: 120
		} });
		expect(failed?.kind).toBe('error');
		expect(failed?.at).toBe(123_000);
		expect(failed?.actionKey).toBe('Replace the API key');
		expect(catalogResult({ catalog: { updated_at: 456 } })?.at).toBe(456_000);
		expect(catalogResult({ catalog: {} })).toBeNull();
	});

	it('keeps list, details and results accessible on narrow screens without truncating catalog errors', () => {
		expect(SERVICES_SOURCE).toContain("['results', $i18n.t('Result')]");
		expect(SERVICES_SOURCE).toContain("class:hidden={mobileView !== 'results'}");
		expect(SERVICES_SOURCE).toContain('provider-list-error');
		expect(SERVICES_SOURCE).toContain('whitespace-normal break-words text-xs text-amber');
		expect(RESULTS_SOURCE).toContain('provider-result-card');
		expect(RESULTS_SOURCE).toContain('onOpenModels');
	});

	it('records the operation outcomes at their source rather than deriving them from a toast', () => {
		expect(PANEL_SOURCE).toContain('providerResults.set(connectionId, result?.error');
		expect(SERVICES_SOURCE).toContain("providerResults.set(connection.id, result?.error");
		expect(TEST_SOURCE).toContain('providerResults.set(connectionId, result?.status');
	});
});

describe('provider models panel fetch wiring', () => {
	it('renders the fetch status next to the button, before the model list', () => {
		const statusIndex = PANEL_SOURCE.indexOf('provider-models-fetch-status');
		const modelsIndex = PANEL_SOURCE.indexOf('{#if models.length === 0}');
		const buttonIndex = PANEL_SOURCE.indexOf('Fetch model list');
		expect(statusIndex).toBeGreaterThan(-1);
		expect(modelsIndex).toBeGreaterThan(statusIndex);
		expect(statusIndex).toBeGreaterThan(buttonIndex);
	});

	it('keeps the result in an out-of-component cache so it survives tab switches', () => {
		expect(PANEL_SOURCE).toContain('context="module"');
		expect(PANEL_SOURCE).toContain('feedbackCache');
	});

	it('does not block the result display on the parent refresh', () => {
		const fetchBody = PANEL_SOURCE.slice(
			PANEL_SOURCE.indexOf('async function fetchModels'),
			PANEL_SOURCE.indexOf('function togglePick')
		);
		// Pre-fix, fetchModels awaited updated() before clearing the loading
		// state, so a slow parent load kept the button in "Fetching…" forever.
		expect(fetchBody).not.toMatch(/await\s+updated\(\)/);
		expect(fetchBody).toContain('updated().catch(');
	});

	it('guards against duplicate submissions and exposes the loading state', () => {
		expect(PANEL_SOURCE).toContain('if (fetching) return;');
		expect(PANEL_SOURCE).toContain('aria-busy={fetching}');
		expect(PANEL_SOURCE).toContain('disabled={fetching}');
	});

	it('writes the outcome to a toast as well as the inline status', () => {
		const fetchBody = PANEL_SOURCE.slice(
			PANEL_SOURCE.indexOf('async function fetchModels'),
			PANEL_SOURCE.indexOf('function togglePick')
		);
		expect(fetchBody).toContain('toast.success(');
		expect(fetchBody).toContain('toast.error(');
	});
});
