import {
	analyzeMarkdownNote,
	buildImportPreview,
	isImagePath,
	isMarkdownPath,
	knowledgeImageMarker,
	normalizeRelativePath,
	rewriteImageRefs,
	scanMarkdownImages,
	type ImportPreview
} from '$lib/components/notes/markdown-import';
import { computeFileHash } from '$lib/utils/hash';
import { WEBUI_API_BASE_URL } from '$lib/constants';
import {
	batchCreateKnowledgeDirectories,
	getKnowledgeImportOperation,
	importKnowledgeFile,
	KnowledgeImportError,
	type KnowledgeImportFile,
	type KnowledgeImportResult,
	removeFileFromKnowledgeById,
	searchKnowledgeFilesById
} from '$lib/apis/knowledge';

import { fileName, type KnowledgeFile, type KnowledgeDirectory } from './types';

// P-006 S4 — knowledge base Markdown folder import orchestration (K7–K10).
// Planning and reporting are pure; network access goes through injectable
// dependencies (`FolderImportDeps`) so the orchestrator can be unit tested
// with stubs. Path safety reuses the S1 core (`normalizeRelativePath`,
// `analyzeMarkdownNote`, `rewriteImageRefs`); decisions #4/#7/#9 keep the
// readable original image references while replacing them with short markers
// in indexed text. Conflict keys are normalized knowledge-base paths.

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
			conflictKeyOf: (file: { path?: string }) => file.path ?? ''
		}
	);

	const fileByPath = new Map<string, File>();
	const duplicates: { relativePath: string; reason: string }[] = [];
	for (const entry of entries) {
		const res = normalizeRelativePath(entry.relativePath);
		if (res.ok) {
			if (fileByPath.has(res.path))
				duplicates.push({ relativePath: entry.relativePath, reason: 'duplicate normalized path' });
			else fileByPath.set(res.path, entry.file);
		}
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
		warnings.push(`所选文件数超过 ${MAX_FILES_BEFORE_BATCH_WARNING}，建议分批导入。` as string);
	}

	return {
		preview,
		files,
		paths: new Set(fileByPath.keys()),
		imagePaths: new Set(files.filter((f) => f.kind === 'image').map((f) => f.path)),
		directories: preview.directories,
		conflicts: preview.conflicts.map((c) => c.key),
		invalidPaths: [...preview.invalidPaths, ...duplicates],
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
	importFile(token: string, id: string, file: KnowledgeImportFile): Promise<KnowledgeImportResult>;
	confirmOperation(token: string, id: string, operationId: string): Promise<KnowledgeImportResult>;
	canReadFile(token: string, fileId: string): Promise<boolean>;
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
	batchDirectories: batchCreateKnowledgeDirectories,
	importFile: importKnowledgeFile,
	confirmOperation: getKnowledgeImportOperation,
	canReadFile: async (token, fileId) => {
		const response = await fetch(`${WEBUI_API_BASE_URL}/files/${fileId}/content`, {
			headers: { authorization: `Bearer ${token}`, Range: 'bytes=0-0' }
		});
		await response.body?.cancel();
		return response.ok;
	},
	removeFileFromKnowledgeById,
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
	// Guard against cyclic directory references from the backend: each
	// directory is walked at most once (the root may also be re-listed by id).
	const visited = new Set<string | null>();

	const walk = async (directoryId: string | null, dirPath: string): Promise<void> => {
		if (visited.has(directoryId)) return;
		visited.add(directoryId);
		const directories: KnowledgeDirectory[] = [];
		let page = 1;
		let received = 0;
		const seenPages = new Set<string>();
		while (true) {
			const listing = await deps.listFiles(token, id, directoryId, page);
			for (const file of listing.items ?? []) {
				const name = fileName(file);
				const key = dirPath ? `${dirPath}/${name}` : name;
				keys.add(key);
				files.set(key, file);
			}
			if (page === 1) directories.push(...(listing.directories ?? []));
			const total = listing.total ?? listing.items?.length ?? 0;
			const signature = JSON.stringify(
				(listing.items ?? []).map((file) => file.id ?? fileName(file))
			);
			if (listing.items?.length && seenPages.has(signature))
				throw new Error('Knowledge listing did not advance');
			seenPages.add(signature);
			received += listing.items?.length ?? 0;
			if (received >= total) break;
			if (!listing.items?.length || page >= 10000)
				throw new Error('Knowledge listing is incomplete');
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
	stage?: string;
	cleanupStatus?: string;
	fileId?: string;
	operationId?: string;
}

export interface FolderImportReport {
	status: 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
	total: number;
	processed: number;
	pending: string[];
	directoriesCreated: number;
	succeeded: ImportedEntry[];
	skipped: SkippedEntry[];
	failed: FailedEntry[];
	missingImages: { mdPath: string; raw: string; path: string }[];
	unsupportedImages: { mdPath: string; raw: string; reason: string }[];
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
		if (typeof detail === 'string') return detail;
		if (detail?.message) return String(detail.message);
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

/** Import images before documents, and only accept confirmed target placements. */
export const runFolderImport = async (
	deps: FolderImportDeps,
	params: FolderImportParams
): Promise<FolderImportReport> => {
	const { token, knowledgeId, entries, strategy = 'skip', shouldCancel, onProgress } = params;
	const startedAt = Date.now();
	const report: FolderImportReport = {
		status: 'completed',
		total: entries.length,
		processed: 0,
		pending: [],
		directoriesCreated: 0,
		succeeded: [],
		skipped: [],
		failed: [],
		missingImages: [],
		unsupportedImages: [],
		orphanImages: [],
		invalidPaths: [],
		refHeavyFiles: [],
		imageUrls: [],
		warnings: [],
		strategy,
		startedAt,
		finishedAt: startedAt
	};
	let plan: FolderImportPlan;
	let existing: Awaited<ReturnType<typeof buildKnowledgePathIndex>>;
	let directories: Record<string, string>;
	try {
		existing = await buildKnowledgePathIndex(deps, token, knowledgeId);
		plan = planFolderImport(entries, existing.keys);
		report.invalidPaths = plan.invalidPaths;
		report.warnings.push(...plan.warnings);
		// Even root-only imports must preflight the server's write permission.
		directories = await deps.batchDirectories(token, knowledgeId, plan.directories);
		report.directoriesCreated = plan.directories.filter((path) => !!directories[path]).length;
	} catch (error) {
		report.status = 'failed';
		report.warnings.push(`Preflight: ${reasonOf(error)}`);
		report.pending = entries.map((entry) => entry.relativePath);
		report.finishedAt = Date.now();
		return report;
	}
	const images = plan.files.filter((item) => item.kind === 'image');
	const documents = plan.files.filter((item) => item.kind === 'markdown');
	const ordered = [...images, ...documents];
	const imageUrls = new Map<string, string>();
	const taken = new Set(existing.keys);
	for (const item of plan.files.filter((item) => item.kind === 'other')) {
		report.skipped.push({ path: item.path, reason: 'unsupported type' });
	}
	report.processed = report.skipped.length + report.invalidPaths.length;
	const directoryId = (item: PlannedFile): string | null => {
		if (!item.dir) return null;
		if (!directories[item.dir]) throw new Error('Target directory was not confirmed');
		return directories[item.dir];
	};
	const submit = async (
		item: PlannedFile,
		file: File,
		kind: 'image' | 'markdown',
		indexText?: string
	) => {
		const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 15) | 64;
		bytes[8] = (bytes[8] & 63) | 128;
		const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
		const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		const input: KnowledgeImportFile = {
			file,
			kind,
			directoryId: directoryId(item),
			sourcePath: item.path,
			sourceHash: await deps.computeFileHash(item.file),
			operationId,
			...(indexText !== undefined ? { indexText } : {})
		};
		let result: KnowledgeImportResult;
		try {
			result = await deps.importFile(token, knowledgeId, input);
		} catch (error) {
			if (!(error instanceof KnowledgeImportError) || !error.unconfirmed)
				throw Object.assign(error instanceof Error ? error : new Error(reasonOf(error)), {
					operationId
				});
			try {
				result = await deps.confirmOperation(token, knowledgeId, operationId);
			} catch {
				throw Object.assign(error, { operationId });
			}
		}
		if (
			result.status !== 'completed' ||
			result.operation_id !== operationId ||
			result.source_path !== item.path ||
			result.directory_id !== input.directoryId ||
			result.indexed !== (kind === 'markdown') ||
			!result.file_id
		) {
			throw Object.assign(
				new KnowledgeImportError(
					'Import result was not confirmed',
					'confirmation',
					'pending',
					undefined,
					true
				),
				{ operationId }
			);
		}
		return { fileId: result.file_id, operationId };
	};
	let cancelled = false;
	for (let i = 0; i < ordered.length; i++) {
		const item = ordered[i];
		if (shouldCancel?.()) {
			cancelled = true;
			report.pending = ordered.slice(i).map((entry) => entry.path);
			break;
		}
		onProgress?.({ processed: report.processed, total: report.total, current: item.path });
		try {
			const old = existing.files.get(item.path);
			if (old && strategy === 'skip') {
				if (item.kind === 'image') {
					if (!old.id || old.has_original === false || !(await deps.canReadFile(token, old.id))) {
						throw new Error('Existing image could not be confirmed readable');
					}
					const url = `/api/v1/files/${old.id}/content`;
					imageUrls.set(item.path, url);
					report.imageUrls.push({ path: item.path, url });
				}
				report.skipped.push({ path: item.path, reason: 'already exists' });
				continue;
			}
			const target =
				old && strategy === 'copy'
					? copyTargetPath(item.path, taken)
					: { path: item.path, filename: item.filename };
			taken.add(target.path);
			if (item.kind === 'image') {
				const image = new File([item.file], target.filename, {
					type: item.file.type || 'application/octet-stream'
				});
				const created = await submit(item, image, 'image');
				const url = `/api/v1/files/${created.fileId}/content`;
				imageUrls.set(item.path, url);
				report.imageUrls.push({ path: item.path, url });
				report.succeeded.push({ path: item.path, kind: 'image', fileId: created.fileId });
			} else {
				const text = await item.file.text();
				const scan = scanMarkdownImages(text);
				if (scan.refs.some((ref) => /^(?:data|blob):/i.test(ref.dest))) {
					throw new Error('Embedded or temporary image URLs cannot be imported');
				}
				const analysis = analyzeMarkdownNote(item.path, text, [...plan.paths], {});
				const refs = scan.refs.length;
				if (refs > MAX_IMAGE_REFS_PER_NOTE)
					report.refHeavyFiles.push({ path: item.path, imageRefs: refs });
				report.orphanImages.push(...analysis.orphanImages);
				const missing: { raw: string; path: string }[] = [];
				const originalRewrite = rewriteImageRefs(
					text,
					(ref, path) => {
						if (ref.external) return null;
						const url = path && imageUrls.get(path);
						if (url) return { form: 'url' as const, url };
						missing.push({ raw: ref.raw, path: path ?? ref.dest });
						return null;
					},
					{ mdDir: item.dir }
				);
				const original = originalRewrite.content;
				const unsupported = originalRewrite.outcomes
					.filter((outcome) => outcome.status === 'unsupported')
					.map((outcome) => ({
						raw: outcome.raw,
						reason: outcome.reason || 'Unsupported image reference'
					}));
				const indexText = rewriteImageRefs(
					text,
					(ref, path) => ({
						form: 'text' as const,
						text:
							ref.alt?.trim() && !/(?:https?:|data:|\/api\/v1\/files\/|[\/\\])/i.test(ref.alt)
								? ref.alt.trim().slice(0, 120)
								: knowledgeImageMarker(path || 'image')
					}),
					{ mdDir: item.dir }
				).content;
				const readable = missing.length
					? `${original}\n\n> ⚠️ Missing images: ${missing.map((m) => m.path).join(', ')}`
					: original;
				const output = new File([readable], target.filename, { type: 'text/markdown' });
				const created = await submit(item, output, 'markdown', indexText);
				if (unsupported.length) {
					report.unsupportedImages.push(
						...unsupported.map((image) => ({ mdPath: item.path, ...image }))
					);
				}
				if (missing.length) {
					report.missingImages.push(...missing.map((m) => ({ mdPath: item.path, ...m })));
					report.failed.push({
						path: item.path,
						reason: 'Referenced images are missing or were not confirmed',
						stage: 'dependency',
						fileId: created.fileId,
						operationId: created.operationId
					});
				} else report.succeeded.push({ path: item.path, kind: 'markdown', fileId: created.fileId });
			}
			if (
				old &&
				strategy === 'overwrite' &&
				old.id &&
				!report.failed.some((failure) => failure.path === item.path)
			) {
				try {
					await deps.removeFileFromKnowledgeById(token, knowledgeId, old.id);
				} catch (error) {
					report.succeeded = report.succeeded.filter((entry) => entry.path !== item.path);
					report.failed.push({
						path: item.path,
						reason: `Replacement created; old file remains: ${reasonOf(error)}`,
						stage: 'cleanup',
						cleanupStatus: 'failed'
					});
				}
			}
		} catch (error) {
			const detail = error instanceof KnowledgeImportError ? error : null;
			report.failed.push({
				path: item.path,
				reason: reasonOf(error),
				stage: detail?.stage || 'upload',
				cleanupStatus: detail?.cleanupStatus,
				fileId: detail?.fileId,
				operationId: (error as any)?.operationId
			});
		} finally {
			report.processed++;
			onProgress?.({ processed: report.processed, total: report.total, current: item.path });
		}
	}
	const hasProblems =
		report.failed.length > 0 ||
		report.invalidPaths.length > 0 ||
		report.missingImages.length > 0 ||
		report.unsupportedImages.length > 0;
	report.status = cancelled
		? 'cancelled'
		: hasProblems
			? report.succeeded.length || report.skipped.length
				? 'completed_with_errors'
				: 'failed'
			: 'completed';
	report.finishedAt = Date.now();
	return report;
};
