<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import {
		setProviderModelUses,
		testProviderModel,
		setProviderModelEnabled
	} from '$lib/apis/providers';
	export let connection: any;
	export let canManage = true;
	const dispatch = createEventDispatcher();
	const sources: Record<string, string> = {
		provider: '厂商目录',
		'provider-adapter': '厂商适配',
		manual: '人工声明',
		'legacy-unconfirmed': '旧配置待确认',
		unknown: '待分类'
	};
	const testStates: Record<string, string> = { passed: '通过', failed: '失败', untested: '未测试' };
	const purposes = ['chat', 'transcription', 'speech', 'image'];
	const labels: Record<string, string> = {
		chat: '聊天',
		transcription: '录音转写',
		speech: '语音合成',
		image: '生图'
	};
	const adapters: Record<string, string[]> = {
		chat: ['openai-chat', 'responses'],
		transcription: ['openai-transcription'],
		speech: ['openai-speech'],
		image: ['openai-image', 'siliconflow-image']
	};
	let query = '';
	let purpose = 'all';
	let availability = 'all';
	let modelId = '';
	let uses: Record<string, string> = {};
	let file: File | null = null;
	let voice = '';
	let busy = false;
	let message = '';
	let selectedModel: any = null;
	let previousConnection = '';
	$: if (connection.id !== previousConnection) {
		previousConnection = connection.id;
		modelId = '';
		uses = {};
		message = '';
	}
	$: selectedModel = connection.models?.find((m: any) => m.upstream_id === modelId);
	$: filtered = (connection.models ?? []).filter(
		(m: any) =>
			`${m.name ?? ''} ${m.upstream_id}`.toLowerCase().includes(query.toLowerCase()) &&
			(purpose === 'all' ||
				(purpose === 'unknown' ? !Object.keys(m.uses ?? {}).length : purpose in (m.uses ?? {}))) &&
			(availability === 'all' ||
				(availability === 'enabled' ? m.enabled !== false : m.enabled === false))
	);
	function select(id: string) {
		modelId = id;
		uses = { ...(connection.models?.find((m: any) => m.upstream_id === id)?.uses ?? {}) };
		message = '';
		file = null;
		voice = '';
	}
	async function save() {
		busy = true;
		message = '';
		try {
			await setProviderModelUses(connection.id, modelId, uses);
			message = '能力已保存；手动声明不代表测试通过。';
			dispatch('updated');
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}
	async function toggle(model: any) {
		busy = true;
		message = '';
		try {
			await setProviderModelEnabled(connection.id, model.upstream_id, model.enabled === false);
			dispatch('updated');
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}
	async function test(use: string) {
		if (
			!confirm(
				`本次将使用「${modelId}」发送一次${labels[use]}请求，可能消耗费用或套餐额度；不会自动重试。继续？`
			)
		)
			return;
		busy = true;
		message = '';
		try {
			let audio_base64: string | undefined;
			if (use === 'transcription') {
				if (!file || file.size > 2 * 1024 * 1024) throw new Error('请选择 2 MB 以下的短录音。');
				const bytes = new Uint8Array(await file.arrayBuffer());
				let binary = '';
				for (const b of bytes) binary += String.fromCharCode(b);
				audio_base64 = btoa(binary);
			}
			const result = await testProviderModel(connection.id, {
				upstream_id: modelId,
				purpose: use,
				voice,
				audio_base64,
				filename: file?.name
			});
			message =
				result.status === 'passed'
					? '本次调用通过；不代表所有参数均兼容。'
					: `本次调用失败：${result.error?.category ?? '请检查配置或上游状态'}`;
			dispatch('updated');
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}
</script>

<section class="min-w-0 space-y-4 text-sm text-gray-900 dark:text-gray-100" aria-label="模型管理">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<p class="font-medium">
				已发现 {connection.models?.length ?? 0} · 已启用 {(connection.models ?? []).filter(
					(m) => m.enabled !== false
				).length}
			</p>
			<p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
				服务器连接 · 目录获取不运行推理 · 新发现模型默认关闭
			</p>
		</div>
		{#if canManage}<button
				type="button"
				class="rounded-lg border px-3 py-2 dark:border-gray-700"
				disabled={busy}
				on:click={() => dispatch('refresh')}>刷新目录</button
			>{/if}
	</div>
	{#if connection.catalog?.stale || connection.catalog?.error}<div
			class="rounded-xl border border-amber-400 bg-amber-50/70 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
			role="status"
		>
			{connection.catalog?.error
				? `目录刷新失败（${connection.catalog.error.category} / HTTP ${connection.catalog.error.status}），保留上次目录。`
				: '目录已过期，后台刷新中；显示上次保存结果。'} 最后成功：{connection.catalog?.updated_at
				? new Date(connection.catalog.updated_at * 1000).toLocaleString()
				: '尚无成功记录'}。目录状态不代表模型调用结果。
		</div>{/if}
	<div class="flex flex-wrap gap-2">
		<input
			class="min-w-0 flex-1 rounded-lg border bg-transparent p-2 dark:border-gray-700"
			aria-label="搜索模型"
			placeholder="搜索名称或模型 ID"
			bind:value={query}
		/><select
			class="rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
			aria-label="能力筛选"
			bind:value={purpose}
			><option value="all">全部能力</option>{#each purposes as p}<option value={p}
					>{labels[p]}</option
				>{/each}<option value="unknown">待分类</option></select
		><select
			class="rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
			aria-label="启用筛选"
			bind:value={availability}
			><option value="all">全部模型</option><option value="enabled">已启用</option><option
				value="disabled">未启用</option
			></select
		>
	</div>
	<div class="max-h-72 space-y-2 overflow-y-auto">
		{#each filtered as model (model.upstream_id)}<article
				class="flex items-start gap-2 rounded-xl border p-3 dark:border-gray-700"
			>
				<button
					type="button"
					class="min-w-0 flex-1 text-left"
					on:click={() => select(model.upstream_id)}
					aria-pressed={modelId === model.upstream_id}
					><span class="block break-all font-medium">{model.name ?? model.upstream_id}</span><span
						class="block break-all text-xs text-gray-600 dark:text-gray-300"
						>{model.upstream_id}</span
					><span class="mt-1 block text-xs"
						>{Object.keys(model.uses ?? {})
							.map((p) => labels[p])
							.join(' / ') || '待分类'} · {sources[model.capability_source] ??
							model.capability_source} · {Object.values(model.verification ?? {}).some(
							(v: any) => v.status === 'passed'
						)
							? '有已通过测试'
							: '未通过独立测试'}</span
					></button
				>{#if canManage}<label class="flex shrink-0 items-center gap-1 text-xs"
						><input
							type="checkbox"
							checked={model.enabled !== false}
							disabled={busy}
							on:change={() => toggle(model)}
							aria-label={`启用 ${model.upstream_id}`}
						/>启用</label
					>{/if}
			</article>{:else}<p class="py-4 text-center text-gray-600 dark:text-gray-300">
				没有符合条件的模型
			</p>{/each}
	</div>
	{#if canManage && connection.auth_type === 'api_key'}<button
			type="button"
			class="rounded-lg border px-3 py-2 dark:border-gray-700"
			on:click={() => {
				modelId = '';
				uses = {};
				message = '';
			}}>＋ 手动添加模型</button
		>{/if}
	{#if message}<p role="status" class="rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-800">
			{message}
		</p>{/if}
	{#if canManage}
		<div class="space-y-3 rounded-xl border p-3 dark:border-gray-700">
			<h5 class="font-medium">{selectedModel ? '模型详情与测试' : '手动模型配置'}</h5>
			<label class="block text-xs"
				>模型 ID<input
					class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
					bind:value={modelId}
					disabled={connection.auth_type !== 'api_key'}
				/></label
			>
			{#if connection.auth_type === 'api_key'}<p class="text-xs text-gray-600 dark:text-gray-300">
					选择已支持的接口适配。能力声明只用于路由，不代表厂商实际兼容。
				</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each purposes as p}<label class="text-xs"
							>{labels[p]}<select
								class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
								value={uses[p] ?? ''}
								on:change={(event) => {
									const value = event.currentTarget.value;
									const next = { ...uses };
									if (value) next[p] = value;
									else delete next[p];
									uses = next;
								}}
								><option value="">不声明</option>{#each adapters[p] as adapter}<option
										value={adapter}>{adapter}</option
									>{/each}</select
							></label
						>{/each}
				</div>
				<button
					type="button"
					class="rounded-lg border px-3 py-2 dark:border-gray-700 disabled:opacity-50"
					disabled={busy || !modelId.trim()}
					on:click={save}>保存能力 / 添加模型</button
				>{/if}
			{#if selectedModel}
				{#if selectedModel.uses?.transcription}<label class="block text-xs"
						>测试短录音（小于 2 MB）<input
							type="file"
							class="mt-1 block max-w-full"
							accept="audio/*"
							on:change={(e) => (file = e.currentTarget.files?.[0] ?? null)}
						/></label
					>{/if}
				{#if selectedModel.uses?.speech}<label class="block text-xs"
						>测试音色<input
							class="mt-1 w-full rounded border bg-transparent p-2 dark:border-gray-700"
							bind:value={voice}
						/></label
					>{/if}
				{#each Object.keys(selectedModel.uses ?? {}) as p}<div
						class="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs dark:border-gray-700"
					>
						<div>
							{labels[p]} · {selectedModel.verification?.[p]?.status ??
								'untested'}{#if selectedModel.verification?.[p]?.tested_at}<span class="block"
									>{new Date(selectedModel.verification[p].tested_at * 1000).toLocaleString()} · {selectedModel
										.verification[p].elapsed_ms ?? '未知'} ms</span
								>{/if}
						</div>
						<button
							type="button"
							class="rounded-lg border px-3 py-2 dark:border-gray-700"
							disabled={busy}
							on:click={() => test(p)}>测试{labels[p]}（消耗额度）</button
						>
					</div>{/each}
			{/if}
		</div>
	{/if}
</section>
