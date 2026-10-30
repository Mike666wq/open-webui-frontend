import type { FolderImportReport } from './knowledge-import';
import { normalizeRelativePath } from '$lib/components/notes/markdown-import';

const PREFIX = 'owui:knowledge-import:v2:';
const MAX_BYTES = 1024 * 1024;
const key = (userId: string, knowledgeId: string) =>
	`${PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(knowledgeId)}`;
const safePath = (path: string) => {
	const result = normalizeRelativePath(path);
	return result.ok ? result.path : '[invalid path]';
};
const safeReason = (reason: string) =>
	reason
		.replace(/\bBearer\s+\S+/gi, '[redacted]')
		.replace(/data:[^\s)]+/gi, '[redacted]')
		.replace(/https?:\/\/\S+/gi, '[url]')
		.replace(/(?:[A-Za-z]:\\\\|\/)(?:[^\s:]+\/)*[^\s:]*/g, '[path]')
		.slice(0, 1000);

/** Store only bounded diagnostic metadata; never file bodies or source absolutes. */
export function saveImportReport(
	storage: Storage,
	userId: string,
	knowledgeId: string,
	report: FolderImportReport
): boolean {
	try {
		const safe = {
			...report,
			succeeded: report.succeeded.map((item) => ({ ...item, path: safePath(item.path) })),
			skipped: report.skipped.map((item) => ({
				...item,
				path: safePath(item.path),
				reason: safeReason(item.reason)
			})),
			failed: report.failed.map((item) => ({
				...item,
				path: safePath(item.path),
				reason: safeReason(item.reason)
			})),
			pending: report.pending.map(safePath),
			invalidPaths: report.invalidPaths.map((item) => ({
				relativePath: safePath(item.relativePath),
				reason: safeReason(item.reason)
			})),
			missingImages: report.missingImages.map((item) => ({
				mdPath: safePath(item.mdPath),
				path: safePath(item.path),
				raw: ''
			})),
			unsupportedImages: (report.unsupportedImages ?? []).map((item) => ({
				mdPath: safePath(item.mdPath),
				raw: safeReason(item.raw).slice(0, 240),
				reason: safeReason(item.reason)
			})),
			orphanImages: report.orphanImages.map(safePath),
			refHeavyFiles: report.refHeavyFiles.map((item) => ({ ...item, path: safePath(item.path) })),
			imageUrls: [],
			warnings: report.warnings.map(safeReason)
		};
		const value = JSON.stringify(safe);
		if (value.length > MAX_BYTES) return false;
		storage.setItem(key(userId, knowledgeId), value);
		return true;
	} catch {
		return false;
	}
}

export function loadImportReport(
	storage: Storage,
	userId: string,
	knowledgeId: string
): FolderImportReport | null {
	try {
		const raw = storage.getItem(key(userId, knowledgeId));
		if (!raw || raw.length > MAX_BYTES) return null;
		const report = JSON.parse(raw);
		if (
			!['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(report.status) ||
			!Array.isArray(report.failed)
		)
			return null;
		return {
			...report,
			unsupportedImages: Array.isArray(report.unsupportedImages) ? report.unsupportedImages : []
		} as FolderImportReport;
	} catch {
		return null;
	}
}

export function clearImportReports(storage: Storage, userId: string): void {
	const prefix = `${PREFIX}${encodeURIComponent(userId)}:`;
	for (let i = storage.length - 1; i >= 0; i--) {
		const entry = storage.key(i);
		if (entry?.startsWith(prefix)) storage.removeItem(entry);
	}
}
