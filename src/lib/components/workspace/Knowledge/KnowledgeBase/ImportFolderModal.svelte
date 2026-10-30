<script lang="ts">
	import { getContext, createEventDispatcher } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as I18n } from 'i18next';
	import { toast } from 'svelte-sonner';

	import Modal from '$lib/components/common/Modal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';

	import {
		buildKnowledgePathIndex,
		defaultFolderImportDeps,
		planFolderImport,
		runFolderImport,
		type FolderImportEntry,
		type FolderImportPlan,
		type FolderImportReport,
		type ImportConflictStrategy
	} from './knowledge-import';

	// P-006 S4 — Markdown folder import modal (K7–K10). Four states:
	// select (webkitdirectory pick) → preview (tree counts, conflicts,
	// strategy) → running (progress + cancellation) → report (structured
	// result). The last report stays viewable after the modal closes.

	const i18n = getContext<Writable<I18n>>('i18n');
	const dispatch = createEventDispatcher();

	export let show = false;
	export let knowledgeId: string = '';
	export let lastReport: FolderImportReport | null = null;
	export let reportStorageUnavailable = false;

	type Mode = 'select' | 'preview' | 'running' | 'report';

	let mode: Mode = 'select';
	let entries: FolderImportEntry[] = [];
	let plan: FolderImportPlan | null = null;
	let strategy: ImportConflictStrategy = 'skip';
	let processed = 0;
	let total = 0;
	let current = '';
	let cancelRequested = false;
	let running = false;
	let report: FolderImportReport | null = null;
	let viewingLast = false;

	const activeReport = () => (viewingLast ? lastReport : report);

	const reset = () => {
		mode = 'select';
		entries = [];
		plan = null;
		processed = 0;
		total = 0;
		current = '';
		cancelRequested = false;
		viewingLast = false;
	};

	let wasShown = false;
	// Every open starts from the selection screen; the last report (held by
	// the parent) stays reachable through the "Last import report" entry.
	$: {
		if (show && !wasShown) {
			wasShown = true;
			if (!running) reset();
		} else if (!show && wasShown) {
			wasShown = false;
			if (!running) reset();
		}
	}

	const hasHiddenFolder = (path: string): boolean =>
		path.split('/').some((part) => part.startsWith('.'));

	const pickFolder = () => {
		const input = document.createElement('input');
		input.type = 'file';
		input.webkitdirectory = true;
		input.multiple = true;
		input.style.display = 'none';
		document.body.appendChild(input);

		const cleanup = () => {
			try {
				document.body.removeChild(input);
			} catch {}
		};

		input.onchange = () => {
			const files = Array.from(input.files ?? []).filter(
				(file) => !hasHiddenFolder(file.webkitRelativePath) && !file.name.startsWith('.')
			);
			cleanup();
			if (files.length > 0) {
				onFilesPicked(files);
			} else {
				toast.error($i18n.t('File not found.'));
			}
		};
		input.onerror = cleanup;
		input.click();
	};

	const onFilesPicked = async (files: File[]) => {
		entries = files.map((file) => ({
			file,
			relativePath: file.webkitRelativePath || file.name
		}));
		mode = 'preview';
		plan = null;
		try {
			const index = await buildKnowledgePathIndex(
				defaultFolderImportDeps,
				localStorage.token,
				knowledgeId
			);
			plan = planFolderImport(entries, index.keys);
		} catch (error) {
			toast.error(`${error}`);
			// Preview without conflict information rather than blocking.
			plan = planFolderImport(entries);
		}
	};

	const startImport = async () => {
		if (!knowledgeId || !plan || running) return;
		mode = 'running';
		cancelRequested = false;
		running = true;
		processed = 0;
		total = plan.counts.markdown + plan.counts.image;
		current = '';
		try {
			report = await runFolderImport(defaultFolderImportDeps, {
				token: localStorage.token,
				knowledgeId,
				entries,
				strategy,
				shouldCancel: () => cancelRequested,
				onProgress: (progress) => {
					processed = progress.processed;
					total = progress.total;
					current = progress.current;
				}
			});
			viewingLast = false;
			mode = 'report';
			if (report.status === 'completed') {
				toast.success($i18n.t('Import completed'));
			} else if (report.status === 'completed_with_errors') {
				toast.warning($i18n.t('Import completed with errors'));
			} else if (report.status === 'cancelled') {
				toast.warning($i18n.t('Import cancelled'));
			} else {
				toast.error($i18n.t('Import failed'));
			}
			dispatch('completed', report);
		} catch (error) {
			toast.error(`${error}`);
			mode = 'preview';
		} finally {
			running = false;
		}
	};

	const strategyOptions: { value: ImportConflictStrategy; label: string }[] = [
		{ value: 'skip', label: $i18n.t('Skip existing files') },
		{ value: 'overwrite', label: $i18n.t('Overwrite existing files') },
		{ value: 'copy', label: $i18n.t('Keep both (rename the new file)') }
	];

	const statusLabel = (status: FolderImportReport['status']) =>
		status === 'completed'
			? $i18n.t('Import completed')
			: status === 'completed_with_errors'
				? $i18n.t('Import completed with errors')
				: status === 'cancelled'
					? $i18n.t('Import cancelled')
					: $i18n.t('Import failed');

	$: progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
