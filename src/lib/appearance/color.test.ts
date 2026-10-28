import { describe, expect, it } from 'vitest';

import {
	contrastRatio,
	effectiveSurface,
	ensureReadableText,
	luminanceToGray,
	mixHex,
	readableForeground,
	relativeLuminance,
	themeColorTokens
} from './color';
import { DEFAULT_APPEARANCE } from './schema';
import type { ModeColors } from './schema';

const lightColors: ModeColors = {
	surface: '#f6f9fd',
	canvas: '#dce8f3',
	accent: '#2563eb',
	borderStrength: 20
};

describe('luminanceToGray', () => {
	it('round-trips luminance through the sRGB transfer curve', () => {
		for (const channel of [0, 51, 102, 153, 204, 255]) {
			const hex = `#${channel.toString(16).padStart(2, '0').repeat(3)}`;
			const gray = luminanceToGray(relativeLuminance(hex));
			expect(Math.abs(relativeLuminance(gray) - relativeLuminance(hex))).toBeLessThan(0.001);
		}
	});

	it('clamps out-of-range luminance', () => {
		expect(luminanceToGray(-1)).toBe('#000000');
		expect(luminanceToGray(2)).toBe('#ffffff');
	});
});

describe('effectiveSurface', () => {
	it('returns the theme surface unchanged without wallpaper luminance', () => {
		expect(
			effectiveSurface(lightColors, { glassAlpha: 0.5, scrim: 0.3, wallpaperLuminance: null })
		).toBe('#f6f9fd');
	});

	it('yields an opaque color equal to the theme surface for a white wallpaper at alpha 1', () => {
		expect(
			effectiveSurface(lightColors, { glassAlpha: 1, scrim: 0, wallpaperLuminance: 1 })
		).toBe('#f6f9fd');
	});

	it('keeps the composited result between the darkened wallpaper and the surface', () => {
		const dark = effectiveSurface(lightColors, {
			glassAlpha: 0.5,
			scrim: 0.5,
			wallpaperLuminance: 0
		});
		const surfaceLum = relativeLuminance('#f6f9fd');
		expect(relativeLuminance(dark)).toBeLessThan(surfaceLum);
		expect(contrastRatio(dark, '#ffffff')).toBeGreaterThan(1);
	});
});

describe('ensureReadableText', () => {
	it('achieves at least the target contrast for both ink and muted over a dark wallpaper', () => {
		const ink = readableForeground('#3a3f4b');
		const base = themeColorTokens(lightColors);
		const surface = effectiveSurface(lightColors, {
			glassAlpha: 0.5,
			scrim: 0.5,
			wallpaperLuminance: 0.1
		});
		const fixed = ensureReadableText(base.ink, base.muted, surface, 4.5);
		expect(contrastRatio(fixed.ink, surface)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(fixed.muted, surface)).toBeGreaterThanOrEqual(4.5);
		// The readable choice for a dark background must not be near-black.
		expect(ink).toBe('#f8fafc');
	});
});

describe('themeColorTokens with wallpaper context', () => {
	it('matches the legacy output when no wallpaper context is given', () => {
		const tokens = themeColorTokens(lightColors);
		expect(tokens.ink).toBe(readableForeground('#f6f9fd'));
		expect(tokens.surfaceRgb).toBe('246 249 253');
	});

	it('keeps highlight and shadow directions consistent via luminance, not string identity', () => {
		const darkMode = { ...lightColors, surface: '#0b1118' };
		const legacyDark = themeColorTokens(darkMode);
		// On a dark surface readableForeground picks the light ink (#f8fafc), so
		// legacy string equality already produced the "light ink" style; the
		// luminance check must reproduce that exactly.
		expect(legacyDark.ink).toBe('#f8fafc');
		expect(legacyDark.highlight).toBe('rgb(255 255 255 / 0.15)');
		expect(legacyDark.shadow).toBe('rgb(0 0 0 / 0.28)');

		// A dark ink (light surface) must produce the strong-highlight style.
		const legacyLight = themeColorTokens(lightColors);
		expect(legacyLight.ink).toBe('#0b1118');
		expect(legacyLight.highlight).toBe('rgb(255 255 255 / 0.5)');
		expect(legacyLight.shadow).toBe('rgb(0 0 0 / 0.12)');
	});

	it('produces at least 4.5:1 body-text contrast over a very dark wallpaper', () => {
		const tokens = themeColorTokens(lightColors, {
			glassAlpha: 0.3,
			scrim: 0.5,
			wallpaperLuminance: 0.02
		});
		const surface = (() => {
			const [r, g, b] = tokens.effectiveSurfaceRgb.split(' ').map(Number);
			return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
		})();
		expect(contrastRatio(tokens.ink, surface)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(tokens.muted, surface)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(tokens.accentText, surface)).toBeGreaterThanOrEqual(4.5);
	});

	it('produces at least 4.5:1 body-text contrast over a very bright wallpaper', () => {
		const tokens = themeColorTokens(lightColors, {
			glassAlpha: 0.3,
			scrim: 0.2,
			wallpaperLuminance: 0.98
		});
		const [r, g, b] = tokens.effectiveSurfaceRgb.split(' ').map(Number);
		const surface = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
		expect(contrastRatio(tokens.ink, surface)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(tokens.muted, surface)).toBeGreaterThanOrEqual(4.5);
	});
});

describe('default settings still tokenize', () => {
	it('works for every preset mode of the default appearance', () => {
		for (const mode of Object.values(DEFAULT_APPEARANCE.modes)) {
			const tokens = themeColorTokens(mode.colors);
			expect(tokens.ink).toMatch(/^#[0-9a-f]{6}$/);
			expect(tokens.muted).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});
