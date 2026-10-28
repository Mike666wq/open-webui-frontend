import { themeColorTokens } from './color';
import { resolveAppearanceTheme } from './presets';
import type {
	AppearanceSettings,
	ResolvedAppearanceTheme,
	SurfaceOverride
} from './schema';

// Module-level wallpaper luminance state. Set by AppearanceProvider after
// sampling the active wallpaper; applyAppearanceCss composites it into
// reading-surface token math. null = no wallpaper or unknown brightness,
// in which case token math falls back to the plain theme surface.
let wallpaperLuminance: number | null = null;
let lastApply: (() => void) | null = null;

/**
 * Provide the sampled average luminance (0-1) of the active wallpaper, or
 * null when no wallpaper is active / sampling failed. Re-applies the last
 * computed appearance so tokens update without waiting for the next
 * settings change.
 */
export function setWallpaperLuminance(luminance: number | null) {
	const next = typeof luminance === 'number' && Number.isFinite(luminance)
		? Math.min(1, Math.max(0, luminance))
		: null;
	if (next === wallpaperLuminance) return;
	wallpaperLuminance = next;
	lastApply?.();
}

const setVariable = (root: HTMLElement, name: string, value: string) => {
	root.style.setProperty(name, value);
};

function overrideNumber(
	override: SurfaceOverride | undefined,
	key: keyof SurfaceOverride,
	fallback: number
): number {
	const value = override?.[key];
	return typeof value === 'number' ? value : fallback;
}

function shapeRadius(shape: AppearanceSettings['layout']['userMessage']['shape'], global: number) {
	if (shape === 'round') return Math.max(22, global);
	if (shape === 'square') return Math.min(8, global);
	return global;
}

