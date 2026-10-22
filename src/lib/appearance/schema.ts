export const APPEARANCE_SCHEMA_VERSION = 6 as const;

export const APPEARANCE_PRESET_IDS = [
	'mist-blue',
	'teal-slate',
	'warm-sand',
	'graphite',
	'mist-rose',
	'midnight'
] as const;

export const GRADIENT_IDS = [
	'mist-blue',
	'teal-slate',
	'warm-sand',
	'graphite',
	'mist-rose',
	'midnight'
] as const;

export type AppearancePreset = (typeof APPEARANCE_PRESET_IDS)[number];
export type AppearanceTheme = 'system' | 'light' | 'dark';
export type ResolvedAppearanceTheme = 'light' | 'dark';
export type GradientId = (typeof GRADIENT_IDS)[number];
export type CodeTone = 'auto' | 'glass' | 'solid';
export type MotionLevel = 'off' | 'gentle' | 'fluid';
export type SurfaceSlot =
	| 'userMessage'
	| 'assistantMessage'
	| 'composer'
	| 'navigation'
	| 'overlay'
	| 'reading';

export type ModeColors = {
	accent: string;
	canvas: string;
	surface: string;
	borderStrength: number;
};

export type LocalImageBackground = {
	kind: 'local-image';
	assetId: string;
	/**
	 * Horizontal focus (0-1) of the wallpaper, remembered per viewport
	 * orientation. The wallpaper fills the screen height and may overflow
	 * horizontally; the focus slides the window left/right across it.
	 */
	focus: { portrait: number; landscape: number };
	mask: number;
	blur: number;
};

export type OfficialVideoBackground = {
	kind: 'official-video';
	video: 'welcome';
	/**
	 * The bundled welcome film uses the same horizontal window model as local
	 * images, with an independent position for portrait and landscape screens.
	 */
	focus: { portrait: number; landscape: number };
	mask: number;
	blur: number;
};

export type GradientBackground = {
	kind: 'gradient';
	gradient: GradientId;
	mask: number;
	blur: number;
};

export type BackgroundSettings =
	| GradientBackground
	| LocalImageBackground
	| OfficialVideoBackground;

export type ModeAppearance = {
	background: BackgroundSettings;
	colors: ModeColors;
};

export type SurfaceOverride = {
	opacity?: number;
	blur?: number;
	radius?: number;
	tint?: number;
};

export type AppearanceComponents = Partial<Record<SurfaceSlot, SurfaceOverride>>;

export type AppearanceLayout = {
	userMessage: {
		alignment: 'left' | 'right';
		maxWidth: number;
		shape: 'round' | 'soft' | 'square';
		showAvatar: boolean;
	};
	assistantMessage: {
		surface: 'glass' | 'reading';
		readingWidth: 720 | 880 | 1000;
		showAvatar: boolean;
		showModelTitle: boolean;
		details: 'collapsed' | 'expanded';
	};
	composer: {
		style: 'glass' | 'solid' | 'minimal';
		width: 720 | 820 | 960;
		density: 'comfortable' | 'compact';
	};
	navigation: {
		density: 'comfortable' | 'compact';
		current: 'rail' | 'fill' | 'both';
	};
};

export type AppearanceReading = {
	fontSize: number;
	lineHeight: number;
	paragraphSpacing: number;
	codeTone: CodeTone;
	codeFontSize: number;
	codeWrap: boolean;
};

export type AppearanceSettingsV3 = {
	version: typeof APPEARANCE_SCHEMA_VERSION;
	enabled: boolean;
	directoryEnabled: boolean;
	preset: AppearancePreset;
	theme: AppearanceTheme;
	modes: Record<ResolvedAppearanceTheme, ModeAppearance>;
	glass: {
		opacity: number;
		blur: number;
		radius: number;
		overlayScrim: number;
	};
	components: AppearanceComponents;
	layout: AppearanceLayout;
	reading: AppearanceReading;
	motion: MotionLevel;
};

export type AppearanceSettings = AppearanceSettingsV3;

type UnknownRecord = Record<string, unknown>;

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
};

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const DEFAULT_FOCUS = { portrait: 0.5, landscape: 0.5 };

const focusFromCropRect = (value: unknown): number => {
	if (!isRecord(value)) return 0.5;
	const width = clampNumber(value.width, 1, 0.05, 1);
	const x = clampNumber(value.x, 0, 0, 1 - width);
	// The crop rectangle's centre becomes the horizontal window position.
	return clampNumber(x + width / 2, 0.5, 0, 1);
};

