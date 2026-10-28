/**
 * Provider error taxonomy shared with the backend.
 *
 * The backend owns the wording: every failure carries a display-ready `hint`.
 * These helpers only provide a fallback for older backends that do not send it
 * yet, and a short title for each of the five documented categories.
 *
 * Newer backends add three optional fields:
 *
 * - `stage` says where the failure happened: `catalog`, `oauth_refresh` or
 *   `inference`.
 * - `reason` says why, in the provider's own terms where that is knowable.
 *   It stays `unknown` when the evidence is not enough to claim more.
 * - `suggested_action` says what the operator can do next.
 *
 * The fields are additive: an error object without them still renders, and so
 * does one that carries nothing but a category.
 */

export const PROVIDER_ERROR_CATEGORIES = [
	'connection',
	'provider_network',
	'authentication',
	'rate_limit',
	'upstream'
] as const;

export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORIES)[number];

export const PROVIDER_ERROR_STAGES = ['catalog', 'oauth_refresh', 'inference'] as const;

export type ProviderErrorStage = (typeof PROVIDER_ERROR_STAGES)[number];

export const PROVIDER_ERROR_REASONS = [
	'invalid_credentials',
	'token_expired',
	'insufficient_permissions',
	'rate_limited',
	'quota_exhausted',
	'address_blocked',
	'dns_failure',
	'tls_failure',
	'timeout',
	'upstream_failure',
	'invalid_parameters',
	'content_rejected',
	'unknown'
] as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR_REASONS)[number];

export const PROVIDER_ERROR_ACTIONS = [
	'reconnect',
	'replace_key',
	'check_permissions',
	'check_server_network',
	'retry_later',
	'inspect_connection'
] as const;

export type ProviderErrorAction = (typeof PROVIDER_ERROR_ACTIONS)[number];

const CATEGORY_TITLES: Record<ProviderErrorCategory, string> = {
	connection: '无法连接厂商',
	provider_network: '网络被安全策略拦截',
	authentication: '凭据被拒绝',
	rate_limit: '限流或额度不足',
	upstream: '厂商服务异常'
};

const CATEGORY_FALLBACKS: Record<ProviderErrorCategory, string> = {
	connection: '无法连接到厂商接口，请检查服务器网络、DNS 与代理设置。',
	provider_network: '连接被服务器的安全策略拦截，请检查地址解析结果与代理配置。',
	authentication: '厂商拒绝了当前凭据，请重新填写 API Key 或重新登录账号。',
	rate_limit: '厂商限流或额度不足，请等待片刻或检查账户套餐与余额。',
	upstream: '厂商服务自身返回异常，请稍后重试或联系厂商。'
};

/**
 * The reason a category implies when the backend does not say more.
 *
 * These are the conservative readings: a failure without evidence keeps the
 * generic meaning of its category instead of claiming a specific cause.
 */
const CATEGORY_REASONS: Record<ProviderErrorCategory, ProviderErrorReason> = {
	connection: 'unknown',
	provider_network: 'address_blocked',
	authentication: 'invalid_credentials',
	rate_limit: 'rate_limited',
	upstream: 'upstream_failure'
};

const CATEGORY_ACTIONS: Record<ProviderErrorCategory, ProviderErrorAction> = {
	connection: 'check_server_network',
	provider_network: 'check_server_network',
	authentication: 'replace_key',
	rate_limit: 'retry_later',
	upstream: 'retry_later'
};

/**
 * The recovery a reason implies.
 *
 * A reason is more specific than its category: a forbidden catalog is a
 * permission the account lacks, not a key that has to be replaced.
 */
const REASON_ACTIONS: Record<ProviderErrorReason, ProviderErrorAction> = {
	invalid_credentials: 'replace_key',
	token_expired: 'reconnect',
	insufficient_permissions: 'check_permissions',
	rate_limited: 'retry_later',
	quota_exhausted: 'retry_later',
	address_blocked: 'check_server_network',
	dns_failure: 'check_server_network',
	tls_failure: 'check_server_network',
	timeout: 'check_server_network',
	upstream_failure: 'retry_later',
	invalid_parameters: 'inspect_connection',
	content_rejected: 'inspect_connection',
	unknown: 'inspect_connection'
};

