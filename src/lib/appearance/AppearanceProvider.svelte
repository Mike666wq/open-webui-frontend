<script lang="ts">
	import { get } from 'svelte/store';
	import { onDestroy, onMount } from 'svelte';
	import { applyAppearanceCss, setWallpaperLuminance } from './css-vars';
	import { loadWallpaperAsset } from './image-store';
	import { appearanceStorageKey, loadAppearance, normalizeAppearanceOrigin } from './storage';
	import { sampleWallpaperLuminance } from './wallpaper-luminance';
	import {
		appearanceSettings,
		appearanceWallpaperUrl,
		effectiveAppearance,
		resolvedAppearanceTheme,
		systemPrefersDark
	} from './state';

	let { origin = '' } = $props();

	let wallpaperRequest = 0;
	let objectUrl: string | null = null;
	let objectUrlAssetId: string | null = null;
	let luminanceCache: { assetId: string; value: number | null } | null = null;
	let mounted = false;
	let unsubscribeAppearance: (() => void) | null = null;
	let unsubscribeWallpaper: (() => void) | null = null;

	onMount(() => {
		const namespace = normalizeAppearanceOrigin(origin || window.location.origin);
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		systemPrefersDark.set(media.matches);
		appearanceSettings.set(loadAppearance(namespace));
		mounted = true;

		const handleMedia = (event: MediaQueryListEvent) => {
			systemPrefersDark.set(event.matches);
		};
		const handleReducedMotion = () => {
			applyAppearanceCss(get(effectiveAppearance));
		};
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== appearanceStorageKey(namespace)) return;
			appearanceSettings.set(loadAppearance(namespace));
		};

		media.addEventListener('change', handleMedia);
		window.addEventListener('storage', handleStorage);
		window
			.matchMedia('(prefers-reduced-motion: reduce)')
			.addEventListener('change', handleReducedMotion);

		const syncWallpaper = async () => {
			if (!mounted) return;
			const request = ++wallpaperRequest;
			const settings = get(effectiveAppearance);
			const theme = get(resolvedAppearanceTheme);
			const background = settings.modes[theme].background;
			let nextUrl: string | null = null;
			let nextAssetId: string | null = null;
			if (settings.enabled && background.kind === 'local-image') {
				if (objectUrl && objectUrlAssetId === background.assetId) {
					nextUrl = objectUrl;
					nextAssetId = objectUrlAssetId;
				} else {
					try {
						const blob = await loadWallpaperAsset(background.assetId);
						if (blob && request === wallpaperRequest) {
							nextUrl = URL.createObjectURL(blob);
							nextAssetId = background.assetId;
							if (luminanceCache?.assetId !== background.assetId) {
								// Sample brightness once per wallpaper asset; token math
								// replays via setWallpaperLuminance. Failure -> null, which
								// keeps the conservative 0.92 reading floor instead.
								const value = await sampleWallpaperLuminance(blob);
								if (request === wallpaperRequest) {
									luminanceCache = { assetId: background.assetId, value };
									setWallpaperLuminance(value);
								}
							} else {
								setWallpaperLuminance(luminanceCache.value);
							}
						}
					} catch (error) {
						console.error('Unable to load the selected wallpaper', error);
					}
				}
			}
			if (request !== wallpaperRequest) {
				if (nextUrl && nextUrl !== objectUrl) URL.revokeObjectURL(nextUrl);
				return;
			}
			if (objectUrl && objectUrl !== nextUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = nextUrl;
			objectUrlAssetId = nextAssetId;
			appearanceWallpaperUrl.set(nextUrl);
			if (!nextAssetId) setWallpaperLuminance(null);
		};

		unsubscribeAppearance = effectiveAppearance.subscribe((settings) => {
			applyAppearanceCss(settings);
			void syncWallpaper();
		});
		unsubscribeWallpaper = resolvedAppearanceTheme.subscribe(() => {
			void syncWallpaper();
		});

		return () => {
			mounted = false;
			wallpaperRequest += 1;
			media.removeEventListener('change', handleMedia);
			window.removeEventListener('storage', handleStorage);
			window
				.matchMedia('(prefers-reduced-motion: reduce)')
				.removeEventListener('change', handleReducedMotion);
			unsubscribeAppearance?.();
			unsubscribeWallpaper?.();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = null;
			objectUrlAssetId = null;
			luminanceCache = null;
			setWallpaperLuminance(null);
			appearanceWallpaperUrl.set(null);
		};
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			delete document.documentElement.dataset.owuiAppearance;
		}
	});
</script>
