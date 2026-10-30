// P-006 S4: knowledge folder import tests
import { describe, expect, it } from 'vitest';

import {
	buildKnowledgePathIndex,
	copyTargetPath,
	planFolderImport,
	runFolderImport,
	type FolderImportDeps,
	type FolderImportEntry,
	type PlannedFile
} from './knowledge-import';

// P-006 S4 — tests for the knowledge-base Markdown folder import
// orchestration (K7–K10). All network access is stubbed through
// `FolderImportDeps`; path safety itself is pinned in the S1 core tests.

const entry = (relativePath: string, content = ''): FolderImportEntry => ({
	relativePath,
	file: new File([content], relativePath.split('/').pop() ?? 'file', { type: 'text/plain' })
});

const asPlanned = (plan: { files: PlannedFile[] }, path: string): PlannedFile => {
	const found = plan.files.find((f) => f.path === path);
	expect(found).toBeDefined();
	return found as PlannedFile;
};

interface Listing {
	items: Record<string, unknown>[];
	directories: { id: string; name: string; parent_id: string | null }[];
	total?: number;
	byDirectory?: Record<string, Listing>;
}

const makeDeps = (rootListing?: Listing) => {
	const state = {
		directoryBatches: [] as string[][],
		imports: [] as any[],
		removes: [] as string[],
		listCalls: [] as any[]
	};
	const deps: FolderImportDeps = {
		async batchDirectories(_token, _id, directories) {
			state.directoryBatches.push([...directories]);
			return Object.fromEntries(directories.map((d) => [d, `dir:${d}`]));
		},
		async importFile(_token, _id, input) {
			const id = `f${state.imports.length + 1}`;
			state.imports.push({ ...input, text: await input.file.text(), id });
			return {
				file_id: id,
				directory_id: input.directoryId,
				source_path: input.sourcePath,
				operation_id: input.operationId,
				status: 'completed',
				indexed: input.kind === 'markdown'
			};
		},
		async confirmOperation() {
			throw new Error('unexpected confirmation');
		},
		async canReadFile() {
			return true;
		},
		async removeFileFromKnowledgeById(_token, _id, fileId) {
			state.removes.push(fileId);
			return {};
		},
		async listFiles(_token, _id, directoryId, page) {
			state.listCalls.push({ directoryId, page });
			if (page > 1) return { items: [], directories: [], total: 0 };
			const listing = directoryId ? rootListing?.byDirectory?.[directoryId] : rootListing;
			return {
				items: listing?.items ?? [],
				directories: listing?.directories ?? [],
				total: listing?.total ?? listing?.items.length ?? 0
			};
		},
		async computeFileHash() {
			return 'a'.repeat(64);
		}
	};
	return { deps, state };
};

describe('planFolderImport', () => {
	it('excludes structurally invalid paths (K14), including encoded traversal', () => {
		const plan = planFolderImport([
			entry('docs/a.md'),
			entry('../evil.png'),
			entry('..%2f..%2fetc'),
			entry('/abs.png'),
			entry('C:\\x.png')
		]);
		expect(plan.invalidPaths.map((i) => i.relativePath)).toEqual([
			'../evil.png',
			'..%2f..%2fetc',
			'/abs.png',
			'C:\\x.png'
		]);
		expect(plan.paths).toEqual(new Set(['docs/a.md']));
	});

	it('classifies markdown / image / other and counts them', () => {
		const plan = planFolderImport([
			entry('notes/报告.md'),
			entry('notes/报告/img/a.png'),
			entry('data.json')
		]);
		expect(plan.counts).toEqual({ markdown: 1, image: 1, other: 1, directory: 3 });
		expect(asPlanned(plan, 'notes/报告.md').kind).toBe('markdown');
		expect(asPlanned(plan, 'notes/报告/img/a.png').kind).toBe('image');
		expect(asPlanned(plan, 'data.json').kind).toBe('other');
	});

	it('flags conflicts against existing knowledge-base keys', () => {
		const plan = planFolderImport([entry('doc.md'), entry('img/a.png')], new Set(['doc.md']));
		expect(plan.conflicts).toEqual(['doc.md']);
	});

	it('builds a three-level directory list parents-first', () => {
		const plan = planFolderImport([entry('a/b/c.md'), entry('a/b/c/图.png')]);
		expect(plan.directories).toEqual(['a', 'a/b', 'a/b/c']);
	});

	it('warns when more than 500 files are selected', () => {
		const entries: FolderImportEntry[] = [];
		for (let i = 0; i < 501; i++) entries.push(entry(`f${i}.md`));
		const plan = planFolderImport(entries);
		expect(plan.warnings).toHaveLength(1);
		expect(plan.warnings[0]).toContain('500');
	});
});

