<script lang="ts">
	type Props = {
		language?: string;
		code: string;
		class?: string;
	};

	let { language = 'text', code, class: className = '' }: Props = $props();

	let copied = $state(false);
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyCode() {
		try {
			await navigator.clipboard.writeText(code);
			copied = true;
			clearTimeout(resetTimer);
			resetTimer = setTimeout(() => {
				copied = false;
			}, 1200);
		} catch {
			copied = false;
		}
	}
</script>

<div class={`mist-code mist-surface mist-surface--reading ${className}`}>
	<div class="mist-code__header">
		<span>{language}</span>
		<button
			type="button"
			class="mist-button mist-button--ghost mist-button--icon mist-focusable"
			aria-label={copied ? 'Copied' : 'Copy code'}
			onclick={copyCode}
		>
			{copied ? 'Copied' : 'Copy'}
		</button>
	</div>
	<pre class="mist-code__body"><code>{code}</code></pre>
</div>
