import {
	APPEARANCE_PRESET_IDS,
	APPEARANCE_SCHEMA_VERSION,
	GRADIENT_IDS,
	normalizeAppearance,
	type AppearanceComponents,
	type AppearanceLayout,
	type AppearanceReading,
	type AppearanceSettings,
	type AppearanceTheme,
	type AppearancePreset,
	type MotionLevel,
	type SurfaceSlot
} from './schema';

export const THEME_FILE_FORMAT = 'open-webui-mist-theme';

type UnknownRecord = Record<string, unknown>;

type ThemeFileV3 = {
	format: typeof THEME_FILE_FORMAT;
	version: typeof APPEARANCE_SCHEMA_VERSION;
	theme: {
		preset: AppearancePreset;
		theme: AppearanceTheme;
		lightColors: AppearanceSettings['modes']['light']['colors'];
		darkColors: AppearanceSettings['modes']['dark']['colors'];
		glass: AppearanceSettings['glass'];
		components: AppearanceComponents;
		layout: AppearanceLayout;
		reading: AppearanceReading;
		motion: MotionLevel;
	};
};

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

class ThemeFileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ThemeFileError';
	}
}

const requireRecord = (value: unknown, path: string): UnknownRecord => {
	if (!isRecord(value)) throw new ThemeFileError(`${path} must be an object`);
	return value;
};

const requireEnum = <T extends string>(
	value: unknown,
	allowed: readonly T[],
	path: string
): T => {
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		throw new ThemeFileError(`${path} is invalid`);
	}
	return value as T;
};

const requireBoolean = (value: unknown, path: string): boolean => {
	if (typeof value !== 'boolean') throw new ThemeFileError(`${path} must be a boolean`);
	return value;
};

const requireNumber = (
	value: unknown,
	min: number,
	max: number,
	path: string,
	integer = false
): number => {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	) {
		throw new ThemeFileError(`${path} must be between ${min} and ${max}`);
	}
	return value;
};

const requireHex = (value: unknown, path: string): string => {
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
		throw new ThemeFileError(`${path} must be a six-digit hex colour`);
	}
	return value.toLowerCase();
};

const validateColors = (
	value: unknown,
	path: string
): AppearanceSettings['modes']['light']['colors'] => {
	const colors = requireRecord(value, path);
	return {
		accent: requireHex(colors.accent, `${path}.accent`),
		canvas: requireHex(colors.canvas, `${path}.canvas`),
		surface: requireHex(colors.surface, `${path}.surface`),
		borderStrength: requireNumber(
			colors.borderStrength,
			0,
			60,
			`${path}.borderStrength`
		)
	};
};

const allowedSurfaceKeys: Record<SurfaceSlot, readonly string[]> = {
	userMessage: ['opacity', 'radius', 'tint'],
	assistantMessage: ['opacity', 'radius', 'tint'],
	composer: ['opacity', 'blur', 'radius'],
	navigation: ['opacity', 'blur', 'radius'],
	overlay: ['opacity', 'blur', 'radius'],
	reading: ['opacity', 'blur', 'radius']
};

const validateComponents = (value: unknown): AppearanceComponents => {
	const components = requireRecord(value, 'theme.components');
	const result: AppearanceComponents = {};
	for (const key of Object.keys(components)) {
		if (!Object.hasOwn(allowedSurfaceKeys, key)) {
			throw new ThemeFileError(`theme.components.${key} is not supported`);
		}
	}
	for (const slot of Object.keys(allowedSurfaceKeys) as SurfaceSlot[]) {
		if (components[slot] === undefined) continue;
		const override = requireRecord(components[slot], `theme.components.${slot}`);
		result[slot] = {};
		for (const key of Object.keys(override)) {
			if (!allowedSurfaceKeys[slot].includes(key)) {
				throw new ThemeFileError(`theme.components.${slot}.${key} is not supported`);
			}
			const minimum = key === 'radius' || key === 'tint' || key === 'blur' ? 0 : 40;
			const maximum =
				key === 'opacity' ? 100 : key === 'blur' ? 30 : key === 'radius' ? 28 : 30;
			(result[slot] as Record<string, number>)[key] = requireNumber(
				override[key],
				minimum,
				maximum,
				`theme.components.${slot}.${key}`
			);
		}
	}
	return result;
};

