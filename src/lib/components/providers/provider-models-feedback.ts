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
