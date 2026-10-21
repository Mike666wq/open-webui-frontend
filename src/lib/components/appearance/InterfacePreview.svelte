<script lang="ts">
	import AppBackdrop from '$lib/components/mist/AppBackdrop.svelte';
	import UserBubble from '$lib/components/mist/UserBubble.svelte';
	import AssistantCard from '$lib/components/mist/AssistantCard.svelte';
	import CodeSurface from '$lib/components/mist/CodeSurface.svelte';
	import ComposerDock from '$lib/components/mist/ComposerDock.svelte';
	import AppTopbar from '$lib/components/mist/AppTopbar.svelte';
	import type { AppearanceSettings } from '$lib/appearance/schema';

	type Props = {
		settings: AppearanceSettings;
		wallpaperUrl?: string | null;
		/** Width in px of the virtual interface being scaled down. */
		baseWidth?: number;
	};

	let { settings, wallpaperUrl = null, baseWidth = 980 }: Props = $props();

	let frame: HTMLDivElement | null = $state(null);
	let frameWidth = $state(0);
	let frameHeight = $state(0);

	$effect(() => {
		if (!frame) return;
		const observer = new ResizeObserver((entries) => {
			frameWidth = entries[0].contentRect.width;
			frameHeight = entries[0].contentRect.height;
		});
		observer.observe(frame);
		return () => observer.disconnect();
	});

	const scale = $derived(frameWidth > 0 ? frameWidth / baseWidth : 1);
	const scaledHeight = $derived(frameHeight > 0 && scale > 0 ? frameHeight / scale : 0);
	const code = 'kubectl get pods -A\n# check listening ports\nss -tlnp | grep 8080';
</script>

<div bind:this={frame} class="interface-preview" aria-hidden="true">
	<div
		class="interface-preview__canvas"
		style:width={`${baseWidth}px`}
		style:height={scaledHeight > 0 ? `${scaledHeight}px` : '100%'}
		style:transform={`scale(${scale})`}
	>
		<AppBackdrop
			variant={wallpaperUrl ? 'wallpaper' : 'gradient'}
			{settings}
			{wallpaperUrl}
			interactive={false}
		/>

		<div class="interface-preview__ui">
			<AppTopbar title="Mist Glass">
				{#snippet leading()}
					<span class="ip-icon" aria-hidden="true">☰</span>
				{/snippet}
				<span class="ip-icon" aria-hidden="true">⚙</span>
			</AppTopbar>

			<main class="interface-preview__messages">
				<UserBubble>
					<p>帮我看一下这个服务为什么连不上？</p>
				</UserBubble>
				<AssistantCard>
					{#snippet header()}
						<span>deepseek-v4.1-flash</span>
						<span>·</span>
					{/snippet}
					<p>先看监听和端口是否正常：</p>
					<CodeSurface language="bash" {code} />
				</AssistantCard>
			</main>

			<div class="interface-preview__composer">
				<ComposerDock>
					{#snippet header()}
						<span class="ip-chip">deepseek-v4.1-flash</span>
					{/snippet}
					<div class="ip-input">有什么我能帮您的吗？</div>
				</ComposerDock>
			</div>
		</div>
	</div>
</div>

<style>
	.interface-preview {
		position: relative;
		width: 100%;
		overflow: hidden;
		border: 1px solid var(--mist-border);
		border-radius: 14px;
		background: rgb(7 11 20 / 0.3);
		aspect-ratio: 16 / 9.5;
	}

	.interface-preview__canvas {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: top left;
	}

	.interface-preview__ui {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.interface-preview__messages {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px 20px;
		overflow: hidden;
	}

	.interface-preview__composer {
		padding: 0 20px 16px;
	}

	.ip-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 8px;
		color: var(--mist-muted);
	}

	.ip-chip {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 999px;
		border: 1px solid var(--mist-border);
		color: var(--mist-muted);
		font-size: 11px;
	}

	.ip-input {
		color: var(--mist-muted);
		font-size: 13px;
		padding: 4px 2px;
	}

	.interface-preview :global(.mist-assistant-card),
	.interface-preview :global(.mist-bubble),
	.interface-preview :global(.mist-composer),
	.interface-preview :global(.mist-code) {
		font-size: 12px;
	}

	.interface-preview :global(.mist-topbar) {
		padding: 8px 14px;
	}
</style>
