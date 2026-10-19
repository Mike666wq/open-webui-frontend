<script lang="ts">
	import type { Snippet } from 'svelte';

	type Tone = 'navigation' | 'content' | 'control' | 'reading';

	type Props = {
		tone?: Tone;
		class?: string;
		children?: Snippet;
	};

	let { tone = 'content', class: className = '', children }: Props = $props();
</script>

<div class={`mist-surface mist-surface--${tone} ${className}`}>
	<div class="mist-surface__scrim"></div>
	{@render children?.()}
</div>
