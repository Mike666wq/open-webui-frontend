<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { updateProviderConnection } from '$lib/apis/providers';
	import {
		buildServiceConfig,
		defaultServiceEndpoint,
		discoveryLabelKey,
		endpointKindLabelKey,
		serviceAdapters,
		serviceDeclaration,
		serviceStatus,
		serviceStatusLabelKey,
		supportedServicePurposes,
		type ProviderServiceTemplate,
		type ServicePurpose
	} from '$lib/utils/provider-services';
	import { PURPOSE_LABEL_KEYS } from '$lib/utils/provider-models';

	const i18n: any = getContext('i18n');

	export let connection: any = null;
	export let template: ProviderServiceTemplate | null = null;
	export let canManage = true;
	export let onUpdated: (() => Promise<void>) | undefined = undefined;

	let enabled: Record<string, boolean> = {};
	let kinds: Record<string, 'base_url' | 'endpoint_url'> = {};
	let urls: Record<string, string> = {};
	let saving = false;
	let message = '';
	let previousConnection = '';

	$: purposes = supportedServicePurposes(template);
	$: if (connection?.id !== previousConnection) {
		previousConnection = connection?.id;
		load();
	}

	function load() {
		const stored = connection?.config?.services ?? {};
		const nextEnabled: Record<string, boolean> = {};
		const nextKinds: Record<string, 'base_url' | 'endpoint_url'> = {};
		const nextUrls: Record<string, string> = {};
		for (const purpose of purposes) {
			const block = stored?.[purpose] ?? {};
			const fallback = defaultServiceEndpoint(template, purpose);
			nextEnabled[purpose] = block.enabled !== false;
			nextKinds[purpose] = (block.endpoint?.kind as 'base_url' | 'endpoint_url') ?? fallback.kind;
			nextUrls[purpose] = block.endpoint?.url ?? fallback.url;
		}
		enabled = nextEnabled;
		kinds = nextKinds;
		urls = nextUrls;
		message = '';
	}

	function resetToDefault(purpose: ServicePurpose) {
		const fallback = defaultServiceEndpoint(template, purpose);
		kinds = { ...kinds, [purpose]: fallback.kind };
		urls = { ...urls, [purpose]: fallback.url };
	}

	async function save() {
		if (saving || !connection?.id) return;
		saving = true;
		message = '';
		try {
			const services: Record<string, unknown> = {};
			for (const purpose of purposes) {
				services[purpose] = buildServiceConfig(template, purpose, {
					enabled: enabled[purpose] !== false,
					endpoint: { kind: kinds[purpose], url: (urls[purpose] ?? '').trim() }
				});
			}
			await updateProviderConnection(connection.id, {
				config: {
					...(connection.config ?? {}),
					services
				}
			});
			if (onUpdated) await onUpdated();
			toast.success($i18n.t('Service settings saved'));
		} catch (err) {
			message = String(err).replace(/^Error:\s*/, '');
		} finally {
			saving = false;
		}
	}
</script>

<section
	class="min-w-0 space-y-4 text-sm"
	aria-label={$i18n.t('Service settings')}
	data-testid="provider-service-settings"
>
	<div>
		<p class="font-medium">{$i18n.t('Services')}</p>
		<p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
			{$i18n.t(
				'Each service has its own address and model list. A service you switch off is not offered.'
			)}
		</p>
	</div>

	{#if purposes.length === 0}
		<p class="rounded-xl border border-dashed p-4 text-center text-gray-600 dark:text-gray-300">
			{$i18n.t('This provider does not declare any service.')}
		</p>
	{:else}
		<div class="space-y-3">
			{#each purposes as purpose (purpose)}
				{@const declaration = serviceDeclaration(template, purpose)}
				{@const status = serviceStatus(connection, purpose)}
				<article class="rounded-xl border p-3 dark:border-gray-700" data-testid={`provider-service-${purpose}`}>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="font-medium">{$i18n.t(PURPOSE_LABEL_KEYS[purpose])}</p>
							<p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
								{$i18n.t(discoveryLabelKey(declaration.discovery ?? 'none'))}
								{#if declaration.model_requirement === 'defaulted'}
									· {$i18n.t('the model is still sent with the request')}
								{/if}
							</p>
							<p class="mt-1 text-xs text-gray-600 dark:text-gray-300" data-testid="provider-service-status">
								{$i18n.t(serviceStatusLabelKey(status))}
							</p>
						</div>
						{#if canManage}
							<label class="flex shrink-0 items-center gap-1 text-xs">
								<input
									type="checkbox"
									checked={enabled[purpose] !== false}
									disabled={saving}
									aria-label={$i18n.t('Enable {{purpose}}', {
										purpose: $i18n.t(PURPOSE_LABEL_KEYS[purpose])
									})}
									on:change={(event) =>
										(enabled = {
											...enabled,
											[purpose]: (event.currentTarget as HTMLInputElement).checked
										})}
								/>
								{$i18n.t('Enabled')}
							</label>
						{/if}
					</div>

					{#if declaration.notes}
						<p class="mt-2 text-xs text-gray-600 dark:text-gray-300">{declaration.notes}</p>
					{/if}

					{#if canManage && enabled[purpose] !== false}
						<div class="mt-3 space-y-2">
							<label class="block text-xs">
								{$i18n.t('Address mode')}
								<select
									class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
									data-testid={`provider-service-kind-${purpose}`}
									bind:value={kinds[purpose]}
								>
									<option value="base_url">{$i18n.t(endpointKindLabelKey('base_url'))}</option>
									<option value="endpoint_url">
										{$i18n.t(endpointKindLabelKey('endpoint_url'))}
									</option>
								</select>
							</label>
							<label class="block text-xs">
								{$i18n.t('Service address')}
								<input
									class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
									data-testid={`provider-service-url-${purpose}`}
									bind:value={urls[purpose]}
								/>
							</label>
							<button
								type="button"
								class="text-xs underline underline-offset-2"
								on:click={() => resetToDefault(purpose)}
							>
								{$i18n.t('Restore the default address')}
							</button>
							{#if connection?.resolved_services?.[purpose]?.endpoint}
								<p class="break-all text-xs text-gray-600 dark:text-gray-300">
									{$i18n.t('The request will go to')}:
									{connection.resolved_services[purpose].endpoint}
								</p>
							{/if}
						</div>
					{/if}
				</article>
			{/each}
		</div>

		{#if canManage}
			<button
				type="button"
				class="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
				disabled={saving}
				data-testid="provider-service-save"
				on:click={save}
			>
				{saving ? $i18n.t('Saving…') : $i18n.t('Save service settings')}
			</button>
		{/if}
	{/if}

	{#if message}
		<p role="status" class="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
			{message}
		</p>
	{/if}
</section>
