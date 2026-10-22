import { describe, expect, it } from 'vitest';
import { contrastRatio, ensureContrast, themeColorTokens } from './color';
import { applyPreset } from './presets';
import {
	APPEARANCE_SCHEMA_VERSION,
	DEFAULT_APPEARANCE,
	normalizeAppearance,
	withMode
} from './schema';

describe('appearance schema v6', () => {
	it('returns a complete v6 default', () => {
		const settings = normalizeAppearance(undefined);
		expect(settings.version).toBe(APPEARANCE_SCHEMA_VERSION);
		expect(settings.preset).toBe('mist-blue');
		expect(settings.directoryEnabled).toBe(true);
		expect(settings.modes.light.background.kind).toBe('gradient');
		expect(settings.modes.dark.background.kind).toBe('gradient');
		expect(settings.components).toEqual({});
	});

	it('migrates v2 single-mode settings into both modes', () => {
		const settings = normalizeAppearance({
			version: 2,
			enabled: false,
			preset: 'teal-slate',
			theme: 'dark',
			accent: '#147d78',
			wallpaper: {
				kind: 'local-image',
				assetId: 'old-wallpaper',
				cropY: 64,
				scale: 135
			},
			glass: { opacity: 72, blur: 12, radius: 17, scrim: 36 },
			components: {
				userMessage: { opacity: 66, blur: 99, radius: 24, tint: 8 },
				composer: { opacity: 58, blur: 21, radius: 19 }
			},
			reading: {
				fontSize: 17,
				lineHeight: 1.72,
				codeTone: 'opaque'
			}
		});

		expect(settings.version).toBe(APPEARANCE_SCHEMA_VERSION);
		expect(settings.enabled).toBe(false);
		const lightBackground = settings.modes.light.background;
		expect(lightBackground.kind).toBe('local-image');
		if (lightBackground.kind === 'local-image') {
			expect(lightBackground.assetId).toBe('old-wallpaper');
			// Settings without any focus data start centred in both orientations.
			expect(lightBackground.focus).toEqual({ portrait: 0.5, landscape: 0.5 });
		}
		expect(settings.modes.dark.background.kind).toBe('local-image');
		expect(settings.components.userMessage).toEqual({
			opacity: 66,
			radius: 24,
			tint: 8
		});
		expect(settings.components.composer).toEqual({
			opacity: 58,
			blur: 21,
			radius: 19
		});
		expect(settings.reading.codeTone).toBe('solid');
		expect(settings.layout.userMessage.alignment).toBe('right');
	});

	it('migrates a v4 crop pair into horizontal focus', () => {
		const settings = normalizeAppearance({
			modes: {
				light: {
					background: {
						kind: 'local-image',
						assetId: 'img',
						crop: {
							portrait: { x: 0.2, y: 0, width: 0.4, height: 0.8 },
							landscape: { x: 0.1, y: 0, width: 0.2, height: 0.9 }
						},
						mask: 22,
						blur: 8
					}
				}
			}
		});
		const background = settings.modes.light.background;
		expect(background.kind).toBe('local-image');
		if (background.kind === 'local-image') {
			expect(background.focus.portrait).toBeCloseTo(0.4, 5);
			expect(background.focus.landscape).toBeCloseTo(0.2, 5);
		}
	});

	it('clamps explicit focus values into 0-1', () => {
		const settings = normalizeAppearance({
			modes: {
				light: {
					background: {
						kind: 'local-image',
						assetId: 'img',
						focus: { portrait: -2, landscape: 3 },
						mask: 22,
						blur: 40
					}
				}
			}
		});
		const background = settings.modes.light.background;
		expect(background.kind).toBe('local-image');
		if (background.kind === 'local-image') {
			expect(background.focus.portrait).toBe(0);
			expect(background.focus.landscape).toBe(1);
			expect(background.blur).toBe(16);
		}
	});

	it('normalizes the bundled official video as a pannable background', () => {
		const settings = normalizeAppearance({
			modes: {
				light: {
					background: {
						kind: 'official-video',
						video: 'welcome',
						focus: { portrait: 0.35, landscape: 0.7 },
						mask: 22,
						blur: 8
					}
				}
			}
		});
		expect(settings.modes.light.background).toEqual({
			kind: 'official-video',
			video: 'welcome',
			focus: { portrait: 0.35, landscape: 0.7 },
			mask: 22,
			blur: 8
		});
	});

	it('clamps values at every numeric boundary', () => {
		const settings = normalizeAppearance({
			preset: 'midnight',
			glass: { opacity: 1, blur: 100, radius: -4, overlayScrim: 120 },
			layout: {
				userMessage: { maxWidth: 300 },
				assistantMessage: { readingWidth: 777 },
				composer: { width: 101 }
			},
			reading: { fontSize: 50, lineHeight: -1, paragraphSpacing: 9, codeFontSize: 40 }
		});
		expect(settings.glass).toEqual({
			opacity: 40,
			blur: 30,
			radius: 0,
			overlayScrim: 80
		});
		expect(settings.layout.userMessage.maxWidth).toBe(90);
		expect(settings.layout.assistantMessage.readingWidth).toBe(880);
		expect(settings.layout.composer.width).toBe(820);
		expect(settings.reading.fontSize).toBe(19);
		expect(settings.reading.lineHeight).toBe(1.45);
		expect(settings.reading.paragraphSpacing).toBe(1.2);
		expect(settings.reading.codeFontSize).toBe(16);
	});

	it('applies presets while retaining layout, components, reading and directory state', () => {
		const source = {
			...structuredClone(DEFAULT_APPEARANCE),
			directoryEnabled: false,
			components: { overlay: { opacity: 61, blur: 22, radius: 16 } },
			layout: {
				...DEFAULT_APPEARANCE.layout,
				composer: { style: 'minimal' as const, width: 960 as const, density: 'compact' as const }
			},
			reading: { ...DEFAULT_APPEARANCE.reading, fontSize: 18 }
		};
		const result = applyPreset(source, 'warm-sand');
		expect(result.preset).toBe('warm-sand');
		expect(result.modes.light.colors.accent).toBe('#b65f38');
		expect(result.components).toEqual(source.components);
		expect(result.layout).toEqual(source.layout);
		expect(result.reading).toEqual(source.reading);
		expect(result.directoryEnabled).toBe(false);
	});

	it('updates only the selected mode', () => {
		const result = withMode(DEFAULT_APPEARANCE, 'dark', (mode) => ({
			...mode,
			colors: { ...mode.colors, accent: '#ffcc00' }
		}));
		expect(result.modes.dark.colors.accent).toBe('#ffcc00');
		expect(result.modes.light.colors.accent).toBe(DEFAULT_APPEARANCE.modes.light.colors.accent);
	});
});

describe('automatic contrast', () => {
	it('chooses readable text for light and dark surfaces', () => {
		for (const colors of [
			{ accent: '#2563eb', canvas: '#dce8f3', surface: '#f6f9fd', borderStrength: 24 },
			{ accent: '#7aa2ff', canvas: '#111a27', surface: '#172231', borderStrength: 18 }
		]) {
			const tokens = themeColorTokens(colors);
			expect(contrastRatio(tokens.ink, colors.surface)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(tokens.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(tokens.accentStrong, colors.surface)).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('repairs low-contrast foregrounds', () => {
		const repaired = ensureContrast('#aaaaaa', '#ffffff', 4.5);
		expect(contrastRatio(repaired, '#ffffff')).toBeGreaterThanOrEqual(4.5);
	});
});
