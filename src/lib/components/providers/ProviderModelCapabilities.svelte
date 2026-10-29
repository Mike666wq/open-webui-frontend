<script lang="ts">
	import { getContext } from 'svelte';
	import { updateProviderModel } from '$lib/apis/providers';

	const i18n: any = getContext('i18n');
	export let connection: any;
	export let model: any;
	export let canManage = false;
	export let onUpdated: (() => Promise<void>) | undefined = undefined;

	let busy = false;
	let message = '';
	let editing = false;
	let vision: 'unknown' | 'true' | 'false' = 'unknown';
	$: if (!editing) {
		const explicit = model?.model_info?.capabilities?.vision;
		vision = explicit === true ? 'true' : explicit === false ? 'false' : 'unknown';
	}

	async function save() {
		busy = true;
		message = '';
		try {
			await updateProviderModel(connection.id, model.upstream_id, {
				capabilities: vision === 'unknown' ? { vision: null } : { vision: vision === 'true' }
			});
			editing = false;
			await onUpdated?.();
		} catch (error) {
			message = String(error).replace(/^Error:\s*/, '');
		} finally {
			busy = false;
		}
	}
</script>

<div class="mt-2 rounded-lg border p-2 text-xs dark:border-gray-700">
	{#if canManage}
		{#if editing}
			<label class="flex flex-wrap items-center gap-2">
				{$i18n.t('Vision capability')}
				<select class="rounded-md border bg-transparent p-1 dark:border-gray-600" bind:value={vision}>
					<option value="unknown">{$i18n.t('Not declared')}</option>
					<option value="true">{$i18n.t('Supports image input')}</option>
					<option value="false">{$i18n.t('Does not support image input')}</option>
				</select>
				<button type="button" class="rounded-md border px-2 py-1 disabled:opacity-50" disabled={busy} on:click={save}>{$i18n.t('Save')}</button>
				<button type="button" class="rounded-md border px-2 py-1" disabled={busy} on:click={() => (editing = false)}>{$i18n.t('Cancel')}</button>
			</label>
		{:else}
			<button type="button" class="rounded-md border px-2 py-1" on:click={() => (editing = true)}>
				{$i18n.t('Vision capability')}: {$i18n.t(vision === 'true' ? 'Supports image input' : vision === 'false' ? 'Does not support image input' : 'Not declared')}
			</button>
		{/if}
	{:else}
		<span>{$i18n.t('Vision capability')}: {$i18n.t(vision === 'true' ? 'Supports image input' : vision === 'false' ? 'Does not support image input' : 'Not declared')}</span>
	{/if}
	{#if message}<p role="alert" class="mt-2 text-red-600 dark:text-red-300">{message}</p>{/if}
</div>
