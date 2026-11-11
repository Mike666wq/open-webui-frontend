import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml, roundTrip } from './tiptap-markdown';

/**
 * B1 — the Markdown round trip used to eat paragraph structure.
 *
 * The writer emitted a single newline between `<p>` elements. A single newline
 * is a soft break *inside* a paragraph in Markdown, so the next read merged
 * the paragraphs into one and turned the break into a space. Every save cycle
 * moved the note further towards a single run-on paragraph, and the exported
 * Markdown rendered that way in any other tool.
 *
 * These cases pin the two properties that matter:
 *   1. `Markdown → HTML → Markdown` is idempotent (a second pass changes
 *      nothing), and
 *   2. the paragraph structure survives — the second pass still sees the same
 *      number of blocks, not one merged run.
 */

// Browser DOM is required by Turndown; CI's frontend suite supplies jsdom.
const countBlocks = (html: string) => (html.match(/<p[\s>]/g) ?? []).length;

describe('B1 note Markdown round trip keeps paragraph structure', () => {
	it('keeps two paragraphs apart through repeated conversion', () => {
		const source = '第一段\n\n第二段\n';

		const first = roundTrip(source);
		expect(first).toBe('第一段\n\n第二段');

		// The decisive property: a second pass must not merge them.
		expect(roundTrip(first)).toBe(first);
		expect(countBlocks(markdownToHtml(first))).toBe(2);
	});

	it('keeps three paragraphs apart', () => {
		const source = '一\n\n二\n\n三\n';
		const first = roundTrip(source);

		expect(first).toBe('一\n\n二\n\n三');
		expect(roundTrip(first)).toBe(first);
		expect(countBlocks(markdownToHtml(first))).toBe(3);
	});

	it('separates paragraphs that follow a heading', () => {
		const first = roundTrip('# 标题\n\n正文\n');

		expect(first).toContain('# 标题');
		expect(first).toContain('\n\n正文');
		expect(roundTrip(first)).toBe(first);
	});

	it('separates paragraphs inside a blockquote', () => {
		const source = '> 一\n>\n> 二\n';
		const first = roundTrip(source);

		expect(roundTrip(first)).toBe(first);
		expect(countBlocks(markdownToHtml(first))).toBe(2);
	});

	it('separates paragraphs inside a list item', () => {
		const source = '- a\n\n  b\n';
		const first = roundTrip(source);

		// Two paragraphs of one list item must not be glued together.
		expect(first).not.toContain('ab');
		expect(roundTrip(first)).toBe(first);
		expect(countBlocks(markdownToHtml(first))).toBe(2);
	});

	it('does not disturb the other block kinds', () => {
		const cases: Array<[string, RegExp]> = [
			['# One', /^# One$/],
			['- a\n- b', /^\* {3}a\n\* {3}b$/],
			['1. one\n2. two', /^1\. {2}one\n2\. {2}two$/],
			['- [x] done\n- [ ] next', /^- \[x\] done\n- \[ \] next$/],
			['> quoted', /^> quoted$/],
			['```js\nconst a = 1;\n```', /```js\nconst a = 1;\n```/],
			['| a | b |\n| :--- | ---: |\n| x | y |', /:--- \| ---:/]
		];

		for (const [source, expected] of cases) {
			const first = roundTrip(source);
			expect(first, source).toMatch(expected);
			expect(roundTrip(first), source).toBe(first);
		}
	});

	it('keeps blank lines inside fenced code blocks', () => {
		const source = '```js\nconst a = 1;\n\nconst b = 2;\n```\n';
		const first = roundTrip(source);

		expect(first).toContain('const a = 1;\n\nconst b = 2;');
		expect(roundTrip(first)).toBe(first);
	});

	it('keeps a hard line break inside one paragraph', () => {
		const source = '第一行  \n第二行\n';
		const first = roundTrip(source);

		expect(first).toContain('第一行');
		expect(first).toContain('第二行');
		expect(roundTrip(first)).toBe(first);
	});

	it('writes Markdown that other renderers read as separate paragraphs', () => {
		// The exported note is consumed outside this editor; a single newline
		// would render as one run-on paragraph there.
		const markdown = htmlToMarkdown('<p>第一段</p><p>第二段</p>');

		expect(markdown).toBe('第一段\n\n第二段');
		expect(markdownToHtml(markdown)).toContain('</p>\n<p>');
	});
});

/**
 * Real documents from this repository, used as regression samples: they carry
 * headings, lists, tables, code fences, block quotes and inline formatting, so
 * a round trip that keeps their block structure is evidence the fix holds for
 * ordinary notes rather than for the handful of shapes above.
 */
describe('B1 round trip over real repository documents', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const docs = join(here, '..', '..', '..', 'docs');

	const samples = ['ACCEPTANCE.md', 'PROVIDER_CONTRACT.md', 'ui-audit.md'];

	it.each(samples)('keeps the block structure of %s', (name) => {
		const source = readFileSync(join(docs, name), 'utf8');

		const first = roundTrip(source);
		const second = roundTrip(first);

		// Idempotent: a second conversion changes nothing.
		expect(second, name).toBe(first);

		// The document still has the same number of paragraphs, so nothing was
		// merged away on the way.
		const before = countBlocks(markdownToHtml(source));
		const after = countBlocks(markdownToHtml(first));
		expect(after, name).toBe(before);
		expect(before, name).toBeGreaterThan(3);
	});

	it('keeps the headings of a real document', () => {
		const source = readFileSync(join(docs, 'ACCEPTANCE.md'), 'utf8');
		const headings = (source.match(/^#{1,6} .+$/gm) ?? []).map((line) => line.trim());
		const converted = roundTrip(source);

		for (const heading of headings) {
			expect(converted, heading).toContain(heading);
		}
	});
});
