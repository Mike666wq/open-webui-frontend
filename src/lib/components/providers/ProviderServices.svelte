<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ProviderCallHistory from '$lib/components/ProviderCallHistory.svelte';
	import ProviderLegacyMigration from '$lib/components/ProviderLegacyMigration.svelte';
	import AddProviderDialog from '$lib/components/providers/AddProviderDialog.svelte';
	import ProviderModelsPanel from '$lib/components/providers/ProviderModelsPanel.svelte';
	import AccessControl from '$lib/components/workspace/common/AccessControl.svelte';
	import { getModels as fetchModels } from '$lib/apis';
	import { config as backendConfig, models, settings, user } from '$lib/stores';
	import {
		deleteProviderConnection,
		disconnectChatGPTConnection,
		disconnectKimiConnection,
		getProviderCatalog,
		getProviderConnections,
		setProviderConnectionEnabled,
		startChatGPTLogin,
		startKimiLogin,
		updateProviderConnection,
		verifyProviderConnection
	} from '$lib/apis/providers';
	import type { ProviderTemplate } from '$lib/apis/providers';

	const i18n: any = getContext('i18n');

	export let mode: 'personal' | 'admin' = 'personal';

	let templates: ProviderTemplate[] = [];
	let groups: { id: string; label: string; order: number }[] = [];
	let connections: any[] = [];
	let selectedConnectionId = '';
	let detailTab = 'models';
	let mobileDetail = false;
	let loading = true;
	let saving = false;
	let workingId = '';
	let error = '';
	let addOpen = false;

	let editingId = '';
	let editName = '';
	let editVisibility: 'private' | 'shared' = 'private';
	let editGrants: any[] = [];
	let editApiKey = '';
	let editBaseUrl = '';
	let editRegion = '';
	let editWorkspaceId = '';
	let editApiType = 'openai';

	$: selected = connections.find((item) => item.id === selectedConnectionId) ?? null;
	$: isAdmin = mode === 'admin';
	$: canManageConnection = (connection: any) =>
		connection.visibility === 'shared'
			? $user?.role === 'admin'
			: connection.owner_id === $user?.id;
	$: isOAuthConnection = (connection: any) =>
		['chatgpt', 'kimi'].includes(connection.provider_id) && connection.auth_type === 'oauth';
	$: templateFor = (connection: any) =>
		templates.find(
			(item) => item.id === (connection?.provider_template ?? connection?.provider_id)
		);

	const readableError = (err: unknown) => String(err).replace(/^Error:\s*/, '');

	const load = async () => {
		loading = connections.length === 0;
		error = '';
		try {
			const [catalog, rows] = await Promise.all([getProviderCatalog(), getProviderConnections()]);
			templates = catalog?.data ?? [];
			groups = catalog?.groups ?? [];
			connections = Array.isArray(rows) ? rows : (rows?.connections ?? []);
			if (!connections.some((item) => item.id === selectedConnectionId)) {
				selectedConnectionId = connections[0]?.id ?? '';
			}
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

	const toggleEnabled = async (connection: any) => {
		workingId = connection.id;
		try {
			await setProviderConnectionEnabled(connection.id, connection.is_enabled === false);
			await load();
			await refreshGlobalModels();
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const verifySaved = async (connection: any) => {
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

	const removeConnection = async (connection: any) => {
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

	const reconnect = async (connection: any) => {
		workingId = connection.id;
		try {
			const attempt =
				connection.provider_id === 'kimi'
					? await startKimiLogin(connection.id)
					: await startChatGPTLogin(connection.id);
			if (attempt?.authorization_url) {
				window.open(attempt.authorization_url, '_blank', 'noopener');
				toast.info($i18n.t('Finish the sign-in in the browser, then refresh this page.'));
			} else if (attempt?.verification_uri) {
				window.open(attempt.verification_uri, '_blank', 'noopener');
				toast.info(
					$i18n.t('Enter the code {{code}} in the provider page.', {
						code: attempt.user_code ?? ''
					})
				);
			}
		} catch (err) {
			toast.error(readableError(err));
		} finally {
			workingId = '';
		}
	};

	const beginEdit = (connection: any) => {
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
	};

	const saveEdit = async (connection: any) => {
		workingId = connection.id;
		try {
			const payload: Record<string, unknown> = { name: editName.trim() };
			if (!isOAuthConnection(connection)) {
				const nextConfig = {
					...(editBaseUrl.trim() ? { base_url: editBaseUrl.trim() } : {}),
					...(editRegion.trim() ? { region: editRegion.trim() } : {}),
					...(editWorkspaceId.trim() ? { workspace_id: editWorkspaceId.trim() } : {}),
					...(connection.provider_id === 'custom' ? { api_type: editApiType } : {}),
					model_ids: connection.config?.model_ids ?? []
				};
				const oldConfig = connection.config ?? {};
				const configChanged =
					(editBaseUrl.trim() || undefined) !== (oldConfig.base_url || undefined) ||
					(editRegion.trim() || undefined) !== (oldConfig.region || undefined) ||
					(editWorkspaceId.trim() || undefined) !== (oldConfig.workspace_id || undefined) ||
					(connection.provider_id === 'custom' && editApiType !== (oldConfig.api_type ?? 'openai'));
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

	onMount(load);
</script>

<section
	class="rounded-xl border border-gray-100 dark:bg-gray-850 border-gray-100 bg-white/70 dark:border-gray-850 p-4"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h3 class="font-medium">{$i18n.t('Model services')}</h3>
			<p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
				{$i18n.t('Add a provider, pick the models you want, and use them in the chat selector.')}
			</p>
		</div>
		<button
			type="button"
			class="rounded-lg bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black"
			data-testid="provider-add"
			on:click={() => (addOpen = true)}
		>
			{$i18n.t('Add provider')}
		</button>
	</div>

	{#if error}
		<div
			class="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300"
			role="status"
		>
			<span>{error}</span>
			<button type="button" class="underline" on:click={load}>{$i18n.t('Try again')}</button>
		</div>
	{/if}

	{#if loading}
		<p class="py-6 text-center text-sm text-gray-600 dark:text-gray-300">
			{$i18n.t('Loading provider accounts…')}
		</p>
	{:else if connections.length === 0}
		<div
			class="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-gray-600 dark:text-gray-300"
		>
			{$i18n.t('No provider yet. Add OpenAI, MiniMax, DeepSeek, ChatGPT or a compatible endpoint.')}
		</div>
	{:else}
		<div class="mt-4 grid min-w-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
			<nav
				class:hidden={mobileDetail}
				class="space-y-2 md:!block"
				aria-label={$i18n.t('Providers')}
				data-testid="provider-list"
			>
				{#each connections as item (item.id)}
					<div
						class="flex items-center gap-2 rounded-xl border p-2 {selectedConnectionId === item.id
							? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
							: 'border-gray-200 dark:border-gray-700'}"
					>
						<button
							type="button"
							class="min-w-0 flex-1 text-left"
							on:click={() => {
								selectedConnectionId = item.id;
								mobileDetail = true;
								editingId = '';
							}}
						>
							<span class="block truncate text-sm font-medium">{item.name}</span>
							<span class="block truncate text-xs text-gray-500 dark:text-gray-400">
								{templateFor(item)?.name ?? item.provider_id}
								· {item.models?.length ?? 0}
								{$i18n.t('models')}
							</span>
						</button>
						{#if canManageConnection(item)}
							<input
								type="checkbox"
								class="shrink-0"
								checked={item.is_enabled !== false}
								disabled={workingId === item.id}
								aria-label={$i18n.t('Enable {{name}}', { name: item.name })}
								on:change={() => toggleEnabled(item)}
							/>
						{/if}
					</div>
				{/each}
			</nav>

			<div class:hidden={!mobileDetail} class="min-w-0 md:!block">
				<button
					type="button"
					class="mb-3 text-sm text-blue-600 dark:text-blue-300 md:hidden"
					on:click={() => (mobileDetail = false)}
				>
					← {$i18n.t('Provider list')}
				</button>

				{#if selected}
					<div
						class="mb-4 flex flex-wrap gap-2"
						role="tablist"
						aria-label={$i18n.t('Provider details')}
					>
						{#each [['settings', $i18n.t('Connection settings')], ['models', $i18n.t('Models')], ['calls', $i18n.t('Call history')]] as [id, label]}
							<button
								type="button"
								role="tab"
								aria-selected={detailTab === id}
								class="rounded-lg px-3 py-2 text-sm {detailTab === id
									? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
									: 'text-gray-700 dark:text-gray-200'}"
								on:click={() => {
									detailTab = id;
									editingId = '';
								}}
							>
								{label}
							</button>
						{/each}
					</div>

					{#if detailTab === 'models'}
						<ProviderModelsPanel
							connection={selected}
							canManage={canManageConnection(selected)}
							onUpdated={async () => {
								await load();
								await refreshGlobalModels();
							}}
						/>
					{:else if detailTab === 'calls'}
						{#key selected.id}<ProviderCallHistory connectionId={selected.id} />{/key}
					{:else if editingId === selected.id}
						<div class="space-y-3">
							<label class="block text-xs text-gray-600 dark:text-gray-300">
								{$i18n.t('Account name')}
								<input
									class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
									bind:value={editName}
									maxlength="80"
								/>
							</label>
							{#if !isOAuthConnection(selected)}
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
								<label class="block text-xs text-gray-600 dark:text-gray-300">
									{$i18n.t('API address')}
									<input
										class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
										bind:value={editBaseUrl}
									/>
								</label>
								{#if selected.provider_id === 'bailian'}
									<div class="grid gap-2 sm:grid-cols-2">
										<label class="block text-xs text-gray-600 dark:text-gray-300">
											{$i18n.t('Region')}
											<select
												class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
												bind:value={editRegion}
											>
												<option value="cn-beijing">cn-beijing</option>
												<option value="ap-southeast-1">ap-southeast-1</option>
												<option value="cn-hongkong">cn-hongkong</option>
												<option value="eu-central-1">eu-central-1</option>
												<option value="us-east-1">us-east-1</option>
												<option value="ap-northeast-1">ap-northeast-1</option>
											</select>
										</label>
										<label class="block text-xs text-gray-600 dark:text-gray-300">
											{$i18n.t('Workspace ID')}
											<input
												class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
												bind:value={editWorkspaceId}
											/>
										</label>
									</div>
								{/if}
								{#if selected.provider_id === 'custom'}
									<label class="block text-xs text-gray-600 dark:text-gray-300">
										{$i18n.t('API type')}
										<select
											class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
											bind:value={editApiType}
										>
											<option value="openai">openai</option>
											<option value="responses">responses</option>
										</select>
									</label>
								{/if}
							{/if}
							{#if isAdmin && !isOAuthConnection(selected)}
								<label class="block text-xs text-gray-600 dark:text-gray-300">
									{$i18n.t('Visibility')}
									<select
										class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
										bind:value={editVisibility}
									>
										<option value="private">{$i18n.t('Private')}</option>
										<option value="shared">{$i18n.t('Shared')}</option>
									</select>
								</label>
								{#if editVisibility === 'shared'}
									<AccessControl bind:accessGrants={editGrants} accessRoles={['read']} />
								{/if}
							{/if}
							<div class="flex flex-wrap gap-2">
								<button
									type="button"
									class="rounded-lg bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black"
									disabled={workingId === selected.id}
									on:click={() => saveEdit(selected)}
								>
									{$i18n.t('Save')}
								</button>
								<button
									type="button"
									class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
									on:click={() => (editingId = '')}
								>
									{$i18n.t('Cancel')}
								</button>
							</div>
						</div>
					{:else}
						<div class="space-y-3">
							<div class="flex flex-wrap items-center gap-2" data-testid="provider-account-row">
								<h4 class="break-all font-medium text-gray-900 dark:text-white">
									{selected.name}
								</h4>
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
									{templateFor(selected)?.protocol_label ?? selected.protocol}
								</span>
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
									{selected.visibility === 'shared' ? $i18n.t('Shared') : $i18n.t('Private')}
								</span>
								<span class="text-xs text-gray-500 dark:text-gray-400">
									{selected.models?.length ?? 0}
									{$i18n.t('models')}
								</span>
							</div>
							<div class="flex flex-wrap gap-2">
								{#if canManageConnection(selected)}
									<button
										type="button"
										class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
										on:click={() => beginEdit(selected)}
									>
										{$i18n.t('Edit')}
									</button>
									<button
										type="button"
										class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
										disabled={workingId === selected.id}
										on:click={() => verifySaved(selected)}
									>
										{$i18n.t('Check connection')}
									</button>
									{#if isOAuthConnection(selected)}
										<button
											type="button"
											class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
											disabled={workingId === selected.id}
											on:click={() => reconnect(selected)}
										>
											{$i18n.t('Sign in again')}
										</button>
									{/if}
									<button
										type="button"
										class="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-800"
										disabled={workingId === selected.id}
										on:click={() => removeConnection(selected)}
									>
										{$i18n.t('Remove')}
									</button>
								{/if}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if isAdmin}
		<ProviderLegacyMigration />
	{/if}
</section>

<AddProviderDialog
	bind:show={addOpen}
	{templates}
	{groups}
	{isAdmin}
	onCreated={async () => {
		await load();
		await refreshGlobalModels();
	}}
/>
