import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// P-004 step 2 (K5–K8): static assertions on Recordings.svelte plus i18n parity.
// The suite has no DOM testing runtime, so component behaviour is pinned by
// asserting the source structure, mirroring provider-i18n.test.ts conventions.

const componentRoot = join(__dirname, '..');
const source = readFileSync(join(componentRoot, 'Recordings.svelte'), 'utf8');

const zhCN = JSON.parse(
	readFileSync(join(__dirname, '../../../i18n/locales/zh-CN/translation.json'), 'utf8')
);
const enUS = JSON.parse(
	readFileSync(join(__dirname, '../../../i18n/locales/en-US/translation.json'), 'utf8')
);

describe('P-004 step 2: Recordings.svelte structure', () => {
	it('renders an always-visible list of generated organized notes (K5)', () => {
		expect(source).toContain('data-testid="summary-documents-list"');
		expect(source).toContain("i18n.t('Generated organized notes')");
		expect(source).toContain('selected.summary_note_ids');
		expect(source).toContain("href={`/notes/${id}`}");
	});

	it('loads summary titles with controlled concurrency and degrades gracefully (K5)', () => {
		expect(source).toContain('mapWithConcurrency(pending, 3');
		expect(source).toContain("i18n.t('Organized notes')} ${index + 1}");
		expect(source).toContain('createdAt');
	});

	it('reports success with a toast and scrolls to the list (K6)', () => {
		expect(source).toContain("toast.success($i18n.t('Organized note generated'))");
		expect(source).toContain('scrollIntoView');
		expect(source).toContain('data-testid="summary-progress-hint"');
		expect(source).toContain('summarySlow');
	});

	it('derives the summary request key deterministically (K7)', () => {
		expect(source).toContain('summaryRequestKey(');
		expect(source).toContain('request_key: key');
		// The old per-session random key is gone.
		expect(source).not.toContain('summaryKey');
		// A fresh random key is used only for the explicit regenerate action.
		expect(source).toContain('data-testid="summary-regenerate"');
		expect(source).toContain('generateSummary(uuidv4())');
	});

	it('shows a persistent knowledge snapshot list (K8)', () => {
		expect(source).toContain('data-testid="knowledge-snapshot-list"');
		expect(source).toContain('savedKnowledgeEntries');
		expect(source).toContain("i18n.t('Up to date')");
		expect(source).toContain("i18n.t('Has changes')");
		expect(source).toContain("href={`/workspace/knowledge/${entry.id}`}");
	});

	it('keeps the writable knowledge base selector for unsaved bases (K8)', () => {
		expect(source).toContain("i18n.t('Select a knowledge base')");
		expect(source).toContain('data-testid="knowledge-sync"');
	});
});

describe('P-004 step 2: i18n parity', () => {
	const keys = [
		'Generated organized notes',
		'Organized note generated',
		'Generating… This may take a while; you can leave this page and come back later.',
		'Still generating. The organized note will appear in the list below when it is ready; you can leave this page and come back later.',
		'Up to date',
		'Has changes',
		'Knowledge base unavailable'
	];
	it.each(keys)('defines "%s" in zh-CN and en-US', (key) => {
		expect(zhCN[key], `zh-CN missing: ${key}`).toBeTruthy();
		expect(enUS[key], `en-US missing: ${key}`).toBeTruthy();
	});
	it('keeps reused keys intact', () => {
		expect(zhCN['Open']).toBe('打开');
		expect(zhCN['Regenerate']).toBe('重新生成');
		expect(zhCN['Organized notes']).toBe('整理稿');
	});
});
