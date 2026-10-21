<script lang="ts">
	import { getContext, onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { v4 as uuid } from 'uuid';
	import { toast } from 'svelte-sonner';
	import { user, showSettings } from '$lib/stores';
	import { userSignOut } from '$lib/apis/auths';
	import { resourceRequest, summarizeTask, type Resource, type ResourceKind, type Preflight, type Task } from '$lib/resources/api';
	import { clearDeviceCategory, deviceUsage, type DeviceCategory, type DeviceUsage } from '$lib/resources/device';

	const i18n = getContext<any>('i18n');
	$: zh = String($i18n.language ?? '').startsWith('zh');
	const tr = (cn: string, en: string) => zh ? cn : en;
	const sections = ['overview', 'resources', 'device', 'recycle', 'tasks'] as const;
	let section: typeof sections[number] = 'overview';
	let compatible = false;
	let loading = true;
	let busy = false;
	let error = '';
	let stats: any = null;
	let items: Resource[] = [];
	let recycled: Resource[] = [];
	let tasks: Task[] = [];
	let rules: any = null;
	let admin: any = null;
	let devices: DeviceUsage[] = [];
	let selected = new Set<string>();
	let type: ResourceKind | '' = '';
	let query = '';
	let before = '';
	let minBytes = 0;
	let sort = 'updated_at';
	let appliedFilters: Record<string, string | number> = { query: '', min_bytes: 0, sort: 'updated_at' };
	let offset = 0;
	let total = 0;
	let includePinned = false;
	let includeShared = false;
	let preview: Preflight | null = null;
	let previewAction = '';
	let previewKey = '';
	let deviceConfirm: DeviceCategory | 'logout' | null = null;
	let result: Task | null = null;
	let generation = 0;
	let disposed = false;
	let poll: ReturnType<typeof setInterval>;
	const key = (item: Resource) => `${item.type}:${item.id}`;
	const label = (value: string) => ({
		overview: tr('概览', 'Overview'), resources: tr('资源', 'Resources'),
		device: tr('此设备', 'This device'), recycle: tr('回收站', 'Recycle bin'),
		tasks: tr('任务与规则', 'Tasks & rules'), chat: tr('AI 对话', 'AI chats'),
		file: tr('上传文件', 'Uploads'), note: tr('笔记', 'Notes'),
		knowledge: tr('知识库', 'Knowledge'), share: tr('公开分享', 'Shares'),
		channel: tr('成员会话', 'Conversations'), cache: tr('可重建缓存', 'Rebuildable cache'),
		drafts: tr('未发送草稿', 'Unsent drafts'), wallpapers: tr('本机壁纸图库', 'Wallpaper library'),
		appearance: tr('本机外观设置', 'Appearance settings'),
		completed: tr('已完成', 'Completed'), partial: tr('部分完成', 'Partially completed'),
		failed: tr('失败', 'Failed'), pending: tr('排队中', 'Queued'), running: tr('处理中', 'Running'),
		purge: tr('彻底清理', 'Purge'), restore: tr('恢复', 'Restore')
	}[value] ?? value);
	const reason = (value: string) => ({
		referenced: tr('仍被其他内容引用，保留文件', 'Referenced by other content; file retained'),
		pinned: tr('已置顶，默认保护', 'Pinned; protected by default'),
		shared_confirmation_required: tr('共享资源，需要单独确认影响', 'Shared resource; separate confirmation required'),
		active_generation: tr('正在生成或存在定时任务', 'Generation or timer is active'),
		active_upload_or_processing: tr('正在上传或处理', 'Upload or processing is active'),
		draft_attachment: tr('未发送草稿附件', 'Unsent draft attachment'),
		legacy_body_unavailable: tr('旧版记录未保留正文，不能恢复；需检查备份', 'Legacy entry has no body; inspect backups'),
		resource_changed_preview_again: tr('内容已变化，请重新预览', 'Resource changed; preview again'),
		not_restorable_or_expired: tr('已过期或当前不能恢复', 'Expired or not restorable'),
		already_recycled: tr('已在回收站', 'Already recycled')
	}[value] ?? value);
	const bytes = (value: number | null) => {
		if (value === null) return tr('无法精确计量', 'Not precisely measurable');
		if (!value) return '0 B';
		const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
		return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
	};
	const date = (value?: number) => value ? new Date(value * 1000).toLocaleString() : '—';
	const filters = () => ({
		...(type ? { type } : {}), query,
		...(before ? { before: Math.floor(new Date(`${before}T23:59:59`).getTime() / 1000) } : {}),
		min_bytes: Number(minBytes) || 0, sort
	});
	const listPath = () => '/list?' + new URLSearchParams(
		Object.entries({ ...appliedFilters, offset, limit: 25 }).map(([k, v]) => [k, String(v)])
	);
	function applyFilters() {
		appliedFilters = filters(); offset = 0; selected = new Set(); refresh();
	}
	function focusDialog(node: HTMLDialogElement) {
		const previous = document.activeElement as HTMLElement | null;
		const controls = () => Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'));
		queueMicrotask(() => controls()[0]?.focus());
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault(); event.stopPropagation();
				if (!busy) { preview = null; deviceConfirm = null; }
			} else if (event.key === 'Tab') {
				const targets = controls();
				const first = targets[0]; const last = targets[targets.length - 1];
				if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
			}
		};
		node.addEventListener('keydown', keydown);
		return { destroy() { node.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); } };
	}
	function toggle(item: Resource) {
		const next = new Set(selected);
		if (next.has(key(item))) next.delete(key(item)); else next.add(key(item));
		selected = next;
	}
	function navigateSection(next: typeof sections[number]) {
		section = next;
		selected = new Set();
	}
	async function refresh() {
		const request = ++generation;
		const account = $user?.id;
		loading = true;
		error = '';
		try {
			const cap = await resourceRequest<{ protocol: number }>('/capabilities');
			if (cap.protocol !== 2) throw new Error(tr('后端不支持可靠资源管理，请先升级匹配的后端。', 'Upgrade to a backend supporting resource management protocol 2.'));
			const [overview, listing, bin, jobs, policy, usage, accounts] = await Promise.all([
				resourceRequest<any>('/overview'), resourceRequest<{ items: Resource[]; total: number }>(listPath()),
				resourceRequest<Resource[]>('/recycle-bin'), resourceRequest<Task[]>('/tasks'),
				resourceRequest<any>('/rules'), deviceUsage().catch(() => []),
				$user?.role === 'admin' ? resourceRequest<any>('/admin/overview') : Promise.resolve(null)
			]);
			if (disposed || request !== generation || account !== $user?.id) return;
			compatible = true;
			stats = overview; items = listing.items; total = listing.total;
			recycled = bin; tasks = jobs; rules = policy; devices = usage; admin = accounts;
			if (result && ['pending', 'running'].includes(result.state)) result = jobs.find((task) => task.id === result?.id) ?? result;
		} catch (cause) {
			if (disposed || request !== generation) return;
			compatible = false;
			error = cause instanceof Error ? cause.message : String(cause);
			// Keep local device controls usable when this server has no new API.
			devices = await deviceUsage().catch(() => []);
		} finally {
			if (request === generation) loading = false;
		}
	}
	async function prepare(action: 'recycle' | 'restore' | 'purge', allMatching = false) {
		busy = true; error = ''; preview = null;
		const account = $user?.id;
		const source = section === 'recycle' ? recycled : items;
		try {
			const next = await resourceRequest<Preflight>('/preflight', {
				action,
				...(allMatching ? { filters: appliedFilters } : {
					items: source.filter((item) => selected.has(key(item))).map(({ id, type }) => ({ id, type }))
				}),
				options: { include_pinned: includePinned, include_shared: includeShared }
			});
			if (disposed || account !== $user?.id) return;
			preview = next;
			previewAction = action;
			previewKey = uuid();
		} catch (cause) { error = String(cause); }
		finally { busy = false; }
	}
	async function execute() {
		if (!preview || busy) return;
		busy = true;
		const account = $user?.id;
		try {
			const task = await resourceRequest<Task>('/tasks', {
				preview_id: preview.id, idempotency_key: previewKey
			});
			if (disposed || account !== $user?.id) return;
			result = task;
			const summary = summarizeTask(task);
			if (summary.running) toast.info(tr('任务已保存，正在处理', 'Task saved and processing'));
			else if (summary.success && !summary.failed) toast.success(tr(`已完成 ${summary.success} 项`, `${summary.success} items completed`));
			else toast.error(tr(`完成 ${summary.success} 项，未完成 ${summary.failed} 项，请查看原因`, `${summary.success} completed; ${summary.failed} failed. Inspect results.`));
			preview = null; selected = new Set();
			await refresh();
		} catch (cause) { error = String(cause); }
		finally { busy = false; }
	}
	async function retry(task: Task) {
		busy = true;
		try { result = await resourceRequest<Task>(`/tasks/${task.id}/retry`, {}); await refresh(); }
		catch (cause) { error = String(cause); }
		finally { busy = false; }
	}
	async function clearDevice() {
		if (!deviceConfirm) return;
		busy = true;
		try {
			if (deviceConfirm === 'logout') {
				await userSignOut();
				localStorage.removeItem('token');
				user.set(undefined); showSettings.set(false);
				await goto('/auth');
			} else {
				await clearDeviceCategory(deviceConfirm);
				devices = await deviceUsage();
				toast.success(tr('已清理所选类别', 'Selected category cleared'));
			}
			deviceConfirm = null;
		} catch (cause) { error = String(cause); }
		finally { busy = false; }
	}
	async function changeRule(enabled: boolean) {
		busy = true;
		try { rules = await resourceRequest('/rules', { temporary_uploads: enabled }, 'PUT'); }
		catch (cause) { error = String(cause); }
		finally { busy = false; }
	}
	onMount(() => {
		refresh();
		poll = setInterval(() => {
			if (tasks.some((task) => ['pending', 'running'].includes(task.state)) && !busy && !preview) refresh();
		}, 3000);
	});
	onDestroy(() => { disposed = true; generation++; clearInterval(poll); });