/**
 * Normalise the per-orientation horizontal focus. Migrates earlier shapes:
 * v4 `crop: { portrait, landscape }` rectangles, v3 single `crop` rectangle,
 * and the original focusX/focusY + scale model.
 */
const normalizeFocus = (
	value: unknown,
	pairSource: unknown,
	legacySource?: UnknownRecord
): { portrait: number; landscape: number } => {
	const fromPair = (input: unknown): { portrait: number; landscape: number } | null => {
		if (!isRecord(input)) return null;
		if (isRecord(input.portrait) || isRecord(input.landscape)) {
			return {
				portrait: focusFromCropRect(input.portrait),
				landscape: focusFromCropRect(input.landscape)
			};
		}
		return null;
	};

	const direct = (input: unknown): number | null => {
		if (typeof input === 'number') return clampNumber(input, 0.5, 0, 1);
		return null;
	};

	if (isRecord(value) && (direct(value.portrait) !== null || direct(value.landscape) !== null)) {
		return {
			portrait: direct(value.portrait) ?? 0.5,
			landscape: direct(value.landscape) ?? 0.5
		};
	}

	const migratedPair = fromPair(pairSource);
	if (migratedPair) return migratedPair;

	// v3 single crop rectangle.
	if (isRecord(pairSource) && (pairSource.width !== undefined || pairSource.x !== undefined)) {
		return { portrait: focusFromCropRect(pairSource), landscape: 0.5 };
	}
	if (isRecord(value) && (value.width !== undefined || value.x !== undefined)) {
		return { portrait: focusFromCropRect(value), landscape: 0.5 };
	}

	// Original cover + focusX model expressed in 0-100 percentages.
	if (legacySource && legacySource.focusX !== undefined) {
		return { portrait: clampNumber(legacySource.focusX, 50, 0, 100) / 100, landscape: 0.5 };
	}
	return { ...DEFAULT_FOCUS };
};

const stringEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
	typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;

const numberEnum = <T extends number>(value: unknown, allowed: readonly T[], fallback: T): T => {
	const number = typeof value === 'number' ? value : Number(value);
	return allowed.includes(number as T) ? (number as T) : fallback;
};

export const normalizeHex = (value: unknown, fallback: string) =>
	typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

const normalizePreset = (value: unknown): AppearancePreset => {
	if (value === 'native-blue') return 'mist-blue';
	return stringEnum(value, APPEARANCE_PRESET_IDS, 'mist-blue');
};

export const PRESET_PALETTES: Record<
	AppearancePreset,
	Record<ResolvedAppearanceTheme, ModeColors & { gradient: GradientId }>
> = {
	'mist-blue': {
		light: {
			accent: '#2563eb',
			canvas: '#dce8f3',
			surface: '#f6f9fd',
			borderStrength: 24,
			gradient: 'mist-blue'
		},
		dark: {
			accent: '#7aa2ff',
			canvas: '#111a27',
			surface: '#172231',
			borderStrength: 18,
			gradient: 'mist-blue'
		}
	},
	'teal-slate': {
		light: {
			accent: '#147d78',
			canvas: '#dce9e7',
			surface: '#f4f9f8',
			borderStrength: 22,
			gradient: 'teal-slate'
		},
		dark: {
			accent: '#5dc7c0',
			canvas: '#101d20',
			surface: '#17282b',
			borderStrength: 17,
			gradient: 'teal-slate'
		}
	},
	'warm-sand': {
		light: {
			accent: '#b65f38',
			canvas: '#eee5d9',
			surface: '#fbf7f1',
			borderStrength: 25,
			gradient: 'warm-sand'
		},
		dark: {
			accent: '#df9a73',
			canvas: '#211a16',
			surface: '#2c231e',
			borderStrength: 18,
			gradient: 'warm-sand'
		}
	},
	graphite: {
		light: {
			accent: '#475569',
			canvas: '#dfe3e8',
			surface: '#f4f6f8',
			borderStrength: 26,
			gradient: 'graphite'
		},
		dark: {
			accent: '#b7c3d2',
			canvas: '#121518',
			surface: '#1c2025',
			borderStrength: 20,
			gradient: 'graphite'
		}
	},
	'mist-rose': {
		light: {
			accent: '#be4e7b',
			canvas: '#f1e2eb',
			surface: '#fbf5f8',
			borderStrength: 22,
			gradient: 'mist-rose'
		},
		dark: {
			accent: '#e68db3',
			canvas: '#24161f',
			surface: '#30202a',
			borderStrength: 18,
			gradient: 'mist-rose'
		}
	},
	midnight: {
		light: {
			accent: '#324d94',
			canvas: '#d8e0eb',
			surface: '#eff3f8',
			borderStrength: 28,
			gradient: 'midnight'
		},
		dark: {
			accent: '#8fa8ff',
			canvas: '#070b14',
			surface: '#101827',
			borderStrength: 22,
			gradient: 'midnight'
		}
	}
};

