import {
	analyzeMarkdownNote,
	buildImportPreview,
	crossBatchAssetKey,
	isImagePath,
	isMarkdownPath,
	knowledgeImageMarker,
	markdownImportMeta,
	normalizeRelativePath,
	noteContentHash,
	parseImageRefs,
	rewriteImageRefs,
	type ImportPreview
} from '$lib/components/notes/markdown-import';
import { computeFileHash } from '$lib/utils/hash';
import { WEBUI_API_BASE_URL } from '$lib/constants';
import {
	addFileToKnowledgeById,
	batchCreateKnowledgeDirectories,
	removeFileFromKnowledgeById,
	searchKnowledgeFilesById
} from '$lib/apis/knowledge';
import { uploadFile } from '$lib/apis/files';

import { fileName, type KnowledgeFile, type KnowledgeDirectory } from './types';

// P-006 S4 — knowledge base Markdown folder import orchestration (K7–K10).
// Planning and reporting are pure; network access goes through injectable
// dependencies (`FolderImportDeps`) so the orchestrator can be unit tested
// with stubs. Path safety reuses the S1 core (`normalizeRelativePath`,
// `analyzeMarkdownNote`, `rewriteImageRefs`); decisions #4/#7/#9 of the
// P-006 plan apply: images never vectorize, Markdown image references are
// rewritten to readable `[图片 <file>]` markers, conflict keys are the
// normalized knowledge-base path.

export type ImportConflictStrategy = 'skip' | 'overwrite' | 'copy';

export type PlannedKind = 'markdown' | 'image' | 'other';

export interface FolderImportEntry {
	file: File;
	/** webkitRelativePath-style path relative to the selected root. */
	relativePath: string;
}

export interface PlannedFile {
	/** Normalized root-relative path (directory + filename). */
	path: string;
	/** Normalized parent directory ('' at the root). */
	dir: string;
	filename: string;
	file: File;
	kind: PlannedKind;
}

export interface FolderImportPlan {
	preview: ImportPreview;
	files: PlannedFile[];
	paths: Set<string>;
	imagePaths: Set<string>;
	directories: string[];
	conflicts: string[];
	invalidPaths: { relativePath: string; reason: string }[];
	counts: { markdown: number; image: number; other: number; directory: number };
	warnings: string[];
}

const MAX_FILES_BEFORE_BATCH_WARNING = 500;
const MAX_IMAGE_REFS_PER_NOTE = 50;

const posixDirname = (path: string): string => {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
};

const posixBasename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Plan a folder import: normalize every relative path (invalid ones are
 * excluded up front, K14), build the directory tree/preview, and flag
 * conflicts against keys already present in the knowledge base.
 */
export function planFolderImport(
	entries: readonly FolderImportEntry[],
	existingKeys?: ReadonlySet<string>
): FolderImportPlan {
	const preview = buildImportPreview(
		entries.map((e) => ({ relativePath: e.relativePath, size: e.file.size })),
		{
			...(existingKeys ? { existingKeys } : {}),
			// buildImportPreview passes the normalized path through as `path`.
			conflictKeyOf: ((file: { path: string }) => file.path) as unknown as (
				file: { relativePath: string; directory: string; filename: string }
			) => string
		}
	);

	const fileByPath = new Map<string, File>();
	for (const entry of entries) {
		const res = normalizeRelativePath(entry.relativePath);
		if (res.ok) fileByPath.set(res.path, entry.file);
	}

	const files: PlannedFile[] = [...fileByPath.entries()].map(([path, file]) => ({
		path,
		dir: posixDirname(path),
		filename: posixBasename(path),
		file,
		kind: isMarkdownPath(path) ? 'markdown' : isImagePath(path) ? 'image' : 'other'
	}));

	const counts = {
		markdown: files.filter((f) => f.kind === 'markdown').length,
		image: files.filter((f) => f.kind === 'image').length,
		other: files.filter((f) => f.kind === 'other').length,
		directory: preview.directories.length
	};

	const warnings: string[] = [];
	if (files.length > MAX_FILES_BEFORE_BATCH_WARNING) {
		warnings.push(
			`所选文件数超过 ${MAX_FILES_BEFORE_BATCH_WARNING}，建议分批导入。` as string
		);
	}

	return {
		preview,
		files,
		paths: new Set(fileByPath.keys()),
		imagePaths: new Set(files.filter((f) => f.kind === 'image').map((f) => f.path)),
		directories: preview.directories,
		conflicts: preview.conflicts.map((c) => c.key),
		invalidPaths: preview.invalidPaths,
		counts,
		warnings
	};
}

