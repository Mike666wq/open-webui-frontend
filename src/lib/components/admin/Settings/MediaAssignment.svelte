<script lang="ts">
	/**
	 * One page for the four media purposes.
	 *
	 * Each purpose used to be configured inside its own settings tab with its
	 * own engine, URL and key, while provider connections described the same
	 * services. That is how production ended up with speech pointing at a
	 * transcription URL and image still holding a plaintext key. Here a purpose
	 * is a single row: which connection, which model, whether it actually works.
	 */
	import { getContext, onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import {
		getMediaAssignment,
		assignMediaPurpose,
		revertMediaPurpose,
		type MediaAssignmentCandidate,
		type MediaAssignmentPurpose,
		type MediaAssignmentView
	} from '$lib/apis/providers';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		connectionBlockedReason,
		emptyWhitelistHint,
		isAssignable,
		modeLabel,
		primaryReason,
		secretPlaceholder
	} from './media-assignment';

	const i18n: any = getContext('i18n');

	let loading = true;
	let busyPurpose = '';
	let view: MediaAssignmentView | null = null;
	let drafts: Record<string, { connectionId: string; modelId: string }> = {};

	$: purposes = view?.purposes ?? [];
	$: candidates = view?.candidates ?? {};

	const candidatesFor = (purpose: string): MediaAssignmentCandidate[] =>
		candidates[purpose] ?? [];

	const draftOf = (purpose: string) => drafts[purpose] ?? { connectionId: '', modelId: '' };

	/*
	 * Models in the second dropdown depend on the connection picked in the
	 * first. A reactive statement only tracks variables it references directly
	 * — a helper function reading `drafts` inside its own body does not count,
	 * so the list never rebuilt and the row could not be assigned. Read
	 * `drafts` here at the top level to make the dependency real.
	 */
	let modelOptions: Record<string, MediaAssignmentCandidate['models']> = {};
	$: modelOptions = Object.fromEntries(
		(purposes ?? []).map((row) => {
			const draft = drafts[row.purpose];
			const connectionId = draft?.connectionId ?? '';
			const candidate =
				(candidates[row.purpose] ?? []).find((item) => item.connection_id === connectionId) ??
				null;
			return [row.purpose, candidate?.models ?? []];
		})
	);

	/*
	 * Same staleness trap as the model list: Svelte does not re-evaluate a
	 * function call in the markup unless a variable it mentions changes, and
	 * this one only mentions the helper. Derive the blocked reason from
	 * `drafts` in a reactive statement so the assign button really enables.
	 */
	let assignBlocked: Record<string, string> = {};
	$: assignBlocked = Object.fromEntries(
		(purposes ?? []).map((row) => {
			const draft = drafts[row.purpose];
			const reason = !draft?.connectionId
				? 'settings.admin.media.selectConnection'
				: !draft.modelId
					? 'settings.admin.media.selectModel'
					: '';
			return [row.purpose, reason];
		})
	);

	const load = async () => {
		loading = true;
		try {
			view = await getMediaAssignment();
			const next: Record<string, { connectionId: string; modelId: string }> = {};
			for (const row of view.purposes) {
				next[row.purpose] = {
					connectionId: row.mode === 'provider' ? row.connection_id : '',
					modelId: row.mode === 'provider' ? row.model : ''
				};
			}
			drafts = next;
		} catch (error) {
			toast.error((error as Error).message);
		}
		loading = false;
	};

	const assign = async (purpose: MediaAssignmentPurpose) => {
		const draft = drafts[purpose.purpose] ?? { connectionId: '', modelId: '' };
		busyPurpose = purpose.purpose;
		try {
			const updated = await assignMediaPurpose(purpose.purpose, draft.connectionId, draft.modelId);
			view = {
				...view,
				purposes: (view?.purposes ?? []).map((row) =>
					row.purpose === purpose.purpose ? updated : row
				)
			} as MediaAssignmentView;
			toast.success(`${purpose.label}已指派`);
		} catch (error) {
			toast.error((error as Error).message);
		}
		busyPurpose = '';
	};

	const revert = async (purpose: MediaAssignmentPurpose) => {
		busyPurpose = purpose.purpose;
		try {
			const updated = await revertMediaPurpose(purpose.purpose);
			view = {
				...view,
				purposes: (view?.purposes ?? []).map((row) =>
					row.purpose === purpose.purpose ? updated : row
				)
			} as MediaAssignmentView;
			drafts = {
				...drafts,
				[purpose.purpose]: { connectionId: '', modelId: '' }
			};
			toast.success(`${purpose.label}已回退到旧配置`);
		} catch (error) {
			toast.error((error as Error).message);
		}
		busyPurpose = '';
	};

	onMount(load);
</script>

