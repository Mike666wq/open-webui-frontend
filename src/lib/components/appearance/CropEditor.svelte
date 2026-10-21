<script lang="ts">
	type Crop = { x: number; y: number; width: number; height: number };

	type Props = {
		imageUrl: string;
		crop: Crop;
		/** Aspect ratio (width / height) the crop region must keep: the screen's. */
		aspectRatio?: number;
		onchange: (crop: Crop) => void;
	};

	let { imageUrl, crop, aspectRatio, onchange }: Props = $props();

	let frame: HTMLDivElement | null = $state(null);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);

	// The frame shows the full image (letterboxed). Crop coordinates are in
	// image-relative 0-1 space; the frame's own box matches the image's box.
	const frameAspect = $derived(
		naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : null
	);

	function clamp(value: number, min: number, max: number) {
		return Math.min(max, Math.max(min, value));
	}

	// Keep the crop rectangle at the screen's aspect ratio. Resizing one axis
	// adjusts the other so the framed region always matches the screen shape.
	function lockAspect(next: Crop, anchor: 'width' | 'height'): Crop {
		if (!aspectRatio || !naturalWidth || !naturalHeight) return next;
		const imageAspect = naturalWidth / naturalHeight;
		// crop aspect in image pixels = (width * imageW) / (height * imageH)
		// we want it to equal the screen aspectRatio.
		let { width, height } = next;
		if (anchor === 'width') {
			height = clamp((width * imageAspect) / aspectRatio, 0.05, 1);
			width = clamp((height * aspectRatio) / imageAspect, 0.05, 1);
		} else {
			width = clamp((height * aspectRatio) / imageAspect, 0.05, 1);
			height = clamp((width * imageAspect) / aspectRatio, 0.05, 1);
		}
		return { ...next, width, height };
	}

	function commit(next: Crop) {
		const width = clamp(next.width, 0.05, 1);
		const height = clamp(next.height, 0.05, 1);
		onchange({
			width,
			height,
			x: clamp(next.x, 0, 1 - width),
			y: clamp(next.y, 0, 1 - height)
		});
	}

	type DragState =
		| { mode: 'move'; pointerId: number; startX: number; startY: number; origin: Crop }
		| {
				mode: 'resize';
				pointerId: number;
				corner: string;
				startX: number;
				startY: number;
				origin: Crop;
		  }
		| null;

	let drag: DragState = null;

	function frameRect() {
		return frame?.getBoundingClientRect() ?? null;
	}

	function toUnit(event: PointerEvent) {
		const rect = frameRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: (event.clientX - rect.left) / rect.width,
			y: (event.clientY - rect.top) / rect.height
		};
	}

	const activePointers = new Map<number, { x: number; y: number }>();
	let pinchStart: { dist: number; crop: Crop } | null = null;

	function onPointerDown(event: PointerEvent) {
		if (!frame) return;
		frame.setPointerCapture(event.pointerId);
		activePointers.set(event.pointerId, toUnit(event));
		if (activePointers.size === 2) {
			const points = [...activePointers.values()];
			pinchStart = {
				dist: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
				crop: { ...crop }
			};
			drag = null;
			event.preventDefault();
			return;
		}
		const target = event.target as HTMLElement;
		const corner = target.dataset.corner;
		const point = toUnit(event);
		if (corner) {
			drag = {
				mode: 'resize',
				pointerId: event.pointerId,
				corner,
				startX: point.x,
				startY: point.y,
				origin: { ...crop }
			};
		} else {
			drag = {
				mode: 'move',
				pointerId: event.pointerId,
				startX: point.x,
				startY: point.y,
				origin: { ...crop }
			};
		}
		event.preventDefault();
	}

	function onPointerMove(event: PointerEvent) {
		if (activePointers.has(event.pointerId)) {
			activePointers.set(event.pointerId, toUnit(event));
		}
		if (pinchStart && activePointers.size === 2) {
			const points = [...activePointers.values()];
			const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
			if (dist > 0 && pinchStart.dist > 0) {
				const factor = pinchStart.dist / dist;
				const origin = pinchStart.crop;
				const centerX = origin.x + origin.width / 2;
				const centerY = origin.y + origin.height / 2;
				const sized = lockAspect(
					{ ...origin, width: clamp(origin.width * factor, 0.05, 1) },
					'width'
				);
				commit({ ...sized, x: centerX - sized.width / 2, y: centerY - sized.height / 2 });
			}
			return;
		}
		if (!drag) return;
		if (event.pointerId !== drag.pointerId) return;
		const point = toUnit(event);
		const dx = point.x - drag.startX;
		const dy = point.y - drag.startY;
		const origin = drag.origin;
		if (drag.mode === 'move') {
			commit({ ...origin, x: origin.x + dx, y: origin.y + dy });
		} else {
			let { x, y, width, height } = origin;
			if (drag.corner.includes('e')) width = origin.width + dx;
			if (drag.corner.includes('s')) height = origin.height + dy;
			if (drag.corner.includes('w')) {
				x = origin.x + dx;
				width = origin.width - dx;
			}
			if (drag.corner.includes('n')) {
				y = origin.y + dy;
				height = origin.height - dy;
			}
			const anchor = drag.corner.includes('e') || drag.corner.includes('w') ? 'width' : 'height';
			commit(lockAspect({ x, y, width, height }, anchor));
		}
	}

	function onPointerUp(event: PointerEvent) {
		activePointers.delete(event.pointerId);
		if (activePointers.size < 2) pinchStart = null;
		if (drag && event.pointerId === drag.pointerId) drag = null;
	}

	function onWheel(event: WheelEvent) {
		event.preventDefault();
		const factor = event.deltaY > 0 ? 1.06 : 1 / 1.06;
		const centerX = crop.x + crop.width / 2;
		const centerY = crop.y + crop.height / 2;
		const sized = lockAspect({ ...crop, width: clamp(crop.width * factor, 0.05, 1) }, 'width');
		commit({ ...sized, x: centerX - sized.width / 2, y: centerY - sized.height / 2 });
	}

	const corners = ['nw', 'ne', 'sw', 'se'];