// ── Dependency contract ─────────────────────────────────────────────────────

export interface KnowledgeFileListing {
	items: KnowledgeFile[];
	directories: KnowledgeDirectory[];
	total: number;
}

export interface FolderImportDeps {
	batchDirectories(
		token: string,
		id: string,
		directories: string[]
	): Promise<Record<string, string>>;
	uploadFile(
		token: string,
		file: File,
		metadata?: object | null,
		process?: boolean | null
	): Promise<any>;
	addFileToKnowledgeById(
		token: string,
		id: string,
		fileId: string,
		directoryId?: string | null,
		process?: boolean
	): Promise<any>;
	removeFileFromKnowledgeById(
		token: string,
		id: string,
		fileId: string,
		confirmShared?: boolean
	): Promise<any>;
	listFiles(
		token: string,
		id: string,
		directoryId: string | null,
		page: number
	): Promise<KnowledgeFileListing>;
	computeFileHash(file: File): Promise<string>;
}

export const defaultFolderImportDeps: FolderImportDeps = {
	batchDirectories: (token, id, directories) =>
		batchCreateKnowledgeDirectories(token, id, directories),
	// stream=false: batch import does not await the per-file process status SSE.
	uploadFile: (token, file, metadata, process) => uploadFile(token, file, metadata, process, false),
	addFileToKnowledgeById: (token, id, fileId, directoryId, process) =>
		addFileToKnowledgeById(token, id, fileId, directoryId, process),
	removeFileFromKnowledgeById: (token, id, fileId, confirmShared) =>
		removeFileFromKnowledgeById(token, id, fileId, confirmShared),
	listFiles: (token, id, directoryId, page) =>
		searchKnowledgeFilesById(token, id, '', null, null, null, page, directoryId, false),
	computeFileHash
};

/**
 * Index the knowledge base by normalized path: recursive walk of the
 * directory tree from the root. Used for conflict detection (idempotency,
 * #9) and overwrite targeting. Keys are `<dirPath>/<filename>`.
 */
export const buildKnowledgePathIndex = async (
	deps: FolderImportDeps,
	token: string,
	id: string
): Promise<{ keys: Set<string>; files: Map<string, KnowledgeFile> }> => {
	const keys = new Set<string>();
	const files = new Map<string, KnowledgeFile>();

	const walk = async (directoryId: string | null, dirPath: string): Promise<void> => {
		const directories: KnowledgeDirectory[] = [];
		let page = 1;
		while (true) {
			const listing = await deps.listFiles(token, id, directoryId, page);
			for (const file of listing.items ?? []) {
				const name = fileName(file);
				const key = dirPath ? `${dirPath}/${name}` : name;
				keys.add(key);
				files.set(key, file);
			}
			if (page === 1) directories.push(...(listing.directories ?? []));
			const total = listing.total ?? (listing.items?.length ?? 0);
			if (!listing.items?.length || listing.items.length >= total) break;
			page++;
		}
		for (const directory of directories) {
			const childPath = dirPath ? `${dirPath}/${directory.name}` : directory.name;
			await walk(directory.id, childPath);
		}
	};

	await walk(null, '');
	return { keys, files };
};

// ── Import report ───────────────────────────────────────────────────────────

export interface ImportedEntry {
	path: string;
	kind: 'markdown' | 'image';
	fileId?: string;
}

export interface SkippedEntry {
	path: string;
	reason: string;
}

export interface FailedEntry {
	path: string;
	reason: string;
}

export interface FolderImportReport {
	status: 'completed' | 'cancelled' | 'failed';
	total: number;
	directoriesCreated: number;
	succeeded: ImportedEntry[];
	skipped: SkippedEntry[];
	failed: FailedEntry[];
	missingImages: { mdPath: string; raw: string; path: string }[];
	orphanImages: string[];
	invalidPaths: { relativePath: string; reason: string }[];
	/** Documents whose image reference count exceeded the threshold (#10). */
	refHeavyFiles: { path: string; imageRefs: number }[];
	/** Rewritten, directly accessible image addresses recorded for reference (#7). */
	imageUrls: { path: string; url: string }[];
	warnings: string[];
	strategy: ImportConflictStrategy;
	startedAt: number;
	finishedAt: number;
}

export interface FolderImportParams {
	token: string;
	knowledgeId: string;
	entries: readonly FolderImportEntry[];
	strategy?: ImportConflictStrategy;
	shouldCancel?: () => boolean;
	onProgress?: (progress: { processed: number; total: number; current: string }) => void;
	batchSize?: number;
}

