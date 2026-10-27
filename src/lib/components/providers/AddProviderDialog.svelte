<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Modal from '$lib/components/common/Modal.svelte';
	import AccessControl from '$lib/components/workspace/common/AccessControl.svelte';
	import {
		cancelChatGPTLogin,
		cancelKimiLogin,
		completeChatGPTLogin,
		createProviderConnection,
		getChatGPTLoginStatus,
		getKimiLoginStatus,
		verifyProviderDraft,
		startChatGPTLogin,
		startKimiLogin
	} from '$lib/apis/providers';
	import type { ProviderTemplate } from '$lib/apis/providers';
	import { providerErrorHint, providerErrorTitle } from '$lib/utils/provider-errors';
	import { PURPOSE_LABEL_KEYS, purposesOfCandidate } from '$lib/utils/provider-models';

	const i18n: any = getContext('i18n');

	export let show = false;
	export let templates: ProviderTemplate[] = [];
	export let groups: { id: string; label: string; order: number }[] = [];
	export let isAdmin = false;
	export let onCreated: (() => Promise<void>) | undefined = undefined;

	let step: 'template' | 'setup' | 'models' | 'oauth' = 'template';
	let templateId = '';
	let name = '';
	let apiKey = '';
	let baseUrl = '';
	let region = '';
	let workspaceId = '';
	let apiType = 'openai';
	let visibility: 'private' | 'shared' = 'private';
	let accessGrants: any[] = [];
	let candidates: any[] = [];
	let picked: string[] = [];
	let saving = false;
	let error = '';
	let revealApiKey = false;
	let oauthAttempt: any = null;
	let callbackUrl = '';
	let submittingCallback = false;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let pollGeneration = 0;

	$: template = templates.find((item) => item.id === templateId);
	$: isOAuth = template?.auth_types?.includes('oauth') ?? false;
	$: isCustom = templateId === 'custom';
	$: isBailian = templateId === 'bailian';
	$: supportedGroups = groups.filter((group) =>
		templates.some((item) => item.group === group.id && item.supported)
	);

	const readableError = (err: unknown) => String(err).replace(/^Error:\s*/, '');

	const bailianNeedsWorkspace = (value: string) =>
		['eu-central-1', 'us-east-1', 'ap-northeast-1'].includes(value);

	function selectTemplate(item: ProviderTemplate) {
		if (!item.supported) {
			error = item.unsupported_reason ?? $i18n.t('This provider type is not available yet.');
			return;
		}
		templateId = item.id;
		name = item.name;
		apiKey = '';
		baseUrl = item.default_base_url ?? '';
		region = isBailian ? 'cn-beijing' : '';
		workspaceId = '';
		apiType = 'openai';
		candidates = [];
		picked = [];
		error = '';
		step = 'setup';
	}

	function close() {
		stopPolling();
		if (oauthAttempt?.attempt_id) {
			(oauthAttempt.provider_id === 'chatgpt'
				? cancelChatGPTLogin(oauthAttempt.attempt_id)
				: cancelKimiLogin(oauthAttempt.attempt_id)
			).catch(() => {});
		}
		oauthAttempt = null;
		callbackUrl = '';
		show = false;
		step = 'template';
		templateId = '';
		name = '';
		apiKey = '';
		baseUrl = '';
		region = '';
		workspaceId = '';
		apiType = 'openai';
		visibility = 'private';
		accessGrants = [];
		candidates = [];
		picked = [];
		error = '';
	}

	function stopPolling() {
		pollGeneration += 1;
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
	}

	async function created() {
		if (onCreated) await onCreated();
	}

	async function checkConnection() {
		error = '';
		saving = true;
		try {
			const result = await verifyProviderDraft({
				provider_template: templateId,
				name: name.trim() || template?.name || templateId,
				auth_type: isOAuth ? 'oauth' : 'api_key',
				config: {
					...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
					...(region.trim() ? { region: region.trim() } : {}),
					...(workspaceId.trim() ? { workspace_id: workspaceId.trim() } : {}),
					...(isCustom ? { api_type: apiType } : {})
				},
				...(apiKey ? { api_key: apiKey } : {})
			});
			candidates = result?.models ?? [];
			picked = candidates.map((model: any) => model.upstream_id ?? model.id);
			step = 'models';
		} catch (err) {
			error = readableError(err);
		} finally {
			saving = false;
		}
	}

	function togglePick(upstreamId: string) {
		picked = picked.includes(upstreamId)
			? picked.filter((item) => item !== upstreamId)
			: [...picked, upstreamId];
	}

	async function saveConnection() {
		error = '';
		saving = true;
		try {
			await createProviderConnection({
				provider_template: templateId,
				name: name.trim() || template?.name || templateId,
				auth_type: isOAuth ? 'oauth' : 'api_key',
				visibility: isAdmin ? visibility : 'private',
				config: {
					...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
					...(region.trim() ? { region: region.trim() } : {}),
					...(workspaceId.trim() ? { workspace_id: workspaceId.trim() } : {}),
					...(isCustom ? { api_type: apiType } : {}),
					model_ids: picked
				},
				...(apiKey ? { api_key: apiKey } : {}),
				...(isAdmin && visibility === 'shared' ? { access_control: accessGrants } : {})
			});
			await created();
			toast.success($i18n.t('Provider connection saved'));
			close();
		} catch (err) {
			error = readableError(err);
		} finally {
			saving = false;
		}
	}

	async function beginOAuth() {
		if (saving) return;
		saving = true;
		error = '';
		stopPolling();
		const generation = pollGeneration;
		const signingProvider = templateId;
		try {
			const attempt =
				signingProvider === 'kimi' ? await startKimiLogin() : await startChatGPTLogin();
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
							await created();
							toast.success(
								$i18n.t('{{provider}} account connected', { provider: template?.name })
							);
							close();
						} else if (['failed', 'expired', 'error'].includes(state.status)) {
							stopPolling();
							error =
								state.message ||
								$i18n.t('{{provider}} sign-in {{status}}', {
									provider: template?.name,
									status: state.status
								});
						} else if (state.status === 'denied') {
							stopPolling();
							error = $i18n.t('{{provider}} authorization was denied.', {
								provider: template?.name ?? signingProvider
							});
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
	}

	async function submitCallback() {
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
			await created();
			toast.success($i18n.t('{{provider}} account connected', { provider: template?.name }));
			close();
		} catch (err) {
			if (oauthAttempt?.attempt_id === attemptId) error = readableError(err);
		} finally {
			if (oauthAttempt?.attempt_id === attemptId) callbackUrl = '';
			submittingCallback = false;
		}
	}

	onDestroy(stopPolling);
