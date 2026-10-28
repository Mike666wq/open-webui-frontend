<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { addProviderModels, updateProviderConnection, updateProviderModel } from '$lib/apis/providers';
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
	import { providerErrorSummary } from '$lib/utils/provider-errors';
	import { goto } from '$app/navigation';
	import { showSettings, user } from '$lib/stores';
	import { getAudioConfig } from '$lib/apis/audio';
	import { recordingRequest } from '$lib/apis/recordings';

	const i18n: any = getContext('i18n');

	export let connection: any = null;
	export let template: ProviderServiceTemplate | null = null;
	export let canManage = true;
	export let onUpdated: (() => Promise<void>) | undefined = undefined;
	export let onCreateVoiceConnection: ((purpose: 'transcription' | 'speech') => void) | undefined = undefined;

	let enabled: Record<string, boolean> = {};
	let kinds: Record<string, 'base_url' | 'endpoint_url'> = {};
	let urls: Record<string, string> = {};
	let saving = false;
	let message = '';
	let previousConnection = '';
	let selectedPresets: Record<string, string> = {};
	let defaults: Record<string, string | null> = { transcription: null, speech: null };
	onMount(async () => {
		try {
			const recording = await recordingRequest<any>(localStorage.token, '/config');
			defaults = { ...defaults, transcription: recording.default_model_ref ?? '' };
		} catch { /* The default is unknown when access or loading fails. */ }
		if ($user?.role === 'admin') {
			try {
				const audio = await getAudioConfig(localStorage.token);
				defaults = { ...defaults, speech: audio?.tts?.MODEL ?? '' };
			} catch { /* Keep unknown rather than reporting an unset default. */ }
		}
	});

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
			nextEnabled[purpose] = connection?.resolved_services?.[purpose]?.enabled ?? (block.enabled !== false);
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

	async function addPreset(purpose: ServicePurpose) {
		const chosen = serviceDeclaration(template, purpose).preset_models?.find(
			(model) => model.upstream_id === selectedPresets[purpose]
		);
		if (!chosen || !canManage || saving) return;
		saving = true;
		message = '';
		try {
			const existing = (connection?.models ?? []).find((model: any) => model.upstream_id === chosen.upstream_id);
			if (existing) {
				await updateProviderModel(connection.id, chosen.upstream_id, {
					uses: { ...(existing.uses ?? {}), ...(chosen.uses ?? {}) }, enabled: true
				});
			} else {
				await addProviderModels(connection.id, {
					upstream_ids: [chosen.upstream_id],
					display_names: { [chosen.upstream_id]: chosen.display_name ?? chosen.upstream_id },
					uses: chosen.uses ?? {},
					source: 'preset'
				});
			}
			if (onUpdated) await onUpdated();
			toast.success('模型已添加并启用 / Model added and enabled');
		} catch (err) {
			message = String(err).replace(/^Error:\s*/, '');
		} finally { saving = false; }
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
		<p class="mt-2 text-xs">1. 保存服务地址 / Save the service · 2. 添加并启用模型 / Add a model · 3. 设置默认或使用 / Set a default or use it</p>
		<p class="mt-1 text-xs">不同服务使用不同 API Key 时，请使用对应厂商提供的媒体 Key 新建独立连接；保存地址不会更改其他连接的 Key。 / Use a separate connection for a different vendor media key.</p>
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
				{@const activeModels = (connection?.models ?? []).filter((model: any) => model.enabled !== false && model.uses?.[purpose])}
				{@const failedTest = activeModels.find((model: any) => model.verification?.[purpose]?.status === 'failed')?.verification?.[purpose]}
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
								{connection?.resolved_services?.[purpose]?.enabled === false ? '服务已关闭 / Service disabled' : $i18n.t(serviceStatusLabelKey(status))}
							</p>
							{#if failedTest?.error}<p class="mt-1 text-xs text-red-700 dark:text-red-300">{providerErrorSummary(failedTest.error)}</p>{/if}
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
					<p class="mt-2 text-xs">已启用模型 / Enabled models: {activeModels.length}</p>
					{#if purpose === 'transcription' || purpose === 'speech'}
						<p class="mt-1 text-xs">默认 / Default: {defaults[purpose] === null ? '不可读取 / Unavailable' : (defaults[purpose] || '未设置 / Not set')}</p>
					{/if}
					{#if canManage && declaration.discovery === 'preset' && declaration.preset_models?.length}
						<div class="mt-3 flex flex-wrap gap-2">
							<select class="min-w-0 flex-1 rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-800" aria-label="选择官方预设模型 / Select an official preset" bind:value={selectedPresets[purpose]}>
								<option value="">选择官方预设模型 / Select a preset</option>
								{#each declaration.preset_models as preset}<option value={preset.upstream_id}>{preset.display_name ?? preset.upstream_id}</option>{/each}
							</select>
							<button type="button" class="rounded-lg border px-3 py-2 text-xs disabled:opacity-50 dark:border-gray-700" disabled={saving || !selectedPresets[purpose] || connection?.resolved_services?.[purpose]?.enabled === false} on:click={() => addPreset(purpose)}>添加并启用 / Add and enable</button>
						</div>
					{/if}
					{#if purpose === 'transcription' && activeModels.length}
						<button type="button" class="mt-2 text-xs underline" on:click={() => { showSettings.set(false); goto(`/notes/recordings?model_ref=${encodeURIComponent(activeModels[0].id)}`); }}>去录音转文档 / Go to recordings</button>
					{:else if purpose === 'speech' && activeModels.length}
						{#if $user?.role === 'admin'}<button type="button" class="mt-2 text-xs underline" on:click={() => showSettings.set('admin:audio')}>设置朗读模型和音色 / Set speech model and voice</button>{:else}<p class="mt-2 text-xs">请联系管理员设置朗读默认模型。 / Ask an administrator to set the default speech model.</p>{/if}
					{/if}
					{#if canManage && onCreateVoiceConnection && (purpose === 'transcription' || purpose === 'speech')}
						<button type="button" class="mt-2 block text-xs underline" data-testid={`provider-new-voice-${purpose}`} on:click={() => onCreateVoiceConnection?.(purpose)}>使用独立 Key 新建此语音连接 / Create a separate voice connection</button>
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
