<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	const i18n = getContext<any>('i18n');
	export let editor: any = null;
	let open = false;
	let headings: { level: number; text: string; pos: number }[] = [];
	let currentEditor: any;
	function refresh() {
		const rows: typeof headings = [];
		editor?.state.doc.descendants((node: any, pos: number) => {
			if (node.type.name === 'heading')
				rows.push({ level: node.attrs.level, text: node.textContent, pos });
		});
		headings = rows;
	}
	$: if (currentEditor !== editor) {
		currentEditor?.off('update', refresh);
		currentEditor = editor;
		editor?.on('update', refresh);
		refresh();
	}
	onDestroy(() => currentEditor?.off('update', refresh));
	function jump(pos: number) {
		const element = editor?.view.nodeDOM(pos) as HTMLElement;
		element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		if (element) {
			element.setAttribute('tabindex', '-1');
			element.focus({ preventScroll: true });
		}
		open = false;
	}
</script>

<div class="outline-control">
	<button
		type="button"
		aria-label={$i18n.t('Note outline')}
		aria-expanded={open}
		on:click={() => (open = !open)}>☷ <span>{$i18n.t('Contents')}</span></button
	>
	{#if open}<nav class="outline-popover" aria-label={$i18n.t('Note outline')}>
			<div class="outline-heading">
				<strong>{$i18n.t('Contents')}</strong><button
					aria-label={$i18n.t('Close')}
					on:click={() => (open = false)}>×</button
				>
			</div>
			{#each headings as heading}<button
					style:padding-left={`${0.75 + (heading.level - 1) * 0.8}rem`}
					on:click={() => jump(heading.pos)}>{heading.text || $i18n.t('Untitled')}</button
				>{/each}
			{#if !headings.length}<p>{$i18n.t('Add headings to create an outline.')}</p>{/if}
		</nav>{/if}
</div>

<style>
	.outline-control {
		position: relative;
		flex-shrink: 0;
		font-size: 0.8rem;
	}
	.outline-control > button {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--mist-border, #cbd5e1);
		border-radius: 0.6rem;
	}
	.outline-popover {
		position: absolute;
		top: 100%;
		right: 0;
		width: min(20rem, 85vw);
		max-height: 60dvh;
		overflow: auto;
		background: rgb(var(--mist-surface-rgb, 255 255 255));
		color: var(--mist-ink, #172334);
		border: 1px solid var(--mist-border, #cbd5e1);
		box-shadow: 0 10px 35px #0003;
		padding: 0.5rem;
		border-radius: 0.8rem;
		z-index: 35;
	}
	.outline-heading {
		display: flex;
		justify-content: space-between;
		padding: 0.4rem 0.7rem;
	}
	.outline-popover > button {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.6rem 0.75rem;
		border-radius: 0.5rem;
		overflow-wrap: anywhere;
	}
	.outline-popover > button:hover {
		background: #80808020;
	}
	.outline-popover p {
		padding: 0.8rem;
	}
</style>
