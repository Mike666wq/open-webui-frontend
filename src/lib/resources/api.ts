import { WEBUI_API_BASE_URL } from '$lib/constants';

export type ResourceKind = 'chat' | 'file' | 'note' | 'knowledge' | 'share' | 'channel';
export type Resource = {
	id: string;
	type: ResourceKind;
	title: string;
	size_bytes: number;
	updated_at?: number;
	href?: string;
	state?: string;
	restorable?: boolean;
	expires_at?: number;
	meta?: { reason?: string; effect?: string };
};
export type Impact = Resource & {
	allowed: boolean;
	reasons: string[];
	pauses_share?: boolean;
	effect?: string;
	retained_references?: number;
	recycled_files?: number;
	retained_files?: number;
};
export type Preflight = {
	id: string;
	items: Impact[];
	allowed: number;
	estimated_bytes: number;
};
export type Task = {
	id: string;
	action: string;
	state: string;
	created_at: number;
	attempts: number;
	results: { id: string; type: string; success: boolean; reason?: string; object_bytes?: number }[];
};

export async function resourceRequest<T>(path: string, body?: unknown, method?: string): Promise<T> {
	const response = await fetch(`${WEBUI_API_BASE_URL}/resources${path}`, {
		method: method ?? (body === undefined ? 'GET' : 'POST'),
		credentials: 'include',
		headers: {
			Authorization: `Bearer ${localStorage.token ?? ''}`,
			...(body === undefined ? {} : { 'Content-Type': 'application/json' })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const result = await response.json().catch(() => null);
	if (!response.ok) {
		const detail = result?.detail;
		throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail ?? `HTTP ${response.status}`));
	}
	return result as T;
}

export function summarizeTask(task: Task) {
	return {
		success: task.results.filter((item) => item.success).length,
		failed: task.results.filter((item) => !item.success).length,
		running: task.state === 'pending' || task.state === 'running'
	};
}
