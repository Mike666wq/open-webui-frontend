import { themeColorTokens } from './color';
import { resolveAppearanceTheme } from './presets';
import type {
	AppearanceSettings,
	ResolvedAppearanceTheme,
	SurfaceOverride
} from './schema';

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
	const tokens = themeColorTokens(mode.colors);
	const { glass, components, layout, reading } = settings;
	const alpha = glass.opacity / 100;
	const overlayScrim = glass.overlayScrim / 100;
	const user = components.userMessage;
	const assistant = components.assistantMessage;
	const composer = components.composer;
	const navigation = components.navigation;
	const overlay = components.overlay;
	const readingSurface = components.reading;

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
}
