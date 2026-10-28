import { describe, expect, it } from 'vitest';

import { averageLuminanceFromPixels } from './wallpaper-luminance';

const pixel = (r: number, g: number, b: number, a = 255): [number, number, number, number] => [
	r,
	g,
	b,
	a
];

describe('averageLuminanceFromPixels', () => {
	it('returns null for empty data', () => {
		expect(averageLuminanceFromPixels(new Uint8ClampedArray())).toBeNull();
	});

	it('returns 0 for a black image', () => {
		const data = new Uint8ClampedArray(4 * 4 * 4);
		for (let i = 0; i < 4 * 4; i += 1) data.set([0, 0, 0, 255], i * 4);
		expect(averageLuminanceFromPixels(data)).toBe(0);
	});

	it('returns 1 for a white image', () => {
		const data = new Uint8ClampedArray(4 * 4 * 4);
		for (let i = 0; i < 4 * 4; i += 1) data.set([255, 255, 255, 255], i * 4);
		expect(averageLuminanceFromPixels(data)).toBeCloseTo(1, 5);
	});

	it('weights green most heavily per the sRGB luminance coefficients', () => {
		const green = new Uint8ClampedArray([...pixel(0, 255, 0)]);
		const red = new Uint8ClampedArray([...pixel(255, 0, 0)]);
		expect(averageLuminanceFromPixels(green)!).toBeGreaterThan(
			averageLuminanceFromPixels(red)!
		);
	});

	it('skips fully transparent pixels instead of dragging the average down', () => {
		const opaqueWhite = new Uint8ClampedArray([...pixel(255, 255, 255)]);
		const mixed = new Uint8ClampedArray([...pixel(255, 255, 255), ...pixel(0, 0, 0, 0)]);
		expect(averageLuminanceFromPixels(mixed)).toBeCloseTo(
			averageLuminanceFromPixels(opaqueWhite)!,
			5
		);
	});

	it('returns null when every pixel is transparent', () => {
		const data = new Uint8ClampedArray([...pixel(10, 20, 30, 0), ...pixel(40, 50, 60, 0)]);
		expect(averageLuminanceFromPixels(data)).toBeNull();
	});

	it('mid-gray lands near its linearized luminance', () => {
		const gray = new Uint8ClampedArray([...pixel(188, 188, 188)]);
		const value = averageLuminanceFromPixels(gray)!;
		expect(value).toBeGreaterThan(0.4);
		expect(value).toBeLessThan(0.6);
	});
});
