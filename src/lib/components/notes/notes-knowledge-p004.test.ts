import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

describe('workspace loop: notes knowledge wiring', () => {
	it('NoteKnowledgeModal uses readiness/sync/remove APIs and shared error formatting', () => {
		const src = read('Notes/NoteKnowledgeModal.svelte');
		for (const needle of [
			'getNoteKnowledgeReadiness', 'getWorkspaceLoopReadiness', 'syncNoteKnowledge',
			'removeNoteKnowledgeSnapshot', 'describeApiError', 'selectWritableKnowledgeBases',
			'snapshotViewState', 'role="alert"', "$i18n.t('Retry')",
			"$i18n.t('Knowledge loop not ready')", 'create-knowledge-base-link', 'save-to-knowledge-confirm'
		]) expect(src, `missing ${needle}`).toContain(needle);
		for (const oldApi of [
			'uploadFile', 'renameFileById', 'updateFileDataContentById', 'addFileToKnowledgeById',
			'updateFileFromKnowledgeById', 'updateNoteById'
		]) expect(src, `old API still used: ${oldApi}`).not.toContain(oldApi);
		expect(src).not.toContain("k.type !== 'external'");
	});

	it('Notes list/grid gates save-to-knowledge by write_access', () => {
		const src = read('Notes.svelte');
		expect(src.match(/note\?\.write_access !== false/g)?.length).toBe(2);
		expect(src.match(/<NoteKnowledgeModal/g)?.length).toBe(1);
	});

	it('NoteEditor canonicalizes titles and flushes pending note saves', () => {
		const src = read('NoteEditor.svelte');
		expect(src).toContain('canonicalNoteTitle');
		expect(src).toContain('openKnowledgeModal');
		expect(src).toContain("$i18n.t('Saving note before snapshot')");
		expect(src).toContain('describeApiError');
		expect(src).toContain('note?.write_access ? openKnowledgeModal : null');
	});

	it('API wrappers expose all workspace-loop endpoints', () => {
		const src = read('../../apis/notes/index.ts');
		for (const needle of ['/loop/readiness', '/knowledge/readiness', '/knowledge/', '/sync', '/snapshot', '/from-chat'])
			expect(src, `missing API path ${needle}`).toContain(needle);
	});

	it('i18n keys exist in zh-CN and en-US with non-empty values', () => {
		const zh = JSON.parse(read('../../i18n/locales/zh-CN/translation.json'));
		const en = JSON.parse(read('../../i18n/locales/en-US/translation.json'));
		const keys = [
			'No writable knowledge bases', 'Create a knowledge base', 'Retry', 'Remove snapshot',
			'Remove from knowledge base', 'Indexing…', 'Indexing failed', 'No permission to save to knowledge',
			'Saving note before snapshot', 'Snapshot linked; indexing in progress', 'Conversation saved to note',
			'Conversation saved to knowledge base', 'Knowledge loop not ready', 'Knowledge bases failed to load',
			'Notes failed to load', 'Save as note', 'Save to knowledge', 'Session changed, please retry.'
		];
		for (const key of keys) {
			expect(String(zh[key] ?? ''), `zh-CN missing ${key}`).not.toBe('');
			expect(String(en[key] ?? ''), `en-US missing ${key}`).not.toBe('');
		}
	});
});
