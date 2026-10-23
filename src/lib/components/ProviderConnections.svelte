<script lang="ts">
	import { getContext, onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import AccessControl from '$lib/components/workspace/common/AccessControl.svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import { getModels as fetchModels } from '$lib/apis';
	import { config as backendConfig, models, settings, user } from '$lib/stores';
	import {
		createProviderConnection,
		completeChatGPTLogin,
		cancelChatGPTLogin,
		cancelKimiLogin,
		disconnectChatGPTConnection,
		disconnectKimiConnection,
		deleteProviderConnection,
		getChatGPTLoginStatus,
		getKimiLoginStatus,
		getProviderCatalog,
		getProviderConnections,
		refreshProviderModels,
		startChatGPTLogin,
		startKimiLogin,
		updateProviderConnection,
		verifyProviderConnection,
		verifyProviderDraft
	} from '$lib/apis/providers';

	const i18n: any = getContext('i18n');
	export let mode: 'personal' | 'admin' = 'personal';

	type Provider = { id: string; name: string; auth_types?: string[]; default_base_url?: string };
	type Model = { id: string; name?: string; owned_by?: string; upstream_id?: string };
	type Connection = {
		id: string;
		provider_id: string;
		name: string;
		auth_type: string;
		visibility?: string;
		owner_id?: string;
		config?: Record<string, any>;
		status?: string;
		models?: Model[];
		configured?: boolean;
		access_control?: any[];
	};

	let providers: Provider[] = [];
	let connections: Connection[] = [];
	let loading = true;
	let saving = false;
	let workingId = '';
	let error = '';
	let wizard = false;
	let step: 'setup' | 'models' | 'oauth' = 'setup';
	let providerId = '';
	let authType = 'api_key';
	let name = '';
	let apiKey = '';
	let baseUrl = '';
	let region = '';
	let workspaceId = '';
	let apiType = 'openai';
	let visibility: 'private' | 'shared' = 'private';
	let accessGrants: any[] = [];
	let verifiedModels: Model[] = [];
	let selectedModelIds: string[] = [];
	let oauthAttempt: any = null;
	let callbackUrl = '';
	let submittingCallback = false;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let pollGeneration = 0;
	let editingId = '';
	let editName = '';
	let editVisibility: 'private' | 'shared' = 'private';
	let editGrants: any[] = [];
	let editApiKey = '';
	let editBaseUrl = '';
	let editRegion = '';
	let editWorkspaceId = '';
	let editApiType = 'openai';
	let editModelIds: string[] = [];
	let editModelOptions: Model[] = [];
	let manualModelInput = '';
	let manualMode = false;
	let draftStatus = 'connected';
	let revealApiKey = false;

	$: provider = providers.find((item) => item.id === providerId);
	$: chatGPT = providerId === 'chatgpt';
	$: kimi = providerId === 'kimi';
	$: oauthProvider = chatGPT || kimi;
	$: customProvider = providerId === 'custom';
	$: isAdmin = mode === 'admin';
	$: authOptions = provider?.auth_types?.length ? provider.auth_types : ['api_key'];
	$: canManageConnection = (connection: Connection) =>
		connection.visibility === 'shared'
			? $user?.role === 'admin'
			: connection.owner_id === $user?.id;
	$: isOAuthConnection = (connection: Connection) =>
		['chatgpt', 'kimi'].includes(connection.provider_id) && connection.auth_type === 'oauth';
	$: statusLabel = (connection: Connection) =>
		connection.status === 'connected'
			? $i18n.t('Connected')
			: connection.status === 'configured'
				? $i18n.t('Not verified yet')
				: (connection.status ?? $i18n.t('Not verified yet'));

	const readableError = (err: unknown) => {
		const message = String(err).replace(/^Error:\s*/, '');
		return message === 'Cannot reach the Open WebUI server. Check your connection and try again.'
			? $i18n.t('Cannot reach the Open WebUI server. Check your connection and try again.')
			: message;
	};

	const bailianNeedsWorkspace = (selectedRegion: string) =>
		['eu-central-1', 'us-east-1', 'ap-northeast-1'].includes(selectedRegion);

	const connectionModelOptions = (connection: Connection): Model[] =>
		connection.models?.length
			? connection.models
			: (connection.config?.model_ids ?? []).map((id: string) => ({ id, upstream_id: id }));

	const load = async () => {
		loading = true;
		error = '';
		try {
			const [catalog, rows] = await Promise.all([getProviderCatalog(), getProviderConnections()]);
			providers = Array.isArray(catalog) ? catalog : (catalog?.providers ?? []);
			connections = Array.isArray(rows) ? rows : (rows?.connections ?? []);
		} catch (err) {
			error = readableError(err);
		} finally {
			loading = false;
		}
	};

	const refreshGlobalModels = async () => {
		try {
			const directConnections = $backendConfig?.features?.enable_direct_connections
				? ($settings?.directConnections ?? null)
				: null;
			await models.set(await fetchModels(localStorage.token, directConnections));
		} catch (err) {
			console.warn(
				'Provider connections changed, but the global model list could not refresh.',
				err
			);
		}
	};

	const clearWizard = () => {
		stopPolling();
		if (oauthAttempt?.attempt_id)
			(oauthAttempt.provider_id === 'chatgpt'
				? cancelChatGPTLogin(oauthAttempt.attempt_id)
				: cancelKimiLogin(oauthAttempt.attempt_id)
			).catch(() => {});
		oauthAttempt = null;
		callbackUrl = '';
		wizard = false;
		step = 'setup';
		providerId = '';
		name = '';
		apiKey = '';
		baseUrl = '';
		region = '';
		workspaceId = '';
		apiType = 'openai';
		visibility = 'private';
		accessGrants = [];
		verifiedModels = [];
		selectedModelIds = [];
		manualModelInput = '';
		manualMode = false;
		draftStatus = 'connected';
		error = '';
		revealApiKey = false;
	};

	const setProvider = (id: string) => {
		apiKey = '';
		workspaceId = '';
		apiType = 'openai';
		verifiedModels = [];
		selectedModelIds = [];
		manualModelInput = '';
		manualMode = false;
		revealApiKey = false;
		error = '';
		providerId = id;
		const item = providers.find((candidate) => candidate.id === id);
		name = item?.name ?? '';
		baseUrl = id === 'bailian' ? '' : (item?.default_base_url ?? '');
		region = id === 'bailian' ? 'cn-beijing' : '';
		authType = item?.auth_types?.[0] ?? 'api_key';
		if (id === 'chatgpt' || id === 'kimi') authType = 'oauth';
	};

	const configPayload = () => ({
		...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
		...(region.trim() ? { region: region.trim() } : {}),
		...(workspaceId.trim() ? { workspace_id: workspaceId.trim() } : {}),
		...(customProvider ? { api_type: apiType } : {}),
		model_ids: manualMode
			? manualModelInput
					.split(/[\n,]/)
					.map((id) => id.trim())
					.filter(Boolean)
			: selectedModelIds
	});

	$: draftCredentialsReady =
		(oauthProvider || authType !== 'api_key' || Boolean(apiKey.trim())) &&
		(!customProvider || Boolean(baseUrl.trim())) &&
		(providerId !== 'bailian' || !bailianNeedsWorkspace(region) || Boolean(workspaceId.trim()));

	$: hasSelectedModels = manualMode
		? manualModelInput.split(/[\n,]/).some((id) => Boolean(id.trim()))
		: selectedModelIds.length > 0;

	const verifyDraft = async () => {
		error = '';
		saving = true;
		try {
			const result = await verifyProviderDraft({
				provider_id: providerId,
				name: name.trim() || provider?.name || providerId,
				auth_type: authType,
				config: configPayload(),
				...(apiKey ? { api_key: apiKey } : {})
			});
			verifiedModels = result?.models ?? [];
			draftStatus = result?.status ?? 'connected';
			manualMode = draftStatus === 'manual';
			selectedModelIds = verifiedModels.map((model) => model.upstream_id ?? model.id);
			manualModelInput = selectedModelIds.join('\n');
			step = 'models';
		} catch (err) {
			error = readableError(err);
		} finally {
			saving = false;
		}
	};

	const saveConnection = async () => {
		error = '';
		saving = true;
		try {
			const created = await createProviderConnection({
				provider_id: providerId,
				name: name.trim() || provider?.name || providerId,
				auth_type: authType,
				visibility: isAdmin ? visibility : 'private',
				config: configPayload(),
				...(apiKey ? { api_key: apiKey } : {}),
				...(isAdmin && visibility === 'shared' ? { access_control: accessGrants } : {})
			});
			if (created?.id) {
				try {
					await refreshProviderModels(created.id);
				} catch {
					toast.warning(
						$i18n.t(
							'The account was saved, but its model list could not be refreshed. Check the connection or try Refresh later.'
						)
					);
				}
			}
			await load();
			await refreshGlobalModels();
			clearWizard();
			toast.success($i18n.t('Provider connection saved'));
		} catch (err) {
			error = readableError(err);
		} finally {
			saving = false;
		}
	};

	const verifySaved = async (connection: Connection) => {
		workingId = connection.id;
		try {
			const result = await verifyProviderConnection(connection.id);
			toast.success(
				$i18n.t('Connection verified · {{count}} models found', {
					count: result?.models?.length ?? 0
				})
			);
			await load();
			await refreshGlobalModels();
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const refreshModels = async (connection: Connection) => {
		workingId = connection.id;
		try {
			const result = await refreshProviderModels(connection.id);
			toast.success(
				$i18n.t('Models refreshed · {{count}} found', { count: result?.models?.length ?? 0 })
			);
			await load();
			await refreshGlobalModels();
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const removeConnection = async (connection: Connection) => {
		if (!confirm($i18n.t('Remove {{name}}?', { name: connection.name }))) return;
		workingId = connection.id;
		try {
			if (isOAuthConnection(connection)) {
				const result =
					connection.provider_id === 'kimi'
						? await disconnectKimiConnection(connection.id)
						: await disconnectChatGPTConnection(connection.id);
				connections = connections.filter((row) => row.id !== connection.id);
				await refreshGlobalModels();
				if (!result?.revocation_confirmed) {
					toast.warning(
						$i18n.t(
							'{{provider}} was disconnected here, but remote token revocation was not confirmed.',
							{ provider: connection.provider_id }
						)
					);
				} else {
					toast.success($i18n.t('Provider connection removed'));
				}
				return;
			}
			await deleteProviderConnection(connection.id);
			connections = connections.filter((row) => row.id !== connection.id);
			await refreshGlobalModels();
			toast.success($i18n.t('Provider connection removed'));
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const beginEdit = (connection: Connection) => {
		editingId = connection.id;
		editName = connection.name;
		editVisibility = connection.visibility === 'shared' ? 'shared' : 'private';
		editGrants = connection.access_control ?? [];
		editApiKey = '';
		editBaseUrl = connection.config?.base_url ?? '';
		editRegion =
			connection.config?.region ?? (connection.provider_id === 'bailian' ? 'cn-beijing' : '');
		editWorkspaceId = connection.config?.workspace_id ?? '';
		editApiType = connection.config?.api_type ?? 'openai';
		editModelOptions = connectionModelOptions(connection);
		editModelIds = editModelOptions.map((model) => model.upstream_id ?? model.id);
	};

	const saveEdit = async (connection: Connection) => {
		if (
			!isOAuthConnection(connection) &&
			editModelOptions.length > 0 &&
			editModelIds.length === 0
		) {
			toast.error($i18n.t('Select at least one model'));
			return;
		}
		workingId = connection.id;
		try {
			const payload: Record<string, unknown> = { name: editName.trim() };
			if (!isOAuthConnection(connection)) {
				const nextConfig = {
					...(editBaseUrl.trim() ? { base_url: editBaseUrl.trim() } : {}),
					...(editRegion.trim() ? { region: editRegion.trim() } : {}),
					...(editWorkspaceId.trim() ? { workspace_id: editWorkspaceId.trim() } : {}),
					...(connection.provider_id === 'custom' ? { api_type: editApiType } : {}),
					model_ids: editModelIds
				};
				const oldConfig = connection.config ?? {};
				const configChanged =
					(editBaseUrl.trim() || undefined) !== (oldConfig.base_url || undefined) ||
					(editRegion.trim() || undefined) !== (oldConfig.region || undefined) ||
					(editWorkspaceId.trim() || undefined) !== (oldConfig.workspace_id || undefined) ||
					(connection.provider_id === 'custom' &&
						editApiType !== (oldConfig.api_type ?? 'openai')) ||
					JSON.stringify(editModelIds) !==
						JSON.stringify(
							connection.models?.length
								? connection.models.map((model) => model.upstream_id ?? model.id)
								: (oldConfig.model_ids ?? [])
						);
				if (editApiKey.trim()) payload.api_key = editApiKey.trim();
				if (configChanged || editApiKey.trim()) payload.config = nextConfig;
			}
			if (isAdmin && !isOAuthConnection(connection)) {
				payload.visibility = editVisibility;
				if (editVisibility === 'shared') payload.access_control = editGrants;
			}
			await updateProviderConnection(connection.id, payload);
			editingId = '';
			editApiKey = '';
			await load();
			await refreshGlobalModels();
			toast.success($i18n.t('Connection updated'));
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const submitChatGPTCallback = async () => {
		if (!oauthAttempt || submittingCallback || !callbackUrl.trim()) return;
		submittingCallback = true;
		error = '';
		const attemptId = oauthAttempt.attempt_id;
		try {
			await completeChatGPTLogin(attemptId, callbackUrl.trim());
			if (oauthAttempt?.attempt_id !== attemptId) return;
			stopPolling();
			oauthAttempt = null;
			callbackUrl = '';
			await load();
			await refreshGlobalModels();
			clearWizard();
			toast.success($i18n.t('{{provider}} account connected', { provider: 'ChatGPT' }));
		} catch (err) {
			if (oauthAttempt?.attempt_id === attemptId) error = readableError(err);
		} finally {
			if (oauthAttempt?.attempt_id === attemptId) callbackUrl = '';
			submittingCallback = false;
		}
	};

	const beginOAuth = async (connectionId?: string) => {
		if (saving) return;
		saving = true;
		error = '';
		stopPolling();
		const generation = pollGeneration;
		const signingProvider = providerId;
		try {
			const attempt =
				signingProvider === 'kimi'
					? await startKimiLogin(connectionId)
					: await startChatGPTLogin(connectionId);
			if (generation !== pollGeneration) {
				(signingProvider === 'kimi'
					? cancelKimiLogin(attempt.attempt_id)
					: cancelChatGPTLogin(attempt.attempt_id)
				).catch(() => {});
				return;
			}
			if (signingProvider === 'chatgpt' && !attempt.authorization_url) {
				await cancelChatGPTLogin(attempt.attempt_id).catch(() => {});
				throw new Error($i18n.t('Update the backend to use browser-based ChatGPT sign-in.'));
			}
			callbackUrl = '';
			oauthAttempt = { ...attempt, provider_id: signingProvider };
			wizard = true;
			step = 'oauth';
			let polling = false;
			pollTimer = setInterval(
				async () => {
					if (polling || (signingProvider === 'chatgpt' && submittingCallback)) return;
					polling = true;
					try {
						const state =
							signingProvider === 'kimi'
								? await getKimiLoginStatus(attempt.attempt_id)
								: await getChatGPTLoginStatus(attempt.attempt_id);
						if (generation !== pollGeneration) return;
						if (state.status === 'complete') {
							stopPolling();
							oauthAttempt = null;
							await load();
							await refreshGlobalModels();
							clearWizard();
							toast.success(
								$i18n.t('{{provider}} account connected', {
									provider: signingProvider === 'kimi' ? 'Kimi Code' : 'ChatGPT'
								})
							);
						} else if (['failed', 'expired', 'error'].includes(state.status)) {
							stopPolling();
							error =
								state.message ||
								$i18n.t('{{provider}} sign-in {{status}}', {
									provider: signingProvider === 'kimi' ? 'Kimi Code' : 'ChatGPT',
									status: state.status
								});
						} else if (state.status === 'denied') {
							stopPolling();
							error = $i18n.t('Kimi Code authorization was denied.');
						}
					} catch (err) {
						if (generation === pollGeneration) {
							stopPolling();
							error = readableError(err);
						}
					} finally {
						polling = false;
					}
				},
				Math.max(2, attempt.interval ?? 2) * 1000
			);
		} catch (err) {
			if (generation === pollGeneration) error = readableError(err);
		} finally {
			saving = false;
		}
	};

	const stopPolling = () => {
		pollGeneration += 1;
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
	};

	const copyText = async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success($i18n.t('Copied to clipboard'));
		} catch {
			toast.error($i18n.t('Could not copy. Select and copy the text manually.'));
		}
	};

	const formatExpiry = (value: string | number) => {
		const timestamp = typeof value === 'number' ? value * 1000 : value;
		return new Date(timestamp).toLocaleTimeString();
	};

	onMount(load);
	onDestroy(stopPolling);
</script>

<section
	class="rounded-xl border border-gray-100 dark:border-gray-850 bg-white/70 dark:bg-gray-900/40 p-4"
>
	<div class="flex items-start justify-between gap-3">
		<div>
			<h3 class="text-sm font-medium text-gray-900 dark:text-white">
				{isAdmin ? $i18n.t('Provider accounts') : $i18n.t('My provider accounts')}
			</h3>
			<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
				{isAdmin
					? $i18n.t(
							'Connect API providers and choose whether each account stays private or is shared with selected people.'
						)
					: $i18n.t(
							'Connect your provider accounts once. They are stored securely and available across your sessions.'
						)}
			</p>
		</div>
		<button
			type="button"
			data-testid="provider-add"
			disabled={loading || providers.length === 0}
			class="rounded-lg bg-gray-900 px-3 py-2 text-xs text-white hover:bg-black dark:bg-gray-100 dark:text-gray-900"
			on:click={() => {
				wizard = true;
			}}
		>
			{$i18n.t('Add provider')}
		</button>
	</div>

	{#if error && !wizard}<p
			class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
		>
			{error}
		</p>{/if}
	{#if error && !wizard}<div class="mt-2 text-right">
			<button type="button" class="text-xs text-blue-600 underline" on:click={load}
				>{$i18n.t('Try again')}</button
			>
		</div>{/if}
	{#if loading}
		<p class="py-5 text-center text-xs text-gray-500">{$i18n.t('Loading provider accounts…')}</p>
	{:else if connections.length === 0}
		<div
			class="mt-4 rounded-lg border border-dashed border-gray-200 p-5 text-center dark:border-gray-700"
		>
			<p class="text-sm text-gray-600 dark:text-gray-300">
				{$i18n.t('No provider accounts connected yet')}
			</p>
			<p class="mt-1 text-xs text-gray-400">
				{$i18n.t('Add OpenAI, DeepSeek, Bailian, ChatGPT, Kimi Code, or a custom endpoint.')}
			</p>
		</div>
	{:else}
		<div class="mt-4 space-y-2">
			{#each connections as connection (connection.id)}
				<div class="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
					{#if editingId === connection.id}
						<div class="space-y-3">
							<label class="block text-xs text-gray-600 dark:text-gray-300"
								>{$i18n.t('Account name')}
								<input
									class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
									bind:value={editName}
									maxlength="80"
								/>
							</label>
							{#if !isOAuthConnection(connection)}
								<label class="block text-xs text-gray-600 dark:text-gray-300">
									{$i18n.t('Replace API key (optional)')}
									<input
										class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
										type="password"
										bind:value={editApiKey}
										autocomplete="new-password"
										placeholder={$i18n.t('Leave blank to keep the current key')}
									/>
								</label>
								{#if ['openai', 'deepseek', 'bailian', 'custom'].includes(connection.provider_id)}
									<label class="block text-xs text-gray-600 dark:text-gray-300">
										{$i18n.t('Base URL')}
										<input
											class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
											bind:value={editBaseUrl}
											placeholder={providers.find((item) => item.id === connection.provider_id)
												?.default_base_url ?? 'https://api.example.com/v1'}
										/>
									</label>
								{/if}
								{#if connection.provider_id === 'bailian'}
									<div class="grid gap-2 sm:grid-cols-2">
										<label class="block text-xs text-gray-600 dark:text-gray-300"
											>{$i18n.t('Region')}<select
												class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
												bind:value={editRegion}
												><option value="cn-beijing">China (Beijing)</option><option
													value="ap-southeast-1">Asia Pacific (Singapore)</option
												><option value="cn-hongkong">China (Hong Kong)</option><option
													value="eu-central-1">Europe (Frankfurt)</option
												><option value="us-east-1">US (Virginia)</option><option
													value="ap-northeast-1">Asia Pacific (Tokyo)</option
												></select
											></label
										><label class="block text-xs text-gray-600 dark:text-gray-300"
											>{$i18n.t(
												bailianNeedsWorkspace(editRegion)
													? 'Workspace ID (required in this region)'
													: 'Workspace ID (optional)'
											)}<input
												class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
												bind:value={editWorkspaceId}
											/></label
										>
									</div>
								{/if}
								{#if connection.provider_id === 'custom'}
									<label class="block text-xs text-gray-600 dark:text-gray-300"
										>{$i18n.t('API type')}<select
											class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
											bind:value={editApiType}
											><option value="openai">Chat Completions</option><option value="responses"
												>Responses API</option
											></select
										></label
									>
								{/if}
								{#if editModelOptions.length}
									<div>
										<p class="mb-1 text-xs text-gray-500">{$i18n.t('Available models')}</p>
										<div
											class="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2 dark:border-gray-800"
										>
											{#each editModelOptions as model (model.upstream_id ?? model.id)}<label
													class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"
													><input
														type="checkbox"
														value={model.upstream_id ?? model.id}
														bind:group={editModelIds}
													/>{model.name ?? model.upstream_id ?? model.id}</label
												>{/each}
										</div>
									</div>
								{/if}
							{/if}
							{#if isAdmin && !isOAuthConnection(connection)}
								<label class="block text-xs text-gray-600 dark:text-gray-300"
									>{$i18n.t('Who can use this account?')}
									<select
										class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
										bind:value={editVisibility}
									>
										<option value="private">{$i18n.t('Only me')}</option><option value="shared"
											>{$i18n.t('Share with selected people')}</option
										>
									</select>
								</label>
								{#if editVisibility === 'shared'}<AccessControl
										bind:accessGrants={editGrants}
										accessRoles={['read']}
										sharePublic={false}
										shareOpen={false}
									/>{/if}
							{/if}
							<div class="flex justify-end gap-2">
								{#if canManageConnection(connection)}<button
										type="button"
										class="rounded-lg px-3 py-1.5 text-xs text-gray-500"
										on:click={() => (editingId = '')}>{$i18n.t('Cancel')}</button
									><button
										type="button"
										class="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white dark:bg-gray-100 dark:text-gray-900"
										disabled={workingId === connection.id ||
											(!isOAuthConnection(connection) &&
												editModelOptions.length > 0 &&
												editModelIds.length === 0)}
										on:click={() => saveEdit(connection)}>{$i18n.t('Save')}</button
									>
								{/if}
							</div>
						</div>
					{:else}
						<div
							class="flex flex-col items-start justify-between gap-3 sm:flex-row"
							data-testid="provider-account-row"
						>
							<div class="min-w-0 w-full sm:w-auto sm:flex-1" data-testid="provider-account-info">
								<div class="flex flex-wrap items-center gap-2">
									<p class="truncate text-sm font-medium text-gray-900 dark:text-white">
										{connection.name}
									</p>
									<span
										class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-800"
										>{connection.provider_id}</span
									>
									<span
										class="rounded-full px-2 py-0.5 text-[10px] {connection.status === 'connected'
											? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
											: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}"
										>{statusLabel(connection)}</span
									>
									<span class="text-[10px] text-gray-400"
										>{connection.visibility === 'shared'
											? $i18n.t('Shared')
											: $i18n.t('Private')}</span
									>
								</div>
								<p class="mt-1 text-xs text-gray-500">
									{connectionModelOptions(connection).length}
									{$i18n.t('models')} · {connection.auth_type === 'oauth'
										? $i18n.t('Account sign-in')
										: $i18n.t('API key')}
								</p>
							</div>
							<div
								class="flex w-full shrink-0 flex-wrap justify-end gap-1 sm:w-auto"
								data-testid="provider-account-actions"
							>
								{#if canManageConnection(connection)}
									<button
										type="button"
										class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
										disabled={workingId === connection.id}
										on:click={() => beginEdit(connection)}>{$i18n.t('Edit')}</button
									>{/if}
								<button
									type="button"
									class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
									disabled={workingId === connection.id}
									on:click={() => verifySaved(connection)}>{$i18n.t('Verify')}</button
								>
								{#if canManageConnection(connection) && isOAuthConnection(connection)}
									<button
										type="button"
										class="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-50"
										disabled={workingId === connection.id}
										on:click={() => {
											providerId = connection.provider_id;
											beginOAuth(connection.id);
										}}>{$i18n.t('Reconnect')}</button
									>
								{/if}
								{#if canManageConnection(connection)}<button
										type="button"
										class="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
										disabled={workingId === connection.id}
										on:click={() => refreshModels(connection)}>{$i18n.t('Refresh')}</button
									>
									<button
										type="button"
										class="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
										disabled={workingId === connection.id}
										on:click={() => removeConnection(connection)}>{$i18n.t('Remove')}</button
									>{/if}
							</div>
						</div>
						{#if connectionModelOptions(connection).length}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each connectionModelOptions(connection).slice(0, 8) as model (model.upstream_id ?? model.id)}<span
										class="rounded bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800"
										>{model.name ?? model.id}</span
									>{/each}{#if connectionModelOptions(connection).length > 8}<span
										class="px-1 py-0.5 text-[10px] text-gray-400"
										>+{connectionModelOptions(connection).length - 8}</span
									>{/if}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>

{#if wizard}
	<Modal bind:show={wizard} size="md" onRequestClose={clearWizard} containerClassName="p-3">
		<div
			class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900"
			aria-labelledby="provider-wizard-title"
		>
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-[10px] uppercase tracking-[0.18em] text-gray-400">
						{$i18n.t('PROVIDER SETUP')}
					</p>
					<h3
						id="provider-wizard-title"
						class="mt-1 text-lg font-semibold text-gray-900 dark:text-white"
					>
						{step === 'models'
							? $i18n.t('Choose models')
							: step === 'oauth'
								? chatGPT
									? $i18n.t('Connect ChatGPT')
									: $i18n.t('Connect Kimi Code')
								: $i18n.t('Add a provider account')}
					</h3>
				</div>
				<button
					type="button"
					class="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
					on:click={clearWizard}
					aria-label={$i18n.t('Close')}>×</button
				>
			</div>
			{#if error}<p
					class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
				>
					{error}
				</p>{/if}
			{#if step === 'setup'}
				<div class="mt-5 space-y-4">
					<label class="block text-xs font-medium text-gray-600 dark:text-gray-300"
						>{$i18n.t('Provider')}
						<select
							class="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900"
							value={providerId}
							on:change={(event) => setProvider(event.currentTarget.value)}
						>
							<option value="" disabled>{$i18n.t('Choose a provider')}</option
							>{#each providers as item}<option value={item.id}>{item.name}</option>{/each}
						</select>
					</label>
					{#if provider}
						<label class="block text-xs font-medium text-gray-600 dark:text-gray-300"
							>{$i18n.t('Account name')}
							<input
								class="mt-1.5 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm dark:border-gray-700"
								bind:value={name}
								placeholder={provider.name}
								maxlength="80"
							/>
						</label>
						{#if oauthProvider}
							<p class="text-xs text-gray-500">
								{$i18n.t(
									'Account sign-in is private. Image generation, speech and transcription require a separate API key.'
								)}
							</p>
							{#if kimi}<p class="text-xs text-gray-500">
									{$i18n.t(
										'Kimi Code sign-in is an experimental compatibility integration for personal interactive coding. Provider access may vary.'
									)}
								</p>{/if}
						{/if}
						{#if !oauthProvider}
							<label class="block text-xs font-medium text-gray-600 dark:text-gray-300"
								>{$i18n.t('Authentication')}
								<select
									class="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900"
									bind:value={authType}
									>{#each authOptions as auth}<option value={auth}
											>{auth === 'api_key' ? $i18n.t('API key') : auth}</option
										>{/each}</select
								>
							</label>
							{#if authType === 'api_key'}
								<label class="block text-xs font-medium text-gray-600 dark:text-gray-300"
									>{$i18n.t('API key')}
									<div class="relative mt-1.5">
										<input
											class="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 pr-16 text-sm dark:border-gray-700"
											type={revealApiKey ? 'text' : 'password'}
											bind:value={apiKey}
											autocomplete="new-password"
											spellcheck="false"
											placeholder={$i18n.t('Paste your API key')}
										/><button
											class="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-gray-500"
											type="button"
											on:click={() => (revealApiKey = !revealApiKey)}
											>{revealApiKey ? $i18n.t('Hide') : $i18n.t('Show')}</button
										>
									</div>
									<p class="mt-1 text-[11px] text-gray-400">
										{$i18n.t('The key is sent securely and will never be shown again.')}
									</p>
								</label>
							{/if}
						{/if}
						{#if customProvider || ['openai', 'deepseek', 'bailian'].includes(providerId)}
							<details
								class="rounded-lg border border-gray-100 px-3 py-2.5 dark:border-gray-800"
								open={customProvider}
							>
								<summary class="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300"
									>{$i18n.t('Endpoint options')}</summary
								>
								<div class="mt-3 space-y-3">
									<label class="block text-xs text-gray-600 dark:text-gray-300"
										>{$i18n.t('Base URL')}<input
											class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
											bind:value={baseUrl}
											placeholder={provider?.default_base_url ?? 'https://api.example.com/v1'}
										/></label
									>
									{#if providerId === 'bailian'}<div class="grid gap-3 sm:grid-cols-2">
											<label class="block text-xs text-gray-600 dark:text-gray-300"
												>{$i18n.t('Region')}<select
													class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
													bind:value={region}
													><option value="cn-beijing">China (Beijing)</option><option
														value="ap-southeast-1">Asia Pacific (Singapore)</option
													><option value="cn-hongkong">China (Hong Kong)</option><option
														value="eu-central-1">Europe (Frankfurt)</option
													><option value="us-east-1">US (Virginia)</option><option
														value="ap-northeast-1">Asia Pacific (Tokyo)</option
													></select
												></label
											><label class="block text-xs text-gray-600 dark:text-gray-300"
												>{$i18n.t(
													bailianNeedsWorkspace(region)
														? 'Workspace ID (required in this region)'
														: 'Workspace ID (optional)'
												)}<input
													class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
													bind:value={workspaceId}
												/></label
											>
										</div>{/if}
									{#if customProvider}<label class="block text-xs text-gray-600 dark:text-gray-300"
											>{$i18n.t('API type')}<select
												class="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
												bind:value={apiType}
												><option value="openai">Chat Completions</option><option value="responses"
													>Responses API</option
												></select
											></label
										>{/if}
								</div>
							</details>
						{/if}
						{#if isAdmin && !oauthProvider}
							<label class="block text-xs font-medium text-gray-600 dark:text-gray-300"
								>{$i18n.t('Account access')}
								<select
									class="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900"
									bind:value={visibility}
									><option value="private">{$i18n.t('Only me · private')}</option><option
										value="shared">{$i18n.t('Share with selected people')}</option
									></select
								>
							</label>
							{#if visibility === 'shared'}<div
									class="rounded-lg border border-gray-100 p-3 dark:border-gray-800"
								>
									<p class="mb-2 text-xs text-gray-500">
										{$i18n.t('Choose who can use this account')}
									</p>
									<AccessControl
										bind:accessGrants
										accessRoles={['read']}
										sharePublic={false}
										shareOpen={false}
									/>
								</div>{/if}
						{/if}
					{/if}
				</div>
				<div class="mt-6 flex justify-end gap-2">
					<button
						type="button"
						class="rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
						on:click={clearWizard}>{$i18n.t('Cancel')}</button
					>
					{#if provider}<button
							type="button"
							class="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
							disabled={saving || !draftCredentialsReady}
							data-testid="provider-verify"
							on:click={() => (oauthProvider ? beginOAuth() : verifyDraft())}
							>{saving
								? $i18n.t('Checking…')
								: oauthProvider
									? kimi
										? $i18n.t('Start device sign-in')
										: $i18n.t('Start secure sign-in')
									: $i18n.t('Verify and continue')}</button
						>{/if}
					{#if provider && !oauthProvider}<button
							type="button"
							class="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
							disabled={!draftCredentialsReady}
							on:click={() => {
								manualMode = true;
								draftStatus = 'manual';
								verifiedModels = [];
								selectedModelIds = [];
								manualModelInput = '';
								step = 'models';
							}}>{$i18n.t('Enter model IDs manually')}</button
						>{/if}
				</div>
			{:else if step === 'oauth'}
				<div class="mt-5 space-y-4">
					{#if kimi}
						<p class="text-sm text-gray-600 dark:text-gray-300">
							{$i18n.t(
								'Open the Kimi verification page on any device, sign in, and enter this one-time code.'
							)}
						</p>
					{:else}
						<p class="text-sm text-gray-600 dark:text-gray-300">
							{$i18n.t(
								'Open the ChatGPT sign-in page, authorize your account, then paste the complete callback URL below. No terminal or script is needed.'
							)}
						</p>
					{/if}
					{#if oauthAttempt}
						{#if kimi}
							<div class="rounded-xl bg-gray-50 p-4 text-center dark:bg-gray-800/70">
								<p class="text-[10px] uppercase tracking-widest text-gray-400">
									{$i18n.t('DEVICE CODE')}
								</p>
								<p class="mt-2 font-mono text-3xl font-semibold tracking-[0.22em]">
									{oauthAttempt.user_code}
								</p>
								<button
									type="button"
									class="mt-2 text-xs text-blue-600 hover:underline"
									on:click={() => copyText(oauthAttempt.user_code)}>{$i18n.t('Copy code')}</button
								>
							</div>
						{/if}
						{#if kimi}
							<a
								class="block rounded-lg border border-blue-200 px-3 py-2 text-center text-xs text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:hover:bg-blue-950/40"
								href={oauthAttempt.verification_uri_complete}
								target="_blank"
								rel="noreferrer">{$i18n.t('Open Kimi verification page')}</a
							>
						{:else}
							<a
								class="block rounded-lg bg-blue-600 px-3 py-2 text-center text-sm text-white hover:bg-blue-700"
								href={oauthAttempt.authorization_url}
								target="_blank"
								rel="noreferrer noopener">{$i18n.t('Open ChatGPT sign-in page')}</a
							>
							<p class="text-xs text-gray-500">
								{$i18n.t(
									'After authorization, the browser may show that 127.0.0.1 cannot be reached. Copy the entire address from its address bar and return here. Keep this address private.'
								)}
							</p>
							<label class="block text-xs font-medium" for="chatgpt-callback-url"
								>{$i18n.t('Complete callback URL')}</label
							>
							<textarea
								id="chatgpt-callback-url"
								class="w-full resize-y rounded-lg border border-gray-200 bg-transparent p-3 text-xs dark:border-gray-700"
								rows="3"
								bind:value={callbackUrl}
								autocomplete="off"
								spellcheck="false"
								placeholder={`${oauthAttempt.redirect_uri}?code=…&state=…&client_id=…`}
							></textarea>
							<button
								type="button"
								class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
								disabled={submittingCallback || !callbackUrl.trim()}
								on:click={submitChatGPTCallback}
							>
								{submittingCallback ? $i18n.t('Connecting...') : $i18n.t('Complete sign-in')}</button
							>
						{/if}
						<p class="text-center text-[11px] text-gray-400">
							{$i18n.t('Code expires at {{time}}', {
								time: formatExpiry(oauthAttempt.expires_at)
							})}
						</p>
						{#if !error}<p class="animate-pulse text-center text-xs text-gray-500">
								{kimi
									? $i18n.t('Waiting for Kimi authorization…')
									: $i18n.t('Waiting for ChatGPT authorization…')}
							</p>{/if}
					{/if}
				</div>
				<div class="mt-6 flex justify-end">
					<button
						type="button"
						class="rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
						on:click={() => {
							if (oauthAttempt?.attempt_id) {
								(kimi
									? cancelKimiLogin(oauthAttempt.attempt_id)
									: cancelChatGPTLogin(oauthAttempt.attempt_id)
								).catch(() => {});
							}
							stopPolling();
							step = 'setup';
							oauthAttempt = null;
							callbackUrl = '';
						}}>{$i18n.t('Back')}</button
					>
				</div>
			{:else}
				<div class="mt-5">
					<p class="text-xs text-gray-500">
						{$i18n.t(
							'Select the models this account should make available. You can change this later by refreshing the model list.'
						)}
					</p>
					{#if manualMode || verifiedModels.length === 0}
						{#if manualMode}<p
								class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
							>
								{$i18n.t(
									'Credentials could not be verified. Add the upstream model IDs you want to expose; this connection will be marked as manual.'
								)}
							</p>{/if}
						{#if manualMode}<label class="mt-3 block text-xs text-gray-600 dark:text-gray-300"
								>{$i18n.t('Model IDs (one per line or comma-separated)')}<textarea
									class="mt-1.5 min-h-28 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
									bind:value={manualModelInput}
									placeholder="model-name\nanother-model"
								></textarea></label
							>{:else}
							<div
								class="mt-4 rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-500 dark:border-gray-700"
							>
								{$i18n.t(
									'The provider verified successfully but returned no models. Enter model IDs manually to choose which models to expose.'
								)}
							</div>
							<button
								type="button"
								class="mt-2 text-xs text-gray-500 underline underline-offset-2"
								on:click={() => (manualMode = true)}>{$i18n.t('Enter model IDs manually')}</button
							>
						{/if}
					{:else}
						<div
							class="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-gray-100 p-2 dark:border-gray-800"
						>
							{#each verifiedModels as model (model.id)}<label
									class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
									><input
										type="checkbox"
										value={model.upstream_id ?? model.id}
										bind:group={selectedModelIds}
									/><span class="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-200"
										>{model.name ?? model.id}</span
									><span class="max-w-32 truncate text-[10px] text-gray-400"
										>{model.upstream_id ?? model.id}</span
									></label
								>{/each}
						</div>
						<div class="mt-2 flex justify-end">
							<button
								type="button"
								class="text-xs text-gray-500 underline underline-offset-2"
								on:click={() => {
									manualMode = true;
									manualModelInput = selectedModelIds.join('\n');
								}}
							>
								{$i18n.t('Enter model IDs manually')}</button
							>
						</div>
					{/if}
					{#if isAdmin && visibility === 'shared' && !oauthProvider}<p
							class="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
						>
							{$i18n.t('People with access can use this account. The API key stays hidden.')}
						</p>{/if}
				</div>
				<div class="mt-6 flex justify-between">
					<button
						type="button"
						class="rounded-lg px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
						on:click={() => (step = 'setup')}>{$i18n.t('Back')}</button
					><button
						type="button"
						class="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
						disabled={saving || !hasSelectedModels}
						data-testid="provider-save"
						on:click={saveConnection}
						>{saving ? $i18n.t('Saving…') : $i18n.t('Save account')}</button
					>
				</div>
			{/if}
		</div>
	</Modal>
{/if}
