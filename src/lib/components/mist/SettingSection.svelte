<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		description?: string;
		class?: string;
		children?: Snippet;
	};

	let { title, description = '', class: className = '', children }: Props = $props();
</script>

<section class={`mist-setting-section ${className}`}>
	<header>
		<h3>{title}</h3>
		{#if description}
			<p>{description}</p>
		{/if}
	</header>
	<div>
		{@render children?.()}
	</div>
</section>
