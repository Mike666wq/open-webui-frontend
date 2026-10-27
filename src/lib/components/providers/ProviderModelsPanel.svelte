<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		addProviderModels,
		fetchProviderModels,
		removeProviderModel,
		testProviderModel,
		updateProviderModel
	} from '$lib/apis/providers';
	import {
		providerErrorActionLabelKey,
		providerErrorHint,
		providerErrorSummary
	} from '$lib/utils/provider-errors';
	import {
		PURPOSE_ADAPTERS,
		PURPOSE_LABEL_KEYS,
		PROVIDER_PURPOSES,
		candidatePool,
		purposesOf,
		purposesOfCandidate,
		supportsPurpose,
		verificationLabel
	} from '$lib/utils/provider-models';

	const i18n: any = getContext('i18n');

	export let connection: any;
	export let canManage = true;
	export let onUpdated: (() => Promise<void>) | undefined = undefined;

	let candidates: any[] = [];
	let picked: string[] = [];
	let fetching = false;
	let busy = false;
	let message = '';
	let editing = '';
	let editingUses: Record<string, string> = {};
	let renaming = '';
	let renameValue = '';
	let previousConnection = '';

	$: if (connection?.id !== previousConnection) {
		previousConnection = connection?.id;
		candidates = [];
		picked = [];
		message = '';
		editing = '';
		editingUses = {};
	}

	$: models = (connection?.models ?? []) as any[];
	$: pool = candidatePool(candidates, models);
	$: fetchError = connection?.catalog?.error ?? null;
	$: fetchErrorContext = { authType: connection?.auth_type ?? null };

	async function updated() {
		if (onUpdated) await onUpdated();
	}

	const readableError = (err: unknown) => String(err).replace(/^Error:\s*/, '');

	async function fetchModels() {
		fetching = true;
		message = '';
		try {
			const result = await fetchProviderModels(connection.id);
			candidates = result?.candidates ?? [];
			picked = [];
			if (result?.error) {
				message = providerErrorSummary(result.error);
			} else {
				message = $i18n.t('Fetched {{count}} models from the provider', {
					count: candidates.length
				});
			}
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			fetching = false;
		}
	}

	function togglePick(upstreamId: string) {
		picked = picked.includes(upstreamId)
			? picked.filter((item) => item !== upstreamId)
			: [...picked, upstreamId];
	}

	async function addPicked() {
		if (picked.length === 0) return;
		busy = true;
		message = '';
		try {
			await addProviderModels(connection.id, { upstream_ids: picked });
			picked = [];
			message = $i18n.t('Added to the model list');
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}

	async function removeModel(model: any) {
		if (
			!confirm(
				$i18n.t('Remove {{name}} from the model list?', { name: model.name ?? model.upstream_id })
			)
		)
			return;
		busy = true;
		message = '';
		try {
			await removeProviderModel(connection.id, model.upstream_id);
			message = $i18n.t('Removed from the model list');
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}

	async function toggleEnabled(model: any) {
		busy = true;
		message = '';
		try {
			await updateProviderModel(connection.id, model.upstream_id, {
				enabled: model.enabled === false
			});
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}

	async function savePurposes(model: any) {
		busy = true;
		message = '';
		try {
			const uses: Record<string, string> = {};
			for (const purpose of PROVIDER_PURPOSES) {
				const adapter = editingUses[purpose];
				if (adapter) uses[purpose] = adapter;
			}
			await updateProviderModel(connection.id, model.upstream_id, { uses });
			editing = '';
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}

	function startPurposeEdit(model: any) {
		editing = model.upstream_id;
		editingUses = { ...(model.uses ?? {}) };
	}

	function togglePurpose(purpose: string) {
		const uses = { ...editingUses };
		const adapter = PURPOSE_ADAPTERS[purpose as keyof typeof PURPOSE_ADAPTERS]?.[0];
		if (uses[purpose]) {
			delete uses[purpose];
		} else if (adapter) {
			uses[purpose] = adapter;
		}
		editingUses = uses;
	}

	function startRename(model: any) {
		renaming = model.upstream_id;
		renameValue = model.name ?? model.upstream_id;
	}

	async function saveRename(model: any) {
		busy = true;
		message = '';
		try {
			await updateProviderModel(connection.id, model.upstream_id, {
				display_name: renameValue.trim() || model.upstream_id
			});
			renaming = '';
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}

	async function testModel(model: any, purpose: string) {
		const confirmed = confirm(
			$i18n.t(
				'This sends one {{purpose}} request to {{model}} and may consume quota. It is never retried automatically. Continue?',
				{
					purpose: $i18n.t(PURPOSE_LABEL_KEYS[purpose as keyof typeof PURPOSE_LABEL_KEYS]),
					model: model.name ?? model.upstream_id
				}
			)
		);
		if (!confirmed) return;
		busy = true;
		message = '';
		try {
			const result = await testProviderModel(connection.id, {
				upstream_id: model.upstream_id,
				purpose
			});
			message =
				result?.status === 'passed'
					? $i18n.t('The request passed. It does not mean every parameter is compatible.')
					: `${$i18n.t('The request failed')}: ${providerErrorHint(result?.error)}`;
			await updated();
		} catch (err) {
			message = readableError(err);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="min-w-0 space-y-4 text-sm"
	aria-label={$i18n.t('Provider models')}
	data-testid="provider-models"
>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="min-w-0">
			<p class="font-medium">
				{$i18n.t('{{count}} models in use', { count: models.length })}
			</p>
			<p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
				{$i18n.t('Only the models you pick are offered in the chat selector.')}
			</p>
		</div>
		{#if canManage}
			<button
				type="button"
				class="rounded-lg border px-3 py-2 dark:border-gray-700"
				disabled={fetching}
				on:click={fetchModels}
			>
				{fetching ? $i18n.t('Fetching…') : $i18n.t('Fetch model list')}
			</button>
		{/if}
	</div>

	{#if fetchError}
		<div
			class="rounded-xl border border-amber-400 bg-amber-50/70 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
			role="status"
			data-testid="provider-models-error"
		>
			<p class="break-words">{providerErrorSummary(fetchError)}</p>
			<p class="mt-1">
				{$i18n.t('Suggested action: {{action}}', {
					action: $i18n.t(providerErrorActionLabelKey(fetchError, fetchErrorContext))
				})}
			</p>
			<p class="mt-1 leading-relaxed">{providerErrorHint(fetchError)}</p>
		</div>
	{/if}

	{#if connection?.catalog?.updated_at}
		<p class="text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t('Last fetched')}: {new Date(connection.catalog.updated_at * 1000).toLocaleString()}
		</p>
	{/if}

	{#if canManage && pool.length > 0}
		<div class="rounded-xl border border-dashed p-3 dark:border-gray-700">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="font-medium">
					{$i18n.t('{{count}} models are not added yet', { count: pool.length })}
				</p>
				<button
					type="button"
					class="rounded-lg border px-3 py-2 disabled:opacity-50 dark:border-gray-700"
					disabled={busy || picked.length === 0}
					on:click={addPicked}
				>
					{$i18n.t('Add selected ({{count}})', { count: picked.length })}
				</button>
			</div>
			<div class="mt-2 max-h-56 space-y-1 overflow-y-auto">
				{#each pool as candidate (candidate.upstream_id)}
					<label
						class="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
					>
						<input
							type="checkbox"
							checked={picked.includes(candidate.upstream_id)}
							on:change={() => togglePick(candidate.upstream_id)}
						/>
						<span class="min-w-0">
							<span class="block break-all">{candidate.display_name ?? candidate.upstream_id}</span>
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
		</div>
	{/if}

	{#if models.length === 0}
		<p class="rounded-xl border border-dashed p-4 text-center text-gray-600 dark:text-gray-300">
			{$i18n.t('No models yet. Fetch the model list and pick the ones you want.')}
		</p>
	{:else}
		<div class="space-y-2">
			{#each models as model (model.upstream_id)}
				<article class="rounded-xl border p-3 dark:border-gray-700">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div class="min-w-0">
							{#if renaming === model.upstream_id}
								<input
									class="w-full rounded-lg border bg-transparent p-1 dark:border-gray-700"
									bind:value={renameValue}
									aria-label={$i18n.t('Model name')}
								/>
							{:else}
								<p class="break-all font-medium">{model.name ?? model.upstream_id}</p>
							{/if}
							<p class="break-all text-xs text-gray-600 dark:text-gray-300">{model.upstream_id}</p>
						</div>
						{#if canManage}
							<label class="flex shrink-0 items-center gap-1 text-xs">
								<input
									type="checkbox"
									checked={model.enabled !== false}
									disabled={busy}
									aria-label={$i18n.t('Enable {{name}}', { name: model.upstream_id })}
									on:change={() => toggleEnabled(model)}
								/>
								{$i18n.t('Enabled')}
							</label>
						{/if}
					</div>

					<div class="mt-2 flex flex-wrap gap-1">
						{#each purposesOf(model) as purpose}
							<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
								{$i18n.t(PURPOSE_LABEL_KEYS[purpose])}
							</span>
						{/each}
						{#if purposesOf(model).length === 0}
							<span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800">
								{$i18n.t('No purpose set')}
							</span>
						{/if}
					</div>

					{#if editing === model.upstream_id}
						<div class="mt-2 space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
							{#each PROVIDER_PURPOSES as purpose}
								{#if supportsPurpose(connection?.protocol, purpose)}
									<label class="flex items-center gap-2 text-xs">
										<input
											type="checkbox"
											checked={Boolean(editingUses[purpose])}
											on:change={() => togglePurpose(purpose)}
										/>
										{$i18n.t(PURPOSE_LABEL_KEYS[purpose])}
									</label>
								{/if}
							{/each}
							<button
								type="button"
								class="rounded-lg border px-3 py-1 text-xs disabled:opacity-50 dark:border-gray-700"
								disabled={busy}
								on:click={() => savePurposes(model)}
							>
								{$i18n.t('Save purposes')}
							</button>
						</div>
					{/if}

					{#if canManage}
						<div class="mt-2 flex flex-wrap gap-2 text-xs">
							<button
								type="button"
								class="rounded-lg border px-2 py-1 dark:border-gray-700"
								on:click={() =>
									editing === model.upstream_id ? (editing = '') : startPurposeEdit(model)}
							>
								{$i18n.t('Purposes')}
							</button>
							<button
								type="button"
								class="rounded-lg border px-2 py-1 dark:border-gray-700"
								on:click={() => startRename(model)}
							>
								{$i18n.t('Rename')}
							</button>
							{#if renaming === model.upstream_id}
								<button
									type="button"
									class="rounded-lg border px-2 py-1 dark:border-gray-700"
									disabled={busy}
									on:click={() => saveRename(model)}
								>
									{$i18n.t('Save')}
								</button>
							{/if}
							{#each purposesOf(model) as purpose}
								<button
									type="button"
									class="rounded-lg border px-2 py-1 dark:border-gray-700"
									disabled={busy}
									on:click={() => testModel(model, purpose)}
								>
									{$i18n.t('Test {{purpose}}', {
										purpose: $i18n.t(PURPOSE_LABEL_KEYS[purpose])
									})}
									· {verificationLabel(model.verification, purpose)}
								</button>
							{/each}
							<button
								type="button"
								class="rounded-lg border border-red-300 px-2 py-1 text-red-600 dark:border-red-800"
								disabled={busy}
								on:click={() => removeModel(model)}
							>
								{$i18n.t('Remove')}
							</button>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}

	{#if message}
		<p role="status" class="rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-800">{message}</p>
	{/if}
</section>