</script>

<Modal size="md" bind:show>
	<div class="flex items-start justify-between px-5 pt-4" data-testid="knowledge-import-modal">
		<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
			{viewingLast ? $i18n.t('Last import report') : $i18n.t('Import Markdown folder')}
		</div>
		<button
			type="button"
			class="self-center p-1 text-gray-500 transition hover:text-gray-700 disabled:opacity-40 dark:text-gray-400"
			disabled={running}
			title={running ? $i18n.t('Import in progress; use Cancel import to stop it.') : ''}
			on:click={() => {
				show = false;
			}}
		>
			<XMark className="size-3.5" />
		</button>
	</div>

	<div class="max-h-[70vh] overflow-y-auto px-5 pb-5 text-sm">
		{#if mode === 'select'}
			<div class="flex flex-col gap-4 pt-2">
				<p class="text-xs text-gray-500 dark:text-gray-400">
					{$i18n.t(
						'Select a local folder. Markdown files and images are imported with the folder structure preserved; other file types are skipped. Image references inside Markdown are rewritten so they stay readable.'
					)}
				</p>
				<button
					type="button"
					class="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gray-50 text-xs font-medium text-gray-700 transition hover:bg-gray-100 dark:bg-gray-850 dark:text-gray-200 dark:hover:bg-gray-800"
					data-testid="knowledge-import-choose"
					on:click={pickFolder}
				>
					{$i18n.t('Choose a folder to import')}
				</button>
				{#if lastReport}
					<button
						type="button"
						class="text-xs text-gray-500 underline-offset-2 transition hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
						on:click={() => {
							viewingLast = true;
							mode = 'report';
						}}
					>
						{$i18n.t('Last import report')}
					</button>
				{/if}
			</div>
		{:else if mode === 'preview'}
			{#if plan}
				<div class="flex flex-col gap-3 pt-2">
					<div class="grid grid-cols-2 gap-2 text-xs">
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Selected files')}</div>
							<div class="mt-0.5 font-medium">{entries.length}</div>
						</div>
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Directories')}</div>
							<div class="mt-0.5 font-medium">{plan.counts.directory}</div>
						</div>
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Markdown files')}</div>
							<div class="mt-0.5 font-medium">{plan.counts.markdown}</div>
						</div>
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Images')}</div>
							<div class="mt-0.5 font-medium">{plan.counts.image}</div>
						</div>
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Other files (skipped)')}</div>
							<div class="mt-0.5 font-medium">{plan.counts.other}</div>
						</div>
						<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
							<div class="text-gray-500">{$i18n.t('Conflicts with existing files')}</div>
							<div class="mt-0.5 font-medium">{plan.conflicts.length}</div>
						</div>
					</div>

					{#if plan.warnings.length > 0}
						<div
							class="rounded-xl bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
						>
							{#each plan.warnings as warning}
								<div>{warning}</div>
							{/each}
						</div>
					{/if}

					{#if plan.invalidPaths.length > 0}
						<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
							<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
								{$i18n.t('Invalid paths ({{count}})', { count: plan.invalidPaths.length })}
							</summary>
							<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
								{#each plan.invalidPaths as invalid}
									<div class="truncate">{invalid.relativePath}: {invalid.reason}</div>
								{/each}
							</div>
						</details>
					{/if}

					<div class="flex flex-col gap-1.5">
						<div class="text-xs text-gray-700 dark:text-gray-200">
							{$i18n.t('Conflict strategy')}
						</div>
						<div class="flex flex-col gap-1">
							{#each strategyOptions as option}
								<label
									class="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-xs transition hover:bg-gray-50 dark:hover:bg-gray-850"
								>
									<input type="radio" bind:group={strategy} value={option.value} />
									<span>{option.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<div class="mt-1 flex items-center justify-between gap-2">
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-xs text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
							on:click={() => {
								reset();
								mode = 'select';
							}}
						>
							{$i18n.t('Back')}
						</button>
						<button
							type="button"
							class="flex h-8 items-center justify-center rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
							data-testid="knowledge-import-start"
							on:click={startImport}
						>
							{$i18n.t('Start import')}
						</button>
					</div>
				</div>
			{:else}
				<div class="flex justify-center py-8"><Spinner className="size-5" /></div>
			{/if}
		{:else if mode === 'running'}
			<div class="flex flex-col gap-3 pt-2">
				<div class="text-xs text-gray-700 dark:text-gray-200">
					{$i18n.t('Importing {{processed}}/{{total}}', { processed, total })}
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
					<div
						class="h-full rounded-full bg-gray-900 transition-all dark:bg-gray-100"
						style="width: {progressPercent}%"
					></div>
				</div>
				<div class="truncate text-xs text-gray-500 dark:text-gray-400">{current}</div>
				<button
					type="button"
					class="self-start rounded-lg px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
					disabled={cancelRequested}
					data-testid="knowledge-import-cancel"
					on:click={() => (cancelRequested = true)}
				>
					{$i18n.t('Cancel import')}
				</button>
			</div>
		{:else if mode === 'report' && (viewingLast ? lastReport : report)}
			{@const r = viewingLast ? lastReport! : report!}
			<div class="flex flex-col gap-3 pt-2" data-testid="knowledge-import-report">
				<div class="flex flex-wrap items-center gap-2 text-xs">
					<span
						class="rounded-lg px-2 py-1 {r.status === 'completed'
							? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
							: r.status === 'cancelled'
								? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
								: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}"
					>
						{statusLabel(r.status)}
					</span>
					<span class="text-gray-500 dark:text-gray-400">
						{$i18n.t('Conflict strategy')}:
						{strategyOptions.find((o) => o.value === r.strategy)?.label ?? r.strategy}
					</span>
				</div>

				<div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
					<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
						<div class="text-gray-500">{$i18n.t('Succeeded')}</div>
						<div class="mt-0.5 font-medium">{r.succeeded.length}</div>
					</div>
					<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
						<div class="text-gray-500">{$i18n.t('Skipped')}</div>
						<div class="mt-0.5 font-medium">{r.skipped.length}</div>
					</div>
					<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
						<div class="text-gray-500">{$i18n.t('Failed')}</div>
						<div class="mt-0.5 font-medium">{r.failed.length}</div>
					</div>
					<div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-850">
						<div class="text-gray-500">{$i18n.t('Directories created')}</div>
						<div class="mt-0.5 font-medium">{r.directoriesCreated}</div>
					</div>
				</div>

				{#if reportStorageUnavailable}<p class="text-xs text-amber-700">
						{$i18n.t('Report storage unavailable; the report may not be available after refresh.')}
					</p>{/if}
				{#if r.failed.length}
					<details open class="rounded-xl bg-red-50 px-3 py-2 text-xs dark:bg-red-900/30">
						<summary>{$i18n.t('Failed')} ({r.failed.length})</summary>
						{#each r.failed as item}
							<div class="my-2 break-all select-text">
								{item.path} — {item.stage || 'unknown'}: {item.reason}{item.cleanupStatus
									? ` (${item.cleanupStatus})`
									: ''}{item.operationId ? ` · ${item.operationId}` : ''}
							</div>
						{/each}
					</details>
				{/if}
				{#if r.skipped.length}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary>{$i18n.t('Skipped')} ({r.skipped.length})</summary>
						{#each r.skipped as item}<div class="my-1 break-all select-text">
								{item.path} — {item.reason}
							</div>{/each}
					</details>
				{/if}
				{#if r.pending?.length}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary>{$i18n.t('Not processed')} ({r.pending.length})</summary>
						{#each r.pending as path}<div class="my-1 break-all select-text">{path}</div>{/each}
					</details>
				{/if}
				{#if r.invalidPaths.length}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary>{$i18n.t('Invalid paths')} ({r.invalidPaths.length})</summary>
						{#each r.invalidPaths as item}<div class="my-1 break-all select-text">
								{item.relativePath} — {item.reason}
							</div>{/each}
					</details>
				{/if}
				{#if r.missingImages.length > 0}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
							{$i18n.t('Missing images ({{count}})', { count: r.missingImages.length })}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
							{#each r.missingImages as item}
								<div class="break-all select-text">{item.mdPath} → {item.path}</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if r.unsupportedImages?.length > 0}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
							{$i18n.t('Unsupported images ({{count}})', {
								count: r.unsupportedImages.length
							})}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
							{#each r.unsupportedImages as item}
								<div class="break-all select-text">
									{item.mdPath} → {item.raw || item.reason}
									{#if item.raw}<span class="text-gray-400"> — {item.reason}</span>{/if}
								</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if r.orphanImages.length > 0}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
							{$i18n.t('Orphan images ({{count}})', { count: r.orphanImages.length })}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
							{#each r.orphanImages as path}
								<div class="break-all select-text">{path}</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if r.refHeavyFiles.length > 0}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
							{$i18n.t('Files with many image references ({{count}})', {
								count: r.refHeavyFiles.length
							})}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
							{#each r.refHeavyFiles as heavy}
								<div class="truncate">{heavy.path} ({heavy.imageRefs})</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if r.imageUrls.length > 0}
					<details class="rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-gray-850">
						<summary class="cursor-pointer text-gray-700 dark:text-gray-200">
							{$i18n.t('Image access addresses ({{count}})', { count: r.imageUrls.length })}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-gray-500 dark:text-gray-400">
							{#each r.imageUrls as image}
								<div class="truncate">
									{image.path} →
									<span class="break-all font-mono">{image.url}</span>
								</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if r.warnings.length > 0}
					<details class="rounded-xl bg-yellow-50 px-3 py-2 text-xs dark:bg-yellow-900/30">
						<summary class="cursor-pointer text-yellow-700 dark:text-yellow-300">
							{$i18n.t('Warnings ({{count}})', { count: r.warnings.length })}
						</summary>
						<div class="mt-1 max-h-32 overflow-y-auto text-yellow-700 dark:text-yellow-300">
							{#each r.warnings as warning}
								<div>{warning}</div>
							{/each}
						</div>
					</details>
				{/if}

				<div class="mt-1 flex items-center justify-between gap-2">
					{#if viewingLast}
						<button
							type="button"
							class="rounded-lg px-3 py-1.5 text-xs text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
							on:click={() => {
								viewingLast = false;
								mode = 'select';
							}}
						>
							{$i18n.t('Back')}
						</button>
					{:else}
						<span></span>
					{/if}
					<button
						type="button"
						class="flex h-8 items-center justify-center rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
						on:click={() => {
							show = false;
						}}
					>
						{$i18n.t('Done')}
					</button>
				</div>
			</div>
		{/if}
	</div>
</Modal>
