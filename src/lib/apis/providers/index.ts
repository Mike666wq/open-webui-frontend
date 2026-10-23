import { WEBUI_API_BASE_URL } from '$lib/constants';

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
		throw new Error(message ?? `Request failed (${response.status})`);
	}
	return body;
};

export const getProviderCatalog = () => request('');
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
export const refreshProviderModels = (id: string) =>
	request(`/connections/${encodeURIComponent(id)}/models/refresh`, {
		method: 'POST',
		body: '{}'
	});
export const getProviderModels = () => request('/models');

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
