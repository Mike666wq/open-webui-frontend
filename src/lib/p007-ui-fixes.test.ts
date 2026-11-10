import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
	contrastRatio,
	effectiveSurface,
	relativeLuminance,
	themeColorTokens
} from './appearance/color';
import { PRESET_PALETTES } from './appearance/schema';

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

	it('keeps the hint readable when the button label collapses on narrow screens', () => {
		// Deliberate tradeoff: below the `sm` breakpoint the button shows only its
		// icon (avoids overflow at 320px), so the drag hint must NOT be hidden
		// responsively or upload would become undiscoverable.
		expect(browser).toContain('<span class="hidden sm:inline">{$i18n.t(\'Upload\')}</span>');

		const hintIndex = browser.indexOf("$i18n.t('Drop files here, or use Upload')");
		expect(hintIndex).toBeGreaterThan(-1);

		const before = browser.slice(Math.max(0, hintIndex - 240), hintIndex);
		const tagStart = before.lastIndexOf('<p');
		expect(tagStart, 'drag hint <p> not found before its text').toBeGreaterThan(-1);

		const hintTag = before.slice(tagStart);
		expect(hintTag).toContain('class="mist-text-muted');
		expect(hintTag).not.toMatch(/\bhidden\b/);
		expect(hintTag).not.toMatch(/\bsm:/);
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

describe('P-007: every new user-facing string has a real translation key', () => {
	const zh = JSON.parse(read('i18n/locales/zh-CN/translation.json'));
	const en = JSON.parse(read('i18n/locales/en-US/translation.json'));

	const strings = [
		'Upload',
		'Upload files to this knowledge base',
		'Drop files here, or use Upload',
		'AI assistant',
		'AI assistant: summarise or rewrite this note',
		'Summarise or rewrite this note with AI',
		'Summarise or rewrite this note',
		'Copy knowledge base ID',
		'Blockquote',
		'Insert table',
		'Horizontal rule',
		'Highlight',
		'Superscript',
		'Subscript',
		'Add table row',
		'Delete table row',
		'Add table column',
		'Delete table column'
	];

	it('is present in zh-CN and en-US', () => {
		for (const key of strings) {
			expect(zh[key], `zh-CN missing "${key}"`).toBeTruthy();
			expect(en[key], `en-US missing "${key}"`).toBeTruthy();
		}
	});

	it('translates rather than echoing English for the Chinese locale', () => {
		// Keys whose English value is identical to the key are legitimate, but the
		// Chinese value must differ or the UI would silently stay English.
		for (const key of ['Upload', 'AI assistant', 'Blockquote', 'Highlight', 'Superscript']) {
			expect(zh[key], `zh-CN did not translate "${key}"`).not.toBe(key);
		}
	});
});

describe('P-007 K14: --mist-muted clears WCAG AA in both themes, by computation', () => {
	// The caption renders as `color: var(--mist-muted)` over the reading surface.
	// Both values come from themeColorTokens(), so resolve them instead of
	// asserting a hardcoded hex: css-vars.ts maps --mist-muted <- tokens.muted and
	// --mist-effective-surface-rgb <- tokens.effectiveSurfaceRgb.
	const surfaces = [
		{ name: 'no wallpaper', glassAlpha: 0.5, scrim: 0.4, wallpaperLuminance: null },
		{ name: 'black wallpaper', glassAlpha: 0.5, scrim: 0.4, wallpaperLuminance: 0 },
		{ name: 'bright wallpaper', glassAlpha: 0.5, scrim: 0.4, wallpaperLuminance: 1 },
		{ name: 'dense dark glass', glassAlpha: 0.85, scrim: 0.7, wallpaperLuminance: 0.1 },
		{ name: 'dense bright glass', glassAlpha: 0.85, scrim: 0.7, wallpaperLuminance: 0.9 }
	];

	const presets = Object.keys(PRESET_PALETTES) as Array<keyof typeof PRESET_PALETTES>;

	it('the css variables the caption consumes are wired to those tokens', () => {
		const cssVars = read('appearance/css-vars.ts');
		expect(cssVars).toContain("setVariable(root, '--mist-muted', tokens.muted)");
		expect(cssVars).toContain(
			"setVariable(root, '--mist-effective-surface-rgb', tokens.effectiveSurfaceRgb)"
		);
	});

	for (const preset of presets) {
		for (const mode of ['light', 'dark'] as const) {
			it(`${preset} / ${mode} stays at or above 4.5:1`, () => {
				const colors = PRESET_PALETTES[preset][mode];

				for (const wallpaper of surfaces) {
					const tokens = themeColorTokens(colors, wallpaper);
					const background = effectiveSurface(colors, wallpaper);
					const ratio = contrastRatio(tokens.muted, background);

					expect(
						ratio,
						`${preset}/${mode}/${wallpaper.name}: --mist-muted ${tokens.muted} on ${background} = ${ratio.toFixed(2)}:1`
					).toBeGreaterThanOrEqual(4.5);
				}
			});
		}
	}

	it('the dark theme really is dark, so this is not a surrogate for light', () => {
		for (const preset of presets) {
			const surface = effectiveSurface(PRESET_PALETTES[preset].dark, surfaces[0]);
			expect(relativeLuminance(surface), `${preset} dark surface ${surface}`).toBeLessThan(0.25);
		}
	});

	it('--mist-muted is dimmer than --mist-ink but still legible', () => {
		const colors = PRESET_PALETTES['mist-blue'].dark;
		const tokens = themeColorTokens(colors, surfaces[0]);
		const background = effectiveSurface(colors, surfaces[0]);

		expect(contrastRatio(tokens.muted, background)).toBeLessThan(
			contrastRatio(tokens.ink, background)
		);
	});
});
