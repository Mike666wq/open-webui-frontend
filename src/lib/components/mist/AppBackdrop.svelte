<script lang="ts">
	import { gradientBackgroundCss } from '$lib/appearance/presets';
	import {
		backgroundMediaUrl,
		isPannableBackground,
		OFFICIAL_WELCOME_MEDIA_ASPECT,
		OFFICIAL_WELCOME_POSTER_URL
	} from '$lib/appearance/media';
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
	let videoElement: HTMLVideoElement | null = $state(null);
	let prefersReducedMotion = $state(false);
	const isPortrait = $derived(viewportH >= viewportW);
	const orientationKey = $derived(isPortrait ? 'portrait' : 'landscape');

	const mode = $derived(settings.modes[$resolvedAppearanceTheme]);
	const background = $derived(mode.background);
	const pannable = $derived(isPannableBackground(background));
	const videoBackground = $derived(background.kind === 'official-video');
	const mediaUrl = $derived(backgroundMediaUrl(background, wallpaperUrl));
	const motionAllowed = $derived(settings.motion !== 'off' && !prefersReducedMotion);

	$effect(() => {
		if (!interactive || typeof window === 'undefined') return;
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const sync = () => {
			prefersReducedMotion = media.matches;
		};
		sync();
		media.addEventListener('change', sync);
		return () => media.removeEventListener('change', sync);
	});

	$effect(() => {
		if (!interactive || typeof document === 'undefined') return;
		const root = document.documentElement;
		if (pannable) {
			root.dataset.owuiWallpaper = background.kind;
		} else {
			delete root.dataset.owuiWallpaper;
		}
		return () => {
			if (
				root.dataset.owuiWallpaper === 'local-image' ||
				root.dataset.owuiWallpaper === 'official-video'
			) {
				delete root.dataset.owuiWallpaper;
			}
		};
	});

	let mediaAspect = $state(0);
	$effect(() => {
		// A video cannot report its dimensions until it has mounted, while the
		// geometry below decides whether it can mount. Seed the known bundled
		// aspect so the video can load, then replace it from metadata.
		mediaAspect = background.kind === 'official-video' ? OFFICIAL_WELCOME_MEDIA_ASPECT : 0;
		if (background.kind !== 'local-image' || !wallpaperUrl) return;
		const image = new Image();
		image.onload = () => {
			if (image.naturalWidth > 0 && image.naturalHeight > 0) {
				mediaAspect = image.naturalWidth / image.naturalHeight;
			}
		};
		image.src = wallpaperUrl;
		return () => {
			image.onload = null;
		};
	});

	$effect(() => {
		if (!videoElement || !videoBackground) return;
		if (motionAllowed) {
			void videoElement.play().catch(() => {
				// The poster remains visible until a later user interaction can
				// grant autoplay permission.
			});
		} else {
			videoElement.pause();
		}
	});

	function handleVideoMetadata() {
		if (!videoElement) return;
		if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
			mediaAspect = videoElement.videoWidth / videoElement.videoHeight;
		}
	}

	const savedFocus = $derived(
		background.kind === 'local-image' || background.kind === 'official-video'
			? (background.focus[orientationKey] ?? 0.5)
			: 0.5
	);
	// Live focus while the user drags, committed to storage on release.
	let liveFocus = $state(0.5);
	let dragging = false;
	$effect(() => {
		if (!dragging) liveFocus = savedFocus;
	});

	const geometry = $derived.by(() => {
		if (!pannable || !mediaUrl || !mediaAspect || !viewportW || !viewportH) {
			return null;
		}
		// Fill the screen height; widen the media beyond the viewport when its
		// aspect ratio allows it, so the window can slide left/right over it.
		let height = viewportH;
		let width = height * mediaAspect;
		if (width < viewportW) {
			width = viewportW;
			height = width / mediaAspect;
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

	const blur = $derived(background.blur > 0 ? `blur(${background.blur}px) saturate(1.04)` : 'none');

	const gradientStyle = $derived(
		`background-image: ${gradientBackgroundCss(
			background.kind === 'gradient'
				? background.gradient
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
		// Only a genuinely horizontally scrollable local surface should win the
		// gesture. Looking at every ancestor was brittle because app shells often
		// report an auto overflow axis even when the gesture began on open space.
		for (
			let node = element as HTMLElement | null;
			node && node !== document.body;
			node = node.parentElement
		) {
			if (node.scrollWidth <= node.clientWidth + 4) continue;
			const style = getComputedStyle(node);
			const canScroll = style.overflowX === 'auto' || style.overflowX === 'scroll';
			const intentionallyHorizontal =
				node.hasAttribute('data-horizontal-scroll') ||
				node.classList.contains('overflow-x-auto') ||
				node.classList.contains('overflow-x-scroll') ||
				node.classList.contains('snap-x');
			if (canScroll && intentionallyHorizontal) return true;
		}
		return false;
	}

	function commitFocus(value: number) {
		if (
			!interactive ||
			$appearanceDraft ||
			(background.kind !== 'local-image' && background.kind !== 'official-video')
		) {
			return;
		}
		const nextBackground = {
			...background,
			focus: { ...background.focus, [orientationKey]: value }
		};
		const next: AppearanceSettings = {
			...$appearanceSettings,
			modes: {
				...$appearanceSettings.modes,
				[$resolvedAppearanceTheme]: {
					...$appearanceSettings.modes[$resolvedAppearanceTheme],
					background: nextBackground
				}
			}
		};
		// Set the live value immediately so the backdrop does not snap back while
		// the provider applies the persisted focus.
		liveFocus = value;
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

		const onTouchStart = (event: TouchEvent) => {
			if (!geometry || geometry.overflowX < 8 || event.touches.length !== 1) return;
			if ($appearanceDraft || isPanBlocked(event.target)) return;
			const touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			startFocus = savedFocus;
			active = true;
			horizontal = false;
		};
		const onTouchMove = (event: TouchEvent) => {
			if (!active || !geometry || event.touches.length !== 1) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (!horizontal) {
				if (Math.abs(dx) < 8) return;
				if (Math.abs(dy) > Math.abs(dx) * 1.1) {
					active = false;
					return;
				}
				horizontal = true;
				dragging = true;
			}
			if (event.cancelable) event.preventDefault();
			liveFocus = Math.min(1, Math.max(0, startFocus - dx / geometry.overflowX));
		};
		const onTouchEnd = () => {
			if (active && horizontal) commitFocus(liveFocus);
			active = false;
			horizontal = false;
			dragging = false;
		};
		window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
		window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
		window.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
		window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
		return () => {
			window.removeEventListener('touchstart', onTouchStart, { capture: true });
			window.removeEventListener('touchmove', onTouchMove, { capture: true });
			window.removeEventListener('touchend', onTouchEnd, { capture: true });
			window.removeEventListener('touchcancel', onTouchEnd, { capture: true });
		};
	});
</script>

<div
	bind:clientWidth={viewportW}
	bind:clientHeight={viewportH}
	class={`mist-backdrop mist-backdrop--${pannable && mediaUrl ? 'wallpaper' : variant}`}
	aria-hidden="true"
>
	{#if pannable && mediaUrl && geometry}
		<div class="mist-backdrop__layer mist-backdrop__layer--wallpaper" style={gradientStyle}>
			{#if videoBackground}
				<video
					bind:this={videoElement}
					class="mist-backdrop__wallpaper mist-backdrop__video"
					src={mediaUrl}
					poster={OFFICIAL_WELCOME_POSTER_URL}
					autoplay
					muted
					loop
					playsinline
					preload="metadata"
					style={wallpaperStyle}
					style:filter={blur}
					onloadedmetadata={handleVideoMetadata}
				></video>
			{:else}
				<img
					class="mist-backdrop__wallpaper"
					src={mediaUrl}
					alt=""
					draggable="false"
					style={wallpaperStyle}
					style:filter={blur}
				/>
			{/if}
		</div>
	{:else}
		<div class="mist-backdrop__layer" style={gradientStyle}></div>
	{/if}
	<div
		class="mist-backdrop__scrim"
		style:background-color={`rgb(7 11 20 / ${background.mask / 100})`}
	></div>
</div>
