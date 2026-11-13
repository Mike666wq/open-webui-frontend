import sha256 from 'js-sha256';

/**
 * The workspace loop has one canonical fingerprint, and the server owns it.
 * These helpers exist so the frontend can *compare* the same way the backend
 * computes it — they never decide that a snapshot is "synced" when the server
 * says otherwise (see `snapshotViewState`).
 */

/**
 * The literal title used when a note has no title. It must not be localised:
 * switching the interface language would otherwise change the fingerprint and
 * make every snapshot look "changed" forever.
 */
export const UNTITLED_NOTE_TITLE = 'Untitled';

/**
 * Canonical title of a note: the title itself when it carries content, and the
 * literal `Untitled` otherwise. Mirrors the backend rule
 * `(title ?? '').trim() ? title : 'Untitled'`.
 */
export const canonicalNoteTitle = (title: string | null | undefined): string => {
	const raw = title ?? '';
	return raw.trim() ? raw : UNTITLED_NOTE_TITLE;
};

// Plain notes and recording transcripts keep separate mapping namespaces
// (note_knowledge vs recording_knowledge) with the same snapshot semantics.
// The fingerprint is sha256(JSON.stringify([canonicalTitle, content])) — see
// the workspace loop contract, §2.
export const noteSnapshotFingerprint = (title: string, content: string) =>
	sha256(JSON.stringify([canonicalNoteTitle(title), content]));

export interface NoteKnowledgeSnapshot {
	file_id: string;
	fingerprint: string;
	updated_at: number;
	/** Server-owned state of the snapshot: synced | changed | indexing | failed | unavailable. */
	state?: string;
	/** Server-owned index state: completed | pending | failed | unknown. */
	index_state?: string;
	/** Why the last index attempt failed, when it did. */
	index_error?: string | null;
}

export type NoteKnowledgeSnapshotState = 'new' | 'synced' | 'changed';

/**
 * The states the interface can show for a knowledge snapshot. `new` and
 * `changed` come from the local comparison, the rest are server-owned.
 */
export type NoteKnowledgeViewState =
	| 'new'
	| 'synced'
	| 'changed'
	| 'indexing'
	| 'failed'
	| 'no-permission'
	| 'unavailable';

export type KnowledgeBaseLike = {
	id?: string | null;
	name?: string | null;
	write_access?: boolean | null;
	external?: boolean | null;
	meta?: Record<string, any> | null;
};

/**
 * The knowledge bases the current user may actually write a snapshot into.
 *
 * The server publishes `write_access`; external bases are read-only and must
 * never appear here. Accepts both a bare array and the `{items, total}`
 * envelope the paginated knowledge endpoints return, and never returns the
 * same base twice.
 */
export const selectWritableKnowledgeBases = (items: any): KnowledgeBaseLike[] => {
	const list: any[] = Array.isArray(items)
		? items
		: Array.isArray(items?.items)
			? items.items
			: [];

	const seen = new Set<string>();
	const writable: KnowledgeBaseLike[] = [];

	for (const base of list) {
		if (!base || typeof base !== 'object') continue;
		// Only an explicit `write_access: true` counts. A missing flag is not
		// permission, and guessing produced "saved" chips for read-only bases.
		if (base.write_access !== true) continue;
		// External bases are read-only by contract.
		if (base.meta?.source === 'external' || base.external === true) continue;

		const id = typeof base.id === 'string' ? base.id : null;
		if (!id || seen.has(id)) continue;
		seen.add(id);
		writable.push(base as KnowledgeBaseLike);
	}

	return writable;
};

/**
 * The state of one snapshot as the interface should show it.
 *
 * The server owns the truth: whenever the payload carries `state`,
 * `index_state`, `index_error`, `exists` or `can_write`, that wins. Only when
 * none of them are present do we fall back to comparing the local fingerprint
 * with the current note content.
 */
