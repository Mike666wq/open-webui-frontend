import { WEBUI_API_BASE_URL } from '$lib/constants';
import { getTimeRange } from '$lib/utils';

type NoteItem = {
	title: string;
	data: object;
	meta?: null | object;
	access_grants?: object[];
};

export const createNewNote = async (token: string, note: NoteItem) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/create`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			...note
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getNotes = async (token: string = '', raw: boolean = false) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	if (raw) {
		return res; // Return raw response if requested
	}

	if (!Array.isArray(res)) {
		return {}; // or throw new Error("Notes response is not an array")
	}

	// Build the grouped object
	const grouped: Record<string, any[]> = {};
	for (const note of res) {
		const timeRange = getTimeRange(note.updated_at / 1000000000);
		if (!grouped[timeRange]) {
			grouped[timeRange] = [];
		}
		grouped[timeRange].push({
			...note,
			timeRange
		});
	}

	return grouped;
};

export const searchNotes = async (
	token: string = '',
	query: string | null = null,
	viewOption: string | null = null,
	permission: string | null = null,
	sortKey: string | null = null,
	page: number | null = null,
	direction: string | null = null
) => {
	let error = null;
	const searchParams = new URLSearchParams();

	if (query !== null) {
		searchParams.append('query', query);
	}

	if (viewOption !== null) {
		searchParams.append('view_option', viewOption);
	}

	if (permission !== null) {
		searchParams.append('permission', permission);
	}

	if (sortKey !== null) {
		searchParams.append('order_by', sortKey);
	}

	if (direction !== null) {
		searchParams.append('direction', direction);
	}

	if (page !== null) {
		searchParams.append('page', `${page}`);
	}

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/search?${searchParams.toString()}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getNoteList = async (token: string = '', page: number | null = null) => {
	let error = null;
	const searchParams = new URLSearchParams();

	if (page !== null) {
		searchParams.append('page', `${page}`);
	}

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/?${searchParams.toString()}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getNoteById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${id}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getNoteChatById = async (token: string, id: string) => {
	let error = null;
	const url = `${WEBUI_API_BASE_URL}/notes/${id}/chat`;

	console.info('[note-chat] fetching linked chat', { noteId: id, url });

	const res = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			console.info('[note-chat] linked chat response', {
				noteId: id,
				status: res.status,
				ok: res.ok
			});
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error('[note-chat] linked chat request failed', { noteId: id, error: err });
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getNoteChatsById = async (token: string, id: string) => {
	let error = null;
	const url = `${WEBUI_API_BASE_URL}/notes/${id}/chats`;

	const res = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const createNoteChatById = async (token: string, id: string) => {
	let error = null;
	const url = `${WEBUI_API_BASE_URL}/notes/${id}/chat`;

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateNoteById = async (token: string, id: string, note: NoteItem) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${id}/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			...note
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const updateNoteAccessGrants = async (token: string, id: string, accessGrants: any[]) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${id}/access/update`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ access_grants: accessGrants })
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const deleteNoteById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${id}/delete`, {
		method: 'DELETE',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;

			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const getPinnedNoteList = async (token: string = '') => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/pinned`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res ?? [];
};

/**
 * The workspace loop is coordinated by the server: the frontend only reads the
 * readiness it publishes and asks the server to perform the write.
 *
 * Every wrapper below follows the convention used by the rest of this file —
 * `err.detail` is rethrown verbatim (the structured detail the backend sends
 * is what `describeApiError` turns into a readable sentence) and nothing is
 * swallowed.
 */

export type KnowledgeBaseSummary = {
	id: string;
	name?: string | null;
	write_access?: boolean | null;
	external?: boolean | null;
	meta?: Record<string, any> | null;
};

export type WorkspaceLoopReadiness = {
	ready: boolean;
	reason_code: string | null;
	user?: Record<string, any> | null;
	embedding?: Record<string, any> | null;
	knowledge_bases?: KnowledgeBaseSummary[] | null;
	features?: Record<string, any> | null;
};

