/**
 * Pure helpers for the provider model panel.
 *
 * The backend owns the wording of failures; these helpers only cover the
 * model list itself: which candidates are not in the curated whitelist yet,
 * and how a purpose is presented without leaking the internal adapter names.
 */

export const PROVIDER_PURPOSES = ['chat', 'transcription', 'speech', 'image'] as const;

export type ProviderPurpose = (typeof PROVIDER_PURPOSES)[number];

/**
 * i18n keys for the purpose labels. The components resolve them with
 * `$i18n.t()` so the panel follows the active locale.
 */
export const PURPOSE_LABEL_KEYS: Record<ProviderPurpose, string> = {
	chat: 'Chat',
	transcription: 'Transcription',
	speech: 'Speech',
	image: 'Image'
};

/** The internal adapters stay hidden; the interface only shows the purpose. */
export const PURPOSE_ADAPTERS: Record<ProviderPurpose, string[]> = {
	chat: ['openai-chat', 'responses'],
	transcription: ['openai-transcription', 'minimax-transcription'],
	speech: ['openai-speech', 'minimax-speech'],
	image: ['openai-image', 'siliconflow-image', 'minimax-image']
};

export interface ProviderModelEntry {
	upstream_id: string;
	name?: string;
	uses?: Record<string, string>;
	enabled?: boolean;
	verification?: Record<string, { status?: string; tested_at?: number; elapsed_ms?: number }>;
}

export interface ProviderCandidate {
	upstream_id: string;
	display_name?: string;
	capabilities?: string[];
	uses?: Record<string, string>;
}

/** One entry of the shared model catalog returned by `GET /providers/models`. */
export interface ProviderCatalogModel {
	id?: string;
	connection_id?: string;
	connection_name?: string;
	upstream_id?: string;
	name?: string;
	uses?: Record<string, string>;
	verification?: Record<string, { status?: string }>;
}

/**
 * The catalog entries a given purpose can use.
 *
 * A catalog entry that declares no use for the purpose is not offered: an
 * unknown media model must not fall into the chat list by accident.
 */
export function providerModelsForPurpose(
	models: ProviderCatalogModel[] | undefined,
	purpose: ProviderPurpose
): ProviderCatalogModel[] {
	return (models ?? []).filter((model) => typeof model?.uses?.[purpose] === 'string');
}

export function purposesOf(model: ProviderModelEntry | undefined): ProviderPurpose[] {
	const uses = model?.uses ?? {};
	return PROVIDER_PURPOSES.filter((purpose) => typeof uses[purpose] === 'string');
}

export function purposesOfCandidate(candidate: ProviderCandidate | undefined): ProviderPurpose[] {
	const uses = candidate?.uses ?? {};
	const declared = PROVIDER_PURPOSES.filter((purpose) => typeof uses[purpose] === 'string');
	if (declared.length > 0) return declared;
	const capabilities = candidate?.capabilities ?? [];
	if (capabilities.some((capability) => ['TG', 'Text Generation', 'chat'].includes(capability))) {
		return ['chat'];
	}
	return [];
}

/** Candidates the user has not added to the curated whitelist yet. */
export function candidatePool(
	candidates: ProviderCandidate[] | undefined,
	whitelist: ProviderModelEntry[] | undefined
): ProviderCandidate[] {
	const known = new Set((whitelist ?? []).map((model) => model.upstream_id));
	return (candidates ?? []).filter((candidate) => !known.has(candidate.upstream_id));
}

export type VerificationStatus = 'passed' | 'failed' | 'untested';

export function verificationLabel(
	verification: Record<string, { status?: string }> | undefined,
	purpose: ProviderPurpose
): VerificationStatus {
	const status = verification?.[purpose]?.status;
	return status === 'passed' || status === 'failed' ? status : 'untested';
}

export function isAnyPurposeTested(
	verification: Record<string, { status?: string }> | undefined
): boolean {
	return Object.values(verification ?? {}).some((entry) => entry?.status === 'passed');
}

/**
 * The fallback for a backend that predates the service contract.
 *
 * The authoritative answer comes from the template declaration
 * (`supportsServicePurpose` in `provider-services.ts`): an OpenAI-compatible
 * chat endpoint says nothing about whether the vendor has a transcription
 * API. This function only covers the old templates that declare no services.
 */
export function supportsPurpose(protocol: string | undefined, purpose: ProviderPurpose): boolean {
	if (protocol === 'openai-compatible' || protocol === 'openai-responses') return true;
	return purpose === 'chat';
}