const validateLayout = (value: unknown): AppearanceLayout => {
	const layout = requireRecord(value, 'theme.layout');
	const user = requireRecord(layout.userMessage, 'theme.layout.userMessage');
	const assistant = requireRecord(layout.assistantMessage, 'theme.layout.assistantMessage');
	const composer = requireRecord(layout.composer, 'theme.layout.composer');
	const navigation = requireRecord(layout.navigation, 'theme.layout.navigation');

	return {
		userMessage: {
			alignment: requireEnum(user.alignment, ['left', 'right'] as const, 'alignment'),
			maxWidth: requireNumber(user.maxWidth, 50, 90, 'userMessage.maxWidth'),
			shape: requireEnum(user.shape, ['round', 'soft', 'square'] as const, 'userMessage.shape'),
			showAvatar: requireBoolean(user.showAvatar, 'userMessage.showAvatar')
		},
		assistantMessage: {
			surface: requireEnum(
				assistant.surface,
				['glass', 'reading'] as const,
				'assistantMessage.surface'
			),
			readingWidth:
				typeof assistant.readingWidth === 'number' &&
				[720, 880, 1000].includes(assistant.readingWidth)
					? (assistant.readingWidth as 720 | 880 | 1000)
					: (() => {
							throw new ThemeFileError('assistantMessage.readingWidth is invalid');
						})(),
			showAvatar: requireBoolean(assistant.showAvatar, 'assistantMessage.showAvatar'),
			showModelTitle: requireBoolean(
				assistant.showModelTitle,
				'assistantMessage.showModelTitle'
			),
			details: requireEnum(
				assistant.details,
				['collapsed', 'expanded'] as const,
				'assistantMessage.details'
			)
		},
		composer: {
			style: requireEnum(composer.style, ['glass', 'solid', 'minimal'] as const, 'composer.style'),
			width:
				typeof composer.width === 'number' && [720, 820, 960].includes(composer.width)
					? (composer.width as 720 | 820 | 960)
					: (() => {
							throw new ThemeFileError('composer.width is invalid');
						})(),
			density: requireEnum(
				composer.density,
				['comfortable', 'compact'] as const,
				'composer.density'
			)
		},
		navigation: {
			density: requireEnum(
				navigation.density,
				['comfortable', 'compact'] as const,
				'navigation.density'
			),
			current: requireEnum(
				navigation.current,
				['rail', 'fill', 'both'] as const,
				'navigation.current'
			)
		}
	};
};

const validateReading = (value: unknown): AppearanceReading => {
	const reading = requireRecord(value, 'theme.reading');
	return {
		fontSize: requireNumber(reading.fontSize, 14, 19, 'reading.fontSize'),
		lineHeight: requireNumber(reading.lineHeight, 1.45, 1.9, 'reading.lineHeight'),
		paragraphSpacing: requireNumber(
			reading.paragraphSpacing,
			0.5,
			1.2,
			'reading.paragraphSpacing'
		),
		codeTone: requireEnum(
			reading.codeTone,
			['auto', 'glass', 'solid'] as const,
			'reading.codeTone'
		),
		codeFontSize: requireNumber(reading.codeFontSize, 12, 16, 'reading.codeFontSize'),
		codeWrap: requireBoolean(reading.codeWrap, 'reading.codeWrap')
	};
};

export function serializeThemeFile(settings: AppearanceSettings): string {
	const file: ThemeFileV3 = {
		format: THEME_FILE_FORMAT,
		version: APPEARANCE_SCHEMA_VERSION,
		theme: {
			preset: settings.preset,
			theme: settings.theme,
			lightColors: settings.modes.light.colors,
			darkColors: settings.modes.dark.colors,
			glass: settings.glass,
			components: settings.components,
			layout: settings.layout,
			reading: settings.reading,
			motion: settings.motion
		}
	};
	return JSON.stringify(file, null, 2);
}

export function parseThemeFile(text: string, current: AppearanceSettings): AppearanceSettings {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new ThemeFileError('The theme file is not valid JSON');
	}

	const root = requireRecord(parsed, 'theme file');
	if (root.format !== THEME_FILE_FORMAT) {
		throw new ThemeFileError('This is not an Open WebUI Mist Glass theme file');
	}
	if (root.version !== APPEARANCE_SCHEMA_VERSION) {
		throw new ThemeFileError(`Only theme version ${APPEARANCE_SCHEMA_VERSION} is supported`);
	}

	const theme = requireRecord(root.theme, 'theme');
	const glass = requireRecord(theme.glass, 'theme.glass');
	const importGlass = {
		opacity: requireNumber(glass.opacity, 40, 100, 'glass.opacity'),
		blur: requireNumber(glass.blur, 0, 30, 'glass.blur'),
		radius: requireNumber(glass.radius, 0, 28, 'glass.radius'),
		overlayScrim: requireNumber(glass.overlayScrim, 0, 80, 'glass.overlayScrim')
	};

	const candidate = {
		...current,
		preset: requireEnum(theme.preset, APPEARANCE_PRESET_IDS, 'theme.preset'),
		theme: requireEnum(theme.theme, ['system', 'light', 'dark'] as const, 'theme.theme'),
		modes: {
			light: {
				background: current.modes.light.background,
				colors: validateColors(theme.lightColors, 'theme.lightColors')
			},
			dark: {
				background: current.modes.dark.background,
				colors: validateColors(theme.darkColors, 'theme.darkColors')
			}
		},
		glass: importGlass,
		components: validateComponents(theme.components),
		layout: validateLayout(theme.layout),
		reading: validateReading(theme.reading),
		motion: requireEnum(theme.motion, ['off', 'gentle', 'fluid'] as const, 'theme.motion')
	};

	return normalizeAppearance(candidate);
}

export { ThemeFileError };

export const THEME_FILE_GRADIENTS = GRADIENT_IDS;
