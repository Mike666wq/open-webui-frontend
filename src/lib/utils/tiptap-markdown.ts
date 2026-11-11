import { Marked } from 'marked';
// The upstream dependencies do not publish TypeScript declarations.
// @ts-ignore upstream package has no declaration file under strict project settings
import TurndownService from 'turndown';
// @ts-ignore upstream package has no declaration file under strict project settings
import { gfm } from '@joplin/turndown-plugin-gfm';

// Match the editor's task-list DOM while retaining ordered-list start values.
const noteMarked = new Marked({
	gfm: true,
	breaks: false,
	extensions: [{
		name: 'noteHighlight',
		level: 'inline',
		start: (source) => source.indexOf('=='),
		tokenizer(source) {
			const match = /^==([^=\n]+)==/.exec(source);
			return match ? { type: 'noteHighlight', raw: match[0], text: match[1] } : undefined;
		},
		renderer(token) {
			return `<mark>${token.text}</mark>`;
		}
	}],
	renderer: {
		list(body, ordered, start) {
			if (!ordered && body.includes('data-checked=')) return `<ul data-type="taskList">${body}</ul>`;
			return ordered
				? `<ol${start !== 1 ? ` start="${start}"` : ''}>${body}</ol>`
				: `<ul>${body}</ul>`;
		},
		listitem(text, task, checked) {
			return task
				? `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}">${text}</li>`
				: `<li>${text}</li>`;
		},
		// Emit the editor's inline alignment style (TipTap TextAlign) instead of the
		// deprecated `align` attribute, so saved Markdown re-imports with fidelity.
		tablecell(content, flags) {
			const type = flags.header ? 'th' : 'td';
			const align = flags.align ? ` style="text-align: ${flags.align}"` : '';
			return `<${type}${align}>${content}</${type}>\n`;
		}
	}
});

export const markdownToHtml = (markdown: string): string =>
	(noteMarked.parse(markdown.replaceAll('\n<br/>', '<br/>'), { breaks: false, gfm: true }) as string).trim();

const createTurndown = (preserveBreaks: boolean) => {
	const service = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx' });
	service.escape = (value: string) => value;
	service.use(gfm);

	/**
	 * Paragraphs are separated by a blank line.
	 *
	 * A single newline is a *soft* break inside a paragraph in Markdown, not a
	 * paragraph boundary. Writing one newline between `<p>` elements therefore
	 * produced Markdown that re-read as a single run-on paragraph: the second
	 * save merged two paragraphs into one and turned the break into a space,
	 * which silently destroyed the structure of every note that had more than
	 * one paragraph.
	 *
	 * The blank line is also what every other Markdown renderer expects, so the
	 * exported/shared note now renders the same way outside this editor.
	 */
	service.addRule('blockParagraphs', {
		filter: (node: HTMLElement) => node.nodeName === 'P' && node.parentNode?.nodeName !== 'LI',
		replacement: (content: string) => `\n\n${content}\n`
	});
	/**
	 * A paragraph inside a list item keeps its own boundary too. Returning the
	 * bare content glued two paragraphs of the same item together with no
	 * separator at all ("firstsecond").
	 */
	service.addRule('listParagraphs', {
		filter: (node: HTMLElement) => node.nodeName === 'P' && node.parentNode?.nodeName === 'LI',
		replacement: (content: string) => `\n\n${content}`
	});
	service.addRule('taskItemCheckbox', {
		filter: (node: HTMLElement) => node.nodeName === 'INPUT' && node.getAttribute('type') === 'checkbox',
		replacement: () => ''
	});
	service.addRule('taskListItems', {
		filter: (node: HTMLElement) =>
			node.nodeName === 'LI' && ['true', 'false'].includes(node.getAttribute('data-checked') ?? ''),
		replacement: (content: string, node: HTMLElement) => {
			const checked = node.getAttribute('data-checked') === 'true';
			return `- [${checked ? 'x' : ' '}] ${content.trim().replace(/\n(?=.)/g, '\n    ')}\n`;
		}
	});
	service.addRule('tableHeaders', { filter: 'th', replacement: (content: string) => content });
	service.addRule('tablesWithAlignment', {
		filter: 'table',
		replacement: (_content: string, node: HTMLTableElement) => {
			const rows = Array.from(node.rows);
			if (!rows.length) return '';
			const cells = (row: HTMLTableRowElement) =>
				Array.from(row.cells).map((cell) =>
					service.turndown(cell.innerHTML).trim().replace(/(?<!\\)\|/g, '\\|').replace(/\n/g, '<br>')
				);
			const header = cells(rows[0]);
			const aligns = Array.from(rows[0].cells).map((cell) => {
				const align = cell.getAttribute('align') ?? cell.style.textAlign;
				return align === 'right' ? '---:' : align === 'center' ? ':---:' : align === 'left' ? ':---' : '---';
			});
			return `\n| ${header.join(' | ')} |\n| ${aligns.join(' | ')} |\n${rows.slice(1).map((row) => `| ${cells(row).join(' | ')} |\n`).join('')}\n`;
		}
	});
	service.addRule('mentions', {
		filter: (node: HTMLElement) => node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'mention',
		replacement: (_content: string, node: HTMLElement) => {
			const id = node.getAttribute('data-id') ?? '';
			const ch = node.getAttribute('data-mention-suggestion-char') ?? '@';
			return `<${ch === '/' ? '$' : ch}${id}>`;
		}
	});
	service.addRule('underline', { filter: 'u', replacement: (content: string) => `<u>${content}</u>` });
	service.addRule('highlight', { filter: 'mark', replacement: (content: string) => `==${content}==` });
	service.addRule('superscript', { filter: 'sup', replacement: (content: string) => `<sup>${content}</sup>` });
	service.addRule('subscript', { filter: 'sub', replacement: (content: string) => `<sub>${content}</sub>` });
	if (preserveBreaks) {
		service.addRule('preserveBreaks', { filter: 'br', replacement: () => '<br/>' });
	}
	return service;
};

const standard = createTurndown(false);
const withBreaks = createTurndown(true);
export const htmlToMarkdown = (html: string, preserveBreaks = false): string =>
	(preserveBreaks ? withBreaks : standard)
		.turndown(
			html.replace(/<p><\/p>/g, '<br/>').replace(/ {2,}/g, (spaces) => spaces.replace(/ /g, '\u00a0'))
		)
		.replace(/\u00a0/g, ' ');

export const roundTrip = (markdown: string): string => htmlToMarkdown(markdownToHtml(markdown), true);
