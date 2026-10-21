<script lang="ts">
	import { onMount } from 'svelte';
	import { scrollableX } from '$lib/actions/scrollableX';
	// Horizontal settings tab strip: arrows + the shared scrollableX action
	// (wheel pan, mouse drag, edge fades). Vertical (md+) mode is untouched.
	export let previousLabel = 'Previous settings';
	export let nextLabel = 'More settings';
	let track: HTMLDivElement;
	let previous = false;
	let next = false;
	let horizontal = true;
	function update() {
		if (!track) return;
		horizontal = getComputedStyle(track).flexDirection === 'row';
		previous = horizontal && track.scrollLeft > 2;
		next = horizontal && track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
	}
	function move(direction: number) {
		track.scrollBy({
			left: direction * Math.max(160, track.clientWidth * 0.7),
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		});
	}
	onMount(() => {
		const observer = new ResizeObserver(update);
		observer.observe(track);
		const changes = new MutationObserver(update);
		changes.observe(track, { childList: true, subtree: true });
		track.addEventListener('scroll', update, { passive: true });
		update();
		return () => {
			observer.disconnect();
			changes.disconnect();
			track.removeEventListener('scroll', update);
		};
	});
</script>

<div class="settings-rail" class:horizontal>
	{#if horizontal && (previous || next)}
		<button class="rail-arrow" type="button" disabled={!previous} aria-label={previousLabel} title={previousLabel} on:click={() => move(-1)}>‹</button>
	{/if}
	<div
		class="tabs settings-rail__track"
		bind:this={track}
		use:scrollableX
	>
		<slot />
	</div>
	{#if horizontal && (previous || next)}
		<button class="rail-arrow" type="button" disabled={!next} aria-label={nextLabel} title={nextLabel} on:click={() => move(1)}>›</button>
	{/if}
</div>

<style>
	.settings-rail { display:flex; min-width:0; min-height:0; flex:1; align-items:stretch; gap:3px; }
	.settings-rail__track { display:flex; flex-direction:row; flex:1; min-width:0; min-height:0; gap:3px; overflow-x:auto; overflow-y:hidden; padding:5px 2px 8px; scrollbar-width:thin; scrollbar-color:rgb(var(--mist-surface-rgb) / .35) transparent; overscroll-behavior-x:contain; touch-action:pan-x; }
	.horizontal .settings-rail__track { cursor:grab; }
	.horizontal .settings-rail__track:global(.is-dragging-x) { cursor:grabbing; }
	.rail-arrow { align-self:center; display:grid; place-items:center; min-width:30px; height:36px; border-radius:10px; background:var(--mist-highlight, #94a3b81a); color:var(--mist-ink); font-size:24px; flex-shrink:0; }
	.rail-arrow:disabled { opacity:.25; }
	.rail-arrow:focus-visible { outline:2px solid var(--mist-accent); }
	@media(min-width:768px) { .settings-rail__track { flex-direction:column; overflow-y:auto; overflow-x:hidden; touch-action:pan-y; padding:4px; } }
</style>
