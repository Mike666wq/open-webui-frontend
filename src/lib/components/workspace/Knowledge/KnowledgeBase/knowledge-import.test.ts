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

interface StubState {
	directoryBatches: string[][];
	uploads: { filename: string; metadata: Record<string, unknown> | null; process: boolean | null }[];
	adds: { fileId: string; directoryId: string | null | undefined; process: boolean | undefined }[];
	removes: string[];
	listCalls: { directoryId: string | null; page: number }[];
	/** Content handed to uploadFile for markdown files, keyed by filename. */
	uploadedText: Map<string, string>;
	uploadCounter: number;
}

interface Listing {
	items: Record<string, unknown>[];
	directories: { id: string; name: string; parent_id: string | null }[];
	total?: number;
	/**
	 * Listings for sub-directories, keyed by directory id. Mirrors the real
	 * API semantics: a listing that contains `directories` belongs to the
	 * parent page; each child directory is listed separately by its id.
	 */
	byDirectory?: Record<string, Listing>;
}

const makeDeps = (rootListing?: Listing): { deps: FolderImportDeps; state: StubState } => {
	const state: StubState = {
		directoryBatches: [],
		uploads: [],
		adds: [],
		removes: [],
		listCalls: [],
		uploadedText: new Map(),
		uploadCounter: 0
	};
	const deps: FolderImportDeps = {
		async batchDirectories(_token, _id, directories) {
			state.directoryBatches.push([...directories]);
			const out: Record<string, string> = {};
			for (const d of directories) out[d] = `dir:${d}`;
			return out;
		},
		async uploadFile(_token, file, metadata, process) {
			state.uploads.push({
				filename: file.name,
				metadata: (metadata as Record<string, unknown>) ?? null,
				process: process ?? null
			});
			state.uploadedText.set(file.name, await file.text());
			return { id: `f${++state.uploadCounter}` };
		},
		async addFileToKnowledgeById(_token, _id, fileId, directoryId, process) {
			state.adds.push({ fileId, directoryId, process });
			return { ok: true };
		},
		async removeFileFromKnowledgeById(_token, _id, fileId) {
			state.removes.push(fileId);
			return { ok: true };
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
		async computeFileHash(file) {
			return `hash-${file.name}-${file.size}`;
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

describe('runFolderImport (K7–K10)', () => {
	it('creates the directory tree via one batch call, then imports images and markdown', async () => {
		const { deps, state } = makeDeps();
		// Relative to a/b/文档.md, `img/图.png` resolves to a/b/img/图.png.
		const md = '![](img/图.png)\n\n正文';
		const report = await runFolderImport(deps, {
			token: 'token',
			knowledgeId: 'kb1',
			entries: [
				entry('a/b/文档.md', md),
				entry('a/b/img/图.png', 'png-bytes'),
				entry('a/b/附件.zip')
			]
		});

		// Directories get-or-created in a single batch (K7).
		expect(state.directoryBatches).toEqual([['a', 'a/b', 'a/b/img']]);
		expect(report.directoriesCreated).toBe(3);

		// Unsupported files are skipped, never uploaded.
		expect(report.skipped).toEqual([{ path: 'a/b/附件.zip', reason: 'unsupported type' }]);
		expect(report.total).toBe(2);

		// Images upload unprocessed, without knowledge_id in metadata (#4).
		const imgUpload = state.uploads.find((u) => u.filename === '图.png');
		expect(imgUpload?.process).toBe(false);
		expect(imgUpload?.metadata).toEqual({ directory_id: 'dir:a/b/img' });
		const imgAdd = state.adds.find((a) => a.fileId === 'f2');
		expect(imgAdd).toMatchObject({ directoryId: 'dir:a/b/img', process: false });

		// Markdown uploads processed, with the import meta block.
		const mdUpload = state.uploads.find((u) => u.filename === '文档.md');
		expect(mdUpload?.process).toBe(true);
		expect(mdUpload?.metadata?.directory_id).toBe('dir:a/b');
		expect((mdUpload?.metadata as any)?.markdown_import?.source_path).toBe('a/b/文档.md');

		// The image reference is rewritten to the readable marker (#7).
		expect(state.uploadedText.get('文档.md')).toBe('[图片 图.png]\n\n正文');

		expect(report.status).toBe('completed');
		expect(report.succeeded.map((s) => s.path)).toEqual(['a/b/文档.md', 'a/b/img/图.png']);
		expect(report.failed).toEqual([]);
	});

	it('is idempotent: a second import with the same paths skips everything', async () => {
		const entries = [entry('doc.md', '# t'), entry('doc/img.png', 'bytes')];
		const first = await runFolderImport(makeDeps().deps, {
			token: 't',
			knowledgeId: 'kb',
			entries
		});
		expect(first.status).toBe('completed');
		expect(first.succeeded).toHaveLength(2);

		// The knowledge base now contains both paths at their directories:
		// doc.md at the root, img.png inside the existing `doc` directory.
		const second = await runFolderImport(
			makeDeps({
				items: [{ id: 'old-md', meta: { name: 'doc.md' } }],
				directories: [{ id: 'kd', name: 'doc', parent_id: null }],
				byDirectory: {
					kd: { items: [{ id: 'old-img', meta: { name: 'img.png' } }], directories: [] }
				}
			}).deps,
			{ token: 't', knowledgeId: 'kb', entries }
		);
		expect(second.skipped.map((s) => s.path).sort()).toEqual(['doc.md', 'doc/img.png']);
		expect(second.succeeded).toEqual([]);
	});

	it('deduplicates identical images across batches (uploaded once, #4)', async () => {
		const { deps, state } = makeDeps();
		const bytes = 'same-image-bytes';
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [
				entry('part1/pic.png', bytes),
				entry('part2/pic.png', bytes),
				entry('part1/a.md', '![](../part2/pic.png)'),
				entry('part2/b.md', '![](pic.png)')
			],
			batchSize: 2
		});
		const imageUploads = state.uploads.filter((u) => u.filename === 'pic.png');
		expect(imageUploads).toHaveLength(1);
		expect(report.succeeded.filter((s) => s.kind === 'image')).toHaveLength(2);
		expect(report.imageUrls).toHaveLength(1);
	});

	it('rewrites in-tree references and keeps external and missing ones as-is (#7/#11)', async () => {
		const { deps, state } = makeDeps();
		const md = [
			'![内](img/内.png)',
			'![外](https://example.com/x.png)',
			'![缺](img/缺.png)',
			'![代码](docs/img/内.png)'
		].join('\n');
		await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [
				entry('docs/笔记.md', md),
				entry('docs/img/内.png', 'bytes')
			]
		});
		const uploaded = state.uploadedText.get('笔记.md') ?? '';
		expect(uploaded).toContain('[图片 内.png]');
		expect(uploaded).toContain('![外](https://example.com/x.png)');
		expect(uploaded).toContain('![缺](img/缺.png)');
	});

	it('reports missing images, orphans and ref-heavy files (#10)', async () => {
		const { deps, state } = makeDeps();
		const manyRefs = Array.from({ length: 51 }, (_, i) => `![x](img/f${i}.png)`).join('\n');
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [
				entry('n.md', '![缺](missing.png)'),
				entry('n/', ''), // directory-only entries are handled by planner
				entry('orphan-dir.md', ''),
				entry('heavy.md', manyRefs),
				entry('unref.png', 'bytes')
			]
		});
		// n.md's missing ref, plus heavy.md's 51 refs to images that are
		// neither imported nor present in the knowledge base (#10).
		expect(report.missingImages[0]).toEqual({
			mdPath: 'n.md',
			raw: '![缺](missing.png)',
			path: 'missing.png'
		});
		expect(report.missingImages).toHaveLength(52);
		// unref.png exists in the tree but is never referenced → orphan.
		expect(report.orphanImages).toEqual([]);
		expect(report.refHeavyFiles).toEqual([{ path: 'heavy.md', imageRefs: 51 }]);
		expect(state.uploads.find((u) => u.filename === 'heavy.md')).toBeDefined();
	});

	it('applies strategy skip: conflicts are not re-uploaded', async () => {
		const { deps, state } = makeDeps({
			items: [{ id: 'old', meta: { name: 'doc.md' } }]
		});
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('doc.md', 'new')],
			strategy: 'skip'
		});
		expect(report.skipped).toEqual([{ path: 'doc.md', reason: 'already exists' }]);
		expect(state.uploads).toHaveLength(0);
		expect(state.removes).toEqual([]);
	});

	it('applies strategy overwrite: fresh content uploaded, stale entry removed', async () => {
		const { deps, state } = makeDeps({
			items: [{ id: 'old', meta: { name: 'doc.md' } }]
		});
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('doc.md', 'new')],
			strategy: 'overwrite'
		});
		expect(report.succeeded).toEqual([{ path: 'doc.md', kind: 'markdown', fileId: 'f1' }]);
		expect(state.uploads).toHaveLength(1);
		expect(state.removes).toEqual(['old']);
		expect(report.failed).toEqual([]);
	});

	it('applies strategy copy: imports under a non-conflicting name', async () => {
		const { deps, state } = makeDeps({
			items: [{ id: 'old', meta: { name: 'doc.md' } }]
		});
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('doc.md', 'new')],
			strategy: 'copy'
		});
		expect(report.succeeded).toHaveLength(1);
		// The uploaded markdown lands under the copy name.
		expect(state.uploads[0].filename).toBe('doc (copy).md');
		expect(state.removes).toEqual([]);
	});

	it('reports failures per file and keeps going', async () => {
		const { deps, state } = makeDeps();
		const failing: FolderImportDeps = {
			...deps,
			uploadFile: async (token, file, metadata, process) => {
				if (file.name === 'bad.png') throw new Error('boom');
				return deps.uploadFile(token, file, metadata, process);
			}
		};
		const report = await runFolderImport(failing, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('bad.png', 'x'), entry('good.md', 'ok')]
		});
		expect(report.failed).toEqual([{ path: 'bad.png', reason: 'boom' }]);
		expect(report.succeeded.map((s) => s.path)).toEqual(['good.md']);
		expect(report.status).toBe('completed');
	});

	it('stops between batches on cancellation, keeping submitted files', async () => {
		const { deps, state } = makeDeps();
		let calls = 0;
		const report = await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('a.md'), entry('b.md'), entry('c.md'), entry('d.md')],
			batchSize: 1,
			shouldCancel: () => ++calls > 2
		});
		expect(report.status).toBe('cancelled');
		expect(report.succeeded.map((s) => s.path)).toEqual(['a.md', 'b.md']);
		expect(state.uploads).toHaveLength(2);
	});

	it('fails fast when the knowledge base cannot be indexed', async () => {
		const { deps } = makeDeps();
		const broken: FolderImportDeps = {
			...deps,
			listFiles: async () => {
				throw new Error('network down');
			}
		};
		const report = await runFolderImport(broken, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('a.md')]
		});
		expect(report.status).toBe('failed');
		expect(report.failed[0]?.reason).toBe('network down');
	});

	it('reports progress per processed file', async () => {
		const { deps } = makeDeps();
		const seen: { processed: number; total: number; current: string }[] = [];
		await runFolderImport(deps, {
			token: 't',
			knowledgeId: 'kb',
			entries: [entry('x.md'), entry('y.png', 'b')],
			onProgress: (p) => seen.push({ ...p })
		});
		expect(seen).toEqual([
			{ processed: 1, total: 2, current: 'x.md' },
			{ processed: 2, total: 2, current: 'y.png' }
		]);
	});
});

describe('copyTargetPath', () => {
	it('appends (copy) before the extension, then (copy 2), (copy 3)…', () => {
		const taken = new Set<string>();
		const first = copyTargetPath('a/b/doc.md', taken);
		expect(first.path).toBe('a/b/doc (copy).md');
		taken.add(first.path);
		const second = copyTargetPath('a/b/doc.md', taken);
		expect(second.path).toBe('a/b/doc (copy 2).md');
		taken.add(second.path);
		expect(copyTargetPath('a/b/doc.md', taken).path).toBe('a/b/doc (copy 3).md');
	});

	it('handles extensionless names and paths without directories', () => {
		expect(copyTargetPath('README', new Set()).path).toBe('README (copy)');
		expect(copyTargetPath('doc.md', new Set()).path).toBe('doc (copy).md');
	});
});
