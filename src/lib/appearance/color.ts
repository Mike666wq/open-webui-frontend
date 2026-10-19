import type { ModeColors, ResolvedAppearanceTheme } from './schema';

export type Rgb = {
	r: number;
	g: number;
	b: number;
};

export function parseHex(value: string): Rgb | null {
	const match = /^#([0-9a-f]{6})$/i.exec(value);
	if (!match) return null;
	const numeric = Number.parseInt(match[1], 16);
	return {
		r: (numeric >> 16) & 255,
		g: (numeric >> 8) & 255,
		b: numeric & 255
	};
}

const channelToLinear = (channel: number) => {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(color: string): number {
	const rgb = parseHex(color);
	if (!rgb) return 0;
	return (
		0.2126 * channelToLinear(rgb.r) +
		0.7152 * channelToLinear(rgb.g) +
		0.0722 * channelToLinear(rgb.b)
	);
}

export function contrastRatio(first: string, second: string): number {
	const a = relativeLuminance(first);
	const b = relativeLuminance(second);
	const lighter = Math.max(a, b);
	const darker = Math.min(a, b);
	return (lighter + 0.05) / (darker + 0.05);
}

export function mixHex(first: string, second: string, amountOfSecond: number): string {
	const a = parseHex(first);
	const b = parseHex(second);
	if (!a || !b) return first;
	const amount = Math.min(1, Math.max(0, amountOfSecond));
	const mix = (left: number, right: number) =>
		Math.round(left + (right - left) * amount)
			.toString(16)
			.padStart(2, '0');
	return `#${mix(a.r, b.r)}${mix(a.g, b.g)}${mix(a.b, b.b)}`;
}

export function rgbaFromHex(value: string, alpha: number): string {
	const rgb = parseHex(value);
	if (!rgb) return `rgb(0 0 0 / ${alpha})`;
	return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${Math.min(1, Math.max(0, alpha))})`;
}

export function rgbTriplet(value: string): string {
	const rgb = parseHex(value);
	return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : '0 0 0';
}

export function readableForeground(background: string): string {
	const dark = '#0b1118';
	const light = '#f8fafc';
	return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
}

export function ensureContrast(foreground: string, background: string, target = 4.5): string {
	if (contrastRatio(foreground, background) >= target) return foreground;
	const dark = '#000000';
	const light = '#ffffff';
	const direction =
		contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
	for (let amount = 0.1; amount <= 1.0001; amount += 0.05) {
		const candidate = mixHex(foreground, direction, amount);
		if (contrastRatio(candidate, background) >= target) return candidate;
	}
	return direction;
}

function mutedForeground(ink: string, background: string): string {
	for (let amount = 0.22; amount <= 0.7; amount += 0.04) {
		const candidate = mixHex(ink, background, amount);
		if (contrastRatio(candidate, background) >= 4.5) return candidate;
	}
	return ink;
}

export function themeColorTokens(colors: ModeColors) {
	const ink = readableForeground(colors.surface);
	const muted = mutedForeground(ink, colors.surface);
	const accentForSurface = ensureContrast(colors.accent, colors.surface, 4.5);
	const accentContrast = readableForeground(colors.accent);
	const borderAlpha = Math.min(0.5, Math.max(0.06, colors.borderStrength / 100));

	return {
		ink,
		muted,
		accent: colors.accent,
		accentStrong: ensureContrast(
			colors.accent,
			colors.surface,
			5.5
		),
		accentText: accentForSurface,
		accentContrast,
		surfaceRgb: rgbTriplet(colors.surface),
		readingRgb: rgbTriplet(mixHex(colors.surface, ink, 0.018)),
		canvasRgb: rgbTriplet(colors.canvas),
		border: rgbaFromHex(ink, borderAlpha),
		strongBorder: rgbaFromHex(ink, Math.min(0.62, borderAlpha + 0.16)),
		highlight: rgbaFromHex('#ffffff', ink === '#0b1118' ? 0.5 : 0.15),
		shadow: rgbaFromHex('#000000', ink === '#0b1118' ? 0.12 : 0.28)
	};
}

export function themeIsDark(theme: ResolvedAppearanceTheme): boolean {
	return theme === 'dark';
}

export function sanitizeCssColor(value: string, fallback: string): string {
	return parseHex(value) ? value : fallback;
}
