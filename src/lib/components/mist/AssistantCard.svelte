<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		class?: string;
		header?: Snippet;
		children?: Snippet;
		actions?: Snippet;
	};

	let { class: className = '', header, children, actions }: Props = $props();
</script>

<div class={`mist-message-row ${className}`}>
	<div class="mist-assistant-card mist-surface mist-surface--content">
		{#if header}
			<div class="mist-assistant-card__header">
				{@render header()}
			</div>
		{/if}
		{@render children?.()}
	</div>
	{#if actions}
		<div class="mist-message-actions">
			{@render actions()}
		</div>
	{/if}
</div>
