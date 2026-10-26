<script lang="ts">
	import { onMount } from 'svelte';
	import { user } from '$lib/stores';
	import { getProviderCalls } from '$lib/apis/providers';
	export let connectionId = '';
	export let chatId = '';
	export let messageId = '';
	let rows: any[] = [];
	let summaries: any[] = [];
	let error = '';
	let loading = true;
	let summary = false;
	let groupBy = 'model_id';
	let groups: any[] = [];
	$: {
		const values = new Map<string, any>();
		for (const row of summaries) {
			const key = row[groupBy] || '未知';
			const item = values.get(key) || {
				key,
				count: 0,
				input: 0,
				output: 0,
				inputReported: 0,
				outputReported: 0
			};
			item.count += row.count;
			item.input += row.input_tokens ?? 0;
			item.output += row.output_tokens ?? 0;
			item.inputReported += row.input_reported;
			item.outputReported += row.output_reported;
			values.set(key, item);
		}
		groups = [...values.values()];
	}
	async function load() {
		loading = true;
		error = '';
		try {
			const result = await getProviderCalls({
				...(connectionId ? { connection_id: connectionId } : {}),
				...(chatId ? { chat_id: chatId } : {}),
				...(messageId ? { message_id: messageId } : {}),
				...(summary ? { admin_summary: 'true' } : {})
			});
			rows = result.data;
			summaries = result.summary ?? [];
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);
</script>

<section class="space-y-3 text-sm text-gray-900 dark:text-gray-100" aria-label="调用记录">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h4 class="font-semibold">调用记录</h4>
		<button
			type="button"
			class="rounded-lg border px-3 py-1.5 dark:border-gray-700"
			on:click={load}
			disabled={loading}>刷新</button
		>
	</div>
	<p class="text-xs text-gray-600 dark:text-gray-300">
		汇总最近 30 天，明细最多显示 500 次请求尝试。仅记录上游报告的
		token；未知不等于零，不代表套餐剩余额度。浏览器直连不计入。
	</p>
	{#if connectionId && $user?.role === 'admin'}
		<label class="flex items-center gap-2 text-xs"
			><input
				type="checkbox"
				bind:checked={summary}
				on:change={load}
			/>管理汇总（需要管理员权限）</label
		>
	{/if}
	{#if error}<p role="alert" class="text-red-600 dark:text-red-300">{error}</p>{/if}
	<label class="flex items-center gap-2 text-xs"
		>汇总方式<select class="rounded bg-gray-100 p-1 dark:bg-gray-800" bind:value={groupBy}
			><option value="model_id">按模型</option><option value="purpose">按用途</option></select
		></label
	>
	{#each groups as group}<div class="rounded-lg border p-2 text-xs dark:border-gray-700">
			<span class="break-all font-medium">{group.key}</span> · {group.count} 次 · {group.reported} 次有用量
			· 已报告输入 {group.input} / 输出 {group.output}
		</div>{/each}
	{#if loading}<p>加载中…</p>{:else if !rows.length}<p
			class="py-4 text-gray-600 dark:text-gray-300"
		>
			暂无调用记录。此功能启用前的调用无法补录。
		</p>{/if}
	<div class="max-h-96 space-y-2 overflow-y-auto">
		{#each rows as row (row.id)}
			<article class="rounded-xl border p-3 dark:border-gray-700">
				<div class="flex flex-wrap justify-between gap-1 text-xs">
					<span class="font-medium">{row.purpose} · {row.status}</span><span
						>{new Date(row.created_at * 1000).toLocaleString()} · {row.elapsed_ms} ms</span
					>
				</div>
				<p class="my-1 break-all text-xs">{row.model_id}</p>
				<p class="text-xs text-gray-600 dark:text-gray-300">
					输入 {row.usage?.input_tokens ?? '未知'} · 输出 {row.usage?.output_tokens ?? '未知'} · 推理
					{row.usage?.reasoning_tokens ?? '未知'} · 缓存 {row.usage?.cached_tokens ?? '未知'}
				</p>
			</article>
		{/each}
	</div>
</section>