</script>

<Modal bind:show size="md">
	<div class="flex flex-col gap-4" aria-labelledby="provider-wizard-title">
		<h3 id="provider-wizard-title" class="text-lg font-semibold">{$i18n.t('Add a provider')}</h3>

		{#if step === 'template'}
			<div class="max-h-[60vh] space-y-4 overflow-y-auto">
				{#each supportedGroups as group}
					<div>
						<p class="mb-2 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
							{group.label}
						</p>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each templates.filter((item) => item.group === group.id) as item}
								<button
									type="button"
									class="rounded-xl border p-3 text-left disabled:opacity-60 {item.supported
										? 'border-gray-200 hover:border-blue-400 dark:border-gray-700'
										: 'border-dashed'}"
									disabled={!item.supported}
									data-testid={`provider-template-${item.id}`}
									on:click={() => selectTemplate(item)}
								>
									<span class="block font-medium">{item.name}</span>
									<span class="block text-xs text-gray-500 dark:text-gray-400">
										{item.protocol_label ?? item.protocol}
									</span>
									{#if !item.supported}
										<span class="mt-1 block text-xs text-amber-600 dark:text-amber-400">
											{item.unsupported_reason}
										</span>
									{/if}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if step === 'setup'}
			<div class="space-y-3">
				<label class="block text-xs">
					{$i18n.t('Account name')}
					<input
						class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
						bind:value={name}
						maxlength="100"
					/>
				</label>

				{#if !isOAuth}
					<label class="block text-xs">
						{$i18n.t('API key')}
						<div class="mt-1 flex gap-2">
							<input
								class="w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
								type={revealApiKey ? 'text' : 'password'}
								bind:value={apiKey}
								autocomplete="new-password"
								placeholder={$i18n.t('Leave blank to keep the current key')}
							/>
							<button
								type="button"
								class="rounded-lg border px-3 text-xs dark:border-gray-700"
								on:click={() => (revealApiKey = !revealApiKey)}
							>
								{revealApiKey ? $i18n.t('Hide') : $i18n.t('Show')}
							</button>
						</div>
					</label>
				{/if}

				<label class="block text-xs">
					{$i18n.t('API address')}
					<input
						class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
						bind:value={baseUrl}
						placeholder={template?.default_base_url ?? 'https://api.example.com/v1'}
					/>
				</label>

				{#if isBailian}
					<div class="grid gap-2 sm:grid-cols-2">
						<label class="block text-xs">
							{$i18n.t('Region')}
							<select
								class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
								bind:value={region}
							>
								<option value="cn-beijing">cn-beijing</option>
								<option value="ap-southeast-1">ap-southeast-1</option>
								<option value="cn-hongkong">cn-hongkong</option>
								<option value="eu-central-1">eu-central-1</option>
								<option value="us-east-1">us-east-1</option>
								<option value="ap-northeast-1">ap-northeast-1</option>
							</select>
						</label>
						<label class="block text-xs">
							{$i18n.t('Workspace ID')}
							<input
								class="mt-1 w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
								bind:value={workspaceId}
							/>
						</label>
					</div>
				{/if}

				{#if isCustom}
					<label class="block text-xs">
						{$i18n.t('API type')}
						<select
							class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
							bind:value={apiType}
						>
							<option value="openai">openai</option>
							<option value="responses">responses</option>
						</select>
					</label>
				{/if}

				{#if isAdmin}
					<label class="block text-xs">
						{$i18n.t('Visibility')}
						<select
							class="mt-1 w-full rounded-lg bg-gray-100 p-2 dark:bg-gray-800"
							bind:value={visibility}
						>
							<option value="private">{$i18n.t('Private')}</option>
							<option value="shared">{$i18n.t('Shared')}</option>
						</select>
					</label>
					{#if visibility === 'shared'}
						<AccessControl bind:accessGrants accessRoles={['read']} />
					{/if}
				{/if}

				<div class="flex flex-wrap justify-between gap-2">
					<button
						type="button"
						class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
						data-testid="provider-back"
						on:click={() => (step = 'template')}
					>
						{$i18n.t('Back')}
					</button>
					{#if isOAuth}
						<button
							type="button"
							class="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
							disabled={saving}
							data-testid="provider-verify"
							on:click={beginOAuth}
						>
							{$i18n.t('Sign in with {{provider}}', { provider: template?.name ?? '' })}
						</button>
					{:else}
						<button
							type="button"
							class="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
							disabled={saving ||
								!apiKey.trim() ||
								(isCustom && !baseUrl.trim()) ||
								(isBailian && bailianNeedsWorkspace(region) && !workspaceId.trim())}
							data-testid="provider-verify"
							on:click={checkConnection}
						>
							{saving ? $i18n.t('Checking…') : $i18n.t('Check connection')}
						</button>
					{/if}
				</div>
			</div>
		{:else if step === 'models'}
			<div class="space-y-3">
				<p class="text-xs text-gray-600 dark:text-gray-300">
					{$i18n.t('Pick the models you want to use. You can change this later.')}
				</p>
				{#if candidates.length === 0}
					<p class="rounded-lg border border-dashed p-3 text-xs">
						{$i18n.t(
							'The provider did not return a model list. You can continue and add model IDs later.'
						)}
					</p>
				{:else}
					<div class="max-h-[45vh] space-y-1 overflow-y-auto">
						{#each candidates as candidate (candidate.upstream_id ?? candidate.id)}
							<label
								class="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
							>
								<input
									type="checkbox"
									checked={picked.includes(candidate.upstream_id ?? candidate.id)}
									on:change={() => togglePick(candidate.upstream_id ?? candidate.id)}
								/>
								<span class="min-w-0">
									<span class="block break-all">{candidate.name ?? candidate.upstream_id}</span>
									<span class="block break-all text-xs text-gray-500 dark:text-gray-400">
										{candidate.upstream_id}
										{purposesOfCandidate(candidate).length > 0
											? `· ${purposesOfCandidate(candidate)
													.map((purpose) => $i18n.t(PURPOSE_LABEL_KEYS[purpose]))
													.join(' / ')}`
											: ''}
									</span>
								</span>
							</label>
						{/each}
					</div>
				{/if}
				<div class="flex flex-wrap justify-between gap-2">
					<button
						type="button"
						class="rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
						data-testid="provider-back"
						on:click={() => (step = 'setup')}
					>
						{$i18n.t('Back')}
					</button>
					<button
						type="button"
						class="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
						disabled={saving || (candidates.length > 0 && picked.length === 0)}
						data-testid="provider-save"
						on:click={saveConnection}
					>
						{$i18n.t('Save provider')}
					</button>
				</div>
			</div>
		{:else if step === 'oauth'}
			<div class="space-y-3">
				{#if templateId === 'chatgpt'}
					<p class="text-xs">
						{$i18n.t('Open the authorization page, then paste the final URL back here.')}
					</p>
					<a
						class="break-all text-sm text-blue-600 underline dark:text-blue-300"
						href={oauthAttempt?.authorization_url ?? '#'}
						target="_blank"
						rel="noreferrer"
					>
						{oauthAttempt?.authorization_url ?? ''}
					</a>
					<label class="block text-xs">
						{$i18n.t('Callback URL')}
						<div class="mt-1 flex gap-2">
							<input
								id="chatgpt-callback-url"
								class="w-full rounded-lg border bg-transparent p-2 dark:border-gray-700"
								bind:value={callbackUrl}
							/>
							<button
								type="button"
								class="rounded-lg border px-3 text-xs disabled:opacity-50 dark:border-gray-700"
								disabled={submittingCallback || !callbackUrl.trim()}
								on:click={submitCallback}
							>
								{$i18n.t('Submit')}
							</button>
						</div>
					</label>
				{:else}
					<p class="text-xs">
						{$i18n.t('Open the verification page and enter the code below.')}
					</p>
					<a
						class="break-all text-sm text-blue-600 underline dark:text-blue-300"
						href={oauthAttempt?.verification_uri_complete ?? oauthAttempt?.verification_uri ?? '#'}
						target="_blank"
						rel="noreferrer"
					>
						{oauthAttempt?.verification_uri_complete ?? oauthAttempt?.verification_uri ?? ''}
					</a>
					<p class="rounded-lg bg-gray-100 p-3 font-mono text-sm dark:bg-gray-800">
						{oauthAttempt?.user_code ?? ''}
					</p>
				{/if}
				<p class="text-xs text-gray-500 dark:text-gray-400">
					{$i18n.t('Waiting for the provider to confirm the sign-in…')}
				</p>
			</div>
		{/if}

		{#if error}
			<p
				role="status"
				class="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300"
			>
				{error}
			</p>
		{/if}

		{#if step !== 'template'}
			<button
				type="button"
				class="self-end rounded-lg border px-3 py-2 text-sm dark:border-gray-700"
				aria-label={$i18n.t('Cancel')}
				on:click={close}
			>
				{$i18n.t('Cancel')}
			</button>
		{/if}
	</div>
</Modal>
