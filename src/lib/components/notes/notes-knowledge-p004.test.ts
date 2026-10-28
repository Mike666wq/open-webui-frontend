import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

// P-004 step 3 (K1-K4): notes -> knowledge base closed loop.
// Component rendering is not feasible without jsdom, so these are static
// source assertions paired with the pure-function tests in note-knowledge.test.ts.
describe('P-004 step 3: notes knowledge wiring', () => {
	it('NoteMenu exposes a save-to-knowledge entry gated by the prop', () => {
		const src = read('Notes/NoteMenu.svelte');

		expect(src).toContain('onSaveToKnowledge');
		expect(src).toMatch(/{#if onSaveToKnowledge}/);
		expect(src).toContain("$i18n.t('Save to knowledge base')");
		// Menu item is inside a conditional block so consumers without the prop
		// are unaffected.
		const itemIdx = src.indexOf("{#if onSaveToKnowledge}");
		const endIdx = src.indexOf('{/if}', itemIdx);
		expect(endIdx).toBeGreaterThan(itemIdx);
	});

	it('Notes list page wires the modal for list and grid menus', () => {
		const src = read('Notes.svelte');

		expect(src).toContain("import NoteKnowledgeModal from './Notes/NoteKnowledgeModal.svelte'");
		// Both menu usages pass the handler.
		expect(src.match(/onSaveToKnowledge=\{\(\) => \{/g)?.length).toBe(2);
		expect(src).toContain('showKnowledgeModal = true');
		// Modal is mounted once.
		expect(src.match(/<NoteKnowledgeModal/g)?.length).toBe(1);
		expect(src).toContain('note={selectedNote}');
	});

	it('NoteEditor adds toolbar entry, menu entry, modal and snapshot chips', () => {
		const src = read('NoteEditor.svelte');

		expect(src).toContain("import NoteKnowledgeModal from './Notes/NoteKnowledgeModal.svelte'");
		expect(src).toContain("import { snapshotIds, snapshotState } from './note-knowledge'");
		expect(src).toContain("import { getKnowledgeBases } from '$lib/apis/knowledge'");

		// Toolbar button and menu entry are write-gated.
		expect(src.match(/{#if note\?\.write_access}\s*\n\s*<Tooltip content=\{\$i18n\.t\('Save to knowledge base'\)\}/)?.length).toBe(1);
		expect(src).toContain(
			'onSaveToKnowledge={note?.write_access ? () => (showKnowledgeModal = true) : null}'
		);

		// Chips row renders from server-backed meta only.
		expect(src).toContain('data-testid="knowledge-snapshot-chips"');
		expect(src).toContain('knowledgeSnapshotEntries');
		expect(src).toContain("snapshotState(\n\t\t\t\t\tnote.meta,");
		// Chips fall back to the unavailable text when the base is gone.
		expect(src.match(/This knowledge base is unavailable or deleted/g)?.length).toBe(2);

		// Modal mounted; only meta is synced back to the live note object.
		expect(src.match(/<NoteKnowledgeModal/g)?.length).toBe(1);
		expect(src).toContain('note.meta = updated.meta');
	});

	it('i18n keys exist in zh-CN and en-US with parity', () => {
		const zh = JSON.parse(read('../../i18n/locales/zh-CN/translation.json'));
		const en = JSON.parse(read('../../i18n/locales/en-US/translation.json'));

		const keys = [
			'Save to knowledge base',
			'Saved to knowledge',
			'Select knowledge base',
			'Snapshot up to date',
			'Snapshot has changes',
			'This knowledge base is unavailable or deleted',
			'Force update',
			'Failed to save to knowledge base'
		];

		for (const key of keys) {
			expect(zh[key], `zh-CN missing "${key}"`).toBeTruthy();
			expect(en, `en-US missing "${key}"`).toHaveProperty(key);
		}

		// Reused keys must already exist upstream.
		for (const key of [
			'Save',
			'Saving...',
			'Update',
			'Remove',
			'Untitled',
			'Knowledge snapshot updated',
			'Saved {{document}} to {{knowledge}}'
		]) {
			expect(zh[key], `zh-CN missing reused key "${key}"`).toBeTruthy();
			expect(en[key] ?? '').toBeDefined();
		}
	});
});
