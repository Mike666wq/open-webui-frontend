<script lang="ts">
	import { onMount, getContext, createEventDispatcher } from 'svelte';
	import { config } from '$lib/stores';
	import { getProviderConnections, getProviderModels } from '$lib/apis/providers';
	export let purpose: 'chat' | 'transcription' | 'speech' | 'image';
	export let value = '';
	export let connectionId = '';
	export let disabled = false;
	export let labelledBy = '';
	const i18n: any = getContext('i18n');
	const dispatch = createEventDispatcher();
	let options: any[] = [];
	let connections: any[] = [];
	$: legacy = !$config?.features?.enable_provider_model_capabilities;
	let error = '';
	let loading = true;
	async function load() {
		loading = true;
		error = '';
		try {
			if (!$config?.features?.enable_provider_model_capabilities) {
				connections = (await getProviderConnections()).filter(
					(c: any) => c.auth_type === 'api_key'
				);
			} else {
				options = ((await getProviderModels(purpose)).data ?? []).filter(
					(m: any) => !!m.uses?.[purpose]
				);
			}
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}
	onMount(load);
	$: selectedId =
		options.find(
			(m) => m.id === value || (m.connection_id === connectionId && m.upstream_id === value)
		)?.id ?? value;
	function choose(event: Event) {
		value = (event.currentTarget as HTMLSelectElement).value;
		const model = options.find((m) => m.id === value);
		connectionId = model?.connection_id ?? '';
		dispatch('change', model);
	}
</script>

<div class="space-y-1">
	{#if legacy}
		<select
			aria-label={labelledBy ? '' : $i18n.t('Select a provider connection')}
			aria-labelledby={labelledBy}
			bind:value={connectionId}
			{disabled}
			class="w-full rounded bg-gray-50 p-2 dark:bg-gray-850"
			><option value="">{$i18n.t('Select a provider connection')}</option
			>{#each connections as connection}<option value={connection.id}>{connection.name}</option
				>{/each}</select
		>
		<input
			aria-label={labelledBy ? '' : $i18n.t('Model ID')}
			aria-labelledby={labelledBy}
			bind:value
			{disabled}
			class="w-full rounded bg-gray-50 p-2 dark:bg-gray-850"
		/>
		<p class="text-xs">{$i18n.t('Legacy configuration')}</p>
	{:else}
		<select
			aria-label={labelledBy ? '' : $i18n.t('Select a model')}
			aria-labelledby={labelledBy}
			class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-850"
			value={selectedId}
			on:change={choose}
			disabled={disabled || loading}
		>
			<option value="">{$i18n.t(loading ? 'Loading...' : 'Select a model')}</option>
			{#if value && !options.some((m) => m.id === selectedId)}<option {value}
					>{value} · {$i18n.t('Unavailable or legacy model')}</option
				>{/if}
			{#each options as model}<option value={model.id}
					>{model.connection_name} · {model.name ?? model.upstream_id} · {$i18n.t(
						model.verification?.[purpose]?.status ?? 'untested'
					)}</option
				>{/each}
		</select>
		{#if error}<p class="text-xs text-red-500">{error}</p>
			<button type="button" on:click={load}>{$i18n.t('Retry')}</button>{/if}
		{#if !loading && !error && !options.length}<p class="text-xs text-amber-600">
				{$i18n.t('No models for this purpose. Configure model capabilities in Connections.')}
			</p>{/if}
	{/if}
</div>
