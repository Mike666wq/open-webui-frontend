import { WEBUI_API_BASE_URL } from '$lib/constants';
import type { ProviderError } from '$lib/utils/provider-errors';

/**
 * A failed provider request.
 *
 * The backend keeps the stage, the reason and the suggested action next to the
 * message. They travel with the error so the interface can offer a recovery
 * instead of only repeating what went wrong.
 */
export class ProviderApiError extends Error {
	providerError: ProviderError | null;

	constructor(message: string, providerError: ProviderError | null = null) {
		super(message);
		this.name = 'ProviderApiError';
		this.providerError = providerError;
	}
}

/** The taxonomy of a failed request, when the backend sent one. */
const providerErrorOf = (body: any): ProviderError | null => {
	const candidate = body?.error ?? body?.detail?.error ?? null;
	if (candidate && typeof candidate === 'object' && typeof candidate.category === 'string') {
		return candidate as ProviderError;
	}
	return null;
};

const request = async (path: string, options: RequestInit = {}) => {
	const token = typeof localStorage !== 'undefined' ? localStorage.token : '';
	let response: Response;
	try {
		response = await fetch(`${WEBUI_API_BASE_URL}/providers${path}`, {
			...options,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(token ? { authorization: `Bearer ${token}` } : {}),
				...options.headers
			}
		});
	} catch {
		throw new Error('Cannot reach the Open WebUI server. Check your connection and try again.');
	}
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = body?.detail;
		const message = [detail?.message, detail?.error?.message, detail, body?.message].find(
			(value) => typeof value === 'string'
		);
		throw new ProviderApiError(
			message ?? `Request failed (${response.status})`,
			providerErrorOf(body)
		);
	}
	return body;
};

export interface ProviderTemplate {
	id: string;
	name: string;
	protocol: string;
	protocol_label?: string;
	group: string;
	group_label?: string;
	auth_types: string[];
	default_base_url: string;
	docs_url?: string;
	supported: boolean;
	unsupported_reason?: string | null;
}

export interface ProviderTemplateGroup {
	id: string;
	label: string;
	order: number;
}

/**
 * The catalog endpoint answers with the grouped template list. Older backends
 * answer with a bare array, so both shapes are accepted here.
 */
export const getProviderCatalog = async () => {
	const body = await request('');
	const data = Array.isArray(body) ? body : (body?.data ?? []);
	const groups = Array.isArray(body?.groups) ? body.groups : [];
	return { data: data as ProviderTemplate[], groups: groups as ProviderTemplateGroup[] };
};
export const getProviderConnections = () => request('/connections');
export const createProviderConnection = (payload: Record<string, unknown>) =>
	request('/connections', { method: 'POST', body: JSON.stringify(payload) });
export const updateProviderConnection = (id: string, payload: Record<string, unknown>) =>
	request(`/connections/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});
export const deleteProviderConnection = (id: string) =>
	request(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const verifyProviderConnection = (id: string) =>
	request(`/connections/${encodeURIComponent(id)}/verify`, { method: 'POST', body: '{}' });
export const verifyProviderDraft = (payload: Record<string, unknown>) =>
	request('/connections/verify', { method: 'POST', body: JSON.stringify(payload) });
export const getProviderModels = (purpose = 'chat') =>
	request(`/models?purpose=${encodeURIComponent(purpose)}`);
export const testProviderModel = (id: string, payload: Record<string, unknown>) =>
	request(`/connections/${encodeURIComponent(id)}/model-test`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});
export const getMediaMigration = () => request('/media-migration');
export const migrateMediaSetting = (purpose: string, fingerprint: string) =>
	request('/media-migration', {
		method: 'POST',
		body: JSON.stringify({ purpose, fingerprint })
	});

export const startChatGPTLogin = (connectionId?: string) =>
	request('/auth/chatgpt/start', {
		method: 'POST',
		body: JSON.stringify({
			mode: 'browser',
			...(connectionId ? { connection_id: connectionId } : {})
		})
	});
export const completeChatGPTLogin = (attemptId: string, callbackUrl: string) =>
	request(`/auth/chatgpt/${encodeURIComponent(attemptId)}/callback`, {
		method: 'POST',
		body: JSON.stringify({ callback_url: callbackUrl })
	});
export const getChatGPTLoginStatus = (attemptId: string) =>
	request(`/auth/chatgpt/${encodeURIComponent(attemptId)}`);
export const cancelChatGPTLogin = (attemptId: string) =>
	request(`/auth/chatgpt/${encodeURIComponent(attemptId)}`, { method: 'DELETE' });
export const disconnectChatGPTConnection = (connectionId: string) =>
	request(`/auth/chatgpt/connection/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });

export const startKimiLogin = (connectionId?: string) =>
	request('/auth/kimi/start', {
		method: 'POST',
		body: JSON.stringify(connectionId ? { connection_id: connectionId } : {})
	});
export const getKimiLoginStatus = (attemptId: string) =>
	request(`/auth/kimi/${encodeURIComponent(attemptId)}`);
export const cancelKimiLogin = (attemptId: string) =>
	request(`/auth/kimi/${encodeURIComponent(attemptId)}`, { method: 'DELETE' });
export const disconnectKimiConnection = (connectionId: string) =>
	request(`/auth/kimi/connection/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });

export const setProviderConnectionEnabled = (id: string, enabled: boolean) =>
	request(`/connections/${encodeURIComponent(id)}/enabled`, {
		method: 'PUT',
		body: JSON.stringify({ enabled })
	});
export const fetchProviderModels = (id: string) =>
	request(`/connections/${encodeURIComponent(id)}/models/fetch`, {
		method: 'POST',
		body: '{}'
	});
export const addProviderModels = (
	id: string,
	payload: {
		upstream_ids: string[];
		display_names?: Record<string, string>;
		uses?: Record<string, string>;
	}
) =>
	request(`/connections/${encodeURIComponent(id)}/models`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});
export const updateProviderModel = (
	id: string,
	upstream_id: string,
	payload: { display_name?: string; uses?: Record<string, string>; enabled?: boolean }
) =>
	request(`/connections/${encodeURIComponent(id)}/models/${encodeURIComponent(upstream_id)}`, {
		method: 'PUT',
		body: JSON.stringify(payload)
	});
export const removeProviderModel = (id: string, upstream_id: string) =>
	request(`/connections/${encodeURIComponent(id)}/models/${encodeURIComponent(upstream_id)}`, {
		method: 'DELETE'
	});
export const getProviderCalls = (filters: Record<string, string> = {}) =>
	request(`/calls/history?${new URLSearchParams(filters)}`);
export const previewLegacyMigration = () => request('/legacy-migration/preview');
export const applyLegacyMigration = (payload: Record<string, unknown>) =>
	request('/legacy-migration/apply', { method: 'POST', body: JSON.stringify(payload) });
