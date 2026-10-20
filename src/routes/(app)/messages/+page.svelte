<script lang="ts">
	import { goto } from '$app/navigation';
	import { getContext, onDestroy } from 'svelte';
	import { getChannelMessages, getChannels } from '$lib/apis/channels';
	import { getDMChannelByUserId } from '$lib/apis/channels';
	import { user, channels, mobile, config as configStore } from '$lib/stores';
	import { toast } from 'svelte-sonner';
	import {
		enrichDmChannels,
		hasDirectoryLoaded,
		loadMoreMembers,
		resetMemberDirectory,
		setMemberDirectoryQuery,
		setVisibleMemberIds,
		subscribeMembers
	} from '$lib/messaging/members';
	import {
		channelDate,
		channelImage,
		channelSubtitle,
		channelTitle,
		isCurrentMemberActive,
		memberImage,
		messagePreview,
		sortChannels,
		truncateText
	} from '$lib/messaging/model';
	import type { DirectoryUser, MessageChannel } from '$lib/messaging/types';

	const i18n = getContext<any>('i18n');
	const config = configStore as any;

	type Tab = 'all' | 'channels' | 'dm' | 'members';

	let tab = $state<Tab>('all');
	let query = $state('');
	let channelRows = $state<MessageChannel[]>([]);
	let directoryUsers = $state<DirectoryUser[]>([]);
	let directoryLoading = $state(false);
	let directoryHasMore = $state(false);
	let loading = $state(true);
	let error = $state('');
	let openingUserId = $state<string | null>(null);
	let unsubscribe: (() => void) | null = null;
	let memberListElement = $state<HTMLUListElement | null>(null);
	const previewRequests = new Set<string>();

	let channelServerEnabled = $state(false);
	let memberCanAccessChannels = $state(false);
	$effect(() => {
		channelServerEnabled = $user?.role === 'admin' || !!$config?.features?.enable_channels;
		memberCanAccessChannels =
			$user?.role === 'admin' || ($user?.permissions?.features?.channels ?? true);
	});
	const channelEnabled = $derived(channelServerEnabled && memberCanAccessChannels);

	const totalUnread = $derived(channelRows.reduce((sum, row) => sum + (row.unread_count ?? 0), 0));

	const filteredRows = $derived.by(() => {
		const normalized = query.trim().toLowerCase();
		const typeFilter = tab === 'channels' ? ['group', ''] : tab === 'dm' ? ['dm'] : null;
		return sortChannels(channelRows).filter((row) => {
			if (typeFilter && !typeFilter.includes(row.type ?? '')) return false;
			if (!normalized) return true;
			return (
				channelTitle(row, $user?.id).toLowerCase().includes(normalized) ||
				channelSubtitle(row, $user?.id).toLowerCase().includes(normalized)
			);
		});
	});

	const filteredMembers = $derived.by(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return directoryUsers;
		return directoryUsers.filter(
			(member) =>
				member.name?.toLowerCase().includes(normalized) ||
				member.status_message?.toLowerCase().includes(normalized)
		);
	});

	$effect(() => {
		if (!channelEnabled) {
			error = $i18n.t('Channels are not enabled on this server.');
			loading = false;
			return;
		}
		void refresh();
	});

	$effect(() => {
		if (!channelEnabled || !localStorage.token) return;
		unsubscribe?.();
		unsubscribe = subscribeMembers(localStorage.token, $user?.id ?? null, (users, meta) => {
			directoryUsers = users;
			directoryLoading = meta.loading;
			directoryHasMore = meta.hasMore;
			if (hasDirectoryLoaded()) enrichDmChannels(channelRows);
		});
		return () => {
			unsubscribe?.();
			unsubscribe = null;
		};
	});

	$effect(() => {
		if (!channelEnabled || !localStorage.token) return;
		setMemberDirectoryQuery(localStorage.token, $user?.id ?? null, tab === 'members' ? query : '');
	});

	$effect(() => {
		if (tab !== 'members' || !memberListElement) {
			setVisibleMemberIds([]);
			return;
		}
		// Rebuild observations whenever the loaded page changes.
		void directoryUsers.length;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.map((entry) => (entry.target as HTMLElement).dataset.memberId)
					.filter((id): id is string => !!id);
				setVisibleMemberIds(visible);
			},
			{ rootMargin: '120px 0px' }
		);
		memberListElement
			.querySelectorAll<HTMLElement>('[data-member-id]')
			.forEach((element) => observer.observe(element));
		return () => observer.disconnect();
	});

	onDestroy(() => {
		unsubscribe?.();
		resetMemberDirectory();
	});

	async function refresh() {
		if (!channelEnabled) return;
		loading = true;
		error = '';
		try {
			const rows = ((await getChannels(localStorage.token)) ?? []) as MessageChannel[];
			channelRows = rows ?? [];
			if (!rows) error = 'Unable to load message channels.';
			if (hasDirectoryLoaded()) enrichDmChannels(channelRows);
			void loadChannelPreviews(channelRows);
			channels.set(
				sortChannels(channelRows).map((row) => ({
					...row,
					type: row.type ?? null,
					is_channel_muted: !!row.is_channel_muted,
					unread_count: row.unread_count ?? 0,
					last_message_at: row.last_message_at ?? null
				}))
			);
		} catch (loadError) {
			error = String(loadError);
		} finally {
			loading = false;
		}
	}

	async function loadChannelPreviews(rows: MessageChannel[]) {
		const visibleRows = sortChannels(rows)
			.filter((row) => row.last_message_at && !row.last_message)
			.slice(0, 12);
		await Promise.allSettled(
			visibleRows.map(async (row) => {
				if (previewRequests.has(row.id)) return;
				previewRequests.add(row.id);
				try {
					const messages = await getChannelMessages(localStorage.token, row.id, 0, 1);
					const latest = Array.isArray(messages) ? messages[0] : null;
					if (!latest) return;
					channelRows = channelRows.map((channel) =>
						channel.id === row.id ? { ...channel, last_message: messagePreview(latest) } : channel
					);
				} catch {
					// The channel still remains usable when its summary cannot be loaded.
				} finally {
					previewRequests.delete(row.id);
				}
			})
		);
	}

	async function openDirectMessage(member: DirectoryUser) {
		if (openingUserId) return;
		openingUserId = member.id;
		try {
			const channel = await getDMChannelByUserId(localStorage.token, member.id);
			if (!channel?.id) throw new Error('Unable to open this private chat.');
			await goto(`/channels/${channel.id}`);
		} catch (openError) {
			toast.error(String(openError));
		} finally {
			openingUserId = null;
		}
	}

	function setStatusColor(member?: DirectoryUser) {
		if (!member || member.is_active === null || member.is_active === undefined) return 'unknown';
		return isCurrentMemberActive(member) ? 'active' : 'away';
	}
