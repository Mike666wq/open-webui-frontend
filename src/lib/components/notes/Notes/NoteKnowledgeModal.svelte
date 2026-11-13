<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';

	import dayjs from '$lib/dayjs';
	import relativeTime from 'dayjs/plugin/relativeTime';
	dayjs.extend(relativeTime);

	import Modal from '$lib/components/common/Modal.svelte';
	import {
		getNoteById,
		getNoteKnowledgeReadiness,
		getWorkspaceLoopReadiness,
		removeNoteKnowledgeSnapshot,
		syncNoteKnowledge
	} from '$lib/apis/notes';
	import { describeApiError } from '$lib/utils/api-error';
	import { config, user } from '$lib/stores';
	import {
		selectWritableKnowledgeBases,
		snapshotIndexError,
		snapshotViewState
	} from '../note-knowledge';

	import BookOpen from '$lib/components/icons/BookOpen.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import GarbageBin from '$lib/components/icons/GarbageBin.svelte';

	const i18n = getContext<typeof import('$lib/i18n').default>('i18n');

	export let show = false;
	export let note: any = null;
	// Called with the updated note after a successful save or mapping removal.
	export let onSaved: (note: any) => void = () => {};

	type SnapshotRow = {
		id: string;
		name: string | null;
		state: string;
		indexError: string | null;
		updatedAt: number | null;
		canWrite: boolean;
		exists: boolean;
	};

	let readiness: any = null;
	let loop: any = null;
	let loopError = '';
	let writableBases: any[] = [];
	let freshNote: any = null;
	let selectedKnowledgeId = '';
	let loading = false;
	let saving = false;
	let removing: string | null = null;
	let error = '';

	let rows: SnapshotRow[] = [];
	let selectedRow: SnapshotRow | null = null;
	let selectedState = 'new';
	let canWriteNote = true;
	let loopNotReady = false;
	let loopReason: string | null = null;

	const currentToken = () => (typeof localStorage !== 'undefined' ? (localStorage.token ?? '') : '');

	// The account the data on screen belongs to. When the user or the token
	// changes, everything fetched for the previous account is dropped: showing
	// (or saving) another account's state would be a data leak.
	let accountKey = '';
	$: accountKey = `${$user?.id ?? ''}:${currentToken()}`;

	let seenAccountKey = '';
	$: if (accountKey !== seenAccountKey) {
		seenAccountKey = accountKey;
		readiness = null;
		loop = null;
		loopError = '';
		writableBases = [];
		freshNote = null;
		selectedKnowledgeId = '';
		error = '';

		if (show && note?.id) {
			load();
		}
	}

	// The server's feature flags decide whether the loop is usable at all.
	let configKey = '';
	$: configKey = JSON.stringify($config?.features ?? {});

	let seenConfigKey = '';
	$: if (configKey !== seenConfigKey) {
		seenConfigKey = configKey;

		if (show && note?.id) {
			load();
		}
	}

	// Open the modal: the server owns the state of the loop, so ask it.
	$: if (show && note?.id) {
		load();
	}

	async function load() {
		if (!note?.id) return;

		loading = true;
		error = '';
		loopError = '';

		const requestNoteId = note.id;
		const token = currentToken();
		const requestAccountKey = accountKey;

		try {
			const [noteReadiness, loopReadiness] = await Promise.all([
				getNoteKnowledgeReadiness(token, requestNoteId),
				// The user-level pre-check is supplementary: when it fails the
				// reason is shown, but the per-note readiness still counts.
				getWorkspaceLoopReadiness(token).catch((e) => {
					loopError = describeApiError(e);
					return null;
				})
			]);

			// Another account took over while the request was in flight.
			if (requestAccountKey !== accountKey) return;

			readiness = noteReadiness ?? null;
			loop = loopReadiness ?? null;

			writableBases = selectWritableKnowledgeBases(
				noteReadiness?.knowledge_bases ?? loopReadiness?.knowledge_bases ?? []
			);

			if (!writableBases.some((base) => base.id === selectedKnowledgeId)) {
				selectedKnowledgeId = writableBases[0]?.id ?? '';
			}

			freshNote = note ?? null;
		} catch (e) {
			error = describeApiError(e);
			readiness = null;
			writableBases = [];
		} finally {
			loading = false;
		}
	}

	async function refreshNote() {
		if (!note?.id) return freshNote;

		try {
			const updated = await getNoteById(currentToken(), note.id);
			freshNote = updated ?? note;
		} catch {
			// The chips fall back to the readiness snapshot in that case.
			freshNote = note;
		}

		return freshNote;
	}

	function buildRows(
		noteReadiness: any,
		bases: any[]
	): SnapshotRow[] {
		const rows: SnapshotRow[] = [];
		const currentFingerprint = noteReadiness?.current_fingerprint ?? '';
		const snapshots: any[] = Array.isArray(noteReadiness?.snapshots)
			? noteReadiness.snapshots
			: [];

		const remaining = new Map<string, any>();
		for (const snapshot of snapshots) {
			if (snapshot?.knowledge_id) {
				remaining.set(snapshot.knowledge_id, snapshot);
			}
		}

		for (const base of bases) {
			const snapshot = remaining.get(base.id) ?? null;
			remaining.delete(base.id);

			rows.push({
				id: base.id,
				name: base.name ?? snapshot?.name ?? null,
				state: snapshot ? snapshotViewState(snapshot, currentFingerprint) : 'new',
				indexError: snapshotIndexError(snapshot),
				updatedAt: snapshot?.updated_at ?? null,
				canWrite: true,
				exists: snapshot?.exists !== false
			});
		}

		// Mappings that are no longer writable (deleted base, lost permission)
		// still have to be listed — and removable.
		for (const snapshot of remaining.values()) {
			rows.push({
				id: snapshot.knowledge_id,
				name: snapshot.name ?? null,
				state: snapshotViewState(snapshot, currentFingerprint),
				indexError: snapshotIndexError(snapshot),
				updatedAt: snapshot.updated_at ?? null,
				canWrite: snapshot?.can_write === true,
				exists: snapshot?.exists !== false
			});
		}

		return rows;
	}

	// The badges come from the server's readiness, not from a local guess.
	$: rows = buildRows(readiness, writableBases);
	$: selectedRow = rows.find((row) => row.id === selectedKnowledgeId) ?? null;
	$: selectedState = selectedRow?.state ?? 'new';
	$: canWriteNote = readiness?.note?.write_access !== false;
	$: loopNotReady = readiness?.ready === false || loop?.ready === false;
	$: loopReason = readiness?.reason_code ?? loop?.reason_code ?? null;

	const stateLabel = (state: string) => {
		switch (state) {
			case 'synced':
				return $i18n.t('Snapshot up to date');
			case 'changed':
				return $i18n.t('Snapshot has changes');
			case 'indexing':
				return $i18n.t('Indexing…');
			case 'failed':
				return $i18n.t('Indexing failed');
			case 'no-permission':
				return $i18n.t('No permission to save to knowledge');
			case 'unavailable':
				return $i18n.t('This knowledge base is unavailable or deleted');
			default:
				return $i18n.t('Save to knowledge');
		}
	};

	const stateClass = (state: string) => {
		switch (state) {
			case 'synced':
				return 'bg-green-500/10 text-green-600 dark:text-green-400';
			case 'failed':
			case 'no-permission':
			case 'unavailable':
				return 'bg-red-500/10 text-red-600 dark:text-red-400';
			case 'indexing':
				return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
			default:
				return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
		}
	};

	const selectedBaseName = () =>
		writableBases.find((base) => base.id === selectedKnowledgeId)?.name ??
		selectedKnowledgeId ??
		null;

	const actionLabel = () => {
		if (selectedState === 'synced') return $i18n.t('Force update');
		if (selectedState === 'changed') return $i18n.t('Update');
		return $i18n.t('Save');
	};

	async function saveToKnowledge(force = false) {
		if (!note?.id || !selectedKnowledgeId || saving) return;

		// Never write with a context that no longer matches the screen.
		if (accountKey !== seenAccountKey) {
			error = $i18n.t('Session changed, please retry.');
			await load();
			return;
		}

		saving = true;
		error = '';

		try {
			const result = await syncNoteKnowledge(
				currentToken(),
				note.id,
				selectedKnowledgeId,
				force
			);

			if (result && result.ok === false) {
				throw result;
			}

			if (result?.state === 'indexing') {
				toast.success($i18n.t('Snapshot linked; indexing in progress'));
			} else {
				toast.success(
					$i18n.t('Saved {{document}} to {{knowledge}}', {
						document: note?.title?.trim() ? note.title : $i18n.t('Untitled'),
						knowledge: selectedBaseName() ?? selectedKnowledgeId
					})
				);
			}

			await refreshNote();
			onSaved(freshNote);
			await load();
		} catch (e) {
			error = describeApiError(e);
			toast.error(`${$i18n.t('Failed to save to knowledge base')}: ${error}`);
		} finally {
			saving = false;
		}
	}

	async function removeMapping(knowledgeId: string, removeFile = false) {
		if (!note?.id || removing) return;

		if (accountKey !== seenAccountKey) {
			error = $i18n.t('Session changed, please retry.');
			await load();
			return;
		}

		removing = knowledgeId;
		error = '';

		try {
			await removeNoteKnowledgeSnapshot(
				currentToken(),
				note.id,
				knowledgeId,
				removeFile
			);

			toast.success(
				removeFile ? $i18n.t('Remove from knowledge base') : $i18n.t('Remove snapshot')
			);

			await refreshNote();
			onSaved(freshNote);
			await load();
		} catch (e) {
			error = describeApiError(e);
			toast.error(error);
		} finally {
			removing = null;
		}
	}
