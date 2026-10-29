import { describe, expect, it } from 'vitest';

import { buildBatchPlan, copyTitle, renderTreeLines, titleForNote } from './notes-import-plan';

const file = (name = 'x'): File => new File(['x'], name, { type: 'text/plain' });

// P-006 S2/S3 — tests for the pure import planning helpers.

describe('titleForNote', () => {
	it('keeps the bare file name in flat mode', () => {
		expect(titleForNote('docs/a/README.md', true)).toBe('README');
		expect(titleForNote('19.Zabbix.md', true)).toBe('19.Zabbix');
	});

	it('prefixes the directory in hierarchical mode so same-named files stay distinct', () => {
		expect(titleForNote('docs/a/README.md', false)).toBe('docs/a/README');
		expect(titleForNote('19.Zabbix.md', false)).toBe('19.Zabbix');
	});
});

describe('buildBatchPlan', () => {
	it('classifies markdown, images and other documents', () => {
		const plan = buildBatchPlan(
			[
				{ relativePath: 'notes/19.Zabbix.md', file: file('19.Zabbix.md') },
				{ relativePath: 'notes/19.Zabbix/img.png', file: file('img.png') },
				{ relativePath: 'notes/report.pdf', file: file('report.pdf') },
				{ relativePath: 'notes/data.json', file: file('data.json') }
			],
			true
		);

		expect(plan.markdown.map((m) => m.title)).toEqual(['19.Zabbix']);
		expect(plan.images.map((i) => i.path)).toEqual(['notes/19.Zabbix/img.png']);
		expect(plan.otherDocs.map((d) => d.title)).toEqual(['notes/report', 'notes/data']);
	});

	it('normalizes ./ and ../ segments before classifying', () => {
		const plan = buildBatchPlan([{ relativePath: './notes/../img/pic.png', file: file() }], true);
		expect(plan.images.map((i) => i.path)).toEqual(['img/pic.png']);
	});

	it('reports structurally invalid paths and excludes them from every list (K14)', () => {
		const plan = buildBatchPlan(
			[
				{ relativePath: '../escape.png', file: file() },
				{ relativePath: 'ok.md', file: file('ok.md') }
			],
			true
		);
		expect(plan.invalidPaths).toHaveLength(1);
		expect(plan.invalidPaths[0].relativePath).toBe('../escape.png');
		expect(plan.markdown.map((m) => m.mdPath)).toEqual(['ok.md']);
		expect(plan.images).toHaveLength(0);
	});
});

describe('renderTreeLines', () => {
	it('indents directories and caps the output', () => {
		const lines = renderTreeLines(
			[
				{
					name: '19.Zabbix',
					path: '19.Zabbix',
					type: 'directory',
					children: [
						{ name: 'a.png', path: '19.Zabbix/a.png', type: 'image' },
						{
							name: 'sub',
							path: '19.Zabbix/sub',
							type: 'directory',
							children: [{ name: 'b.png', path: '19.Zabbix/sub/b.png', type: 'image' }]
						}
					]
				},
				{ name: '19.Zabbix.md', path: '19.Zabbix.md', type: 'markdown' }
			],
			2
		);
		expect(lines).toEqual(['19.Zabbix/', '  a.png']);
	});
});

describe('copyTitle', () => {
	it('finds the first free (n) suffix', () => {
		expect(copyTitle('A', new Set())).toBe('A (2)');
		expect(copyTitle('A', new Set(['A (2)']))).toBe('A (3)');
		expect(copyTitle('A', new Set(['A (2)', 'A (3)']))).toBe('A (4)');
	});
});