export type NoteKnowledgeSnapshotEntry = {
	knowledge_id: string;
	name?: string | null;
	file_id?: string | null;
	fingerprint?: string | null;
	updated_at?: number | null;
	state?: string | null;
	index_state?: string | null;
	index_error?: string | null;
	can_write?: boolean | null;
	exists?: boolean | null;
	external?: boolean | null;
};

export type NoteKnowledgeReadiness = {
	ready: boolean;
	reason_code: string | null;
	note?: { id: string; title?: string | null; write_access?: boolean | null } | null;
	current_fingerprint?: string | null;
	embedding?: Record<string, any> | null;
	knowledge_bases?: KnowledgeBaseSummary[] | null;
	snapshots?: NoteKnowledgeSnapshotEntry[] | null;
};

export type NoteKnowledgeSyncResult = {
	ok: boolean;
	action?: 'noop' | 'created' | 'updated' | 'repaired' | string;
	state?: 'synced' | 'indexing' | 'failed' | string;
	note_id?: string;
	knowledge_id?: string;
	file_id?: string | null;
	fingerprint?: string | null;
	updated_at?: number | null;
	index_state?: string | null;
	index_error?: string | null;
	cleanup_status?: string | null;
	message?: string | null;
};

export type NoteKnowledgeSnapshotRemoval = {
	ok: boolean;
	removed_mapping?: boolean;
	removed_file?: boolean;
	file_id?: string | null;
};

export type CreateNoteFromChatPayload = {
	chat_id: string;
	message_id: string;
	title?: string;
	knowledge_id?: string;
};

export const getWorkspaceLoopReadiness = async (token: string = '') => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/loop/readiness`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err?.detail ?? err;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res as WorkspaceLoopReadiness;
};

export const getNoteKnowledgeReadiness = async (token: string = '', noteId: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${noteId}/knowledge/readiness`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err?.detail ?? err;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res as NoteKnowledgeReadiness;
};

export const syncNoteKnowledge = async (
	token: string = '',
	noteId: string,
	knowledgeId: string,
	force: boolean = false
) => {
	let error = null;

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/notes/${noteId}/knowledge/${knowledgeId}/sync`,
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				authorization: `Bearer ${token}`
			},
			body: JSON.stringify({ force })
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err?.detail ?? err;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res as NoteKnowledgeSyncResult;
};

export const removeNoteKnowledgeSnapshot = async (
	token: string = '',
	noteId: string,
	knowledgeId: string,
	removeFile: boolean = false
) => {
	let error = null;

	const res = await fetch(
		`${WEBUI_API_BASE_URL}/notes/${noteId}/knowledge/${knowledgeId}/snapshot?remove_file=${removeFile}`,
		{
			method: 'DELETE',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				authorization: `Bearer ${token}`
			}
		}
	)
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err?.detail ?? err;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res as NoteKnowledgeSnapshotRemoval;
};

export const createNoteFromChat = async (
	token: string = '',
	payload: CreateNoteFromChatPayload
) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/from-chat`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		},
		body: JSON.stringify({
			chat_id: payload?.chat_id,
			message_id: payload?.message_id,
			...(payload?.title ? { title: payload.title } : {}),
			...(payload?.knowledge_id ? { knowledge_id: payload.knowledge_id } : {})
		})
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.catch((err) => {
			error = err?.detail ?? err;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};

export const toggleNotePinnedStatusById = async (token: string, id: string) => {
	let error = null;

	const res = await fetch(`${WEBUI_API_BASE_URL}/notes/${id}/pin`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			authorization: `Bearer ${token}`
		}
	})
		.then(async (res) => {
			if (!res.ok) throw await res.json();
			return res.json();
		})
		.then((json) => {
			return json;
		})
		.catch((err) => {
			error = err.detail;
			console.error(err);
			return null;
		});

	if (error) {
		throw error;
	}

	return res;
};