export function applyAppearanceCss(
	settings: AppearanceSettings,
	target?: HTMLElement,
	forcedTheme?: ResolvedAppearanceTheme
) {
	if (typeof document === 'undefined') return;

	const root = target ?? document.documentElement;
	const prefersDark =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-color-scheme: dark)').matches;
	const resolvedTheme =
		forcedTheme ?? resolveAppearanceTheme(settings.theme, prefersDark);
	const mode = settings.modes[resolvedTheme];
	const { glass, components, layout, reading } = settings;
	const alpha = glass.opacity / 100;
	const overlayScrim = glass.overlayScrim / 100;
	const user = components.userMessage;
	const assistant = components.assistantMessage;
	const composer = components.composer;
	const navigation = components.navigation;
	const overlay = components.overlay;
	const readingSurface = components.reading;

	const wallpaperActive =
		settings.enabled &&
		(mode.background.kind === 'local-image' || mode.background.kind === 'official-video');
	const scrim = mode.background.mask / 100;
	// Conservative smallest surface alpha across the slots that carry body
	// text: whatever the user dialed down, this is the least opaque surface
	// text can sit on while a wallpaper is behind it.
	const contentAlpha = Math.min(
		overrideNumber(user, 'opacity', glass.opacity),
		overrideNumber(assistant, 'opacity', glass.opacity),
		overrideNumber(readingSurface, 'opacity', glass.opacity)
	) / 100;
	const tokens = themeColorTokens(
		mode.colors,
		wallpaperActive
			? { glassAlpha: contentAlpha, scrim, wallpaperLuminance }
			: undefined
	);
	// Minimum opaque floor for reading surfaces. Only raised while a
	// wallpaper is actually active; without a wallpaper the floor stays 0 so
	// fully transparent themes still behave exactly as before.
	const readingFloor = wallpaperActive ? Math.max(contentAlpha, 0.92) : 0;

	root.dataset.owuiAppearance = settings.enabled ? 'on' : 'off';
	root.dataset.owuiAppearancePreset = settings.preset;
	root.dataset.owuiAppearanceTheme = settings.theme;
	root.dataset.owuiResolvedTheme = resolvedTheme;
	root.dataset.owuiWallpaper = mode.background.kind;
	root.dataset.owuiCodeTone = reading.codeTone;
	root.dataset.owuiMotion = settings.motion;
	root.dataset.owuiComposerStyle = layout.composer.style;
	root.dataset.owuiAssistantSurface = layout.assistantMessage.surface;
	root.dataset.owuiNavigationCurrent = layout.navigation.current;
	root.dataset.owuiMotionReduced =
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 'true'
			: 'false';

	setVariable(root, '--mist-accent', tokens.accent);
	setVariable(root, '--mist-accent-strong', tokens.accentStrong);
	setVariable(root, '--mist-accent-text', tokens.accentText);
	setVariable(root, '--mist-accent-contrast', tokens.accentContrast);
	setVariable(root, '--mist-canvas', mode.colors.canvas);
	setVariable(root, '--mist-canvas-rgb', tokens.canvasRgb);
	setVariable(root, '--mist-surface-rgb', tokens.surfaceRgb);
	setVariable(root, '--mist-reading-rgb', tokens.readingRgb);
	setVariable(root, '--mist-ink', tokens.ink);
	setVariable(root, '--mist-muted', tokens.muted);
	setVariable(root, '--mist-border', tokens.border);
	setVariable(root, '--mist-border-strong', tokens.strongBorder);
	setVariable(root, '--mist-highlight', tokens.highlight);
	setVariable(root, '--mist-shadow', tokens.shadow);

	setVariable(root, '--mist-glass-alpha', String(alpha));
	setVariable(root, '--mist-blur-background', `${mode.background.blur}px`);
	setVariable(root, '--mist-blur-control', `${glass.blur}px`);
	setVariable(root, '--mist-radius', `${glass.radius}px`);
	setVariable(root, '--mist-radius-sm', `${Math.max(8, glass.radius - 6)}px`);
	setVariable(root, '--mist-wallpaper-mask', String(mode.background.mask / 100));
	setVariable(root, '--mist-overlay-scrim', String(overlayScrim));
	setVariable(root, '--mist-reading-floor', String(readingFloor));
	setVariable(root, '--mist-wallpaper-luminance', String(wallpaperLuminance ?? 0.5));
	setVariable(root, '--mist-effective-surface-rgb', tokens.effectiveSurfaceRgb);

	// Fluid text scale steps. These follow the user's --app-text-scale
	// preference without ever overriding it (scale default is 1).
	setVariable(root, '--mist-text-xs', `calc(0.6875rem * var(--app-text-scale, 1))`);
	setVariable(root, '--mist-text-sm', `calc(0.8125rem * var(--app-text-scale, 1))`);
	setVariable(root, '--mist-text-md', `calc(0.875rem * var(--app-text-scale, 1))`);
	setVariable(root, '--mist-text-lg', `calc(1rem * var(--app-text-scale, 1))`);
	setVariable(root, '--mist-text-xl', `calc(1.125rem * var(--app-text-scale, 1))`);
	setVariable(root, '--mist-text-2xl', `calc(1.5rem * var(--app-text-scale, 1))`);

	const slots = {
		user: { override: user, fallbackOpacity: glass.opacity },
		assistant: { override: assistant, fallbackOpacity: glass.opacity },
		composer: { override: composer, fallbackOpacity: glass.opacity },
		navigation: { override: navigation, fallbackOpacity: glass.opacity },
		overlay: { override: overlay, fallbackOpacity: glass.opacity },
		reading: { override: readingSurface, fallbackOpacity: glass.opacity }
	} as const;

	for (const [name, slot] of Object.entries(slots)) {
		setVariable(
			root,
			`--mist-${name}-alpha`,
			String(overrideNumber(slot.override, 'opacity', slot.fallbackOpacity) / 100)
		);
		setVariable(
			root,
			`--mist-${name}-blur`,
			`${overrideNumber(slot.override, 'blur', glass.blur)}px`
		);
		setVariable(
			root,
			`--mist-${name}-radius`,
			`${overrideNumber(slot.override, 'radius', glass.radius)}px`
		);
	}

	setVariable(root, '--owui-user-surface-alpha', `var(--mist-user-alpha)`);
	setVariable(root, '--owui-assistant-surface-alpha', `var(--mist-assistant-alpha)`);
	setVariable(root, '--owui-composer-surface-alpha', `var(--mist-composer-alpha)`);
	setVariable(root, '--owui-user-tint-percent', `${overrideNumber(user, 'tint', 0)}%`);
	setVariable(
		root,
		'--owui-assistant-tint-percent',
		`${overrideNumber(assistant, 'tint', 0)}%`
	);
	setVariable(root, '--owui-user-max-width', `${layout.userMessage.maxWidth}%`);
	setVariable(root, '--owui-user-align', layout.userMessage.alignment === 'left' ? 'flex-start' : 'flex-end');
	setVariable(
		root,
		'--owui-user-radius',
		`${shapeRadius(layout.userMessage.shape, overrideNumber(user, 'radius', glass.radius))}px`
	);
	setVariable(root, '--owui-user-avatar-display', layout.userMessage.showAvatar ? 'flex' : 'none');
	setVariable(
		root,
		'--owui-assistant-width',
		`${layout.assistantMessage.readingWidth}px`
	);
	setVariable(
		root,
		'--owui-assistant-surface-mode',
		layout.assistantMessage.surface
	);
	setVariable(
		root,
		'--owui-assistant-avatar-display',
		layout.assistantMessage.showAvatar ? 'flex' : 'none'
	);
	setVariable(
		root,
		'--owui-model-title-display',
		layout.assistantMessage.showModelTitle ? 'block' : 'none'
	);
	setVariable(root, '--owui-details-mode', layout.assistantMessage.details);
	setVariable(
		root,
		'--owui-navigation-min-height',
		layout.navigation.density === 'compact' ? '40px' : '48px'
	);
	setVariable(root, '--owui-composer-width', `${layout.composer.width}px`);
	setVariable(
		root,
		'--owui-composer-density',
		layout.composer.density === 'compact' ? 'compact' : 'comfortable'
	);
	setVariable(root, '--owui-reading-font-size', `${reading.fontSize}px`);
	setVariable(root, '--owui-reading-line-height', String(reading.lineHeight));
	setVariable(root, '--owui-reading-paragraph-gap', `${reading.paragraphSpacing}em`);
	setVariable(root, '--owui-code-font-size', `${reading.codeFontSize}px`);
	setVariable(root, '--owui-code-white-space', reading.codeWrap ? 'pre-wrap' : 'pre');
	setVariable(root, '--owui-code-word-break', reading.codeWrap ? 'break-word' : 'normal');

	const motionScale =
		settings.motion === 'off' ? 0 : settings.motion === 'fluid' ? 1.25 : 1;
	setVariable(root, '--mist-motion-scale', String(motionScale));
	setVariable(root, '--mist-duration-fast', `${Math.round(120 * motionScale)}ms`);
	setVariable(root, '--mist-duration-base', `${Math.round(180 * motionScale)}ms`);

	root.classList.toggle('dark', resolvedTheme === 'dark');
	root.classList.toggle('light', resolvedTheme === 'light');

	lastApply = () => applyAppearanceCss(settings, target, forcedTheme);
}
