/**
 * scrollableX — make a horizontally overflowing strip mouse-friendly:
 * vertical wheel pans sideways, left-drag pans, and edge fades hint that
 * more content exists off-screen.
 *
 * Svelte 5 action. Attached element keeps its own layout; fades are
 * rendered by adding `data-scrollable-x` plus `data-can-scroll-start/end`
 * attributes consumed by the global styles in mist-app.css.
 */
export function scrollableX(node: HTMLElement): { destroy(): void } {
	let dragging = false;
	let suppressClick = false;
	let pointer: number | null = null;
	let startX = 0;
	let startScroll = 0;

	const update = () => {
		const overflow = node.scrollWidth - node.clientWidth;
		const start = node.scrollLeft > 2;
		const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
		node.dataset.canScrollStart = String(start);
		node.dataset.canScrollEnd = String(end);
		node.dataset.scrollableX = String(overflow > 4);
	};

	const wheel = (event: WheelEvent) => {
		if (event.ctrlKey) return; // browser zoom gesture
		if (node.dataset.scrollableX !== 'true') return;
		if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
		const atStart = node.scrollLeft <= 0;
		const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
		// Only hijack the wheel when the strip can actually consume it; a
		// pinned wheel at one edge should keep scrolling the page.
		if ((event.deltaY < 0 && atStart) || (event.deltaY > 0 && atEnd)) return;
		event.preventDefault();
		node.scrollLeft += event.deltaY;
	};

	const down = (event: PointerEvent) => {
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		if (node.dataset.scrollableX !== 'true') return;
		pointer = event.pointerId;
		startX = event.clientX;
		startScroll = node.scrollLeft;
	};

	const move = (event: PointerEvent) => {
		if (pointer !== event.pointerId) return;
		const distance = event.clientX - startX;
		if (!dragging && Math.abs(distance) < 6) return;
		if (!dragging) {
			dragging = true;
			node.setPointerCapture(event.pointerId);
			node.classList.add('is-dragging-x');
		}
		event.preventDefault();
		node.scrollLeft = startScroll - distance;
	};

	const up = (event: PointerEvent) => {
		if (pointer !== event.pointerId) return;
		if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
		pointer = null;
		if (dragging) {
			// A drag ends without a click when the pointer is cancelled; clear the
			// flag here so the next real tab click is not swallowed. The click that
			// follows a normal drag is suppressed once by `click`.
			dragging = false;
			node.classList.remove('is-dragging-x');
			suppressClick = true;
			setTimeout(() => {
				suppressClick = false;
			}, 0);
		}
	};

	// A real drag must not also fire the click on whichever tab was under
	// the cursor at pointer-down.
	const click = (event: MouseEvent) => {
		if (!suppressClick) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		suppressClick = false;
	};

	const resize = new ResizeObserver(update);
	const mutations = new MutationObserver(update);
	resize.observe(node);
	mutations.observe(node, { childList: true, subtree: true });
	node.addEventListener('scroll', update, { passive: true });
	node.addEventListener('wheel', wheel, { passive: false });
	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', up);
	node.addEventListener('pointercancel', up);
	node.addEventListener('click', click, true);
	update();

	return {
		destroy() {
			resize.disconnect();
			mutations.disconnect();
			node.removeEventListener('scroll', update);
			node.removeEventListener('wheel', wheel);
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', up);
			node.removeEventListener('pointercancel', up);
			node.removeEventListener('click', click, true);
		}
	};
}