</script>

<svelte:window on:keydown={(event) => { if (event.key === 'Escape' && !busy) { preview = null; deviceConfirm = null; } }} />

<section class="resources-page" aria-label={tr('资源与存储', 'Resources & Storage')}>
	<header class="resources-header">
		<div>
			<p class="eyebrow">{tr('你的内容，由你管理', 'YOUR CONTENT, YOUR CONTROL')}</p>
			<h2>{tr('资源与存储', 'Resources & Storage')}</h2>
			<p class="muted">{tr('整理内容、保护引用，清楚了解每一次清理。', 'Organize content, preserve references, understand every cleanup.')}</p>
		</div>
		<button on:click={refresh} disabled={loading || busy}>{loading ? tr('刷新中…', 'Refreshing…') : tr('刷新', 'Refresh')}</button>
	</header>
	<nav class="section-tabs" aria-label={tr('资源管理分区', 'Resource sections')}>
		{#each sections as value}
			<button aria-current={section === value ? 'page' : undefined} class:active={section === value}
				on:click={() => navigateSection(value)}>{label(value)}{value === 'recycle' && recycled.length ? ` · ${recycled.length}` : ''}</button>
		{/each}
	</nav>
	{#if error}
		<div class="notice error" role="alert">{error}<p>{tr('失败不会按零占用或清理成功处理。', 'A failed request is never reported as zero usage or a successful cleanup.')}</p></div>
	{/if}
	{#if result}
		<div class="notice" role="status">
			<strong>{label(result.state)}</strong> · {summarizeTask(result).success} {tr('项完成', 'completed')}
			<button class="text-action" on:click={() => result = null}>{tr('收起结果', 'Dismiss results')}</button>
			{#each result.results.filter((item) => !item.success) as item}
				<p>{label(item.type)} · {reason(item.reason ?? '')}</p>
			{/each}
		</div>
	{/if}

	<div class="section-body">
		{#if section === 'overview'}
			{#if stats}
				<div class="metric-grid">
					{#each Object.entries(stats.counts) as [kind, count]}
						<button class="metric" on:click={() => { type = kind as ResourceKind; navigateSection('resources'); applyFilters(); }}>
							<span>{label(kind)}</span><strong>{count}</strong>
						</button>
					{/each}
				</div>
				<article class="surface capacity">
					<div><h3>{tr('上传文件登记容量', 'Registered upload size')}</h3>
						<p class="muted">{tr('按文件记录计量，不是系统内存或整个服务器的磁盘占用。', 'Based on file records. Not RAM or total server disk usage.')}</p></div>
					<strong>{bytes(stats.total_bytes)}</strong>
				</article>
				<div class="metric-grid">
					<div class="surface"><h3>{tr('回收站文件容量', 'Recycled file size')}</h3><strong>{bytes(stats.recycled_bytes)}</strong><p class="muted">{tr('仍占空间，保留七天。', 'Still stored during the seven-day retention period.')}</p></div>
					<div class="surface"><h3>{tr('已删除存储对象大小', 'Removed storage object size')}</h3><strong>{bytes(stats.object_bytes_removed)}</strong><p class="muted">{tr('仅累计成功移除的对象记录大小；不代表数据库文件已缩小。', 'Only confirmed object removal; database file size may remain unchanged.')}</p></div>
				</div>
				<div class="notice">{tr(`回收站 ${stats.recycled_count} 项，未完成任务 ${stats.failed_tasks} 个。`, `${stats.recycled_count} recycled items; ${stats.failed_tasks} tasks need attention.`)}</div>
			{:else if loading}<p class="muted">{tr('正在读取实际统计…', 'Reading actual usage…')}</p>{/if}
		{:else if section === 'resources' || section === 'recycle'}
			{#if section === 'resources'}
				<form class="filters surface" on:submit|preventDefault={applyFilters}>
					<input aria-label={tr('搜索资源名称', 'Search resource names')} placeholder={tr('搜索名称…', 'Search names…')} bind:value={query} />
					<select aria-label={tr('资源类型', 'Resource type')} bind:value={type}>
						<option value="">{tr('全部类型', 'All types')}</option>
						{#each ['chat', 'file', 'note', 'knowledge', 'share', 'channel'] as kind}<option value={kind}>{label(kind)}</option>{/each}
					</select>
					<label>{tr('更新时间早于', 'Updated before')}<input type="date" bind:value={before} /></label>
					<label>{tr('最小字节数', 'Minimum bytes')}<input type="number" min="0" bind:value={minBytes} /></label>
					<select aria-label={tr('排序', 'Sort')} bind:value={sort}>
						<option value="updated_at">{tr('最近更新', 'Recently updated')}</option>
						<option value="size_bytes">{tr('容量从大到小', 'Largest first')}</option>
						<option value="title">{tr('名称', 'Name')}</option>
					</select>
					<button type="submit" disabled={loading}>{tr('筛选', 'Filter')}</button>
				</form>
				<div class="protection-options">
					<label><input type="checkbox" bind:checked={includePinned} />{tr('明确纳入置顶内容', 'Include pinned content explicitly')}</label>
					<label><input type="checkbox" bind:checked={includeShared} />{tr('单独检查共享内容影响', 'Review shared content impact separately')}</label>
				</div>
			{:else}
				<p class="notice">{tr('删除后保留七天。成员会话仅隐藏本人的历史，不删除他人的消息；恢复分享不会自动重新公开。', 'Retained for seven days. Conversation clear only hides your own history. Restoring content does not republish shares.')}</p>
			{/if}
			<div class="selection-bar">
				<span>{tr(`已选 ${selected.size} 项`, `${selected.size} selected`)}</span>
				<button on:click={() => selected = new Set((section === 'recycle' ? recycled : items).map(key))}>{tr('选择本页', 'Select this page')}</button>
				<button on:click={() => selected = new Set()}>{tr('取消选择', 'Clear selection')}</button>
				{#if section === 'resources'}
					<button disabled={!compatible || busy || !total} on:click={() => prepare('recycle', true)}>{tr(`预览全部筛选结果（${total}）`, `Preview all matches (${total})`)}</button>
				{/if}
			</div>
			<div class="resource-list" aria-label={label(section)}>
				{#each (section === 'recycle' ? recycled : items) as item (key(item))}
					<article class="surface resource-row">
						<input type="checkbox" aria-label={`${tr('选择', 'Select')} ${item.title}`} checked={selected.has(key(item))} on:change={() => toggle(item)} />
						<div class="resource-info">
							<div class="resource-meta"><span class="type-badge">{label(item.type)}</span><span>{bytes(item.size_bytes)}</span></div>
							<h3>{item.title}</h3>
							<p class="muted">{section === 'recycle' ? `${tr('到期', 'Expires')}: ${date(item.expires_at)}` : date(item.updated_at)}</p>
							{#if item.meta?.effect === 'clear_only_for_me'}<p class="muted">{tr('仅本人清空', 'Cleared only for you')}</p>{/if}
							{#if item.state === 'legacy'}<p class="error-text">{reason('legacy_body_unavailable')}</p>{/if}
						</div>
						{#if item.href}<a href={item.href} on:click={() => showSettings.set(false)}>{tr('打开', 'Open')}</a>{/if}
					</article>
				{:else}<p class="empty">{loading ? tr('读取中…', 'Loading…') : tr('这里暂时没有内容', 'Nothing here yet')}</p>{/each}
			</div>
			{#if section === 'resources'}
				<div class="selection-bar"><button disabled={offset === 0 || loading} on:click={() => { offset = Math.max(0, offset - 25); selected = new Set(); refresh(); }}>{tr('上一页', 'Previous')}</button>
					<span>{total ? `${offset + 1}–${Math.min(total, offset + 25)} / ${total}` : '0 / 0'}</span>
					<button disabled={offset + 25 >= total || loading} on:click={() => { offset += 25; selected = new Set(); refresh(); }}>{tr('下一页', 'Next')}</button></div>
			{/if}
			<div class="sticky-actions">
				{#if section === 'resources'}
					<button class="primary" disabled={!compatible || busy || !selected.size} on:click={() => prepare('recycle')}>{tr('预览回收／仅本人清空', 'Preview recycle / clear for me')}</button>
				{:else}
					<button class="primary" disabled={!compatible || busy || !selected.size} on:click={() => prepare('restore')}>{tr('预览恢复', 'Preview restore')}</button>
					<button class="danger" disabled={!compatible || busy || !selected.size} on:click={() => prepare('purge')}>{tr('预览彻底清理', 'Preview permanent cleanup')}</button>
				{/if}
			</div>
		{:else if section === 'device'}
			<p class="notice">{tr('只管理当前站点的明确类别，不扫描下载目录，不会一键清空登录、草稿和壁纸。', 'Only known categories on this origin are managed. Downloads are not scanned; credentials, drafts and wallpapers are separate.')}</p>
			{#each devices as usage}
				<article class="surface capacity">
					<div><h3>{label(usage.category)}</h3><p class="muted">{usage.count} {tr('项', 'items')} · {bytes(usage.bytes)}</p>
						{#if usage.category === 'cache'}<p class="muted">{tr('仅清除带有本项目可重建标识的缓存；未知缓存保留。', 'Only explicitly registered rebuildable caches; unknown caches are retained.')}</p>{/if}
						{#if usage.category === 'drafts'}<p class="muted">{tr('当前浏览器标签保存的 AI 输入草稿；其他未登记数据保留。', 'AI input drafts in this browser tab; unregistered data is retained.')}</p>{/if}
					</div>
					<button disabled={busy || !usage.count} on:click={() => deviceConfirm = usage.category}>{tr('清理此类别', 'Clear category')}</button>
				</article>
			{/each}
			<div class="surface capacity"><div><h3>{tr('登录状态', 'Session')}</h3><p class="muted">{tr('退出当前设备，服务端内容保留。', 'Sign out on this device; server content is retained.')}</p></div><button on:click={() => deviceConfirm = 'logout'}>{tr('退出登录…', 'Sign out…')}</button></div>
		{:else if section === 'tasks'}
			<article class="surface">
				<h3>{tr('清理规则', 'Cleanup rules')}</h3>
				<p>{tr('回收站到期后清理，保留期七天。正常对话、笔记和知识库不按年龄自动删除。', 'Recycled content expires after seven days. Active chats, notes and knowledge are not automatically removed by age.')}</p>
				{#if rules}
					<label class="rule-control"><input type="checkbox" checked={rules.temporary_uploads} disabled={!rules.can_edit || busy}
						on:change={(event) => changeRule(event.currentTarget.checked)} />
						{tr('自动回收无引用临时上传', 'Recycle unreferenced temporary uploads automatically')}</label>
					<p class="muted">{tr('默认关闭，仅管理员可改。仅处理明确登记的临时上传：无引用、闲置七天，再保留七天；旧文件与未知草稿保留。', 'Off by default; administrators only. Explicitly registered temporary uploads must be unreferenced and idle for seven days, then retained for another seven. Legacy files and unknown drafts are kept.')}</p>
				{/if}
			</article>
			{#each tasks as task (task.id)}
				<article class="surface"><div class="capacity"><h3>{task.action === 'recycle' ? tr('回收／个人清空', 'Recycle / personal clear') : label(task.action)}</h3><span class="type-badge">{label(task.state)}</span></div>
					<p class="muted">{date(task.created_at)} · {tr('执行次数', 'Attempts')}: {task.attempts}</p>
					<p>{summarizeTask(task).success} {tr('项完成', 'completed')} · {summarizeTask(task).failed} {tr('项未完成', 'failed')}</p>
					{#each task.results.filter((r) => !r.success) as item}<p class="error-text">{label(item.type)} · {reason(item.reason ?? '')}</p>{/each}
					{#if ['failed', 'partial'].includes(task.state)}
						{#if task.action === 'purge'}<button disabled={busy} on:click={() => retry(task)}>{tr('重试未完成步骤', 'Retry unfinished steps')}</button>
						{:else}<p class="muted">{tr('请返回资源列表重新预览未完成项目，避免使用过期确认。', 'Return to resources and preview unfinished items again; old confirmations may be stale.')}</p>{/if}
					{/if}
				</article>
			{:else}<p class="empty">{tr('尚无清理任务', 'No cleanup tasks yet')}</p>{/each}
			{#if admin}
				<article class="surface"><h3>{tr('管理员 · 账号级统计', 'Administrator · Account aggregates')}</h3>
					<p class="muted">{tr('这里只展示数量和任务结果，不提供他人的私人正文。', 'Counts and task outcomes only; no private content from other accounts.')}</p>
					{#each admin.accounts as account}
						<div class="account-stat"><code>{account.user_id}</code><p>{Object.entries(account.counts).map(([kind, count]) => `${label(kind)} ${count}`).join(' · ')}</p><p class="muted">{Object.entries(account.tasks ?? {}).map(([state, count]) => `${label(state)} ${count}`).join(' · ')}</p></div>
					{/each}
				</article>
			{/if}
		{/if}
	</div>
</section>

{#if preview || deviceConfirm}
	<div class="resource-confirm-backdrop">
		<dialog open class="resource-confirm surface" aria-modal="true" aria-label={tr('确认清理影响', 'Confirm cleanup impact')} use:focusDialog>
			<header><h3>{deviceConfirm ? tr('确认此设备操作', 'Confirm device action') : tr('操作影响预览', 'Impact preview')}</h3></header>
			<div class="confirm-body">
				{#if deviceConfirm}
					<p>{tr('仅处理你明确选择的类别：', 'Only the category you selected: ')}<strong>{deviceConfirm === 'logout' ? tr('退出登录', 'Sign out') : label(deviceConfirm)}</strong></p>
					<p class="notice">{tr('草稿或壁纸清除后无法在回收站恢复。其他类别和服务端内容不受影响。', 'Removed device drafts or wallpapers cannot be restored from the recycle bin. Other categories and server content are unaffected.')}</p>
				{:else if preview}
					<p>{tr(`共 ${preview.items.length} 项，可处理 ${preview.allowed} 项。`, `${preview.items.length} selected; ${preview.allowed} eligible.`)}</p>
					<p class="muted">{tr('涉及文件登记容量（估算）', 'Estimated registered file size')}: {bytes(preview.estimated_bytes)}</p>
					{#if previewAction === 'purge'}<p class="notice error">{tr('这是第二次确认：彻底删除无法撤销。成员会话只结束本人清空的撤销期，不会删除其他成员消息。', 'Final confirmation: permanent deletion cannot be undone. For conversations this only ends your undo period; other members keep their messages.')}</p>
					{:else if previewAction === 'recycle'}<p class="notice">{tr('内容进入七天回收站。成员会话只清空本人的可见历史，新消息正常显示。其他引用仍在的附件会保留。', 'Content enters a seven-day recycle bin. Conversations clear only your history; new messages remain visible. Attachments with other references are kept.')}</p>{/if}
					{#each preview.items as item}
						<div class="impact-item"><strong>{label(item.type)} · {item.title ?? item.id}</strong>
							{#if item.allowed}<p>{item.effect === 'clear_only_for_me' ? tr('仅本人清空', 'Clear only for me') : tr('可处理', 'Eligible')}</p>{/if}
							{#if item.pauses_share}<p>{tr('将暂停公开分享；恢复后需另行开放', 'Public share will be paused; republish separately after restoring')}</p>{/if}
							{#if item.retained_references}<p>{tr(`保留：${item.retained_references} 处引用`, `Retained: ${item.retained_references} references`)}</p>{/if}
							{#if item.recycled_files || item.retained_files}<p>{tr(`附件：随内容回收 ${item.recycled_files ?? 0} 个，因引用或保护保留 ${item.retained_files ?? 0} 个`, `Attachments: ${item.recycled_files ?? 0} recycled with content; ${item.retained_files ?? 0} retained by references or protection`)}</p>{/if}
							{#each item.reasons as why}<p class="error-text">{reason(why)}</p>{/each}
						</div>
					{/each}
				{/if}
			</div>
			<footer><button disabled={busy} on:click={() => { preview = null; deviceConfirm = null; }}>{tr('取消', 'Cancel')}</button>
				<button class:danger={previewAction === 'purge' || !!deviceConfirm} class:primary={previewAction !== 'purge' && !deviceConfirm}
					disabled={busy || (!deviceConfirm && !preview?.allowed)} on:click={() => deviceConfirm ? clearDevice() : execute()}>
					{busy ? tr('处理中…', 'Processing…') : tr('确认执行', 'Confirm')}
				</button></footer>
		</dialog>
	</div>
{/if}

<style>
	.resources-page { display:flex; flex-direction:column; height:100%; min-height:0; min-width:0; color:var(--mist-ink, inherit); }
	.resources-header { display:flex; justify-content:space-between; align-items:start; gap:12px; padding:4px 2px 16px; }
	h2 { font-size:1.4rem; font-weight:650; letter-spacing:-.025em; }
	h3 { font-weight:600; overflow-wrap:anywhere; }
	.eyebrow { color:var(--mist-accent); font-size:10px; font-weight:650; letter-spacing:.12em; margin-bottom:6px; }
	.muted { color:var(--mist-muted, #71717a); font-size:12px; line-height:1.6; }
	button, a { border-radius:10px; padding:9px 12px; font-size:12px; border:1px solid var(--mist-border, #94a3b833); transition:background .15s; }
	button:hover:enabled, a:hover { background:var(--mist-highlight, #94a3b822); }
	button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline:2px solid var(--mist-accent, #2563eb); outline-offset:3px; }
	button:disabled { opacity:.45; cursor:not-allowed; }
	.section-tabs { display:flex; gap:4px; overflow-x:auto; flex-shrink:0; border-bottom:1px solid var(--mist-border); padding-bottom:8px; }
	.section-tabs button { white-space:nowrap; border-color:transparent; }
	.section-tabs .active { color:var(--mist-accent); background:var(--mist-highlight); border-color:var(--mist-border-strong); font-weight:600; }
	.section-body { overflow-y:auto; overscroll-behavior:contain; min-height:0; padding:16px 3px 24px; display:flex; flex-direction:column; gap:12px; }
	.surface { border:1px solid var(--mist-border, #94a3b844); background:rgba(var(--mist-surface-rgb, 248, 250, 252), .55); border-radius:16px; padding:16px; min-width:0; }
	.metric-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
	.metric { display:flex; flex-direction:column; gap:10px; text-align:start; padding:16px; background:var(--mist-highlight, #94a3b811); border-radius:16px; }
	.metric span { color:var(--mist-muted); font-size:12px; }
	.metric strong { font-size:28px; font-weight:550; }
	.capacity { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
	.capacity > div { flex:1; min-width:140px; }
	.capacity > strong { font-size:24px; font-weight:550; }
	.notice { padding:12px 14px; border-radius:12px; background:var(--mist-highlight, #94a3b822); font-size:12px; line-height:1.65; overflow-wrap:anywhere; }
	.error { background:#d9770618; border:1px solid #d9770644; }
	.error-text { color:var(--mist-accent-text, #a16207); font-size:12px; line-height:1.6; }
	.filters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
	.filters input, .filters select { width:100%; min-width:0; border:1px solid var(--mist-border); border-radius:9px; background:transparent; padding:9px; font-size:12px; }
	.filters label { font-size:11px; color:var(--mist-muted); }
	.filters label input { margin-top:3px; color:var(--mist-ink); }
	.protection-options, .selection-bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:12px; }
	label { display:flex; gap:7px; align-items:center; }
	.filters label { display:block; }
	input[type=checkbox] { width:17px; height:17px; flex-shrink:0; accent-color:var(--mist-accent); }
	.resource-list { display:flex; flex-direction:column; gap:8px; }
	.resource-row { display:flex; align-items:center; gap:12px; padding:13px; }
	.resource-info { flex:1; min-width:0; }
	.resource-info h3 { font-size:14px; margin:5px 0; }
	.resource-meta { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:11px; color:var(--mist-muted); }
	.type-badge { font-size:10px; padding:3px 7px; border-radius:6px; background:var(--mist-highlight); }
	.sticky-actions { position:sticky; bottom:0; display:flex; flex-wrap:wrap; gap:8px; padding:10px 0 0; background:rgba(var(--mist-surface-rgb, 248,250,252), .94); border-radius:12px; }
	.primary { background:var(--mist-accent, #2563eb); color:var(--mist-accent-contrast, white); }
	.danger { background:#b91c1c; color:white; }
	.text-action { border:0; color:var(--mist-accent-text); }
	.empty { padding:32px 12px; text-align:center; color:var(--mist-muted); font-size:13px; }
	.rule-control { margin:12px 0; font-size:13px; }
	.account-stat { border-top:1px solid var(--mist-border); padding:12px 0; overflow-wrap:anywhere; font-size:12px; }
	.account-stat code { font-size:10px; }
	.resource-confirm-backdrop { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:16px; background:#0f172a77; backdrop-filter:blur(8px); }
	.resource-confirm { width:min(560px,100%); max-height:min(85dvh,800px); display:flex; flex-direction:column; background:rgba(var(--mist-surface-rgb, 248,250,252), .97); box-shadow:0 24px 90px #0004; }
	.confirm-body { overflow-y:auto; overscroll-behavior:contain; min-height:0; padding:14px 0; display:flex; flex-direction:column; gap:10px; font-size:13px; }
	.impact-item { border-top:1px solid var(--mist-border); padding-top:10px; overflow-wrap:anywhere; }
	.resource-confirm footer { display:flex; justify-content:flex-end; gap:10px; padding-top:12px; border-top:1px solid var(--mist-border); }
	@media (max-width:480px) { .resources-header { flex-wrap:wrap; } .resources-header h2 { font-size:1.2rem; } .section-tabs button { padding:9px 10px; } .resource-confirm-backdrop { padding:10px; } }
</style>