/** Short wording per reason; the long explanation stays in the backend hint. */
const REASON_SUMMARIES: Record<ProviderErrorReason, string> = {
	invalid_credentials: '凭据无效',
	token_expired: '登录状态已失效',
	insufficient_permissions: '账号权限不足',
	rate_limited: '被厂商限流',
	quota_exhausted: '额度或余额不足',
	address_blocked: '地址被本地安全策略拦截',
	dns_failure: '域名解析失败',
	tls_failure: 'TLS 握手失败',
	timeout: '请求超时',
	upstream_failure: '厂商服务异常',
	invalid_parameters: '请求参数被厂商拒绝',
	content_rejected: '内容被厂商拒绝',
	unknown: '原因未确认'
};

/** Short wording per stage: where the failure happened. */
const STAGE_SUMMARIES: Record<ProviderErrorStage, string> = {
	catalog: '获取模型列表时',
	oauth_refresh: '刷新登录状态时',
	inference: '调用模型时'
};

/**
 * The label of each recovery action.
 *
 * These are translation keys, not sentences: the components pass them to the
 * i18n store so the action reads in the language of the interface.
 */
const ACTION_LABEL_KEYS: Record<ProviderErrorAction, string> = {
	reconnect: 'Sign in again',
	replace_key: 'Replace the API key',
	check_permissions: 'Check the account permissions',
	check_server_network: 'Check the server network',
	retry_later: 'Try again later',
	inspect_connection: 'Inspect the connection'
};

export interface ProviderError {
	category?: string;
	status?: number;
	http_status?: number;
	upstream_status?: number | null;
	retryable?: boolean;
	at?: number;
	hint?: string;
	stage?: string;
	reason?: string;
	suggested_action?: string;
	/** The business code the provider returned, when it has one. */
	upstream_code?: string | null;
	/** The real upstream HTTP status, also for a business failure inside a 200. */
	upstream_http_status?: number | null;
	/** The upstream trace id, for the operator to quote. */
	trace_id?: string | null;
	/** The purpose the failure belongs to, for a media service. */
	purpose?: string | null;
}

/**
 * What the interface knows about the connection the failure belongs to.
 *
 * The authentication type decides which recovery is even possible: an OAuth
 * account cannot be repaired with a new key, and an API key connection cannot
 * be repaired with a sign-in.
 */
export interface ProviderErrorContext {
	authType?: string | null;
	isAdmin?: boolean;
}

export function providerErrorCategory(
	error: ProviderError | null | undefined
): ProviderErrorCategory {
	const category = error?.category;
	return (PROVIDER_ERROR_CATEGORIES as readonly string[]).includes(category ?? '')
		? (category as ProviderErrorCategory)
		: 'connection';
}

export function providerErrorTitle(error: ProviderError | null | undefined): string {
	return CATEGORY_TITLES[providerErrorCategory(error)];
}

export function providerErrorHint(error: ProviderError | null | undefined): string {
	return error?.hint?.trim() || CATEGORY_FALLBACKS[providerErrorCategory(error)];
}

export function providerErrorStatus(error: ProviderError | null | undefined): number | null {
	return error?.upstream_status ?? error?.status ?? error?.http_status ?? null;
}

/** The stage of the failure, or null when the backend did not report one. */
export function providerErrorStage(
	error: ProviderError | null | undefined
): ProviderErrorStage | null {
	const stage = error?.stage;
	return (PROVIDER_ERROR_STAGES as readonly string[]).includes(stage ?? '')
		? (stage as ProviderErrorStage)
		: null;
}

/** The reason of the failure, falling back to what its category implies. */
export function providerErrorReason(error: ProviderError | null | undefined): ProviderErrorReason {
	const reason = error?.reason;
	if ((PROVIDER_ERROR_REASONS as readonly string[]).includes(reason ?? '')) {
		return reason as ProviderErrorReason;
	}
	return CATEGORY_REASONS[providerErrorCategory(error)];
}

/**
 * The recovery the operator can take.
 *
 * The backend decides it, because only it knows how the connection
 * authenticates. The one correction made here is the impossible pairing: an
 * OAuth account has no key to replace, and an API key connection has no
 * sign-in to repeat.
 */
export function providerErrorAction(
	error: ProviderError | null | undefined,
	context: ProviderErrorContext = {}
): ProviderErrorAction {
	const requested = error?.suggested_action;
	let action: ProviderErrorAction;
	if ((PROVIDER_ERROR_ACTIONS as readonly string[]).includes(requested ?? '')) {
		action = requested as ProviderErrorAction;
	} else {
		const reason = providerErrorReason(error);
		action =
			reason === 'unknown'
				? CATEGORY_ACTIONS[providerErrorCategory(error)]
				: REASON_ACTIONS[reason];
	}
	const authType = context.authType ?? null;
	if (authType === 'oauth' && action === 'replace_key') {
		action = 'reconnect';
	}
	if (authType === 'api_key' && action === 'reconnect') {
		action = 'replace_key';
	}
	return action;
}

