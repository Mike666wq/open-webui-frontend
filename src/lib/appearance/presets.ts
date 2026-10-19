import {
	APPEARANCE_PRESET_IDS,
	DEFAULT_APPEARANCE,
	PRESET_PALETTES,
	type AppearancePreset,
	type AppearanceSettings,
	type GradientId,
	type ResolvedAppearanceTheme
} from './schema';

export type AppearancePresetDefinition = {
	id: AppearancePreset;
	name: { zh: string; en: string };
	description: { zh: string; en: string };
};

export const APPEARANCE_PRESETS: AppearancePresetDefinition[] = [
	{
		id: 'mist-blue',
		name: { zh: '蓝雾', en: 'Mist blue' },
		description: { zh: '冷静、明亮，默认玻璃主题', en: 'Calm, bright and the default glass theme' }
	},
	{
		id: 'teal-slate',
		name: { zh: '青灰', en: 'Teal slate' },
		description: { zh: '偏青的沉静中性色', en: 'A quiet neutral with a cool green cast' }
	},
	{
		id: 'warm-sand',
		name: { zh: '暖砂', en: 'Warm sand' },
		description: { zh: '低饱和暖色与柔和层次', en: 'Muted warmth with gentle depth' }
	},
	{
		id: 'graphite',
		name: { zh: '石墨', en: 'Graphite' },
		description: { zh: '更克制的中性灰界面', en: 'A restrained neutral grey interface' }
	},
	{
		id: 'mist-rose',
		name: { zh: '雾粉', en: 'Mist rose' },
		description: { zh: '轻柔粉调，不削弱正文对比', en: 'A soft rose tint with readable body text' }
	},
	{
		id: 'midnight',
		name: { zh: '极夜', en: 'Midnight' },
		description: { zh: '深色夜航，适合低光环境', en: 'Deep night tones for low-light reading' }
	}
];

export const APPEARANCE_PRESET_IDS_LIST = APPEARANCE_PRESET_IDS;

export function presetName(
	preset: AppearancePreset,
	language: string
): string {
	const definition =
		APPEARANCE_PRESETS.find((candidate) => candidate.id === preset) ?? APPEARANCE_PRESETS[0];
	return language.toLowerCase().startsWith('zh') ? definition.name.zh : definition.name.en;
}

export function applyPreset(
	settings: AppearanceSettings,
	preset: AppearancePreset
): AppearanceSettings {
	const light = PRESET_PALETTES[preset].light;
	const dark = PRESET_PALETTES[preset].dark;
	return {
		...settings,
		preset,
		glass: {
			...settings.glass,
			opacity: DEFAULT_APPEARANCE.glass.opacity,
			blur: DEFAULT_APPEARANCE.glass.blur,
			radius: DEFAULT_APPEARANCE.glass.radius,
			overlayScrim: DEFAULT_APPEARANCE.glass.overlayScrim
		},
		modes: {
			light: {
				background: {
					kind: 'gradient',
					gradient: light.gradient,
					mask: settings.modes.light.background.mask,
					blur: settings.modes.light.background.blur
				},
				colors: {
					accent: light.accent,
					canvas: light.canvas,
					surface: light.surface,
					borderStrength: light.borderStrength
				}
			},
			dark: {
				background: {
					kind: 'gradient',
					gradient: dark.gradient,
					mask: settings.modes.dark.background.mask,
					blur: settings.modes.dark.background.blur
				},
				colors: {
					accent: dark.accent,
					canvas: dark.canvas,
					surface: dark.surface,
					borderStrength: dark.borderStrength
				}
			}
		}
	};
}

export function resolveAppearanceTheme(
	theme: AppearanceSettings['theme'],
	prefersDark: boolean
): ResolvedAppearanceTheme {
	return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

const gradientPalette: Record<
	GradientId,
	Record<ResolvedAppearanceTheme, [string, string, string, string]>
> = {
	'mist-blue': {
		light: ['#dce8f3', '#edf4fa', '#d5e2ee', 'rgba(124, 164, 205, 0.26)'],
		dark: ['#111a27', '#172435', '#0c121c', 'rgba(86, 126, 181, 0.24)']
	},
	'teal-slate': {
		light: ['#dce9e7', '#eef6f4', '#d1e0df', 'rgba(86, 148, 141, 0.23)'],
		dark: ['#101d20', '#172a2d', '#091214', 'rgba(72, 137, 131, 0.23)']
	},
	'warm-sand': {
		light: ['#eee5d9', '#f7f1e9', '#e4d7c7', 'rgba(181, 121, 80, 0.2)'],
		dark: ['#211a16', '#30261f', '#15100d', 'rgba(177, 111, 72, 0.2)']
	},
	graphite: {
		light: ['#dfe3e8', '#eff2f5', '#d2d8df', 'rgba(104, 122, 143, 0.2)'],
		dark: ['#121518', '#22272d', '#090b0d', 'rgba(112, 128, 146, 0.18)']
	},
	'mist-rose': {
		light: ['#f1e2eb', '#f9f0f5', '#e7d4e0', 'rgba(183, 96, 137, 0.2)'],
		dark: ['#24161f', '#32212b', '#160c11', 'rgba(183, 94, 137, 0.2)']
	},
	midnight: {
		light: ['#d8e0eb', '#e9eff7', '#cbd6e4', 'rgba(77, 102, 147, 0.23)'],
		dark: ['#070b14', '#111a2b', '#03050a', 'rgba(87, 111, 177, 0.22)']
	}
};

export function gradientBackgroundCss(
	gradient: GradientId,
	mode: ResolvedAppearanceTheme
): string {
	const [start, end, fallback, glow] = gradientPalette[gradient][mode];
	return [
		`radial-gradient(115% 86% at 14% 8%, ${glow}, transparent 58%)`,
		`radial-gradient(90% 75% at 88% 96%, color-mix(in srgb, ${glow} 72%, transparent), transparent 62%)`,
		`linear-gradient(152deg, ${start}, ${end} 52%, ${fallback})`
	].join(', ');
}
