<script lang="ts">
	type Props = {
		sourceUrl: string;
		mediaKind?: 'image' | 'video';
		/** Horizontal window position across the wallpaper, 0 (left) to 1 (right). */
		focus: number;
		/** Screen aspect ratio (width / height) of the preview window. */
		aspectRatio: number;
		onchange: (focus: number) => void;
	};

	let { sourceUrl, mediaKind = 'image', focus, aspectRatio, onchange }: Props = $props();

	let frame: HTMLDivElement | null = $state(null);
	let frameWidth = $state(0);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let dragging = false;
	let dragStartX = 0;
	let dragStartFocus = 0.5;
	let liveFocus = $state(0.5);

	$effect(() => {
		if (!dragging) liveFocus = focus;
	});

	$effect(() => {
		naturalWidth = 0;
		naturalHeight = 0;
		if (!sourceUrl) return;

		// Videos only expose their dimensions after mounting, but renderedWidth
		// gates that mount. Start with the bundled film's aspect and update it
		// from loadedmetadata once the element exists.
		if (mediaKind === 'video') {
			naturalWidth = 16;
			naturalHeight = 9;
			return;
		}

		let active = true;
		const image = new Image();
		image.onload = () => {
			if (!active || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
			naturalWidth = image.naturalWidth;
			naturalHeight = image.naturalHeight;
		};
		image.onerror = () => {
			if (!active) return;
			naturalWidth = 0;
			naturalHeight = 0;
		};
		image.src = sourceUrl;

		return () => {
			active = false;
			image.onload = null;
			image.onerror = null;
		};
	});

	function onVideoMetadata(event: Event) {
		const video = event.currentTarget as HTMLVideoElement;
		if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
		naturalWidth = video.videoWidth;
		naturalHeight = video.videoHeight;
		void video.play().catch(() => {
			// The first frame/poster remains visible if autoplay is blocked.
		});
	}

	const clamp = (value: number) => Math.min(1, Math.max(0, value));

	const frameHeight = $derived(frameWidth > 0 && aspectRatio > 0 ? frameWidth / aspectRatio : 0);
	const renderedWidth = $derived.by(() => {
		if (!frameWidth || !naturalWidth || !naturalHeight) return 0;
		const imageAspect = naturalWidth / naturalHeight;
		// Match the app: fill the window height, grow wider than the window when
		// the media allows it so it can be slid left/right.
		return Math.max(frameWidth, frameHeight * imageAspect);
	});
	const overflowX = $derived(Math.max(0, renderedWidth - frameWidth));
	const mediaStyle = $derived(
		[
			`width: ${renderedWidth.toFixed(2)}px`,
			`height: ${frameHeight.toFixed(2)}px`,
			`left: ${(-clamp(liveFocus) * overflowX).toFixed(2)}px`
		].join(';')
	);

	function onPointerDown(event: PointerEvent) {
		if (!frame || overflowX <= 0) return;
		frame.setPointerCapture(event.pointerId);
		dragging = true;
		dragStartX = event.clientX;
		dragStartFocus = clamp(liveFocus);
		event.preventDefault();
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || overflowX <= 0) return;
		const dx = event.clientX - dragStartX;
		liveFocus = clamp(dragStartFocus - dx / overflowX);
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		frame?.releasePointerCapture?.(event.pointerId);
		onchange(clamp(liveFocus));
	}

	function onWheel(event: WheelEvent) {
		if (overflowX <= 0) return;
		event.preventDefault();
		liveFocus = clamp(liveFocus + (event.deltaY + event.deltaX) / 400);
		onchange(liveFocus);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (overflowX <= 0) return;
		const step = event.shiftKey ? 0.1 : 0.02;
		if (event.key === 'ArrowLeft') {
			liveFocus = clamp(liveFocus - step);
		} else if (event.key === 'ArrowRight') {
			liveFocus = clamp(liveFocus + step);
		} else {
			return;
		}
		event.preventDefault();
		onchange(liveFocus);
	}
</script>

<div
	bind:this={frame}
	bind:clientWidth={frameWidth}
	class="crop-editor"
	style:aspect-ratio={String(aspectRatio)}
	role="slider"
	tabindex="0"
	aria-label="Wallpaper horizontal position"
	aria-valuemin="0"
	aria-valuemax="100"
	aria-valuenow={Math.round(clamp(liveFocus) * 100)}
	data-no-bg-pan
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onwheel={onWheel}
	onkeydown={onKeyDown}
>
	{#if renderedWidth > 0}
		{#if mediaKind === 'video'}
			<video
				src={sourceUrl}
				muted
				loop
				autoplay
				playsinline
				preload="metadata"
				style={mediaStyle}
				onloadedmetadata={onVideoMetadata}
			></video>
		{:else}
			<img src={sourceUrl} alt="" draggable="false" style={mediaStyle} />
		{/if}
	{/if}
	<div class="crop-editor__hint">
		<span aria-hidden="true">←</span>
		<span class="crop-editor__hint-text">左右滑动</span>
		<span aria-hidden="true">→</span>
	</div>
	<div class="crop-editor__rail">
		<div class="crop-editor__thumb" style:left={`${clamp(liveFocus) * 100}%`}></div>
	</div>
</div>

<style>
	.crop-editor {
		position: relative;
		width: 100%;
		overflow: hidden;
		border: 1px solid var(--mist-border);
		border-radius: 12px;
		background: rgb(7 11 20 / 0.4);
		touch-action: pan-y;
		user-select: none;
		cursor: grab;
	}

	.crop-editor:active {
		cursor: grabbing;
	}

	.crop-editor:focus-visible {
		outline: 2px solid var(--mist-accent);
		outline-offset: 2px;
	}

	.crop-editor :is(img, video) {
		position: absolute;
		top: 0;
		max-width: none;
		object-fit: cover;
		pointer-events: none;
	}

	.crop-editor__hint {
		position: absolute;
		top: 10px;
		left: 50%;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 4px 10px;
		transform: translateX(-50%);
		border-radius: 999px;
		background: rgb(7 11 20 / 0.45);
		color: #fff;
		font-size: 11px;
		pointer-events: none;
	}

	.crop-editor__rail {
		position: absolute;
		right: 12px;
		bottom: 10px;
		left: 12px;
		height: 3px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.35);
		pointer-events: none;
	}

	.crop-editor__thumb {
		position: absolute;
		top: 50%;
		width: 14px;
		height: 14px;
		transform: translate(-50%, -50%);
		border: 2px solid #fff;
		border-radius: 999px;
		background: var(--mist-accent);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
	}

	@media (prefers-reduced-motion: no-preference) {
		.crop-editor__hint {
			animation: crop-hint 2.6s ease-in-out infinite;
		}
	}

	@keyframes crop-hint {
		0%,
		100% {
			opacity: 0.9;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
