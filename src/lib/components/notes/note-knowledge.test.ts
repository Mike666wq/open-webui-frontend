import { describe, expect, it } from 'vitest';
import sha256 from 'js-sha256';

import {
	findSnapshot,
	noteSnapshotFingerprint,
	removeSnapshot,
	snapshotIds,
	snapshotState,
	upsertSnapshot
} from './note-knowledge';

const FP = (title: string, content: string) => sha256(JSON.stringify([title, content]));

describe('noteSnapshotFingerprint', () => {
	it('matches the recording page fingerprint semantics (sha256 of JSON [title, content])', () => {
		expect(noteSnapshotFingerprint('T', 'C')).toBe(FP('T', 'C'));
	});

	it('is sensitive to title and content changes', () => {
		expect(noteSnapshotFingerprint('T', 'C')).not.toBe(noteSnapshotFingerprint('T2', 'C'));
		expect(noteSnapshotFingerprint('T', 'C')).not.toBe(noteSnapshotFingerprint('T', 'C2'));
	});
});

describe('findSnapshot', () => {
	it('returns null for missing meta, missing mapping, or mapping without file_id', () => {
		expect(findSnapshot(null, 'kb1')).toBeNull();
		expect(findSnapshot({}, 'kb1')).toBeNull();
		expect(findSnapshot({ note_knowledge: {} }, 'kb1')).toBeNull();
		expect(findSnapshot({ note_knowledge: { kb1: { fingerprint: 'x' } } }, 'kb1')).toBeNull();
	});

	it('returns the stored snapshot', () => {
		const snap = { file_id: 'f1', fingerprint: 'fp', updated_at: 1 };
		expect(findSnapshot({ note_knowledge: { kb1: snap } }, 'kb1')).toEqual(snap);
	});
});

describe('snapshotState', () => {
	const meta = {
		note_knowledge: {
			kb1: { file_id: 'f1', fingerprint: FP('T', 'C'), updated_at: 1 },
			kb2: { file_id: 'f2', fingerprint: FP('old', 'old'), updated_at: 2 }
		}
	};

	it('returns "new" when no mapping exists', () => {
		expect(snapshotState(null, 'kbX', 'T', 'C')).toBe('new');
		expect(snapshotState(meta, 'kbX', 'T', 'C')).toBe('new');
	});

	it('returns "synced" when fingerprint matches the current title/content', () => {
		expect(snapshotState(meta, 'kb1', 'T', 'C')).toBe('synced');
	});

	it('returns "changed" when the content changed since last sync', () => {
		expect(snapshotState(meta, 'kb2', 'T', 'C')).toBe('changed');
		expect(snapshotState(meta, 'kb1', 'T', 'C2')).toBe('changed');
	});
});

describe('upsertSnapshot', () => {
	it('creates note_knowledge when meta is null and does not mutate the input', () => {
		const input = null;
		const out = upsertSnapshot(input, 'kb1', 'f1', 'T', 'C', 42);
		expect(out.note_knowledge.kb1).toEqual({
			file_id: 'f1',
			fingerprint: FP('T', 'C'),
			updated_at: 42
		});
	});

	it('preserves other mappings and overwrites only the target', () => {
		const input = {
			note_knowledge: {
				kb1: { file_id: 'f1', fingerprint: 'old1', updated_at: 1 },
				kb2: { file_id: 'f2', fingerprint: 'old2', updated_at: 2 }
			},
			other: 'kept'
		};
		const out = upsertSnapshot(input, 'kb1', 'f9', 'T2', 'C2', 99);
		expect(out.note_knowledge.kb1).toEqual({
			file_id: 'f9',
			fingerprint: FP('T2', 'C2'),
			updated_at: 99
		});
		expect(out.note_knowledge.kb2).toEqual(input.note_knowledge.kb2);
		expect(out.other).toBe('kept');
		// input untouched
		expect(input.note_knowledge.kb1.file_id).toBe('f1');
	});
});

describe('removeSnapshot', () => {
	it('removes only the target mapping and preserves the rest', () => {
		const input = {
			note_knowledge: {
				kb1: { file_id: 'f1', fingerprint: 'a', updated_at: 1 },
				kb2: { file_id: 'f2', fingerprint: 'b', updated_at: 2 }
			}
		};
		const out = removeSnapshot(input, 'kb1');
		expect(out.note_knowledge).toEqual({ kb2: input.note_knowledge.kb2 });
		// input untouched
		expect(out.note_knowledge.kb2).toBe(input.note_knowledge.kb2);
		expect(Object.keys(input.note_knowledge)).toContain('kb1');
	});

	it('handles null meta', () => {
		expect(removeSnapshot(null, 'kb1')).toEqual({ note_knowledge: {} });
	});
});

describe('snapshotIds', () => {
	it('lists mapping keys and tolerates missing meta', () => {
		expect(snapshotIds(null)).toEqual([]);
		expect(snapshotIds({ note_knowledge: { a: {}, b: {} } })).toEqual(['a', 'b']);
	});
});
