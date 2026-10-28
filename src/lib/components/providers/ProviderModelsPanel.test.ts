import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	createFetchFeedbackCache,
	errorFeedback,
	formatFetchTime,
	successFeedback,
	thrownFeedback
} from './provider-models-feedback';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL_SOURCE = readFileSync(join(HERE, 'ProviderModelsPanel.svelte'), 'utf8');

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
