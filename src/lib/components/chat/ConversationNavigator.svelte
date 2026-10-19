<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import MistDrawer from '$lib/components/mist/MistDrawer.svelte';
	import { directoryEnabled } from '$lib/appearance';
	import {
		filterNavigatorEntries,
		messageElementId,
		nextNavigatorSelection
	} from '$lib/appearance/navigator';
	import { mobile, showControls } from '$lib/stores';
	import {
		closeNavigator,
		navigatorOpen,
		navigatorSession,
		setNavigatorCurrent,
		toggleNavigator
	} from '$lib/stores/navigator';

	const i18n = getContext<any>('i18n');
	const zh = $derived(
		String($i18n.language ?? '')
			.toLowerCase()
			.startsWith('zh')
	);
	const copy = (chinese: string, english: string) => (zh ? chinese : english);
	let query = $state('');
	let selectedId = $state<string | null>(null);
	let listElement: HTMLDivElement | null = $state(null);
	let scrollFrame = 0;

	const visibleEntries = $derived(filterNavigatorEntries($navigatorSession.entries, query));
	const canShow = $derived(
		$directoryEnabled && $navigatorSession.entries.length > 0 && !$showControls
	);
	const canShowDesktopRail = $derived(canShow && $navigatorSession.entries.length >= 2 && !$mobile);

	$effect(() => {
		if ($navigatorOpen) {
			query = '';
			selectedId =
				$navigatorSession.entries.find((entry) => entry.isCurrent)?.id ??
				$navigatorSession.entries[0]?.id ??
				null;
		}
	});

	$effect(() => {
		if (!visibleEntries.some((entry) => entry.id === selectedId)) {
			selectedId = visibleEntries[0]?.id ?? null;
		}
	});

	onMount(() => {
		const container = document.getElementById('messages-container');
		const onScroll = () => {
			if (scrollFrame) cancelAnimationFrame(scrollFrame);
			scrollFrame = requestAnimationFrame(updateCurrentFromViewport);
		};
		container?.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			container?.removeEventListener('scroll', onScroll);
			if (scrollFrame) cancelAnimationFrame(scrollFrame);
		};
	});

	function updateCurrentFromViewport() {
		const container = document.getElementById('messages-container');
		const session = $navigatorSession;
		if (!container || !session.entries.length) return;
		const containerRect = container.getBoundingClientRect();
		const line = containerRect.top + Math.min(containerRect.height * 0.35, 260);
		let closest = session.entries[0];
		let closestDistance = Number.POSITIVE_INFINITY;
		for (const entry of session.entries) {
			const element = document.getElementById(messageElementId(entry.id));
			if (!element) continue;
			const distance = Math.abs(element.getBoundingClientRect().top - line);
			if (distance < closestDistance) {
				closest = entry;
				closestDistance = distance;
			}
		}
		if (!closest.isCurrent) {
			setNavigatorCurrent(session, closest.id);
		}
	}

	function jumpTo(id: string) {
		const container = document.getElementById('messages-container');
		const target = document.getElementById(messageElementId(id));
		if (!container || !target) return;
		const containerRect = container.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const top = container.scrollTop + targetRect.top - containerRect.top - 18;
		const reduceMotion =
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		container.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
		setNavigatorCurrent($navigatorSession, id);
		selectedId = id;
		closeNavigator();
	}

	function handleKeys(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			selectedId = nextNavigatorSelection(
				visibleEntries,
				selectedId,
				event.key === 'ArrowDown' ? 1 : -1
			);
			const selected = listElement?.querySelector<HTMLElement>(
				`[data-navigator-id="${CSS.escape(selectedId ?? '')}"]`
			);
			selected?.focus();
			return;
		}
		if (event.key === 'Enter' && selectedId) {
			event.preventDefault();
			jumpTo(selectedId);
			return;
		}
		if (event.key === 'Escape' && !$mobile) {
			event.preventDefault();
			closeNavigator();
			document.getElementById('conversation-navigator-button')?.focus();
		}
	}
</script>

