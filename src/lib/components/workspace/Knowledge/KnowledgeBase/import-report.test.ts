import { describe, expect, it } from 'vitest';
import { clearImportReports, loadImportReport, saveImportReport } from './import-report';
import type { FolderImportReport } from './knowledge-import';

const memory = (): Storage => {
	const data = new Map<string, string>();
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k) => data.get(k) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (k) => {
			data.delete(k);
		},
		setItem: (k, v) => {
			data.set(k, v);
		}
	};
};
const report = (): FolderImportReport => ({
	status: 'failed',
	total: 1,
	processed: 1,
	pending: [],
	directoriesCreated: 0,
	succeeded: [],
	skipped: [],
	failed: [{ path: '/Users/private/x.md', reason: 'Bearer secret-token /Users/private/x.md' }],
	missingImages: [],
	unsupportedImages: [],
	orphanImages: [],
	invalidPaths: [],
	refHeavyFiles: [],
	imageUrls: [],
	warnings: [],
	strategy: 'skip',
	startedAt: 1,
	finishedAt: 2
});

describe('import report persistence', () => {
	it('isolates accounts and knowledge bases and removes private input', () => {
		const storage = memory();
		expect(saveImportReport(storage, 'alice', 'kb1', report())).toBe(true);
		expect(loadImportReport(storage, 'bob', 'kb1')).toBeNull();
		expect(loadImportReport(storage, 'alice', 'kb2')).toBeNull();
		const raw = storage.getItem(storage.key(0)!)!;
		expect(raw).not.toContain('secret-token');
		expect(raw).not.toContain('/Users/private');
		clearImportReports(storage, 'alice');
		expect(storage.length).toBe(0);
	});
	it('reports a storage failure', () => {
		const storage = memory();
		storage.setItem = () => {
			throw new Error('quota');
		};
		expect(saveImportReport(storage, 'alice', 'kb', report())).toBe(false);
	});

	it('persists bounded unsupported-image diagnostics and normalizes legacy reports', () => {
		const storage = memory();
		const value = report();
		value.unsupportedImages = [
			{
				mdPath: 'notes/a.md',
				raw: '![ref][id] https://example.test/private',
				reason: 'Reference-style image is unsupported'
			}
		];
		expect(saveImportReport(storage, 'alice', 'kb', value)).toBe(true);
		const loaded = loadImportReport(storage, 'alice', 'kb');
		expect(loaded?.unsupportedImages).toEqual([
			{
				mdPath: 'notes/a.md',
				raw: '![ref][id] [url]',
				reason: 'Reference-style image is unsupported'
			}
		]);

		storage.setItem(
			'owui:knowledge-import:v2:alice:legacy',
			JSON.stringify({ ...report(), unsupportedImages: undefined })
		);
		expect(loadImportReport(storage, 'alice', 'legacy')?.unsupportedImages).toEqual([]);
	});
});
