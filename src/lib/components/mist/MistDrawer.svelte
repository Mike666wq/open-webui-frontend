<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import * as FocusTrap from 'focus-trap';
	import type { Snippet } from 'svelte';

	type Side = 'left' | 'right' | 'bottom';

	type Props = {
		open: boolean;
		side?: Side;
		title?: string;
		preview?: boolean;
		compact?: boolean;
		pagePreview?: boolean;
		belowTopbar?: boolean;
		hidden?: boolean;
		onclose: () => void;
		children?: Snippet;
		footer?: Snippet;
		overlay?: Snippet;
	};

	let {
		open,
		side = 'left',
		title = '',
		preview = false,
		compact = false,
		pagePreview = false,
		belowTopbar = false,
		hidden = false,
		onclose,
		children,
		footer,
		overlay
	}: Props = $props();

	let panel: HTMLElement | null = $state(null);
	let trap: FocusTrap.FocusTrap | null = null;
	let previousOverflow: string | null = null;

	$effect(() => {
		if (open && panel && !pagePreview && !trap) {
			trap = FocusTrap.createFocusTrap(panel);
			trap.activate();
			previousOverflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
		} else if ((!open || pagePreview) && trap) {
			trap.deactivate();
			trap = null;
			if (previousOverflow !== null) {
				document.body.style.overflow = previousOverflow;
				previousOverflow = null;
			}
		}
	});

	function closeOnEscape(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	$effect(() => {
		return () => {
			trap?.deactivate();
			trap = null;
			if (previousOverflow !== null) {
				document.body.style.overflow = previousOverflow;
				previousOverflow = null;
			}
		};
	});

	const sideClass = {
		left: 'left-0 h-full w-[min(320px,86vw)] rounded-r-[var(--mist-radius)]',
		right: 'right-0 h-full w-[min(440px,calc(100vw-24px))] rounded-l-[var(--mist-radius)]',
		bottom: 'bottom-0 w-full max-h-[90dvh] rounded-t-[var(--mist-radius)]'
	};
</script>

<svelte:window onkeydown={closeOnEscape} />

{#if open}
	<div
		use:portal
		class:mist-modal--hidden={hidden}
		class:mist-modal--preview={preview}
		class:mist-modal--compact={compact}
		class:mist-modal--page-preview={pagePreview}
		class:mist-modal--below-topbar={belowTopbar}
		class="mist-modal"
		transition:fade={{ duration: 120 }}
	>
		<button type="button" class="mist-modal__backdrop" aria-label="Close panel" onclick={onclose}
		></button>
		<div
			bind:this={panel}
			class={`mist-panel mist-surface mist-surface--navigation mist-panel--${side} ${sideClass[side]}`}
			role="dialog"
			aria-modal={pagePreview ? undefined : true}
			aria-label={title || 'Panel'}
			transition:fly={{
				x: side === 'bottom' ? 0 : side === 'left' ? -24 : 24,
				y: side === 'bottom' ? 28 : 0,
				duration: 180
			}}
		>
			{@render overlay?.()}
			{#if side === 'bottom'}
				<button type="button" class="mist-panel__handle" aria-label="Close panel" onclick={onclose}
				></button>
			{/if}
			<div class="mist-panel__header">
				<div>
					<p class="mist-panel__eyebrow">Mist Glass</p>
					<h2>{title}</h2>
				</div>
				<button
					type="button"
					class="mist-button mist-button--ghost mist-button--icon mist-focusable"
					aria-label="Close"
					onclick={onclose}
				>
					×
				</button>
			</div>
			<div class="mist-panel__body">
				{@render children?.()}
			</div>
			{#if footer}
				<div class="mist-panel__footer">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
