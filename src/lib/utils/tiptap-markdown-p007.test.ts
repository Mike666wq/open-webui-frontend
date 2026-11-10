import { describe, expect, it } from 'vitest';

import { roundTrip } from './tiptap-markdown';

/**
 * P-007 K19: the editor gained blockquote, table, horizontal rule, highlight,
 * superscript and subscript buttons. Those only stay useful if a Markdown
 * document survives a trip through the editor and back.
 *
 * The contract is idempotency, not byte preservation: `---` legitimately
 * normalises to `* * *`, and a hard-wrapped blockquote is reflowed onto one
 * line. What must never happen is the second round trip differing from the
 * first, or the construct disappearing.
 */
const SAMPLES: Record<string, { source: string; mustKeep: string }> = {
	blockquote: {
		source: '> 这是一段引用\n> 第二行\n',
		mustKeep: '这是一段引用'
	},
	table: {
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
		mustKeep: '| A | B |'
	},
	horizontalRule: {
		source: '上文\n\n---\n\n下文\n',
		mustKeep: '上文'
	},
	highlight: {
		source: '==高亮文字==\n',
		mustKeep: '==高亮文字=='
	},
	superscript: {
		source: 'E = mc<sup>2</sup>\n',
		mustKeep: '<sup>2</sup>'
	},
	subscript: {
		source: 'H<sub>2</sub>O\n',
		mustKeep: '<sub>2</sub>'
	}
};

describe('P-007 K19: Markdown round-trip keeps the new syntaxes', () => {
	for (const [name, { source, mustKeep }] of Object.entries(SAMPLES)) {
		it(`${name} is preserved and idempotent`, () => {
			const once = roundTrip(source);
			const twice = roundTrip(once);

			expect(once).toContain(mustKeep);
			// A second pass must not keep changing the document.
			expect(twice).toBe(once);
		});
	}

	it('horizontal rule is kept as a thematic break, whichever spelling', () => {
		const once = roundTrip(SAMPLES.horizontalRule.source);

		// `---` normalises to the `* * *` form; both are Markdown thematic breaks.
		expect(once).toMatch(/^(---|\* \* \*)$/m);
	});

	/**
	 * KNOWN PRE-EXISTING BUG — documented here, not fixed here.
	 *
	 * `singleNewlineParagraphs` rewrites a `<p>` as `\n{content}\n`, so a
	 * paragraph break becomes a single newline. Re-parsing takes that newline
	 * as a soft break, so the next save collapses the two paragraphs into one
	 * line and the save after that joins them with a space. Opening and saving
	 * a note twice therefore destroys its paragraph structure.
	 *
	 * `it.fails` marks the current (broken) behaviour. When this is fixed the
	 * test starts failing on purpose, which is the signal to flip it to `it`.
	 * This file predates P-007: `tiptap-markdown.ts` is unchanged on
	 * `origin/main`, so the bug is not introduced by this work.
	 */
	it.fails('KNOWN BUG: paragraph breaks collapse on a second round trip', () => {
		const source = '第一段\n\n第二段\n';
		const once = roundTrip(source);
		const twice = roundTrip(once);

		// Today: `once` keeps a single newline, and `twice` joins with a space.
		expect(twice).toBe(once);
	});
});