{#if loading}
	<div class="flex w-full justify-center py-10">
		<Spinner />
	</div>
{:else}
	<div class="flex flex-col gap-4 text-sm">
		<p class="text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t('settings.admin.media.subtitle')}
		</p>

		{#each purposes as purpose (purpose.purpose)}
			<div
				class="rounded-xl border border-gray-100 p-3 dark:border-gray-850"
				data-testid={`media-purpose-${purpose.purpose}`}
			>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="font-medium">{purpose.label}</span>
						<span
							class="rounded-md px-1.5 py-0.5 text-[11px] {purpose.ready
								? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
								: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}"
						>
							{purpose.ready ? $i18n.t('settings.admin.media.ready') : $i18n.t('settings.admin.media.notReady')}
						</span>
						<span class="text-xs text-gray-500 dark:text-gray-400">
							{modeLabel(purpose.mode, $i18n.t)}
							{purpose.connection_name ? ` · ${purpose.connection_name}` : ''}
							{purpose.upstream_model ? ` · ${purpose.upstream_model}` : ''}
						</span>
					</div>

					{#if purpose.mode === 'provider'}
						<button
							class="text-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
							type="button"
							disabled={busyPurpose === purpose.purpose}
							on:click={() => revert(purpose)}
						>
							{$i18n.t('settings.admin.media.revert')}
						</button>
					{/if}
				</div>

				{#if !purpose.ready && primaryReason(purpose)}
					<p class="mt-2 text-xs text-amber-700 dark:text-amber-300">{primaryReason(purpose)}</p>
				{/if}

				{#if isAssignable(purpose)}
					<div class="mt-3 flex flex-wrap items-end gap-2">
						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-gray-500 dark:text-gray-400"
								>{$i18n.t('settings.admin.media.connection')}</span
							>
							<select
								class="w-52 rounded-lg border border-gray-100 bg-transparent px-2 py-1 text-xs dark:border-gray-850"
								value={drafts[purpose.purpose]?.connectionId ?? ''}
								on:change={(event) => {
									const connectionId = (event.currentTarget as HTMLSelectElement).value;
									drafts = {
										...drafts,
										[purpose.purpose]: { connectionId, modelId: '' }
									};
								}}
							>
								<option value="">未选择</option>
								{#each candidatesFor(purpose.purpose) as option (option.connection_id)}
									<option value={option.connection_id} disabled={connectionBlockedReason(option) !== null}>
										{option.name}
										{connectionBlockedReason(option) === 'private'
											? ` — ${$i18n.t('settings.admin.media.privateOption')}`
											: connectionBlockedReason(option) === 'no-models'
												? ` — ${$i18n.t('settings.admin.media.noModelsOption')}`
												: ''}
									</option>
								{/each}
							</select>
						</label>

						<label class="flex flex-col gap-1">
							<span class="text-[11px] text-gray-500 dark:text-gray-400"
								>{$i18n.t('settings.admin.media.model')}</span
							>
							<select
								class="w-56 rounded-lg border border-gray-100 bg-transparent px-2 py-1 text-xs dark:border-gray-850"
								value={drafts[purpose.purpose]?.modelId ?? ''}
								on:change={(event) => {
									const modelId = (event.currentTarget as HTMLSelectElement).value;
									drafts = {
										...drafts,
										[purpose.purpose]: {
											connectionId: drafts[purpose.purpose]?.connectionId ?? '',
											modelId
										}
									};
								}}
							>
								<option value="">未选择</option>
								{#each modelOptions[purpose.purpose] ?? [] as model (model.id)}
									<option value={model.id}>
										{model.display_name}
										{model.verification === 'untested' ? '（未测试）' : ''}
									</option>
								{/each}
							</select>
						</label>

						<button
							class="rounded-lg bg-black px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-black"
							type="button"
							disabled={busyPurpose === purpose.purpose || (assignBlocked[purpose.purpose] ?? '') !== ''}
							title={assignBlocked[purpose.purpose] ? $i18n.t(assignBlocked[purpose.purpose]) : ''}
							on:click={() => assign(purpose)}
						>
							{$i18n.t('settings.admin.media.assign')}
						</button>
					</div>

					{#if (drafts[purpose.purpose]?.connectionId ?? '') && (modelOptions[purpose.purpose] ?? []).length === 0}
						<p class="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
							{emptyWhitelistHint(purpose.label, $i18n.t)}
						</p>
					{/if}
				{/if}

				{#if purpose.legacy.configured || purpose.legacy.has_api_key}
					<div class="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
						{$i18n.t('settings.admin.media.legacyPrefix')}{purpose.legacy.engine || '—'}
						{#if purpose.legacy.normalized_base_url}
							· {purpose.legacy.normalized_base_url}
						{/if}
						{#if purpose.legacy.model}
							· {purpose.legacy.model}
						{/if}
						· {secretPlaceholder(purpose.legacy.has_api_key, $i18n.t)}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