/** The translation key of the recovery action. */
export function providerErrorActionLabelKey(
	error: ProviderError | null | undefined,
	context: ProviderErrorContext = {}
): string {
	return ACTION_LABEL_KEYS[providerErrorAction(error, context)];
}

/**
 * A one-line summary of the failure.
 *
 * It names the stage and the reason, because the connection name is shown
 * next to it and the long explanation stays in the details.
 */
export function providerErrorSummary(error: ProviderError | null | undefined): string {
	const category = providerErrorCategory(error);
	const reason = providerErrorReason(error);
	const stage = providerErrorStage(error);
	const stageText = stage ? STAGE_SUMMARIES[stage] : '';
	if (reason === 'unknown') {
		return stageText ? `${stageText}${CATEGORY_TITLES[category]}` : CATEGORY_TITLES[category];
	}
	return `${stageText}${REASON_SUMMARIES[reason]}`;
}

/** The long explanation, for the place where the details are shown. */
export function providerErrorDetails(error: ProviderError | null | undefined): string {
	return providerErrorHint(error);
}

/** The upstream status, when the failure came from the provider itself. */
export function providerErrorUpstreamStatus(
	error: ProviderError | null | undefined
): number | null {
	return error?.upstream_status ?? null;
}

/**
 * The real upstream HTTP status.
 *
 * A provider may refuse a request inside a HTTP 200 and report the refusal
 * through its business code. The status is still 200 and must not be dressed
 * up as an authentication or rate-limit failure.
 */
export function providerErrorUpstreamHttpStatus(
	error: ProviderError | null | undefined
): number | null {
	return error?.upstream_http_status ?? null;
}

/** The business code the provider returned, when it has one. */
export function providerErrorUpstreamCode(error: ProviderError | null | undefined): string {
	return (error?.upstream_code ?? '').toString();
}

/** The catalog status the server reports for every visible connection. */
export interface ProviderCatalogStatus {
	connection_id?: string;
	connection_name?: string;
	stale?: boolean;
	error?: ProviderError | null;
}

/** A catalog that failed, with the short reason and the recovery. */
export interface ProviderCatalogFailure {
	connectionId: string;
	connectionName: string;
	summary: string;
	action: ProviderErrorAction;
}

/**
 * The catalogs that failed.
 *
 * A catalog that is only stale has no failure to report: it is waiting for a
 * refresh, and the models that are already in use keep working.
 */
export function providerCatalogFailures(
	catalogs: (ProviderCatalogStatus | null | undefined)[] | null | undefined
): ProviderCatalogFailure[] {
	return (catalogs ?? [])
		.filter((catalog): catalog is ProviderCatalogStatus => Boolean(catalog?.error))
		.map((catalog) => ({
			connectionId: catalog.connection_id ?? '',
			connectionName: catalog.connection_name ?? '',
			summary: providerErrorSummary(catalog.error),
			action: providerErrorAction(catalog.error)
		}));
}

/** The catalogs that wait for a refresh without a failure behind them. */
export function providerCatalogStale(
	catalogs: (ProviderCatalogStatus | null | undefined)[] | null | undefined
): number {
	return (catalogs ?? []).filter((catalog) => Boolean(catalog?.stale) && !catalog?.error).length;
}

/**
 * The recovery focus channel.
 *
 * The model selector shows a short reason and offers to open the connection
 * that failed. The connection settings pick that connection up from here, so
 * the operator does not have to find it in the list again.
 */
export const PROVIDER_RECOVERY_FOCUS_KEY = 'open-webui:provider-recovery-focus';
export const PROVIDER_RECOVERY_FOCUS_EVENT = 'open-webui:provider-recovery-focus';

export function requestProviderRecoveryFocus(connectionId: string): void {
	if (!connectionId || typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(PROVIDER_RECOVERY_FOCUS_KEY, connectionId);
	} catch {
		// A browser that refuses storage still gets the event below.
	}
	window.dispatchEvent(
		new CustomEvent(PROVIDER_RECOVERY_FOCUS_EVENT, { detail: { connectionId } })
	);
}

/** Read the pending focus once and forget it. */
export function takeProviderRecoveryFocus(): string {
	if (typeof window === 'undefined') return '';
	try {
		const value = window.localStorage.getItem(PROVIDER_RECOVERY_FOCUS_KEY) ?? '';
		if (value) window.localStorage.removeItem(PROVIDER_RECOVERY_FOCUS_KEY);
		return value;
	} catch {
		return '';
	}
}
