import { mixHex } from './color';
import type { ModeColors, ResolvedAppearanceTheme } from './schema';

export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
export const MAX_WALLPAPER_EDGE = 2560;
export const SUPPORTED_WALLPAPER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type DetectedImageFormat = 'jpeg' | 'png' | 'webp';

export class WallpaperImageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WallpaperImageError';
	}
}

export function detectImageFormat(bytes: Uint8Array): DetectedImageFormat | null {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return 'jpeg';
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'png';
	}
	if (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	) {
		return 'webp';
	}
	return null;
}

export function validateWallpaperFile(file: Pick<File, 'size' | 'type'>): void {
	if (!SUPPORTED_WALLPAPER_TYPES.includes(file.type as (typeof SUPPORTED_WALLPAPER_TYPES)[number])) {
		throw new WallpaperImageError('Choose a JPEG, PNG or WebP image');
	}
	if (file.size <= 0) throw new WallpaperImageError('The selected image is empty');
	if (file.size > MAX_WALLPAPER_BYTES) {
		throw new WallpaperImageError('The selected image is larger than 20MB');
	}
}

export function fitImageDimensions(
	width: number,
	height: number,
	maxEdge = MAX_WALLPAPER_EDGE
): { width: number; height: number } {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new WallpaperImageError('The image dimensions are invalid');
	}
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

const readMagic = async (file: File) => {
	const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
	if (!detectImageFormat(bytes)) {
		throw new WallpaperImageError('The file contents are not a supported image');
	}
};

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
	if ('createImageBitmap' in window) {
		try {
			return await createImageBitmap(file, { imageOrientation: 'from-image' });
		} catch {
			// Older WebViews decode through the image element fallback below.
		}
	}
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.decoding = 'async';
		image.src = url;
		await image.decode();
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new WallpaperImageError('The image could not be encoded'));
			},
			'image/webp',
			0.92
		);
	});

export async function processWallpaperFile(file: File): Promise<Blob> {
	validateWallpaperFile(file);
	await readMagic(file);
	const image = await decodeImage(file);
	try {
		const sourceWidth = image.width;
		const sourceHeight = image.height;
		const target = fitImageDimensions(sourceWidth, sourceHeight);
		const canvas = document.createElement('canvas');
		canvas.width = target.width;
		canvas.height = target.height;
		const context = canvas.getContext('2d', { alpha: true });
		if (!context) throw new WallpaperImageError('Canvas is unavailable on this device');
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(image, 0, 0, target.width, target.height);
		return await canvasToBlob(canvas);
	} catch (error) {
		if (error instanceof WallpaperImageError) throw error;
		throw new WallpaperImageError('The image could not be processed');
	} finally {
		if ('close' in image) image.close();
	}
}

const toHex = (value: number) =>
	Math.max(0, Math.min(255, Math.round(value)))
		.toString(16)
		.padStart(2, '0');

const rgbToHex = (r: number, g: number, b: number) => `#${toHex(r)}${toHex(g)}${toHex(b)}`;

export async function suggestColorsFromImage(
	blob: Blob,
	mode: ResolvedAppearanceTheme
): Promise<Pick<ModeColors, 'accent' | 'canvas' | 'surface'>> {
	const image = await decodeImage(new File([blob], 'wallpaper.webp', { type: blob.type }));
	try {
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new WallpaperImageError('Canvas is unavailable on this device');
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
		let count = 0;
		let sumR = 0;
		let sumG = 0;
		let sumB = 0;
		let saturatedR = 0;
		let saturatedG = 0;
		let saturatedB = 0;
		let saturatedCount = 0;

		for (let index = 0; index < data.length; index += 4) {
			const r = data[index];
			const g = data[index + 1];
			const b = data[index + 2];
			const alpha = data[index + 3];
			if (alpha < 24) continue;
			count += 1;
			sumR += r;
			sumG += g;
			sumB += b;
			const max = Math.max(r, g, b);
			const min = Math.min(r, g, b);
			if (max - min > 28) {
				saturatedR += r;
				saturatedG += g;
				saturatedB += b;
				saturatedCount += 1;
			}
		}

		const average = rgbToHex(
			count ? sumR / count : mode === 'dark' ? 24 : 224,
			count ? sumG / count : mode === 'dark' ? 31 : 232,
			count ? sumB / count : mode === 'dark' ? 45 : 240
		);
		const accentSource =
			saturatedCount > count * 0.04
				? rgbToHex(
						saturatedR / saturatedCount,
						saturatedG / saturatedCount,
						saturatedB / saturatedCount
					)
				: {
						light: '#2563eb',
						dark: '#7aa2ff'
					}[mode];
		return {
			accent: mixHex(accentSource, mode === 'dark' ? '#ffffff' : '#000000', 0.04),
			canvas: mixHex(average, mode === 'dark' ? '#070b14' : '#f7fbff', 0.62),
			surface: mixHex(average, mode === 'dark' ? '#101827' : '#ffffff', 0.78)
		};
	} finally {
		if ('close' in image) image.close();
	}
}
