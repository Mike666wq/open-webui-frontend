<script lang="ts">
	import { gradientBackgroundCss } from '$lib/appearance/presets';
	import {
		activeWallpaperUrl,
		effectiveAppearance,
		resolvedAppearanceTheme
	} from '$lib/appearance/state';
	import type { AppearanceSettings } from '$lib/appearance/schema';

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

	const mode = $derived(settings.modes[$resolvedAppearanceTheme]);
	const imageBackground = $derived(mode.background.kind === 'local-image');
	const backdropStyle = $derived.by(() => {
		if (mode.background.kind === 'local-image' && wallpaperUrl) {
			const backgroundImage = `url("${wallpaperUrl.replaceAll('"', '%22')}")`;
			const focus = `${mode.background.focusX}% ${mode.background.focusY}%`;
			const scale = Math.max(1.02, mode.background.scale / 100);
			return [
				`background-image: ${backgroundImage}`,
				`background-position: ${focus}`,
				'background-size: cover',
				`transform-origin: ${focus}`,
				`transform: scale(${scale.toFixed(4)})`,
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
