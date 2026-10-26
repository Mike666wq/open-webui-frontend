<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { previewLegacyMigration, applyLegacyMigration } from '$lib/apis/providers';
	const dispatch = createEventDispatcher();
	let preview: any = null;
	let error = '';
	let busy = false;
	let owners: Record<string, number> = {};
	async function load() {
		busy = true;
		error = '';
		try {
			preview = await previewLegacyMigration();
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
	async function migrate(source: any) {
		if (
			!confirm(
				'将此旧连接迁入供应商管理，并禁用对应旧来源。保留现有模型访问规则与聊天引用。确认迁移？'
			)
		)
			return;
		busy = true;
		error = '';
		try {
			await applyLegacyMigration({
				index: source.index,
				fingerprint: source.fingerprint,
				alias_owners: owners
			});
			await load();
			dispatch('updated');
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="mt-4 space-y-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100"
>
	<div class="flex items-center justify-between gap-2">
		<h4 class="font-medium">旧版 OpenAI 连接迁移</h4>
		<button
			type="button"
			class="rounded-lg border px-3 py-1.5 dark:border-gray-700"
			on:click={load}
			disabled={busy}>预览迁移</button
		>
	</div>
	<p class="text-xs text-gray-600 dark:text-gray-300">
		预览只获取目录，不运行推理。迁移前旧连接继续有效；浏览器直连不在迁移范围内。
	</p>
	{#if error}<p role="alert" class="text-red-600 dark:text-red-300">{error}</p>{/if}
	{#if preview}
		{#each Object.entries(preview.conflicts) as [alias, ids]}<label class="block text-xs"
				>同名模型 {alias} 的归属<select
					class="ml-2 rounded bg-gray-100 p-2 dark:bg-gray-800"
					bind:value={owners[alias]}
					><option value={undefined}>选择来源</option>{#each ids as index}<option value={index}
							>连接 {Number(index) + 1}</option
						>{/each}</select
				></label
			>{/each}
		{#each preview.sources as source}<article
				class="space-y-2 rounded-lg border p-3 dark:border-gray-700"
			>
				<h5>{source.name}</h5>
				<p class="break-all text-xs">{source.base_url}</p>
				<p class="text-xs">{source.models.length} 个模型 · 保留原模型访问规则；服务端共享来源</p>
				<p class="break-all text-xs">{Object.keys(source.aliases).join('、')}</p>
				{#if source.blocked_reason}<p class="text-xs text-amber-700 dark:text-amber-300">
						{source.blocked_reason}
					</p>{/if}<button
					type="button"
					class="rounded-lg border px-3 py-1.5 disabled:opacity-50 dark:border-gray-700"
					disabled={busy || !!source.blocked_reason || !!source.migrated_connection}
					on:click={() => migrate(source)}
					>{source.migrated_connection ? '已迁移' : '确认迁移此连接'}</button
				>
			</article>{/each}
	{/if}
</section>
