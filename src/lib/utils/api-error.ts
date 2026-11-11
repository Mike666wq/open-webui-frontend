/**
 * Turn whatever an API call rejected with into a sentence a person can act on.
 *
 * The API layer rethrows `err.detail` verbatim, and `detail` is not always a
 * string: the resource recycle policy answers 409 with
 * `{reason: 'protected_resource', items: [{title, reasons: ['active_generation']}]}`.
 * Interpolating that into a toast printed `[object Object]` and left the user
 * with no idea why their chat would not delete — the chat was still streaming
 * a reply, which is a perfectly good reason, just not one that survived the
 * trip to the interface.
 */

/** What the recycle policy can say about a resource it refuses to delete. */
const REASON_TEXT: Record<string, string> = {
	active_generation: '仍有一条回复正在生成，请等它结束或先停止生成',
	pinned: '已置顶，请先取消置顶',
	shared_confirmation_required: '已经分享过，删除前需要在「资源与存储」里确认',
	active_upload_or_processing: '文件仍在上传或处理中',
	referenced: '仍被其他内容引用',
	draft_attachment: '仍作为草稿附件使用',
	already_recycled: '已经在回收站里',
	other_owner: '属于其他用户',
	not_restorable_or_expired: '恢复期限已过',
	share_requires_republish: '需要重新发布分享'
};

const reasonText = (reason: unknown): string => {
	if (typeof reason !== 'string') return '';
	return REASON_TEXT[reason] ?? reason;
};

interface ProtectedItem {
	title?: string;
	reasons?: unknown[];
}

const describeProtected = (detail: Record<string, unknown>): string | null => {
	const items = Array.isArray(detail.items) ? (detail.items as ProtectedItem[]) : [];
	if (items.length === 0) return null;
	const explained: string[] = [];
	for (const item of items) {
		const why = (item.reasons ?? []).map(reasonText).filter(Boolean);
		if (!why.length) continue;
		const title =
			typeof item.title === 'string' && item.title.trim() ? `「${item.title.trim()}」` : '该项目';
		explained.push(`${title}${why.join('、')}`);
	}
	if (explained.length === 0) return '其中包含受保护的项目，请到「资源与存储」里处理';
	if (explained.length === 1) return `无法删除：${explained[0]}`;
	return `无法删除 ${explained.length} 个项目：${explained.slice(0, 3).join('；')}${
		explained.length > 3 ? ' 等' : ''
	}`;
};

export const describeApiError = (error: unknown, fallback = '操作失败，请稍后再试'): string => {
	if (error == null) return fallback;
	if (typeof error === 'string') return error.trim() || fallback;

	if (error instanceof Error) {
		return error.message?.trim() || fallback;
	}

	if (typeof error === 'object') {
		const detail = error as Record<string, unknown>;

		// The recycle policy: a structured refusal with per-item reasons.
		const protectedText = describeProtected(detail);
		if (protectedText) return protectedText;

		// Other structured details used across the API.
		for (const key of ['message', 'msg', 'detail', 'error']) {
			const value = detail[key];
			if (typeof value === 'string' && value.trim()) return value.trim();
		}
		// `{detail: {message, ...}}` is a common shape: read one level deeper.
		if (detail.detail && typeof detail.detail === 'object' && !Array.isArray(detail.detail)) {
			const nested = describeApiError(detail.detail, '');
			if (nested) return nested;
		}
		if (typeof detail.reason === 'string' && detail.reason.trim()) {
			return reasonText(detail.reason) || fallback;
		}
		if (Array.isArray(detail.detail)) {
			// FastAPI validation errors: [{loc, msg}]
			const messages = (detail.detail as Record<string, unknown>[])
				.map((entry) => (typeof entry?.msg === 'string' ? entry.msg : ''))
				.filter(Boolean);
			if (messages.length) return messages.join('；');
		}

		try {
			const encoded = JSON.stringify(detail);
			// A raw JSON dump is still better than "[object Object]", but only
			// when it is short enough to read.
			if (encoded && encoded !== '{}' && encoded.length <= 160) return encoded;
		} catch {
			/* circular — fall through */
		}
	}
	return fallback;
};
