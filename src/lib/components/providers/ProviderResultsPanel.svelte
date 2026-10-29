<script lang="ts">
	import { getContext } from 'svelte';
	import { catalogResult, providerResults } from './provider-models-feedback';
	import { providerErrorAction } from '$lib/utils/provider-errors';

	const i18n: any = getContext('i18n');
	export let connection: any;
	export let canManage = false;
	export let onOpenModels: () => void;
	export let onRecovery: (action: string) => void;
	$: result = $providerResults[connection?.id] ?? catalogResult(connection);
	$: action = result?.error
		? providerErrorAction(result.error, { authType: connection?.auth_type })
		: null;
	$: title = result?.operation === 'verify'
		? $i18n.t('Check connection')
		: result?.operation === 'test'
			? $i18n.t('Test {{purpose}}', { purpose: result.purpose ?? '' })
			: $i18n.t('Fetch model list');
</script>

<section class="min-w-0 rounded-xl border border-gray-200 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-850" aria-label={$i18n.t('Result')} data-testid="provider-results-panel">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h4 class="font-medium">{$i18n.t('Result')}</h4>
		{#if $providerResults[connection?.id]}
			<button type="button" class="text-xs underline" on:click={() => providerResults.clear(connection.id)}>{$i18n.t('Clear')}</button>
		{/if}
	</div>
	{#if result}
		<div class="mt-3 min-w-0 rounded-lg border p-3 text-sm {result.kind === 'success'
			? 'border-green-300 bg-green-50/70 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
			: 'border-amber-400 bg-amber-50/70 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}" role="status" aria-live="polite" data-testid="provider-result-card">
			<p class="font-medium">{title} · {result.kind === 'success' ? $i18n.t('Success') : $i18n.t('Failed')}</p>
			{#if result.at}<p class="mt-1 text-xs">{new Date(result.at).toLocaleString()}</p>{/if}
			{#if result.modelName}<p class="mt-1 break-all text-xs">{result.modelName}</p>{/if}
			{#if result.summary}<p class="mt-2 whitespace-pre-wrap break-words">{result.summary}</p>{/if}
			{#if result.kind === 'error'}
				{#if result.hint}<p class="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{result.hint}</p>{/if}
				{#if result.actionKey}<p class="mt-2 text-xs">{$i18n.t('Suggested action: {{action}}', { action: $i18n.t(result.actionKey) })}</p>{/if}
			{/if}
		</div>
		<div class="mt-3 flex flex-wrap gap-2 text-xs">
			{#if canManage && action}
				<button type="button" class="rounded-lg border px-3 py-2 dark:border-gray-700" on:click={() => result.operation === 'test' && action === 'retry_later' ? onOpenModels() : onRecovery(action)}>{$i18n.t(result.actionKey ?? 'Try again')}</button>
			{/if}
			<button type="button" class="rounded-lg border px-3 py-2 dark:border-gray-700" on:click={onOpenModels}>{$i18n.t('Models')}</button>
		</div>
	{:else}
		<p class="mt-3 text-sm text-gray-600 dark:text-gray-300">{$i18n.t('No results')}</p>
		<button type="button" class="mt-3 rounded-lg border px-3 py-2 text-xs dark:border-gray-700" on:click={onOpenModels}>{$i18n.t('Models')}</button>
	{/if}
</section>
