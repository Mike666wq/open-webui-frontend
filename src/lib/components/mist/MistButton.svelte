<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';

	type Props = {
		variant?: Variant;
		type?: 'button' | 'submit';
		class?: string;
		disabled?: boolean;
		'aria-label'?: string;
		onclick?: (event: MouseEvent) => void;
		children?: Snippet;
	};

	let {
		variant = 'secondary',
		type = 'button',
		class: className = '',
		disabled = false,
		'aria-label': ariaLabel,
		onclick,
		children
	}: Props = $props();
</script>

<button
	{type}
	{disabled}
	{onclick}
	aria-label={ariaLabel}
	class={`mist-button mist-button--${variant} mist-focusable ${className}`}
>
	{@render children?.()}
</button>