</script>

<div
	bind:this={frame}
	class="crop-editor"
	style:aspect-ratio={frameAspect ? String(frameAspect) : undefined}
	role="application"
	aria-label="Crop wallpaper"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onwheel={onWheel}
>
	<img
		src={imageUrl}
		alt=""
		draggable="false"
		onload={(e) => {
			const img = e.currentTarget as HTMLImageElement;
			naturalWidth = img.naturalWidth;
			naturalHeight = img.naturalHeight;
		}}
	/>
	{#if frameAspect}
		<div
			class="crop-editor__frame"
			style:left={`${crop.x * 100}%`}
			style:top={`${crop.y * 100}%`}
			style:width={`${crop.width * 100}%`}
			style:height={`${crop.height * 100}%`}
		>
			{#each corners as corner (corner)}
				<button
					type="button"
					class="crop-editor__handle"
					data-corner={corner}
					aria-label="Resize"
					onpointerdown={onPointerDown}
				></button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.crop-editor {
		position: relative;
		width: 100%;
		overflow: hidden;
		border: 1px solid var(--mist-border);
		border-radius: 12px;
		background: rgb(7 11 20 / 0.4);
		touch-action: none;
		user-select: none;
	}

	.crop-editor img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		opacity: 0.55;
		pointer-events: none;
	}

	.crop-editor__frame {
		position: absolute;
		border: 2px solid var(--mist-accent);
		border-radius: 6px;
		box-shadow: 0 0 0 9999px rgb(7 11 20 / 0.28);
		cursor: move;
	}

	.crop-editor__handle {
		position: absolute;
		width: 18px;
		height: 18px;
		border: 2px solid #fff;
		border-radius: 999px;
		background: var(--mist-accent);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
		cursor: pointer;
	}

	.crop-editor__handle[data-corner='nw'] { left: -9px; top: -9px; cursor: nwse-resize; }
	.crop-editor__handle[data-corner='ne'] { right: -9px; top: -9px; cursor: nesw-resize; }
	.crop-editor__handle[data-corner='sw'] { left: -9px; bottom: -9px; cursor: nesw-resize; }
	.crop-editor__handle[data-corner='se'] { right: -9px; bottom: -9px; cursor: nwse-resize; }
</style>
