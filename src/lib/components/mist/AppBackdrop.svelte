<script lang="ts">
	import { gradientBackgroundCss } from '$lib/appearance/presets';
	import {
		activeWallpaperUrl,
		effectiveAppearance,
		resolvedAppearanceTheme
	} from '$lib/appearance/state';
	import type { AppearanceSettings, CropRect } from '$lib/appearance/schema';

	type Props = {
		variant?: 'gradient' | 'wallpaper';
		settings?: AppearanceSettings;
		wallpaperUrl?: string | null;
	};

	let {
		variant = 'gradient',
		settings = $effectiveAppearance,
		wallpaperUrl = $activeWallpaperUrl
	}: Props = $props();

	// Track the live viewport orientation so the correct per-orientation crop
	// rectangle is used and the background re-fits without a reload.
	let viewportW = $state(0);
	let viewportH = $state(0);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const update = () => {
			viewportW = window.visualViewport?.width ?? window.innerWidth;
			viewportH = window.visualViewport?.height ?? window.innerHeight;
		};
		update();
		window.addEventListener('resize', update);
		window.addEventListener('orientationchange', update);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('orientationchange', update);
		};
	});
	const isPortrait = $derived(viewportH >= viewportW);

	function pickCrop(crop: { portrait: CropRect; landscape: CropRect }): CropRect {
		return isPortrait ? crop.portrait : crop.landscape;
	}

	const mode = $derived(settings.modes[$resolvedAppearanceTheme]);
	const imageBackground = $derived(mode.background.kind === 'local-image');
	const backdropStyle = $derived.by(() => {
		if (mode.background.kind === 'local-image' && wallpaperUrl) {
			const backgroundImage = `url("${wallpaperUrl.replaceAll('"', '%22')}")`;
			const crop = pickCrop(mode.background.crop);
			// Fit the crop rectangle to the viewport with a single cover scale on
			// the longer axis, then centre it. The crop rectangle matches the
			// viewport aspect ratio (the editor frames with the screen's aspect),
			// so the selected region fills the screen edge-to-edge with no
			// distortion and nothing important is cut off.
			const size = `${(100 / crop.width).toFixed(3)}% auto`;
			const posX = crop.width >= 1 ? 50 : (crop.x / (1 - crop.width)) * 100;
			const posY = crop.height >= 1 ? 50 : (crop.y / (1 - crop.height)) * 100;
			const position = `${posX.toFixed(3)}% ${posY.toFixed(3)}%`;
			return [
				`background-image: ${backgroundImage}`,
				`background-size: ${size}`,
				`background-position: ${position}`,
				'background-repeat: no-repeat',
				`filter: blur(${mode.background.blur}px)`
			].join(';');
		}
		return `background-image: ${gradientBackgroundCss(
			mode.background.kind === 'gradient'
				? mode.background.gradient
				: settings.modes[$resolvedAppearanceTheme].colors.canvas === '#000000'
					? 'midnight'
					: settings.preset,
			$resolvedAppearanceTheme
		)}`;
	});
</script>

<div
	class={`mist-backdrop mist-backdrop--${imageBackground && wallpaperUrl ? 'wallpaper' : variant}`}
	aria-hidden="true"
>
	<div class="mist-backdrop__layer" style={backdropStyle}></div>
	<div
		class="mist-backdrop__scrim"
		style:background-color={`rgb(7 11 20 / ${mode.background.mask / 100})`}
	></div>
</div>
