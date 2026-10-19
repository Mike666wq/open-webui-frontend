<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		label: string;
		current?: boolean;
		badge?: string;
		class?: string;
		icon?: Snippet;
		onclick?: () => void;
	};

	let { label, current = false, badge, class: className = '', icon, onclick }: Props = $props();
</script>

<button
	type="button"
	{onclick}
	aria-current={current ? 'page' : undefined}
	data-current={current}
	class={`mist-nav-item mist-focusable ${className}`}
>
	{#if icon}
		<span class="mist-nav-item__icon">{@render icon()}</span>
	{/if}
	<span class="mist-nav-item__label">{label}</span>
	{#if badge}
		<span class="mist-nav-item__badge">{badge}</span>
	{/if}
</button>
