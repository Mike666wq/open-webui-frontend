import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url)); // .../src/lib
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

// P-007 S4/S5 (K14-K20). Component rendering needs a browser, so these are
// static source assertions in the same style as notes-knowledge-p004.test.ts,
// paired with the pure Markdown tests in utils/tiptap-markdown.test.ts.
describe('P-007 K14: suggested-prompt caption uses the contrast-checked token', () => {
	const chat = read('components/chat/Chat.svelte');

	it('uses the shared muted token class and no hardcoded light grey', () => {
		expect(chat).toContain('class="mist-text-muted mb-2 text-[0.75rem]"');
		// The previous fixed palette is what measured ~1.4:1 on the glass surface.
		expect(chat).not.toContain('mb-2 text-[0.75rem] text-gray-300 dark:text-gray-700');
	});

	it('defines .mist-text-muted on top of --mist-muted rather than a literal colour', () => {
		const css = read('styles/mist-app.css');

		expect(css).toMatch(/\.mist-text-muted\s*\{\s*color:\s*var\(--mist-muted\);/);
		// The rule must not redeclare any Mist token (only consume it), so P-004's
		// contrast values stay owned by the appearance layer.
		expect(css).not.toMatch(/\.mist-text-muted\s*\{[^}]*--mist-[a-z-]+\s*:/);
	});

	it('the token is derived with a 4.5 contrast target', () => {
		const color = read('appearance/color.ts');

		expect(color).toContain('ensureReadableText(');
		expect(color).toMatch(/target = 4\.5/);
	});
});

describe('P-007 K15: knowledge base id is compact but still one-click copyable', () => {
	const src = read('components/workspace/Knowledge/KnowledgeBase.svelte');

	it('renders a short prefix plus a copy icon instead of the whole UUID', () => {
		expect(src).toContain("{id.slice(0, 8)}");
		expect(src).toContain("import Clipboard from '$lib/components/icons/Clipboard.svelte'");
		// The old rule let the UUID claim 40% of the header.
		expect(src).not.toContain('max-w-[40%] shrink-0 truncate font-mono');
	});

	it('copies the full id and exposes it in the tooltip', () => {
		expect(src).toContain('copyToClipboard(id);');
		expect(src).toContain('title={`${$i18n.t(\'Click to copy ID\')} — ${id}`}');
	});
});

describe('P-007 K16: knowledge base upload affordance is discoverable', () => {
	const browser = read('components/workspace/Knowledge/KnowledgeBase/Browser.svelte');

	it('offers a visible labelled upload button', () => {
		expect(browser).toContain("import ArrowUpCircle from '$lib/components/icons/ArrowUpCircle.svelte'");
		expect(browser).toContain("on:click={() => onUpload('files', null, [])}");
		expect(browser).toContain('{$i18n.t(\'Upload\')}');
	});

	it('states the drag-and-drop target in words', () => {
		expect(browser).toContain("$i18n.t('Drop files here, or use Upload')");
	});

	it('keeps the existing "+" menu and its sync/reset entries', () => {
		expect(browser).toContain('<AddContentMenu');
		expect(browser).toContain('onSync={() => guard(onSync)}');
		expect(browser).toContain('onReset={() => guard(onReset)}');
		// Both the new button and the menu stay behind write access.
		expect(browser).toMatch(/\{#if knowledge\.write_access\}/);
	});
});

describe('P-007 K17: note editor AI entry is text bearing', () => {
	const src = read('components/notes/NoteEditor.svelte');

	it('renders a label and a one-line explanation', () => {
		expect(src).toContain("{$i18n.t('AI assistant')}");
		expect(src).toContain("$i18n.t('Summarise or rewrite this note with AI')");
		expect(src).toContain("$i18n.t('AI assistant: summarise or rewrite this note')");
	});

	it('reuses the existing chat-open handler instead of a second panel', () => {
		expect(src).toContain('on:click={openNoteChat}');
		// Exactly one embedded Chat instance; K17 must not add another.
		expect(src.match(/<Chat\b/g)?.length).toBe(1);
	});
});

describe('P-007 K18: changelog is per-version, not per-load', () => {
	const layout = read('../routes/(app)/+layout.svelte');

	it('gates on the locally remembered version first', () => {
		expect(layout).toContain('const seenVersion = localStorage.version ?? $settings?.version;');
		expect(layout).toContain('showChangelog.set(seenVersion !== $config.version);');
		expect(layout).not.toContain('showChangelog.set($settings?.version !== $config.version);');
	});

	it('keeps the dismiss path writing the version', () => {
		const modal = read('components/ChangelogModal.svelte');

		expect(modal).toContain('localStorage.version = $config.version;');
		expect(modal).toContain('show = false;');
	});
});

describe('P-007 K19: formatting toolbar exposes the P-005 syntax set', () => {
	const buttons = read('components/common/RichTextInput/FormattingButtons.svelte');

	it('wires blockquote, table, rule, highlight, superscript and subscript', () => {
		for (const action of [
			'toggleBlockquote()',
			'insertTable({ rows: 3, cols: 3, withHeaderRow: true })',
			'setHorizontalRule()',
			'toggleHighlight()',
			"toggleMark('superscript')",
			"toggleMark('subscript')"
		]) {
			expect(buttons, `missing ${action}`).toContain(action);
		}
	});

	it('uses icons and the shared button styling instead of bare glyphs', () => {
		for (const icon of ['Blockquote', 'Grid', 'Minus', 'Highlighter', 'Superscript', 'Subscript']) {
			expect(buttons, `missing icon ${icon}`).toContain(
				`import ${icon} from '$lib/components/icons/${icon}.svelte'`
			);
		}
		for (const glyph of ['❝', '▦', '🖍', 'xⁿ', 'xₙ']) {
			expect(buttons, `stray glyph ${glyph}`).not.toContain(glyph);
		}
		// Every new button must carry the same rounded/hover classes as the rest.
		expect(buttons.match(/rounded-lg p-1\.5 transition-all/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
	});

	it('the editor config actually registers the extensions these buttons drive', () => {
		const editor = read('components/common/RichTextInput.svelte');

		for (const extension of ['TableKit', 'Highlight', 'Superscript', 'Subscript']) {
			expect(editor, `editor missing ${extension} extension`).toContain(extension);
		}
		// Blockquote and HorizontalRule ship with StarterKit.
		expect(editor).toContain('StarterKit.configure(');
	});
});

describe('P-007 K20: dead AIMenu component is gone', () => {
	it('the file no longer exists and nothing references it', () => {
		expect(existsSync(join(dir, 'components/notes/AIMenu.svelte'))).toBe(false);

		const notesList = read('components/notes/Notes.svelte');
		const editor = read('components/notes/NoteEditor.svelte');
		expect(notesList).not.toContain('AIMenu');
		expect(editor).not.toContain('AIMenu');
	});
});
