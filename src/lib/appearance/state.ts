import { derived, writable } from 'svelte/store';
import { resolveAppearanceTheme } from './presets';
import { DEFAULT_APPEARANCE, type AppearanceSettings } from './schema';

export const appearanceSettings = writable<AppearanceSettings>(
	structuredClone(DEFAULT_APPEARANCE)
);
export const appearanceDraft = writable<AppearanceSettings | null>(null);
export const appearanceWallpaperUrl = writable<string | null>(null);
export const appearancePreviewWallpaperUrl = writable<string | null>(null);
export const appearancePreviewTheme = writable<'light' | 'dark' | null>(null);
export const systemPrefersDark = writable(false);

export const effectiveAppearance = derived(
	[appearanceSettings, appearanceDraft],
	([$settings, $draft]) => $draft ?? $settings
);
export const appearanceEnabled = derived(effectiveAppearance, ($settings) => $settings.enabled);
export const directoryEnabled = derived(
	effectiveAppearance,
	($settings) => $settings.directoryEnabled
);
export const resolvedAppearanceTheme = derived(
	[effectiveAppearance, systemPrefersDark, appearancePreviewTheme],
	([$settings, $prefersDark, $previewTheme]) =>
		$previewTheme ?? resolveAppearanceTheme($settings.theme, $prefersDark)
);
export const wallpaperVariant = derived(
	[effectiveAppearance, systemPrefersDark],
	([$settings, $prefersDark]): 'gradient' | 'wallpaper' =>
		$settings.modes[resolveAppearanceTheme($settings.theme, $prefersDark)].background.kind ===
		'local-image'
			? 'wallpaper'
			: 'gradient'
);
export const activeWallpaperUrl = derived(
	[appearanceDraft, appearanceWallpaperUrl, appearancePreviewWallpaperUrl],
	([$draft, $wallpaperUrl, $previewUrl]) => ($draft && $previewUrl ? $previewUrl : $wallpaperUrl)
);

export function beginAppearancePreview(
	settings: AppearanceSettings,
	wallpaperUrl: string | null = null,
	theme: 'light' | 'dark' | null = null
): void {
	appearanceDraft.set(settings);
	appearancePreviewWallpaperUrl.set(wallpaperUrl);
	appearancePreviewTheme.set(theme);
}

export function updateAppearancePreview(settings: AppearanceSettings): void {
	appearanceDraft.set(settings);
}

export function endAppearancePreview(): void {
	appearanceDraft.set(null);
	appearancePreviewWallpaperUrl.set(null);
	appearancePreviewTheme.set(null);
}
