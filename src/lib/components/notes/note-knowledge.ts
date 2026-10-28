import sha256 from 'js-sha256';

// Plain notes and recording transcripts keep separate mapping namespaces
// (note_knowledge vs recording_knowledge) with the same snapshot semantics.
// Fingerprint must match the recording page's snapshotFingerprint exactly:
// sha256(JSON.stringify([title, content])) — see interface_decisions #3.
export const noteSnapshotFingerprint = (title: string, content: string) =>
	sha256(JSON.stringify([title, content]));

export interface NoteKnowledgeSnapshot {
	file_id: string;
	fingerprint: string;
	updated_at: number;
}

export type NoteKnowledgeSnapshotState = 'new' | 'synced' | 'changed';

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
