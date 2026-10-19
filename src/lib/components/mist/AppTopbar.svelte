<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title?: string;
		class?: string;
		leading?: Snippet;
		children?: Snippet;
	};

	let { title = '', class: className = '', leading, children }: Props = $props();
</script>

<header class={`mist-topbar ${className}`}>
	<div class="mist-topbar__leading">
		{@render leading?.()}
	</div>
	<div class="mist-topbar__title">{title}</div>
	<div class="mist-topbar__actions">
		{@render children?.()}
	</div>
</header>
