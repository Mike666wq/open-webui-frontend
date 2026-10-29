import { writable } from 'svelte/store';
import {
	providerErrorActionLabelKey,
	providerErrorHint,
	providerErrorSummary,
	type ProviderErrorContext
} from '$lib/utils/provider-errors';

/**
 * What the operator sees right next to the "Fetch model list" button.
 *
 * The panel must show the outcome of the last fetch even after switching
 * detail tabs, so the feedback lives outside the component instance and is
 * rebuilt from these plain objects.
 */
export type FetchFeedback = {
	kind: 'success' | 'error';
	/** Number of candidate models the provider returned (0 when it failed). */
	count: number;
	/** Completion time of the fetch, as a Unix millisecond timestamp. */
	at: number;
	/** Classified failure summary; empty on success. */
	summary: string;
	/** Translation key of the suggested recovery action; null on success. */
	actionKey: string | null;
	/** Long explanation of the failure; null on success. */
	hint: string | null;
};

/** The body shape `fetchProviderModels` resolves to. */
export type FetchModelResult = {
	candidates?: any[];
	error?: any;
} | null | undefined;

/** HH:mm in the viewer's locale, shown next to the fetched count. */
export function formatFetchTime(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function successFeedback(count: number, at: number): FetchFeedback {
	return { kind: 'success', count, at, summary: '', actionKey: null, hint: null };
}

/**
 * Feedback for a fetch that answered but reported a classified provider error.
 * Candidates may still be present; the count keeps that fact visible.
 */
export function errorFeedback(
	result: Exclude<FetchModelResult, null | undefined>,
	context: ProviderErrorContext,
	at: number
): FetchFeedback {
	const error = result.error;
	return {
		kind: 'error',
		count: result.candidates?.length ?? 0,
		at,
		summary: providerErrorSummary(error),
		actionKey: providerErrorActionLabelKey(error, context),
		hint: providerErrorHint(error)
	};
}

/** Feedback for a fetch whose request itself threw (network, auth, crash). */
export function thrownFeedback(err: unknown, at: number): FetchFeedback {
	return {
		kind: 'error',
		count: 0,
		at,
		summary: String(err).replace(/^Error:\s*/, ''),
		actionKey: null,
		hint: null
	};
}

export type ProviderOperation = 'fetch' | 'verify' | 'test';
export type ProviderResult = {
	operation: ProviderOperation;
	kind: 'success' | 'error';
	at: number;
	summary: string;
	actionKey: string | null;
	hint: string | null;
	/** Error retains its classification so the recovery action matches P-001. */
	error: any | null;
	purpose?: string;
	modelName?: string;
};

export function classifiedResult(
	operation: ProviderOperation,
	error: any,
	context: ProviderErrorContext,
	at: number,
	purpose?: string,
	modelName?: string
): ProviderResult {
	return {
		operation, kind: 'error', at,
		summary: providerErrorSummary(error),
		actionKey: providerErrorActionLabelKey(error, context),
		hint: providerErrorHint(error), error, purpose, modelName
	};
}

export function requestFailureResult(
	operation: ProviderOperation,
	error: unknown,
	at: number,
	purpose?: string,
	modelName?: string,
	context: ProviderErrorContext = {}
): ProviderResult {
	const classified = (error as { providerError?: any } | null)?.providerError;
	if (classified) return classifiedResult(operation, classified, context, at, purpose, modelName);
	return {
		operation, kind: 'error', at,
		summary: String(error).replace(/^Error:\s*/, ''),
		actionKey: null, hint: null, error: null, purpose, modelName
	};
}

export function successfulResult(
	operation: ProviderOperation,
	summary: string,
	at: number,
	purpose?: string,
	modelName?: string
): ProviderResult {
	return { operation, kind: 'success', summary, at, actionKey: null, hint: null, error: null, purpose, modelName };
}

/** The current result is per connection; tab and connection switches retain it. */
export function createProviderResultCache() {
	const results = writable<Record<string, ProviderResult>>({});
	return {
		subscribe: results.subscribe,
		set(connectionId: string | undefined, result: ProviderResult) {
			if (connectionId) results.update((entries) => ({ ...entries, [connectionId]: result }));
		},
		clear(connectionId: string | undefined) {
			if (!connectionId) return;
			results.update((entries) => {
				const next = { ...entries };
				delete next[connectionId];
				return next;
			});
		}
	};
}

export const providerResults = createProviderResultCache();

export function catalogResult(connection: any): ProviderResult | null {
	const catalog = connection?.catalog;
	if (catalog?.error) {
		return classifiedResult('fetch', catalog.error, { authType: connection.auth_type },
			(catalog.error.at ?? catalog.updated_at ?? 0) * 1000);
	}
	if (catalog?.updated_at) {
		return successfulResult('fetch', '', catalog.updated_at * 1000);
	}
	return null;
}

export type FetchFeedbackCache = {
	get(connectionId: string | undefined): FetchFeedback | null;
	set(connectionId: string | undefined, feedback: FetchFeedback): void;
};

/**
 * Last fetch feedback per connection id.
 *
 * Keeping it outside the component means switching detail tabs (which
 * unmounts the panel) and coming back still shows the most recent result.
 */
export function createFetchFeedbackCache(): FetchFeedbackCache {
	const entries = new Map<string, FetchFeedback>();
	return {
		get(connectionId) {
			return (connectionId && entries.get(connectionId)) || null;
		},
		set(connectionId, feedback) {
			if (!connectionId) return;
			entries.set(connectionId, feedback);
		}
	};
}