export function snapshotViewState(entry: any, currentFingerprint: string): NoteKnowledgeViewState {
	if (!entry) return 'new';

	// The file is gone (deleted, recycled or never created).
	if (entry.exists === false) return 'unavailable';
	// The base cannot be written by this user any more.
	if (entry.can_write === false) return 'no-permission';
	if (entry.external === true) return 'no-permission';

	const serverState = typeof entry.state === 'string' ? entry.state.trim().toLowerCase() : '';
	const indexState =
		typeof entry.index_state === 'string' ? entry.index_state.trim().toLowerCase() : '';

	switch (serverState) {
		case 'failed':
			return 'failed';
		case 'unavailable':
			return 'unavailable';
		case 'no-permission':
		case 'no_permission':
			return 'no-permission';
		case 'indexing':
			return 'indexing';
		case 'changed':
			return 'changed';
		case 'synced':
			if (indexState === 'failed') return 'failed';
			if (indexState === 'pending') return 'indexing';
			return 'synced';
	}

	// No server state: fall back to the index state the file itself reports.
	if (indexState === 'failed') return 'failed';
	if (indexState === 'pending') return 'indexing';

	// Legacy payloads only carry the fingerprint.
	if (!entry.file_id) return 'new';
	return entry.fingerprint === currentFingerprint ? 'synced' : 'changed';
}

/**
 * The reason the server gave for a failed index, if any.
 */
export function snapshotIndexError(entry: any): string | null {
	const message = entry?.index_error;
	if (typeof message !== 'string') return null;
	return message.trim() ? message.trim() : null;
}

export function findSnapshot(
	meta: any,
	knowledgeId: string
): NoteKnowledgeSnapshot | null {
	const snap = meta?.note_knowledge?.[knowledgeId];
	if (!snap || !snap.file_id) return null;
	return snap;
}

export function snapshotState(
	meta: any,
	knowledgeId: string,
	title: string,
	content: string
): NoteKnowledgeSnapshotState {
	const snap = findSnapshot(meta, knowledgeId);
	if (!snap) return 'new';
	return snap.fingerprint === noteSnapshotFingerprint(title, content) ? 'synced' : 'changed';
}

// Returns a new meta object with the snapshot for knowledgeId upserted.
// Never mutates the input; safe to pass through updateNoteById.
export function upsertSnapshot(
	meta: any,
	knowledgeId: string,
	fileId: string,
	title: string,
	content: string,
	updatedAt: number = Date.now()
): any {
	const base = { ...(meta ?? {}) };
	base.note_knowledge = {
		...((meta?.note_knowledge as Record<string, NoteKnowledgeSnapshot>) ?? {}),
		[knowledgeId]: {
			file_id: fileId,
			fingerprint: noteSnapshotFingerprint(title, content),
			updated_at: updatedAt
		}
	};
	return base;
}

// Removes the local mapping for knowledgeId (e.g. the knowledge base was
// deleted or became inaccessible). Other mappings are preserved.
export function removeSnapshot(meta: any, knowledgeId: string): any {
	const base = { ...(meta ?? {}) };
	const rest = { ...((meta?.note_knowledge as Record<string, NoteKnowledgeSnapshot>) ?? {}) };
	delete rest[knowledgeId];
	base.note_knowledge = rest;
	return base;
}

export function snapshotIds(meta: any): string[] {
	return Object.keys(meta?.note_knowledge ?? {});
}

/**
 * The body of `POST /notes/from-chat`, built without the optional parts.
 *
 * The backend treats an empty title as "derive it from the message" and an
 * empty knowledge id as "do not sync yet", so both keys are omitted rather
 * than sent blank.
 */
export const buildNoteFromChatPayload = (
	chatId: string,
	messageId: string,
	options: { title?: string | null; knowledgeId?: string | null } = {}
) => {
	const title = (options?.title ?? '').trim();
	const knowledgeId = (options?.knowledgeId ?? '').trim();

	return {
		chat_id: chatId,
		message_id: messageId,
		...(title ? { title } : {}),
		...(knowledgeId ? { knowledge_id: knowledgeId } : {})
	};
};
