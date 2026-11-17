import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('knowledge legacy PPT preview', () => {
	it('converts .ppt through the server preview endpoint before using the slide renderer', () => {
		const source = readFileSync(
			new URL('./FileViewer.svelte', import.meta.url),
			'utf8'
		);
		expect(source).toContain('getFilePreviewBlobById');
		expect(source).toContain("ext === 'ppt'");
		expect(source).toContain("fileOfficeSlides: result.images");
	});
});