const reasonOf = (error: unknown): string => {
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'detail' in (error as any)) {
		const detail = (error as any).detail;
		if (detail) return String(detail);
	}
	if (error instanceof Error && error.message) return error.message;
	return String(error);
};

/** `a/b/name.png` → `a/b/name (copy).png`, then `(copy 2)`, `(copy 3)`… */
export const copyTargetPath = (
	path: string,
	taken: ReadonlySet<string>
): { path: string; filename: string } => {
	const dir = posixDirname(path);
	const filename = posixBasename(path);
	const dot = filename.lastIndexOf('.');
	const base = dot <= 0 ? filename : filename.slice(0, dot);
	const ext = dot <= 0 ? '' : filename.slice(dot);
	for (let n = 0; n < 1000; n++) {
		const candidate = `${base}${n === 0 ? ' (copy)' : ` (copy ${n + 1})`}${ext}`;
		const candidatePath = dir ? `${dir}/${candidate}` : candidate;
		if (!taken.has(candidatePath)) {
			return { path: candidatePath, filename: candidate };
		}
	}
	return { path, filename };
};

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Batch import a Markdown folder into a knowledge base (K7–K10):
 * directories get-or-created via the batch endpoint, images uploaded
 * unprocessed (never vectorized, #4) with cross-batch content dedup,
 * Markdown uploaded processed with image references rewritten to readable
 * markers (#7), conflicts resolved per strategy (skip default), batches of
 * `batchSize` files with progress reporting and cancellation between batches.
 */
export const runFolderImport = async (
	deps: FolderImportDeps,
	params: FolderImportParams
): Promise<FolderImportReport> => {
	const {
		token,
		knowledgeId,
		entries,
		strategy = 'skip',
		shouldCancel,
		onProgress,
		batchSize = 10
	} = params;

	const startedAt = Date.now();
	const report: FolderImportReport = {
		status: 'completed',
		total: 0,
		directoriesCreated: 0,
		succeeded: [],
		skipped: [],
		failed: [],
		missingImages: [],
		orphanImages: [],
		invalidPaths: [],
		refHeavyFiles: [],
		imageUrls: [],
		warnings: [],
		strategy,
		startedAt,
		finishedAt: startedAt
	};

	const fail = (reason: unknown) => {
		report.status = 'failed';
		report.failed.push({ path: '*', reason: reasonOf(reason) });
		report.finishedAt = Date.now();
		return report;
	};

	// ── 1. Index what already exists in the knowledge base (#9) ──
	let existingKeys: Set<string>;
	let existingFiles: Map<string, KnowledgeFile>;
	try {
		const index = await buildKnowledgePathIndex(deps, token, knowledgeId);
		existingKeys = index.keys;
		existingFiles = index.files;
	} catch (error) {
		return fail(error);
	}

	// ── 2. Plan: normalize paths, build the tree, flag conflicts ──
	const plan = planFolderImport(entries, existingKeys);
	report.invalidPaths = plan.invalidPaths;
	report.warnings.push(...plan.warnings);

	const ordered = plan.files.filter((f) => f.kind !== 'other');
	for (const other of plan.files.filter((f) => f.kind === 'other')) {
		report.skipped.push({ path: other.path, reason: 'unsupported type' });
	}
	report.total = ordered.length;

	// ── 3. Get-or-create the directory tree (K7) ──
	const directoryIdByPath: Record<string, string> = {};
	if (plan.directories.length > 0) {
		try {
			const created = await deps.batchDirectories(token, knowledgeId, plan.directories);
			Object.assign(directoryIdByPath, created ?? {});
		} catch (error) {
			return fail(error);
		}
	}
	report.directoriesCreated = plan.directories.filter((p) => !!directoryIdByPath[p]).length;

	const directoryIdOf = (dir: string): string | null => directoryIdByPath[dir] ?? null;

	// Cross-batch image dedup (#4): (filename, size, sha256) → uploaded asset.
	const assetCache = new Map<string, { fileId: string; url: string }>();

	const importImage = async (item: PlannedFile): Promise<void> => {
		const hash = await deps.computeFileHash(item.file);
		const assetKey = crossBatchAssetKey(item.filename, item.file.size, hash);
		let fileId: string;
		let url: string;
		const cached = assetCache.get(assetKey);
		if (cached) {
			({ fileId, url } = cached);
		} else {
			const uploaded = await deps.uploadFile(
				token,
				item.file,
				{ directory_id: directoryIdOf(item.dir) },
				false
			);
			if (!uploaded?.id) throw new Error('upload failed');
			fileId = uploaded.id;
			url = `${WEBUI_API_BASE_URL}/files/${fileId}/content`;
			await deps.addFileToKnowledgeById(
				token,
				knowledgeId,
				fileId,
				directoryIdOf(item.dir),
				false
			);
			assetCache.set(assetKey, { fileId, url });
			report.imageUrls.push({ path: item.path, url });
		}
		report.succeeded.push({ path: item.path, kind: 'image', fileId });
	};

	const importMarkdown = async (item: PlannedFile): Promise<void> => {
		const text = await item.file.text();
		const analysis = analyzeMarkdownNote(item.path, text, [...plan.paths], {});
		const refCount = parseImageRefs(text).length;
		if (refCount > MAX_IMAGE_REFS_PER_NOTE) {
			report.refHeavyFiles.push({ path: item.path, imageRefs: refCount });
		}
		for (const missing of analysis.missingRefs) {
			report.missingImages.push({ mdPath: item.path, raw: missing.raw, path: missing.path });
		}
		for (const orphan of analysis.orphanImages) {
			report.orphanImages.push(orphan);
		}

		// Rewrite every reference that resolves to an existing image in the
		// selected tree into a readable marker (#7); external references are
		// kept as-is (#11); missing/unresolvable ones stay untouched.
		const { content } = rewriteImageRefs(
			text,
			(ref, path) => {
				if (ref.external) return null;
				if (path && plan.imagePaths.has(path)) {
					return { form: 'text' as const, text: knowledgeImageMarker(path) };
				}
				return null;
			},
			{ mdDir: item.dir }
		);

		const contentHash = noteContentHash(content);
		const outFile = new File([content], item.filename, { type: 'text/markdown' });
		const metadata = {
			directory_id: directoryIdOf(item.dir),
			...markdownImportMeta(item.path, contentHash, Math.floor(Date.now() / 1000))
		};
		const uploaded = await deps.uploadFile(token, outFile, metadata, true);
		if (!uploaded?.id) throw new Error('upload failed');
		await deps.addFileToKnowledgeById(
			token,
			knowledgeId,
			uploaded.id,
			directoryIdOf(item.dir),
			true
		);
		report.succeeded.push({ path: item.path, kind: 'markdown', fileId: uploaded.id });
	};

	const importPlanned = async (
		item: PlannedFile,
		target: { path: string; filename: string }
	): Promise<void> => {
		const effective: PlannedFile =
			target.filename === item.filename ? item : { ...item, ...target };
		if (effective.kind === 'image') {
			await importImage(effective);
		} else if (effective.kind === 'markdown') {
			await importMarkdown(effective);
		}
	};

	// ── 4. Submit in batches, cancellable between batches (K7) ──
	let processed = 0;
	let cancelled = false;
	for (let start = 0; start < ordered.length; start += batchSize) {
		if (shouldCancel?.()) {
			cancelled = true;
			break;
		}
		const batch = ordered.slice(start, start + batchSize);
		for (const item of batch) {
			processed++;
			onProgress?.({ processed, total: ordered.length, current: item.path });
			try {
				if (existingKeys.has(item.path)) {
					// Conflict: knowledge base already has this path (#9).
					if (strategy === 'skip') {
						report.skipped.push({ path: item.path, reason: 'already exists' });
						continue;
					}
					if (strategy === 'copy') {
						const target = copyTargetPath(item.path, existingKeys);
						existingKeys.add(target.path);
						await importPlanned(item, target);
						continue;
					}
					// overwrite: upload fresh content, then swap the KB entry.
					await importPlanned(item, { path: item.path, filename: item.filename });
					const stale = existingFiles.get(item.path);
					if (stale?.id) {
						await deps.removeFileFromKnowledgeById(token, knowledgeId, stale.id).catch(
							(error) => {
								report.warnings.push(`overwrite: ${item.path}: ${reasonOf(error)}`);
							}
						);
					}
				} else {
					existingKeys.add(item.path);
					await importPlanned(item, { path: item.path, filename: item.filename });
				}
			} catch (error) {
				report.failed.push({ path: item.path, reason: reasonOf(error) });
			}
		}
	}

	if (cancelled) {
		report.status = 'cancelled';
		report.warnings.push('import cancelled; already submitted files are kept');
	}
	report.finishedAt = Date.now();
	return report;
};
