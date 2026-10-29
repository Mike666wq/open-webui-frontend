import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '../../utils/tiptap-markdown';

// The note editor stores data.content.md, which export and knowledge snapshots consume unchanged.
describe('note Markdown document', () => {
	it('exports ordered numbering and alignment from the same saved Markdown', async () => {
		const source = '5. item\n6. next\n\n| a | b |\n| :--- | ---: |\n| x | y |';
		const saved = htmlToMarkdown(markdownToHtml(source), true);
		const exported = new Blob([saved], { type: 'text/markdown' });
		expect(await exported.text()).toBe(saved);
		expect(saved).toMatch(/5\.\s+item/);
		expect(saved).toMatch(/6\.\s+next/);
		expect(saved).toContain(':--- | ---:');
		expect(markdownToHtml(await exported.text())).toMatch(/text-align:\s*right/);
	});
});
