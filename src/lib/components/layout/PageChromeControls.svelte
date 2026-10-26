<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { showSidebar } from '$lib/stores';
	const i18n = getContext<any>('i18n');
	let open = false;
	let topHidden = false;
	let sideHidden = false;
	let ready = false;
	let previousSidebar = false;
	function apply() {
		document.documentElement.toggleAttribute('data-topbar-hidden', topHidden);
		document.documentElement.toggleAttribute('data-sidebar-hidden', sideHidden);
		if (ready) localStorage.setItem('owui:page-chrome', JSON.stringify({ topHidden, sideHidden }));
	}
	function toggleSidebar() {
		sideHidden = !sideHidden;
		if (sideHidden) {
			previousSidebar = $showSidebar;
			showSidebar.set(false);
		} else showSidebar.set(previousSidebar);
		apply();
	}
	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem('owui:page-chrome') || '{}');
			topHidden = saved.topHidden === true;
			sideHidden = saved.sideHidden === true;
		} catch {}
		previousSidebar = $showSidebar;
		if (sideHidden) showSidebar.set(false);
		ready = true;
		apply();
		return () => {
			document.documentElement.removeAttribute('data-topbar-hidden');
			document.documentElement.removeAttribute('data-sidebar-hidden');
		};
	});
</script>

<div class="chrome-dock" data-testid="page-chrome-controls">
	{#if open}<div class="chrome-menu" role="group" aria-label={$i18n.t('Page layout')}>
			<strong>{$i18n.t('Page layout')}</strong>
			<button
				aria-pressed={topHidden}
				on:click={() => {
					topHidden = !topHidden;
					apply();
				}}>{$i18n.t(topHidden ? 'Show page toolbar' : 'Hide page toolbar')}</button
			>
			<button aria-pressed={sideHidden} on:click={toggleSidebar}
				>{$i18n.t(sideHidden ? 'Show navigation' : 'Hide navigation')}</button
			>
			<button
				on:click={() => {
					topHidden = false;
					if (sideHidden) toggleSidebar();
					else apply();
					open = false;
				}}>{$i18n.t('Restore page layout')}</button
			>
		</div>{/if}
	<button
		class="chrome-trigger"
		aria-label={$i18n.t('Page layout')}
		aria-expanded={open}
		on:click={() => (open = !open)}>☷ <span>{$i18n.t('Layout')}</span></button
	>
</div>

<style>
	.chrome-dock {
		position: fixed;
		bottom: calc(4rem + env(safe-area-inset-bottom));
		left: 0.6rem;
		z-index: 45;
	}
	.chrome-trigger,
	.chrome-menu {
		background: rgb(var(--mist-surface-rgb, 255 255 255) / 0.98);
		color: var(--mist-ink, #172334);
		border: 1px solid var(--mist-border, #cbd5e1);
		border-radius: 0.75rem;
		box-shadow: 0 3px 16px #0002;
	}
	.chrome-trigger {
		padding: 0.45rem 0.6rem;
		font-size: 0.75rem;
	}
	.chrome-menu {
		display: grid;
		gap: 0.35rem;
		padding: 0.7rem;
		margin-bottom: 0.5rem;
		min-width: 12rem;
		font-size: 0.85rem;
	}
	.chrome-menu button {
		text-align: left;
		padding: 0.6rem;
		border-radius: 0.5rem;
	}
	.chrome-menu button:hover {
		background: rgb(128 128 128 / 0.15);
	}
	:global(html[data-sidebar-hidden] #sidebar),
	:global(html[data-sidebar-hidden] .owui-sidebar-shell) {
		display: none !important;
	}
	:global(html[data-sidebar-hidden] #main-content > div) {
		max-width: 100% !important;
		width: 100%;
	}
	:global(html[data-topbar-hidden] #main-content [data-page-toolbar]),
	:global(html[data-topbar-hidden] #main-content nav.drag-region),
	:global(html[data-topbar-hidden] #main-content .owui-chat-topbar) {
		display: none !important;
	}
</style>
