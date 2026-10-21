<script lang="ts">
	import { gradientBackgroundCss } from '$lib/appearance/presets';
	import { saveAppearance } from '$lib/appearance/storage';
	import {
		activeWallpaperUrl,
		appearanceDraft,
		appearanceSettings,
		effectiveAppearance,
		resolvedAppearanceTheme
	} from '$lib/appearance/state';
	import type { AppearanceSettings } from '$lib/appearance/schema';

	type Props = {
		variant?: 'gradient' | 'wallpaper';
		settings?: AppearanceSettings;
		wallpaperUrl?: string | null;
		/** Allow the phone window to slide left/right over the wallpaper. */
		interactive?: boolean;
	};

	let {
		variant = 'gradient',
		settings = $effectiveAppearance,
		wallpaperUrl = $activeWallpaperUrl,
		interactive = true
	}: Props = $props();

	// Measure the backdrop itself so the same component works full screen and
	// inside the scaled interface preview.
	let viewportW = $state(0);
	let viewportH = $state(0);
	const isPortrait = $derived(viewportH >= viewportW);
	const orientationKey = $derived(isPortrait ? 'portrait' : 'landscape');

	const mode = $derived(settings.modes[$resolvedAppearanceTheme]);
	const imageBackground = $derived(mode.background.kind === 'local-image');

	$effect(() => {
		if (!interactive || typeof document === 'undefined') return;
		const root = document.documentElement;
		if (imageBackground) {
			root.dataset.owuiWallpaper = 'local-image';
		} else {
			delete root.dataset.owuiWallpaper;
		}
		return () => {
			if (root.dataset.owuiWallpaper === 'local-image') {
				delete root.dataset.owuiWallpaper;
			}
		};
	});

	let imageAspect = $state(0);
	$effect(() => {
		imageAspect = 0;
		if (!wallpaperUrl) return;
		const image = new Image();
		image.onload = () => {
			if (image.naturalWidth > 0 && image.naturalHeight > 0) {
				imageAspect = image.naturalWidth / image.naturalHeight;
			}
		};
		image.src = wallpaperUrl;
		return () => {
			image.onload = null;
		};
	});

	const savedFocus = $derived(
		mode.background.kind === 'local-image'
			? (mode.background.focus[orientationKey] ?? 0.5)
			: 0.5
	);
	// Live focus while the user drags, committed to storage on release.
	let liveFocus = $state(0.5);
	let dragging = false;
	$effect(() => {
		if (!dragging) liveFocus = savedFocus;
	});

	const geometry = $derived.by(() => {
		if (!imageBackground || !wallpaperUrl || !imageAspect || !viewportW || !viewportH) {
			return null;
		}
		// Fill the screen height; widen the image beyond the viewport when its
		// aspect ratio allows it, so the window can slide left/right over it.
		let height = viewportH;
		let width = height * imageAspect;
		if (width < viewportW) {
			width = viewportW;
			height = width / imageAspect;
		}
		return { width, height, overflowX: Math.max(0, width - viewportW) };
	});

	const wallpaperStyle = $derived.by(() => {
		if (!geometry) return '';
		const offsetX = liveFocus * geometry.overflowX;
		const top = (viewportH - geometry.height) / 2;
		return [
			`width: ${geometry.width.toFixed(2)}px`,
			`height: ${geometry.height.toFixed(2)}px`,
			`left: ${(-offsetX).toFixed(2)}px`,
			`top: ${top.toFixed(2)}px`
		].join(';');
	});

	const blur = $derived(
		mode.background.blur > 0 ? `blur(${mode.background.blur}px) saturate(1.04)` : 'none'
	);

	const gradientStyle = $derived(
		`background-image: ${gradientBackgroundCss(
			mode.background.kind === 'gradient'
				? mode.background.gradient
				: settings.modes[$resolvedAppearanceTheme].colors.canvas === '#000000'
					? 'midnight'
					: settings.preset,
			$resolvedAppearanceTheme
		)}`
	);

	function isPanBlocked(target: EventTarget | null): boolean {
		const element = target instanceof Element ? target : null;
		if (!element) return false;
		if (
			element.closest(
				'input, textarea, select, button, a, pre, table, [contenteditable="true"], [role="dialog"], [role="slider"], [data-no-bg-pan], [data-horizontal-scroll], .overflow-x-auto, .overflow-x-scroll, .snap-x'
			)
		) {
			return true;
		}
		// Let horizontally scrollable content (code, tables, carousels) win.
		for (let node = element as HTMLElement | null; node && node !== document.body; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (
				(style.overflowX === 'auto' || style.overflowX === 'scroll') &&
				style.overflowY !== 'auto' &&
				style.overflowY !== 'scroll' &&
				node.scrollWidth > node.clientWidth + 4 &&
				node.clientWidth > 0
			) {
				return true;
			}
		}
		return false;
	}

	function commitFocus(value: number) {
		if (!interactive || $appearanceDraft) return;
		if (!imageBackground || mode.background.kind !== 'local-image') return;
		const next: AppearanceSettings = {
			...$appearanceSettings,
			modes: {
				...$appearanceSettings.modes,
				[$resolvedAppearanceTheme]: {
					...$appearanceSettings.modes[$resolvedAppearanceTheme],
					background: {
						...mode.background,
						focus: { ...mode.background.focus, [orientationKey]: value }
					}
				}
			}
		};
		try {
			appearanceSettings.set(saveAppearance(window.location.origin, next));
		} catch {
			// Panning is a cosmetic preference; ignore storage failures.
		}
	}

	$effect(() => {
		if (!interactive || typeof window === 'undefined') return;
		let startX = 0;
		let startY = 0;
		let startFocus = 0;
		let active = false;
		let horizontal = false;

		const onDown = (event: PointerEvent) => {
			const coarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
			const blocked = isPanBlocked(event.target);
			if (!geometry || geometry.overflowX < 8 || event.button !== 0) return;
			// Touch only: a mouse drag must stay available for text selection.
			if (!coarse) return;
			if (blocked || $appearanceDraft) return;
			startX = event.clientX;
			startY = event.clientY;
			startFocus = savedFocus;
			active = true;
			horizontal = false;
		};
		const onMove = (event: PointerEvent) => {
			if (!active || !geometry) return;
			const dx = event.clientX - startX;
			const dy = event.clientY - startY;
			if (!horizontal) {
				if (Math.abs(dx) < 8) return;
				if (Math.abs(dy) > Math.abs(dx)) {
					active = false;
					return;
				}
				horizontal = true;
				dragging = true;
			}
			// The app root opts into vertical panning while a wallpaper is
			// interactive. Once the gesture proves horizontal, keep it on the
			// wallpaper instead of allowing Android's page-level navigation.
			if (event.cancelable) event.preventDefault();
			liveFocus = Math.min(1, Math.max(0, startFocus - dx / geometry.overflowX));
		};
		const onUp = () => {
			if (active && horizontal) {
				dragging = false;
				commitFocus(liveFocus);
			}
			active = false;
			horizontal = false;
			dragging = false;
		};
		window.addEventListener('pointerdown', onDown, { passive: false });
		window.addEventListener('pointermove', onMove, { passive: false });
		window.addEventListener('pointerup', onUp, { passive: true });
		window.addEventListener('pointercancel', onUp, { passive: true });
		return () => {
			window.removeEventListener('pointerdown', onDown);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
	});
</script>

<div
	bind:clientWidth={viewportW}
	bind:clientHeight={viewportH}
	class={`mist-backdrop mist-backdrop--${imageBackground && wallpaperUrl ? 'wallpaper' : variant}`}
	aria-hidden="true"
>
	{#if imageBackground && wallpaperUrl && geometry}
		<div class="mist-backdrop__layer mist-backdrop__layer--wallpaper" style={gradientStyle}>
			<img
				class="mist-backdrop__wallpaper"
				src={wallpaperUrl}
				alt=""
				draggable="false"
				style={wallpaperStyle}
				style:filter={blur}
			/>
		</div>
	{:else}
		<div class="mist-backdrop__layer" style={gradientStyle}></div>
	{/if}
	<div
		class="mist-backdrop__scrim"
		style:background-color={`rgb(7 11 20 / ${mode.background.mask / 100})`}
	></div>
</div>