describe('buildKnowledgePathIndex', () => {
	it('walks the directory tree recursively and keys files by path', async () => {
		const { deps, state } = makeDeps({
			items: [{ meta: { name: 'root.md' } }],
			directories: [{ id: 'd1', name: 'docs', parent_id: null }],
			byDirectory: {
				d1: {
					items: [{ meta: { name: 'deep.png' } }],
					directories: [{ id: 'd2', name: 'img', parent_id: 'd1' }]
				},
				d2: { items: [{ meta: { name: 'x.md' } }], directories: [] }
			}
		});
		const index = await buildKnowledgePathIndex(deps, 'token', 'kb1');
		expect(index.keys).toEqual(new Set(['root.md', 'docs/deep.png', 'docs/img/x.md']));
		expect(index.files.get('docs/deep.png')?.meta?.name).toBe('deep.png');
		// Root and every discovered directory are listed exactly once,
		// depth-first: root → docs → docs/img.
		expect(state.listCalls.map((c) => c.directoryId)).toEqual([null, 'd1', 'd2']);
	});

	it('paginates file listings until total is reached', async () => {
		const page1 = [{ meta: { name: 'a.md' } }, { meta: { name: 'b.md' } }];
		const wrapped: FolderImportDeps = {
			...makeDeps().deps,
			listFiles: async (_t, _i, _d, page) =>
				page === 1
					? { items: page1, directories: [], total: 3 }
					: page === 2
						? { items: [{ meta: { name: 'c.md' } }], directories: [], total: 3 }
						: { items: [], directories: [], total: 0 }
		};
		const index = await buildKnowledgePathIndex(wrapped, 'token', 'kb1');
		expect(index.keys).toEqual(new Set(['a.md', 'b.md', 'c.md']));
	});
});

describe('P-006 r3 folder import', () => {
	it('uploads images first and preserves readable references while indexing clean text', async () => {
		const { deps, state } = makeDeps();
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('doc.md', '![diagram](pic.png)\nText'), entry('pic.png', 'bytes')]
		});
		expect(report.status).toBe('completed');
		expect(state.directoryBatches).toEqual([[]]);
		expect(state.imports.map((x) => x.kind)).toEqual(['image', 'markdown']);
		expect(state.imports[1].text).toContain('![diagram](/api/v1/files/f1/content)');
		expect(state.imports[1].indexText).toContain('diagram');
		expect(state.imports[1].indexText).not.toContain('/api/v1/files/');
	});

	it('places identical images in each target directory', async () => {
		const { deps, state } = makeDeps();
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('a/pic.png', 'same'), entry('b/pic.png', 'same')]
		});
		expect(report.succeeded).toHaveLength(2);
		expect(state.imports.map((x) => x.directoryId).sort()).toEqual(['dir:a', 'dir:b']);
		expect(new Set(state.imports.map((x) => x.id)).size).toBe(2);
	});

	it('does not report a failure as success and accounts for missing dependencies', async () => {
		const { deps } = makeDeps();
		const report = await runFolderImport(
			{
				...deps,
				importFile: async (_t, _id, item) => {
					if (item.kind === 'image') throw new Error('denied');
					return deps.importFile(_t, _id, item);
				}
			},
			{
				token: 't',
				knowledgeId: 'kb',
				entries: [entry('a.png', 'bytes'), entry('doc.md', '![a](a.png)')]
			}
		);
		expect(report.status).toBe('failed');
		expect(report.failed.map((x) => x.path).sort()).toEqual(['a.png', 'doc.md']);
		expect(report.succeeded).toHaveLength(0);
		expect(report.missingImages).toHaveLength(1);
	});

	it('maps a skipped existing image into the dependent document', async () => {
		const { deps, state } = makeDeps({
			items: [{ id: 'old', meta: { name: 'pic.png' } }],
			directories: []
		});
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('doc.md', '![x](pic.png)'), entry('pic.png', 'bytes')]
		});
		expect(report.status).toBe('completed');
		expect(state.imports[0].text).toContain('/api/v1/files/old/content');
		expect(report.skipped.map((x) => x.path)).toContain('pic.png');
	});

	it('keeps old files when an overwrite upload fails', async () => {
		const { deps, state } = makeDeps({
			items: [{ id: 'old', meta: { name: 'doc.md' } }],
			directories: []
		});
		const report = await runFolderImport(
			{
				...deps,
				importFile: async () => {
					throw new Error('failure');
				}
			},
			{ token: 't', knowledgeId: 'kb', strategy: 'overwrite', entries: [entry('doc.md', 'body')] }
		);
		expect(report.status).toBe('failed');
		expect(state.removes).toEqual([]);
	});

	it('reports partial failure and leaves unprocessed paths on cancellation', async () => {
		const { deps } = makeDeps();
		let checks = 0;
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('a.md', 'a'), entry('b.md', 'b')],
			shouldCancel: () => ++checks > 1
		});
		expect(report.status).toBe('cancelled');
		expect(report.succeeded.map((x) => x.path)).toEqual(['a.md']);
		expect(report.pending).toEqual(['b.md']);
	});

	it('stops without file writes if preflight fails', async () => {
		const { deps, state } = makeDeps();
		const report = await runFolderImport(
			{
				...deps,
				batchDirectories: async () => {
					throw new Error('denied');
				}
			},
			{ token: 't', knowledgeId: 'kb', entries: [entry('a.md', 'a')] }
		);
		expect(report.status).toBe('failed');
		expect(state.imports).toHaveLength(0);
		expect(report.pending).toEqual(['a.md']);
	});
});

describe('copyTargetPath', () => {
	it('chooses the next available name', () => {
		expect(copyTargetPath('a/doc.md', new Set(['a/doc (copy).md'])).path).toBe('a/doc (copy 2).md');
	});
});