</script>

<svelte:head>
	<title>Messages / Open WebUI</title>
</svelte:head>

<div class="mist-messages" data-mobile={$mobile ? 'true' : 'false'}>
	<header class="mist-messages__header">
		<div>
			<p class="mist-messages__eyebrow">Messages</p>
			<h1 class="mist-messages__title">
				{tab === 'members' ? $i18n.t('Members') : $i18n.t('Messages')}
				{#if tab !== 'members'}
					<span class="mist-messages__count">{totalUnread}</span>
				{/if}
			</h1>
		</div>
		<button
			class="mist-refresh mist-focusable"
			type="button"
			onclick={refresh}
			aria-label="Refresh messages"
		>
			Refresh
		</button>
	</header>

	<div class="mist-messages__tabs" role="tablist" aria-label="Message categories">
		{#each [['all', 'All'], ['dm', 'Private'], ['channels', 'Channels'], ['members', 'Members']] as [value, label] (value)}
			<button
				type="button"
				role="tab"
				aria-selected={tab === value}
				class="mist-messages__tab mist-focusable"
				class:mist-messages__tab--current={tab === value}
				onclick={() => (tab = value as Tab)}
			>
				{label}
			</button>
		{/each}
	</div>

	<label class="mist-messages__search">
		<span class="sr-only">Search messages or members</span>
		<input
			type="search"
			bind:value={query}
			placeholder={tab === 'members' ? 'Search members' : 'Search messages'}
			aria-label={tab === 'members' ? 'Search members' : 'Search messages'}
		/>
	</label>

	{#if !channelEnabled}
		<section class="mist-messages__empty" aria-live="polite">
			<h2>Messages are unavailable</h2>
			<p>{error}</p>
		</section>
	{:else if loading && !channelRows.length}
		<div class="mist-messages__state">Loading messages...</div>
	{:else if tab === 'members'}
		<ul bind:this={memberListElement} class="mist-messages__list" aria-label="Directory members">
			{#each filteredMembers as member (member.id)}
				<li
					class="mist-member mist-focusable"
					data-member-id={member.id}
					data-status={setStatusColor(member)}
				>
					<img src={memberImage(member) ?? '/static/favicon.png'} alt="" loading="lazy" />
					<div class="mist-member__body">
						<div class="mist-member__name">
							{member.name || 'Unnamed member'}
							{#if member.status_emoji}<span aria-hidden="true">{member.status_emoji}</span>{/if}
						</div>
						<p class="mist-member__status">
							{member.is_active === undefined || member.is_active === null
								? 'Status unavailable'
								: member.is_active
									? 'Recently active'
									: 'Not recently active'}
							{#if member.status_message}<span> · {member.status_message}</span>{/if}
						</p>
					</div>
					<button
						type="button"
						class="mist-member__action mist-focusable"
						disabled={openingUserId === member.id}
						onclick={() => openDirectMessage(member)}
					>
						{openingUserId === member.id ? 'Opening...' : 'Message'}
					</button>
				</li>
			{:else}
				<li class="mist-messages__state">
					{directoryLoading ? 'Loading members...' : 'No members found'}
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="mist-messages__list" aria-label="Message channels">
			{#each filteredRows as row (row.id)}
				<li>
					<a class="mist-message-row-card mist-focusable" href={`/channels/${row.id}`}>
						<img
							src={channelImage(row, $user?.id) ?? '/static/favicon.png'}
							alt=""
							loading="lazy"
						/>
						<div class="min-w-0 flex-1">
							<div class="mist-message-row-card__top">
								<span class="mist-message-row-card__title">{channelTitle(row, $user?.id)}</span>
								{#if channelDate(row)}
									<time>{channelDate(row)?.toLocaleString()}</time>
								{/if}
							</div>
							<div class="mist-message-row-card__bottom">
								<span
									>{truncateText(
										messagePreview(row.last_message) || channelSubtitle(row, $user?.id)
									)}</span
								>
								{#if (row.unread_count ?? 0) > 0}
									<span class="mist-message-row-card__unread">{row.unread_count}</span>
								{/if}
							</div>
						</div>
					</a>
				</li>
			{:else}
				<li class="mist-messages__state">No conversations here yet</li>
			{/each}
		</ul>
		{#if directoryHasMore}
			<button
				type="button"
				class="mist-messages__load-more mist-focusable"
				disabled={directoryLoading}
				onclick={() => loadMoreMembers(localStorage.token, $user?.id ?? null)}
			>
				{directoryLoading ? 'Loading...' : 'Load more members'}
			</button>
		{/if}
	{/if}

	{#if error && channelEnabled}
		<p class="mist-messages__error" role="alert">{error}</p>
	{/if}
</div>
