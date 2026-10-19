<script lang="ts">
	import { get } from 'svelte/store';
	import { onDestroy, onMount } from 'svelte';
	import { applyAppearanceCss } from './css-vars';
	import { loadWallpaperAsset, pruneWallpaperAssets } from './image-store';
	import {
		appearanceStorageKey,
		loadAppearance,
		normalizeAppearanceOrigin
	} from './storage';
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
			if (settings.enabled && background.kind === 'local-image') {
				try {
					const blob = await loadWallpaperAsset(background.assetId);
					if (blob && request === wallpaperRequest) nextUrl = URL.createObjectURL(blob);
				} catch (error) {
					console.error('Unable to load the selected wallpaper', error);
				}
			}
			if (request !== wallpaperRequest) {
				if (nextUrl) URL.revokeObjectURL(nextUrl);
				return;
			}
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			objectUrl = nextUrl;
			appearanceWallpaperUrl.set(nextUrl);
		};

		unsubscribeAppearance = effectiveAppearance.subscribe((settings) => {
			applyAppearanceCss(settings);
			void syncWallpaper();
		});
		unsubscribeWallpaper = resolvedAppearanceTheme.subscribe(() => {
			void syncWallpaper();
		});

		void pruneWallpaperAssets(
			[appearanceSettings].flatMap(() => {
				const settings = get(appearanceSettings);
				return [settings.modes.light.background, settings.modes.dark.background]
					.filter((background) => background.kind === 'local-image')
					.map((background) => background.assetId);
			})
		).catch((error) => console.warn('Unable to prune unused wallpapers', error));

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
			appearanceWallpaperUrl.set(null);
		};
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			delete document.documentElement.dataset.owuiAppearance;
		}
	});
</script>
