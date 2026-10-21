<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { toast } from 'svelte-sonner';
	import { user } from '$lib/stores';

	const i18n: Writable<any> = getContext('i18n');

	type RecycleItem = {
		id: string;
		type: string;
		title: string;
		size_bytes: number;
		deleted_at: number;
		expires_at: number;
		meta?: Record<string, any>;
	};

	type ResourceStats = {
		chats: number;
		files: number;
		notes: number;
		knowledge: number;
		total_bytes: number;
		recycled_count: number;
		recycled_bytes: number;
	};

	let stats: ResourceStats | null = null;
	let recycleBin: RecycleItem[] = [];
	let loading = false;
	let activeSection: 'overview' | 'recycle' = 'overview';

	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
	};

	const formatDate = (timestamp: number): string => {
		return new Date(timestamp * 1000).toLocaleString();
	};

	const loadData = async () => {
		loading = true;
		try {
			const [statsRes, recycleRes] = await Promise.all([
				fetch('/api/v1/resources/overview', {
					headers: { Authorization: `Bearer ${localStorage.token}` }
				}),
				fetch('/api/v1/resources/recycle-bin', {
					headers: { Authorization: `Bearer ${localStorage.token}` }
				})
			]);

			if (statsRes.ok) {
				stats = await statsRes.json();
			}
			if (recycleRes.ok) {
				recycleBin = await recycleRes.json();
			}
		} catch (error) {
			console.error('Failed to load resource data:', error);
			toast.error($i18n.t('Failed to load resource data'));
		} finally {
			loading = false;
		}
	};

	const restoreItem = async (item: RecycleItem) => {
		try {
			const res = await fetch('/api/v1/resources/restore', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${localStorage.token}`
				},
				body: JSON.stringify({
					ids: [item.id],
					type: item.type
				})
			});

			if (res.ok) {
				toast.success($i18n.t('Item restored'));
				await loadData();
			} else {
				toast.error($i18n.t('Failed to restore item'));
			}
		} catch (error) {
			console.error('Failed to restore item:', error);
			toast.error($i18n.t('Failed to restore item'));
		}
	};

	const permanentDelete = async (item: RecycleItem) => {
		if (!confirm($i18n.t('Permanently delete this item? This cannot be undone.'))) {
			return;
		}

		try {
			const res = await fetch('/api/v1/resources/delete', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${localStorage.token}`
				},
				body: JSON.stringify({
					ids: [item.id],
					type: item.type,
					permanent: true
				})
			});

			if (res.ok) {
				toast.success($i18n.t('Item permanently deleted'));
				await loadData();
			} else {
				toast.error($i18n.t('Failed to delete item'));
			}
		} catch (error) {
			console.error('Failed to delete item:', error);
			toast.error($i18n.t('Failed to delete item'));
		}
	};

	onMount(() => {
		loadData();
	});
</script>

<div class="flex flex-col h-full">
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-lg font-semibold">{$i18n.t('Resources & Storage')}</h2>
		<button
			class="px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
			on:click={loadData}
			disabled={loading}
		>
			{$i18n.t('Refresh')}
		</button>
	</div>

	<!-- Section tabs -->
	<div class="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700">
		<button
			class="px-3 py-2 text-sm font-medium border-b-2 transition {activeSection === 'overview'
				? 'border-blue-500 text-blue-600 dark:text-blue-400'
				: 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}"
			on:click={() => (activeSection = 'overview')}
		>
			{$i18n.t('Overview')}
		</button>
		<button
			class="px-3 py-2 text-sm font-medium border-b-2 transition {activeSection === 'recycle'
				? 'border-blue-500 text-blue-600 dark:text-blue-400'
				: 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}"
			on:click={() => (activeSection = 'recycle')}
		>
			{$i18n.t('Recycle Bin')}
			{#if stats && stats.recycled_count > 0}
				<span class="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-700">
					{stats.recycled_count}
				</span>
			{/if}
		</button>
	</div>

	{#if loading && !stats}
		<div class="flex items-center justify-center py-12">
			<div class="text-gray-500 dark:text-gray-400">{$i18n.t('Loading...')}</div>
		</div>
	{:else if activeSection === 'overview'}
		<!-- Overview section -->
		<div class="space-y-4">
			<div class="grid grid-cols-2 gap-4">
				<div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
					<div class="text-sm text-gray-600 dark:text-gray-400">{$i18n.t('Chats')}</div>
					<div class="text-2xl font-semibold mt-1">{stats?.chats ?? 0}</div>
				</div>
				<div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
					<div class="text-sm text-gray-600 dark:text-gray-400">{$i18n.t('Files')}</div>
					<div class="text-2xl font-semibold mt-1">{stats?.files ?? 0}</div>
				</div>
				<div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
					<div class="text-sm text-gray-600 dark:text-gray-400">{$i18n.t('Notes')}</div>
					<div class="text-2xl font-semibold mt-1">{stats?.notes ?? 0}</div>
				</div>
				<div class="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50">
					<div class="text-sm text-gray-600 dark:text-gray-400">{$i18n.t('Knowledge')}</div>
					<div class="text-2xl font-semibold mt-1">{stats?.knowledge ?? 0}</div>
				</div>
			</div>

			<div class="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
				<div class="flex items-center justify-between">
					<div>
						<div class="text-sm font-medium text-blue-900 dark:text-blue-100">
							{$i18n.t('Total Storage')}
						</div>
						<div class="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
							{$i18n.t('Files and attachments')}
						</div>
					</div>
					<div class="text-xl font-semibold text-blue-900 dark:text-blue-100">
						{formatBytes(stats?.total_bytes ?? 0)}
					</div>
				</div>
			</div>

			{#if stats && stats.recycled_count > 0}
				<div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
					<div class="flex items-center justify-between">
						<div>
							<div class="text-sm font-medium text-amber-900 dark:text-amber-100">
								{$i18n.t('Recycle Bin')}
							</div>
							<div class="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
								{$i18n.t('Items will be permanently deleted after 7 days')}
							</div>
						</div>
						<div class="text-right">
							<div class="text-lg font-semibold text-amber-900 dark:text-amber-100">
								{stats.recycled_count} {$i18n.t('items')}
							</div>
							<div class="text-xs text-amber-700 dark:text-amber-300">
								{formatBytes(stats.recycled_bytes)}
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Recycle bin section -->
		<div class="flex-1 overflow-y-auto">
			{#if recycleBin.length === 0}
				<div class="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
					<svg class="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
					</svg>
					<div class="text-sm">{$i18n.t('Recycle bin is empty')}</div>
				</div>
			{:else}
				<div class="space-y-2">
					{#each recycleBin as item (item.id)}
						<div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
							<div class="flex items-start justify-between gap-3">
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
											{item.type}
										</span>
										<span class="text-xs text-gray-500 dark:text-gray-400">
											{formatBytes(item.size_bytes)}
										</span>
									</div>
									<div class="font-medium mt-1 truncate">{item.title}</div>
									<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
										{$i18n.t('Deleted')}: {formatDate(item.deleted_at)}
										<br />
										{$i18n.t('Expires')}: {formatDate(item.expires_at)}
									</div>
								</div>
								<div class="flex gap-2">
									<button
										class="px-2 py-1 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition"
										on:click={() => restoreItem(item)}
									>
										{$i18n.t('Restore')}
									</button>
									<button
										class="px-2 py-1 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition"
										on:click={() => permanentDelete(item)}
									>
										{$i18n.t('Delete')}
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