const defaultBackground = (
	preset: AppearancePreset,
	mode: ResolvedAppearanceTheme
): GradientBackground => ({
	kind: 'gradient',
	gradient: PRESET_PALETTES[preset][mode].gradient,
	mask: 22,
	blur: 8
});

const defaultMode = (preset: AppearancePreset, mode: ResolvedAppearanceTheme): ModeAppearance => {
	const palette = PRESET_PALETTES[preset][mode];
	return {
		background: defaultBackground(preset, mode),
		colors: {
			accent: palette.accent,
			canvas: palette.canvas,
			surface: palette.surface,
			borderStrength: palette.borderStrength
		}
	};
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
	version: APPEARANCE_SCHEMA_VERSION,
	enabled: true,
	directoryEnabled: true,
	preset: 'mist-blue',
	theme: 'system',
	modes: {
		light: defaultMode('mist-blue', 'light'),
		dark: defaultMode('mist-blue', 'dark')
	},
	glass: {
		opacity: 50,
		blur: 18,
		radius: 20,
		overlayScrim: 40
	},
	components: {},
	layout: {
		userMessage: {
			alignment: 'right',
			maxWidth: 72,
			shape: 'soft',
			showAvatar: false
		},
		assistantMessage: {
			surface: 'glass',
			readingWidth: 880,
			showAvatar: true,
			showModelTitle: true,
			details: 'collapsed'
		},
		composer: {
			style: 'glass',
			width: 820,
			density: 'comfortable'
		},
		navigation: {
			density: 'comfortable',
			current: 'both'
		}
	},
	reading: {
		fontSize: 15,
		lineHeight: 1.65,
		paragraphSpacing: 0.8,
		codeTone: 'auto',
		codeFontSize: 13,
		codeWrap: false
	},
	motion: 'gentle'
};

const normalizeBackground = (
	value: unknown,
	fallback: BackgroundSettings,
	legacyWallpaper?: unknown
): BackgroundSettings => {
	const source =
		isRecord(value) && typeof value.kind === 'string'
			? value
			: isRecord(legacyWallpaper)
				? legacyWallpaper
				: null;

	if (source?.kind === 'local-image') {
		const assetId = typeof source.assetId === 'string' ? source.assetId.trim() : '';
		if (assetId) {
			return {
				kind: 'local-image',
				assetId,
				focus: normalizeFocus(source.focus, source.crop, source),
				mask: clampNumber(source.mask, fallback.mask, 0, 80),
				blur: clampNumber(source.blur, fallback.blur, 0, 16)
			};
		}
	}

	if (source?.kind === 'official-video') {
		return {
			kind: 'official-video',
			video: 'welcome',
			focus: normalizeFocus(source.focus, source.crop, source),
			mask: clampNumber(source.mask, fallback.mask, 0, 80),
			blur: clampNumber(source.blur, fallback.blur, 0, 16)
		};
	}

	if (source?.kind === 'gradient') {
		const fallbackGradient = fallback.kind === 'gradient' ? fallback.gradient : 'mist-blue';
		const legacyGradient = typeof source.value === 'string' ? source.value : undefined;
		const gradient =
			legacyGradient === 'default'
				? 'mist-blue'
				: legacyGradient === 'blue'
					? 'mist-blue'
					: legacyGradient === 'teal'
						? 'teal-slate'
						: legacyGradient === 'sand'
							? 'warm-sand'
							: source.gradient;
		return {
			kind: 'gradient',
			gradient: stringEnum(gradient, GRADIENT_IDS, fallbackGradient),
			mask: clampNumber(source.mask, fallback.mask, 0, 80),
			blur: clampNumber(source.blur, fallback.blur, 0, 16)
		};
	}

	return fallback;
};

const normalizeColors = (value: unknown, fallback: ModeColors): ModeColors => {
	const source = isRecord(value) ? value : {};
	return {
		accent: normalizeHex(source.accent, fallback.accent),
		canvas: normalizeHex(source.canvas, fallback.canvas),
		surface: normalizeHex(source.surface, fallback.surface),
		borderStrength: clampNumber(source.borderStrength, fallback.borderStrength, 0, 60)
	};
};