{#snippet navigatorList()}
	<div class="mist-conversation-nav__tools">
		<label class="mist-conversation-nav__search">
			<span aria-hidden="true">⌕</span>
			<input
				type="search"
				bind:value={query}
				placeholder={copy('筛选提问…', 'Filter questions…')}
				aria-label={copy('筛选提问', 'Filter questions')}
				onkeydown={handleKeys}
			/>
		</label>
		<span class="mist-conversation-nav__count">
			{visibleEntries.length}/{$navigatorSession.entries.length}
		</span>
	</div>
	<p class="mist-conversation-nav__scope">
		{copy('仅包含已加载消息', 'Loaded messages only')}
	</p>
	<div
		class="mist-conversation-nav__list"
		role="listbox"
		aria-label={copy('对话提问目录', 'Conversation questions')}
		tabindex="-1"
		bind:this={listElement}
		onkeydown={handleKeys}
	>
		{#each visibleEntries as entry (entry.id)}
			<button
				type="button"
				role="option"
				aria-selected={entry.isCurrent}
				class="mist-conversation-nav__item"
				data-current={entry.isCurrent}
				data-selected={selectedId === entry.id}
				data-navigator-id={entry.id}
				onfocus={() => (selectedId = entry.id)}
				onclick={() => jumpTo(entry.id)}
			>
				<span class="mist-conversation-nav__ordinal">{entry.ordinal}</span>
				<span>{entry.preview}</span>
			</button>
		{/each}
		{#if visibleEntries.length === 0}
			<p class="mist-conversation-nav__empty">
				{copy('没有匹配的提问', 'No questions match this filter')}
			</p>
		{/if}
	</div>
{/snippet}

{#if canShowDesktopRail}
	<aside
		class="mist-conversation-nav"
		data-expanded={$navigatorOpen}
		aria-label={copy('对话导航', 'Conversation navigator')}
	>
		<button
			type="button"
			class="mist-conversation-nav__toggle"
			aria-label={$navigatorOpen
				? copy('收起对话目录', 'Collapse conversation navigator')
				: copy('展开对话目录', 'Open conversation navigator')}
			aria-expanded={$navigatorOpen}
			onclick={toggleNavigator}
			onkeydown={handleKeys}
		>
			<span class="mist-conversation-nav__ticks" aria-hidden="true">
				{#each $navigatorSession.entries.slice(0, 12) as entry}
					<i data-current={entry.isCurrent}></i>
				{/each}
			</span>
			<span class="mist-conversation-nav__toggle-label">
				{copy('对话目录', 'Conversation')}
			</span>
		</button>
		<div class="mist-conversation-nav__body">
			{@render navigatorList()}
		</div>
	</aside>
{/if}

{#if $mobile}
	<MistDrawer
		open={$navigatorOpen}
		side="bottom"
		title={copy('对话目录', 'Conversation navigator')}
		belowTopbar
		onclose={closeNavigator}
	>
		{#snippet overlay()}
			<button
				type="button"
				class="mist-navigator-close-toggle"
				aria-label={copy('关闭对话目录', 'Close conversation navigator')}
				onclick={closeNavigator}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M5 6h.01M9 6h10M5 12h.01M9 12h10M5 18h.01M9 18h7" />
				</svg>
			</button>
		{/snippet}
		{@render navigatorList()}
		{#snippet footer()}
			<span class="mist-conversation-nav__footer">
				{copy('点击只定位当前已加载的消息', 'Jump only to currently loaded messages')}
			</span>
			<button type="button" class="mist-button mist-button--secondary" onclick={closeNavigator}>
				{copy('关闭', 'Close')}
			</button>
		{/snippet}
	</MistDrawer>
{/if}

<style>
	.mist-conversation-nav {
		position: fixed;
		top: 76px;
		right: 12px;
		z-index: 18;
		display: flex;
		width: 48px;
		max-height: calc(100dvh - 168px);
		flex-direction: column;
		border: 1px solid var(--mist-border);
		border-radius: var(--mist-navigation-radius);
		background: rgb(var(--mist-surface-rgb) / var(--mist-navigation-alpha));
		backdrop-filter: blur(var(--mist-navigation-blur)) saturate(1.06);
		box-shadow:
			inset 0 1px 0 var(--mist-highlight),
			0 12px 36px var(--mist-shadow);
		color: var(--mist-ink);
		overflow: hidden;
		transition: width var(--mist-duration-base) var(--mist-ease);
	}

	.mist-navigator-close-toggle {
		position: fixed;
		top: calc(env(safe-area-inset-top) + 3px);
		right: 128px;
		z-index: 3;
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		border: 1px solid var(--mist-border);
		border-radius: 14px;
		background: rgb(var(--mist-surface-rgb) / var(--mist-navigation-alpha));
		backdrop-filter: blur(var(--mist-navigation-blur)) saturate(1.08);
		box-shadow:
			inset 0 1px 0 var(--mist-highlight),
			0 8px 24px var(--mist-shadow);
		color: var(--mist-ink);
	}

	.mist-navigator-close-toggle svg {
		width: 18px;
		height: 18px;
	}

	.mist-conversation-nav[data-expanded='true'] {
		width: min(290px, calc(100vw - 24px));
	}

	.mist-conversation-nav__toggle {
		display: flex;
		min-height: 48px;
		align-items: center;
		gap: 10px;
		border: 0;
		background: transparent;
		padding: 0 13px;
		color: var(--mist-ink);
	}

	.mist-conversation-nav__ticks {
		display: grid;
		width: 18px;
		flex: 0 0 18px;
		place-items: center;
		gap: 2px;
	}

	.mist-conversation-nav__ticks i {
		display: block;
		width: 13px;
		height: 1px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--mist-muted) 48%, transparent);
	}

	.mist-conversation-nav__ticks i:nth-child(3n) {
		width: 19px;
	}

	.mist-conversation-nav__ticks i[data-current='true'] {
		height: 3px;
		width: 22px;
		background: var(--mist-accent);
	}

	.mist-conversation-nav__toggle-label {
		color: var(--mist-muted);
		font-size: 12px;
		font-weight: 650;
		opacity: 0;
		white-space: nowrap;
	}

	.mist-conversation-nav[data-expanded='true'] .mist-conversation-nav__toggle-label {
		opacity: 1;
	}

	.mist-conversation-nav__body {
		display: none;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		border-top: 1px solid var(--mist-border);
		padding: 9px;
	}

	.mist-conversation-nav[data-expanded='true'] .mist-conversation-nav__body {
		display: flex;
	}

	.mist-conversation-nav__tools {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.mist-conversation-nav__search {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--mist-border);
		border-radius: 9px;
		background: rgb(var(--mist-reading-rgb) / 0.56);
		padding: 0 8px;
		color: var(--mist-muted);
	}

	.mist-conversation-nav__search input {
		min-width: 0;
		width: 100%;
		height: 34px;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--mist-ink);
		font-size: 12px;
	}

	.mist-conversation-nav__count {
		color: var(--mist-muted);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.mist-conversation-nav__scope {
		margin: 7px 2px 8px;
		color: var(--mist-muted);
		font-size: 10px;
	}

	.mist-conversation-nav__list {
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}

	.mist-conversation-nav__item {
		display: grid;
		grid-template-columns: 23px minmax(0, 1fr);
		width: 100%;
		min-height: var(--owui-navigation-min-height);
		align-items: start;
		gap: 7px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		padding: 8px 7px;
		color: var(--mist-muted);
		text-align: left;
		line-height: 1.35;
	}

	.mist-conversation-nav__item:hover,
	.mist-conversation-nav__item[data-selected='true'] {
		background: rgb(var(--mist-surface-rgb) / 0.1);
		color: var(--mist-ink);
	}

	.mist-conversation-nav__item[data-current='true'] {
		background: color-mix(in srgb, var(--mist-accent) 10%, transparent);
		color: var(--mist-ink);
	}

	.mist-conversation-nav__ordinal {
		display: inline-grid;
		width: 21px;
		height: 21px;
		place-items: center;
		border-radius: 7px;
		background: rgb(var(--mist-reading-rgb) / 0.7);
		color: var(--mist-muted);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	.mist-conversation-nav__item[data-current='true'] .mist-conversation-nav__ordinal {
		background: var(--mist-accent);
		color: var(--mist-accent-contrast);
	}

	.mist-conversation-nav__empty {
		padding: 18px 8px;
		color: var(--mist-muted);
		font-size: 11px;
		text-align: center;
	}

	.mist-conversation-nav__footer {
		margin-right: auto;
		color: var(--mist-muted);
		font-size: 10px;
	}
</style>
