<script lang="ts">
	// Mist Glass custom dropdown: glass floating panel, full keyboard support,
	// closes on Escape or any pointer/keyboard focus leaving the control.
	// Replaces the native <select> chrome in the appearance editor.

	type Option = { value: string; label: string };

	let {
		id,
		ariaLabel,
		value,
		options,
		onchange
	}: {
		id: string;
		ariaLabel: string;
		value: string;
		options: Option[];
		onchange: (value: string) => void;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement;
	let trigger: HTMLButtonElement;

	const selectedLabel = $derived(
		options.find((option) => String(option.value) === String(value))?.label ?? String(value)
	);
	const selectedIndex = $derived(
		Math.max(
			0,
			options.findIndex((option) => String(option.value) === String(value))
		)
	);

	function choose(option: Option) {
		open = false;
		trigger?.focus();
		if (String(option.value) !== String(value)) onchange(String(option.value));
	}

	function step(direction: number) {
		const next = options[Math.min(options.length - 1, Math.max(0, selectedIndex + direction))];
		if (next && String(next.value) !== String(value)) onchange(String(next.value));
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (open) {
				step(event.key === 'ArrowDown' ? 1 : -1);
			} else {
				open = true;
			}
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			open = !open;
		} else if (event.key === 'Escape' && open) {
			event.preventDefault();
			open = false;
		} else if (event.key === 'Home' && open) {
			event.preventDefault();
			const first = options[0];
			if (first && String(first.value) !== String(value)) onchange(String(first.value));
		} else if (event.key === 'End' && open) {
			event.preventDefault();
			const last = options[options.length - 1];
			if (last && String(last.value) !== String(value)) onchange(String(last.value));
		}
	}

	function onListKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			step(event.key === 'ArrowDown' ? 1 : -1);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
			trigger?.focus();
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			const current = options[selectedIndex];
			if (current) choose(current);
		} else if (event.key === 'Home') {
			event.preventDefault();
			const first = options[0];
			if (first && String(first.value) !== String(value)) onchange(String(first.value));
		} else if (event.key === 'End') {
			event.preventDefault();
			const last = options[options.length - 1];
			if (last && String(last.value) !== String(value)) onchange(String(last.value));
		}
	}

	// Escape / outside pointer / keyboard focus leaving the control all close
	// the panel without committing anything beyond the current selection.
	function onWindowPointerdown(event: PointerEvent) {
		if (!open) return;
		if (event.target instanceof Node && root?.contains(event.target)) return;
		open = false;
	}
	function onWindowFocusin(event: FocusEvent) {
		if (!open) return;
		if (event.target instanceof Node && root?.contains(event.target)) return;
		open = false;
	}
</script>

<svelte:window on:pointerdown={onWindowPointerdown} on:focusin={onWindowFocusin} />

<div class="mist-select" bind:this={root}>
	<button
		{id}
		type="button"
		class="mist-select__trigger"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={ariaLabel}
		bind:this={trigger}
		onclick={() => (open = !open)}
		onkeydown={onTriggerKeydown}
	>
		<span class="mist-select__label">{selectedLabel}</span>
		<svg class="mist-select__chevron" class:mist-select__chevron--open={open} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
			<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>
	{#if open}
		<div class="mist-select__panel" role="listbox" aria-label={ariaLabel} tabindex="-1" onkeydown={onListKeydown}>
			{#each options as option}
				{@const selected = String(option.value) === String(value)}
				<button
					type="button"
					class="mist-select__option"
					role="option"
					aria-selected={selected}
					data-active={selected}
					onclick={() => choose(option)}
				>
					<span>{option.label}</span>
					{#if selected}
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
							<path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mist-select {
		position: relative;
		flex-shrink: 0;
	}

	.mist-select__trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-width: 128px;
		max-width: 200px;
		min-height: 34px;
		padding: 0 9px 0 11px;
		border: 1px solid var(--mist-border);
		border-radius: 9px;
		background: rgb(var(--mist-reading-rgb) / 0.72);
		color: var(--mist-ink);
		font-size: 12px;
		cursor: pointer;
	}

	.mist-select__trigger:focus-visible {
		outline: 2px solid var(--mist-accent);
		outline-offset: 1px;
	}

	.mist-select__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mist-select__chevron {
		flex-shrink: 0;
		color: var(--mist-muted);
		transition: transform var(--mist-duration-fast, 150ms) ease;
	}

	.mist-select__chevron--open {
		transform: rotate(180deg);
	}

	.mist-select__panel {
		position: absolute;
		inset-inline-end: 0;
		top: calc(100% + 5px);
		z-index: 60;
		display: grid;
		gap: 2px;
		min-width: 100%;
		max-width: 240px;
		max-height: 260px;
		overflow-y: auto;
		padding: 5px;
		border: 1px solid var(--mist-border);
		border-radius: 12px;
		background: rgb(var(--mist-reading-rgb) / 0.78);
		backdrop-filter: blur(16px) saturate(1.15);
		box-shadow:
			0 14px 34px rgb(15 23 42 / 0.16),
			inset 0 1px 0 var(--mist-highlight);
	}

	.mist-select__option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		width: 100%;
		min-height: 30px;
		padding: 3px 9px;
		border-radius: 8px;
		color: var(--mist-ink);
		font-size: 12px;
		text-align: start;
		white-space: nowrap;
		cursor: pointer;
	}

	.mist-select__option:hover,
	.mist-select__option:focus-visible {
		background: var(--mist-highlight);
		outline: none;
	}

	.mist-select__option[data-active='true'] {
		color: var(--mist-accent-text);
		font-weight: 600;
	}
</style>