const normalizeOverride = (value: unknown, allowTint: boolean): SurfaceOverride | undefined => {
	if (!isRecord(value)) return undefined;
	const override: SurfaceOverride = {};

	if (value.opacity !== undefined) {
		override.opacity = clampNumber(value.opacity, 50, 40, 100);
	}
	if (allowTint) {
		if (value.tint !== undefined) {
			override.tint = clampNumber(value.tint, 0, 0, 30);
		}
	} else if (value.blur !== undefined) {
		override.blur = clampNumber(value.blur, 0, 0, 30);
	}
	if (value.radius !== undefined) {
		override.radius = clampNumber(value.radius, 20, 0, 28);
	}

	return Object.keys(override).length ? override : undefined;
};

const currentColorsOrPreset = (
	value: unknown,
	preset: AppearancePreset,
	mode: ResolvedAppearanceTheme,
	legacyAccent?: unknown
) => {
	const fallback = {
		accent: normalizeHex(legacyAccent, PRESET_PALETTES[preset][mode].accent),
		canvas: PRESET_PALETTES[preset][mode].canvas,
		surface: PRESET_PALETTES[preset][mode].surface,
		borderStrength: PRESET_PALETTES[preset][mode].borderStrength
	};
	return normalizeColors(value, fallback);
};

/**
 * Accepts schema 1, 2 and 3. Legacy single-mode values are copied into both
 * modes, then all unknown fields and unsafe values are removed.
 */
