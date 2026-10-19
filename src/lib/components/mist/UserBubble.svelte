<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		class?: string;
		children?: Snippet;
		actions?: Snippet;
	};

	let { class: className = '', children, actions }: Props = $props();
</script>

<div class={`mist-message-row mist-message-row--user ${className}`}>
	<div class="mist-bubble mist-surface mist-surface--content">
		{@render children?.()}
	</div>
	{#if actions}
		<div class="mist-message-actions">
			{@render actions()}
		</div>
	{/if}
</div>
