export { default as AppearanceProvider } from './AppearanceProvider.svelte';
export { contrastRatio, ensureContrast, themeColorTokens } from './color';
export { applyAppearanceCss } from './css-vars';
export {
	detectImageFormat,
	fitImageDimensions,
	processWallpaperFile,
	suggestColorsFromImage,
	validateWallpaperFile
} from './image';
export {
	deleteWallpaperAsset,
	listWallpaperAssets,
	loadWallpaperAsset,
	saveWallpaperAsset
} from './image-store';
export {
	branchFingerprint,
	buildNavigatorEntries,
	filterNavigatorEntries,
	nextNavigatorSelection,
	type NavigatorEntry
} from './navigator';
export { persistAppearanceChange } from './persist';
export {
	APPEARANCE_PRESETS,
	applyPreset,
	gradientBackgroundCss,
	presetName,
	resolveAppearanceTheme
} from './presets';
export {
	APPEARANCE_PRESET_IDS,
	APPEARANCE_SCHEMA_VERSION,
	DEFAULT_APPEARANCE,
	GRADIENT_IDS,
	cloneAppearance,
	normalizeAppearance,
	withMode,
	type AppearanceComponents,
	type AppearanceLayout,
	type AppearancePreset,
	type AppearanceReading,
	type AppearanceSettings,
	type AppearanceTheme,
	type BackgroundSettings,
	type CodeTone,
	type GradientId,
	type ModeAppearance,
	type ModeColors,
	type MotionLevel,
	type ResolvedAppearanceTheme,
	type SurfaceOverride,
	type SurfaceSlot
} from './schema';
export {
	activeWallpaperUrl,
	appearanceDraft,
	appearanceEnabled,
	appearancePreviewTheme,
	appearancePreviewWallpaperUrl,
	appearanceSettings,
	appearanceWallpaperUrl,
	beginAppearancePreview,
	directoryEnabled,
	effectiveAppearance,
	endAppearancePreview,
	resolvedAppearanceTheme,
	systemPrefersDark,
	updateAppearancePreview,
	wallpaperVariant
} from './state';
export {
	APPEARANCE_STORAGE_PREFIX,
	appearanceStorageKey,
	loadAppearance,
	saveAppearance
} from './storage';
export {
	parseThemeFile,
	serializeThemeFile,
	THEME_FILE_FORMAT,
	ThemeFileError
} from './theme-file';
