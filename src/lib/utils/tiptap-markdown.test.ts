import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml, roundTrip } from './tiptap-markdown';

// Browser DOM is required by Turndown; CI's frontend suite supplies jsdom.
describe('note Markdown round trip', () => {
	it.each([
		'# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six',
		'- a\n- b', '3. first\n4. second', '- [x] done\n- [ ] next',
		'> first\n> > nested', '```js\nconst a = 1;\n```',
		'| left | right |\n| :--- | ---: |\n| a | b |',
		'---', '[link](https://example.com)', '![alt](https://example.com/img.png)',
		'~~strike~~', '==highlight==', '<sup>top</sup> and <sub>bottom</sub>'
	])('retains semantics through repeated conversion: %s', (markdown) => {
		const first = roundTrip(markdown);
		expect(roundTrip(first)).toBe(first);
	});
	it('keeps ordered starts and table alignment', () => {
		const ordered = roundTrip('3. first\n4. second');
		expect(ordered).toMatch(/3\.\s+first/);
		expect(ordered).toMatch(/4\.\s+second/);
		const table = roundTrip('| a | b |\n| :--- | ---: |\n| x | y |');
		expect(table).toContain(':--- | ---:');
		expect(markdownToHtml(table)).toMatch(/text-align:\s*right/);
	});
	it('retains nested ordered and task items after a second pass', () => {
		const nested = '- [x] parent\n    - [ ] child\n    - [x] done';
		const converted = roundTrip(nested);
		expect(converted).toMatch(/\[x\] parent/);
		expect(converted).toMatch(/\[ \] child/);
		expect(converted).toMatch(/\[x\] done/);
		expect(roundTrip(converted)).toBe(converted);
		const numbered = roundTrip('7. parent\n   1. child\n8. sibling');
		expect(numbered).toMatch(/7\.\s+parent/);
		expect(numbered).toMatch(/8\.\s+sibling/);
		expect(numbered).toMatch(/1\.\s+child/);
	});
	it('retains code fences and soft breaks inside list items', () => {
		expect(roundTrip('```js\na\n\nb\n```')).toContain('a\n\nb');
		expect(htmlToMarkdown('<ul><li><p>one<br>two</p></li></ul>', true)).toContain('<br/>');
	});
	it('leaves ordinary text intact', () => {
		expect(roundTrip('ordinary text')).toBe('ordinary text');
		expect(markdownToHtml('==marked==')).toContain('<mark>marked</mark>');
	});
});
