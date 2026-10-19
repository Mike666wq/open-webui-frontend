<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		class?: string;
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
	};

	let { class: className = '', header, children, footer }: Props = $props();
</script>

<div class={`mist-composer mist-surface mist-surface--control ${className}`}>
	{#if header}
		<div class="mist-composer__header">
			{@render header()}
		</div>
	{/if}
	<div class="mist-composer__body">
		{@render children?.()}
	</div>
	{#if footer}
		<div class="mist-composer__footer">
			{@render footer()}
		</div>
	{/if}
</div>
