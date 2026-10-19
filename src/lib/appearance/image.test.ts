import { describe, expect, it } from 'vitest';
import {
	MAX_WALLPAPER_BYTES,
	detectImageFormat,
	fitImageDimensions,
	validateWallpaperFile
} from './image';

describe('wallpaper image validation', () => {
	it('detects actual JPEG, PNG and WebP signatures', () => {
		expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe('jpeg');
		expect(
			detectImageFormat(
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			)
		).toBe('png');
		expect(
			detectImageFormat(
				new Uint8Array([
					0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
				])
			)
		).toBe('webp');
		expect(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
	});

	it('rejects unsupported, empty and oversized files', () => {
		expect(() =>
			validateWallpaperFile({ size: 100, type: 'image/gif' } as File)
		).toThrow(/JPEG/);
		expect(() =>
			validateWallpaperFile({ size: 0, type: 'image/png' } as File)
		).toThrow(/empty/);
		expect(() =>
			validateWallpaperFile({
				size: MAX_WALLPAPER_BYTES + 1,
				type: 'image/webp'
			} as File)
		).toThrow(/20MB/);
	});

	it('caps the long edge at 2560 and preserves aspect ratio', () => {
		expect(fitImageDimensions(6000, 4000)).toEqual({ width: 2560, height: 1707 });
		expect(fitImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
		expect(() => fitImageDimensions(0, 1)).toThrow(/invalid/);
	});
});
