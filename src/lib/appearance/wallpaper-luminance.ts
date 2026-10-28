const SAMPLE_SIZE = 24;

/**
 * Perceptual (sRGB-linearized) average luminance of raw RGBA pixel data.
 * Pure function so it can be unit-tested without a canvas. Fully
 * transparent pixels are excluded from the average; if every pixel is
 * transparent, returns null.
 */
export function averageLuminanceFromPixels(data: Uint8ClampedArray | Uint8Array): number | null {
	const count = Math.floor(data.length / 4);
	if (count === 0) return null;
	let total = 0;
	let opaque = 0;
	for (let index = 0; index < count; index += 1) {
		const offset = index * 4;
		if (data[offset + 3] === 0) continue;
		opaque += 1;
		const linear = (channel: number) => {
			const value = channel / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		};
		total +=
			0.2126 * linear(data[offset]) +
			0.7152 * linear(data[offset + 1]) +
			0.0722 * linear(data[offset + 2]);
	}
	return opaque === 0 ? null : total / opaque;
}

/**
 * Downsamples a wallpaper image to a tiny canvas and returns its average
 * luminance (0-1), or null when sampling is not possible in this
 * environment. Never throws for malformed images; callers treat null as
 * "unknown wallpaper brightness" and fall back to conservative surfaces.
 */
export async function sampleWallpaperLuminance(
	blob: Blob,
	size = SAMPLE_SIZE
): Promise<number | null> {
	try {
		let width = size;
		let height = size;
		let source: ImageBitmap | HTMLImageElement;

		if (typeof createImageBitmap === 'function') {
			const bitmap = await createImageBitmap(blob);
			source = bitmap;
		} else if (typeof Image !== 'undefined') {
			source = await new Promise<HTMLImageElement>((resolve, reject) => {
				const url = URL.createObjectURL(blob);
				const image = new Image();
				image.onload = () => {
					URL.revokeObjectURL(url);
					resolve(image);
				};
				image.onerror = () => {
					URL.revokeObjectURL(url);
					reject(new Error('Unable to decode wallpaper image'));
				};
				image.src = url;
			});
		} else {
			return null;
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) return null;
		context.drawImage(source, 0, 0, width, height);
		if ('close' in source && typeof source.close === 'function') source.close();
		const { data } = context.getImageData(0, 0, width, height);
		return averageLuminanceFromPixels(data);
	} catch {
		return null;
	}
}