</script>

<Modal bind:show size="sm">
	<div class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<BookOpen className="size-5" />
			<div class="text-lg font-medium">{$i18n.t('Save to knowledge base')}</div>
		</div>

		{#if error}
			<div role="alert" class="rounded-xl bg-red-500/10 p-3 text-sm break-words">{error}</div>
		{/if}

		{#if loopError}
			<div role="alert" class="rounded-xl bg-amber-500/10 p-3 text-sm break-words">
				{loopError}
			</div>
		{/if}

		{#if loading}
			<div class="flex items-center justify-center py-8">
				<Spinner className="size-5" />
			</div>
		{:else}
			{#if !canWriteNote}
				<div class="rounded-xl bg-gray-50 dark:bg-gray-850 p-3 text-sm">
					<div class="font-medium">{$i18n.t('No permission to save to knowledge')}</div>
				</div>
			{:else if loopNotReady}
				<div class="rounded-xl bg-amber-500/10 p-3 text-sm">
					<div class="font-medium">{$i18n.t('Knowledge loop not ready')}</div>
					{#if loopReason}
						<div class="mt-1 text-xs break-words opacity-80">{loopReason}</div>
					{/if}
				</div>
			{:else if writableBases.length === 0}
				<div class="rounded-xl bg-gray-50 dark:bg-gray-850 p-3 text-sm">
					<div class="font-medium">{$i18n.t('No writable knowledge bases')}</div>
					<a
						class="mt-2 inline-block underline"
						href="/workspace/knowledge/create"
						data-testid="create-knowledge-base-link"
					>
						{$i18n.t('Create a knowledge base')}
					</a>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
						{$i18n.t('Select knowledge base')}
					</div>
					<select
						class="w-full rounded-xl text-sm py-2 px-3.5 dark:text-gray-300 bg-gray-50 dark:bg-gray-850 outline-hidden"
						bind:value={selectedKnowledgeId}
						disabled={saving}
					>
						{#each writableBases as base (base.id)}
							<option value={base.id}>{base.name ?? base.id}</option>
						{/each}
					</select>

					<div class="flex items-center justify-end gap-2 pt-1">
						{#if selectedState === 'synced'}
							<span class="text-xs text-gray-500 dark:text-gray-400 mr-auto">
								{$i18n.t('Snapshot up to date')}
							</span>
						{/if}
						<button
							data-testid="save-to-knowledge-confirm"
							class="text-sm px-3 py-1.5 rounded-lg bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1.5"
							disabled={!selectedKnowledgeId || saving}
							on:click={() => saveToKnowledge(selectedState === 'synced')}
						>
							{#if saving}
								<Spinner className="size-3.5" />
							{/if}
							{saving ? $i18n.t('Saving...') : actionLabel()}
						</button>
					</div>
				</div>
			{/if}

			{#if rows.length > 0}
				<div class="flex flex-col gap-2">
					<div class="text-xs font-medium text-gray-500 dark:text-gray-400">
						{$i18n.t('Saved to knowledge')}
					</div>
					{#each rows as row (row.id)}
						<div
							class="flex flex-col gap-1 rounded-xl bg-gray-50 dark:bg-gray-850 px-3 py-2 text-sm"
						>
							<div class="flex items-center gap-2">
								<Document className="size-4 shrink-0" />
								{#if row.name === null}
									<span class="min-w-0 flex-1 truncate italic text-gray-500 dark:text-gray-400">
										{$i18n.t('This knowledge base is unavailable or deleted')}
									</span>
								{:else}
									<a
										class="min-w-0 flex-1 truncate hover:underline"
										href={`/workspace/knowledge/${row.id}`}>{row.name}</a
									>
								{/if}
								<span
									data-testid="knowledge-state-{row.id}"
									class="shrink-0 rounded-full px-2 py-0.5 text-xs {stateClass(row.state)}"
								>
									{stateLabel(row.state)}
								</span>
							</div>

							{#if row.indexError}
								<div role="alert" class="text-xs text-red-600 dark:text-red-400 break-words">
									{row.indexError}
								</div>
							{/if}

							{#if row.updatedAt}
								<span class="text-xs text-gray-500 dark:text-gray-400">
									{dayjs(row.updatedAt)
										.locale($i18n.language)
										.fromNow()}
								</span>
							{/if}

							<div class="flex items-center justify-end gap-2 pt-1">
								<button
									class="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition disabled:cursor-not-allowed disabled:opacity-50"
									aria-label={$i18n.t('Remove snapshot')}
									disabled={removing !== null}
									on:click={() => removeMapping(row.id, false)}
								>
									{#if removing === row.id}
										<Spinner className="size-3.5" />
									{:else}
										<GarbageBin className="size-3.5" strokeWidth="2" />
									{/if}
									{$i18n.t('Remove snapshot')}
								</button>
								{#if row.canWrite && row.exists}
									<button
										class="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition disabled:cursor-not-allowed disabled:opacity-50"
										disabled={removing !== null}
										on:click={() => removeMapping(row.id, true)}
									>
										{$i18n.t('Remove from knowledge base')}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex items-center justify-end pt-1">
				<button
					class="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-850 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition disabled:cursor-not-allowed disabled:opacity-50"
					disabled={loading || saving}
					on:click={() => load()}
				>
					{$i18n.t('Retry')}
				</button>
			</div>
		{/if}
	</div>
</Modal>