export function normalizeAppearance(value: unknown): AppearanceSettings {
	const source = isRecord(value) ? value : {};
	const preset = normalizePreset(source.preset);
	const legacyGlass = isRecord(source.glass) ? source.glass : source;
	const legacyComponents = isRecord(source.components) ? source.components : {};
	const reading = isRecord(source.reading) ? source.reading : source;
	const modes = isRecord(source.modes) ? source.modes : {};
	const layout = isRecord(source.layout) ? source.layout : {};
	const userLayout = isRecord(layout.userMessage) ? layout.userMessage : {};
	const assistantLayout = isRecord(layout.assistantMessage) ? layout.assistantMessage : {};
	const composerLayout = isRecord(layout.composer) ? layout.composer : {};
	const navigationLayout = isRecord(layout.navigation) ? layout.navigation : {};
	const lightSource = isRecord(modes.light) ? modes.light : source;
	const darkSource = isRecord(modes.dark) ? modes.dark : source;
	const lightFallback = defaultMode(preset, 'light');
	const darkFallback = defaultMode(preset, 'dark');
	const legacyWallpaper = source.wallpaper;
	const legacyCodeTone = reading.codeTone === 'opaque' ? 'solid' : reading.codeTone;

	const density = stringEnum(
		navigationLayout.density ?? source.navigationDensity,
		['comfortable', 'compact'] as const,
		DEFAULT_APPEARANCE.layout.navigation.density
	);

	return {
		version: APPEARANCE_SCHEMA_VERSION,
		enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_APPEARANCE.enabled,
		directoryEnabled:
			typeof source.directoryEnabled === 'boolean'
				? source.directoryEnabled
				: DEFAULT_APPEARANCE.directoryEnabled,
		preset,
		theme: stringEnum(source.theme, ['system', 'light', 'dark'] as const, DEFAULT_APPEARANCE.theme),
		modes: {
			light: {
				background: normalizeBackground(
					lightSource.background,
					lightFallback.background,
					legacyWallpaper
				),
				colors: currentColorsOrPreset(lightSource.colors, preset, 'light', source.accent)
			},
			dark: {
				background: normalizeBackground(
					darkSource.background,
					darkFallback.background,
					legacyWallpaper
				),
				colors: currentColorsOrPreset(darkSource.colors, preset, 'dark', source.accent)
			}
		},
		glass: {
			opacity: clampNumber(legacyGlass.opacity, DEFAULT_APPEARANCE.glass.opacity, 40, 100),
			blur: clampNumber(
				legacyGlass.blur ?? legacyGlass.glassBlur,
				DEFAULT_APPEARANCE.glass.blur,
				0,
				30
			),
			radius: clampNumber(legacyGlass.radius, DEFAULT_APPEARANCE.glass.radius, 0, 28),
			overlayScrim: clampNumber(
				legacyGlass.overlayScrim ?? legacyGlass.scrim,
				DEFAULT_APPEARANCE.glass.overlayScrim,
				0,
				80
			)
		},
		components: {
			userMessage: normalizeOverride(legacyComponents.userMessage, true),
			assistantMessage: normalizeOverride(legacyComponents.assistantMessage, true),
			composer: normalizeOverride(legacyComponents.composer, false),
			navigation: normalizeOverride(legacyComponents.navigation, false),
			overlay: normalizeOverride(legacyComponents.overlay, false),
			reading: normalizeOverride(legacyComponents.reading, false)
		},
		layout: {
			userMessage: {
				alignment: stringEnum(
					userLayout.alignment,
					['left', 'right'] as const,
					DEFAULT_APPEARANCE.layout.userMessage.alignment
				),
				maxWidth: clampNumber(
					userLayout.maxWidth,
					DEFAULT_APPEARANCE.layout.userMessage.maxWidth,
					50,
					90
				),
				shape: stringEnum(
					userLayout.shape,
					['round', 'soft', 'square'] as const,
					DEFAULT_APPEARANCE.layout.userMessage.shape
				),
				showAvatar:
					typeof userLayout.showAvatar === 'boolean'
						? userLayout.showAvatar
						: DEFAULT_APPEARANCE.layout.userMessage.showAvatar
			},
			assistantMessage: {
				surface: stringEnum(
					assistantLayout.surface,
					['glass', 'reading'] as const,
					DEFAULT_APPEARANCE.layout.assistantMessage.surface
				),
				readingWidth: numberEnum(
					assistantLayout.readingWidth,
					[720, 880, 1000] as const,
					DEFAULT_APPEARANCE.layout.assistantMessage.readingWidth
				),
				showAvatar:
					typeof assistantLayout.showAvatar === 'boolean'
						? assistantLayout.showAvatar
						: DEFAULT_APPEARANCE.layout.assistantMessage.showAvatar,
				showModelTitle:
					typeof assistantLayout.showModelTitle === 'boolean'
						? assistantLayout.showModelTitle
						: DEFAULT_APPEARANCE.layout.assistantMessage.showModelTitle,
				details: stringEnum(
					assistantLayout.details,
					['collapsed', 'expanded'] as const,
					DEFAULT_APPEARANCE.layout.assistantMessage.details
				)
			},
			composer: {
				style: stringEnum(
					composerLayout.style,
					['glass', 'solid', 'minimal'] as const,
					DEFAULT_APPEARANCE.layout.composer.style
				),
				width: numberEnum(
					composerLayout.width,
					[720, 820, 960] as const,
					DEFAULT_APPEARANCE.layout.composer.width
				),
				density: stringEnum(
					composerLayout.density,
					['comfortable', 'compact'] as const,
					DEFAULT_APPEARANCE.layout.composer.density
				)
			},
			navigation: {
				density,
				current: stringEnum(
					navigationLayout.current,
					['rail', 'fill', 'both'] as const,
					DEFAULT_APPEARANCE.layout.navigation.current
				)
			}
		},
		reading: {
			fontSize: clampNumber(reading.fontSize, DEFAULT_APPEARANCE.reading.fontSize, 14, 19),
			lineHeight: clampNumber(reading.lineHeight, DEFAULT_APPEARANCE.reading.lineHeight, 1.45, 1.9),
			paragraphSpacing: clampNumber(
				reading.paragraphSpacing,
				DEFAULT_APPEARANCE.reading.paragraphSpacing,
				0.5,
				1.2
			),
			codeTone: stringEnum(
				legacyCodeTone ?? source.codeTone,
				['auto', 'glass', 'solid'] as const,
				DEFAULT_APPEARANCE.reading.codeTone
			),
			codeFontSize: clampNumber(
				reading.codeFontSize,
				DEFAULT_APPEARANCE.reading.codeFontSize,
				12,
				16
			),
			codeWrap:
				typeof reading.codeWrap === 'boolean'
					? reading.codeWrap
					: DEFAULT_APPEARANCE.reading.codeWrap
		},
		motion: stringEnum(
			source.motion,
			['off', 'gentle', 'fluid'] as const,
			DEFAULT_APPEARANCE.motion
		)
	};
}

export function cloneAppearance(settings: AppearanceSettings): AppearanceSettings {
	return structuredClone(settings);
}

export function withMode(
	settings: AppearanceSettings,
	mode: ResolvedAppearanceTheme,
	update: (value: ModeAppearance) => ModeAppearance
): AppearanceSettings {
	return {
		...settings,
		modes: {
			...settings.modes,
			[mode]: update(settings.modes[mode])
		}
	};
}
