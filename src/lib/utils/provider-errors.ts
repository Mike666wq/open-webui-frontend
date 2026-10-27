/**
 * Provider error taxonomy shared with the backend.
 *
 * The backend owns the wording: every failure carries a display-ready `hint`.
 * These helpers only provide a fallback for older backends that do not send it
 * yet, and a short title for each of the five documented categories.
 */

export const PROVIDER_ERROR_CATEGORIES = [
	'connection',
	'provider_network',
	'authentication',
	'rate_limit',
	'upstream'
] as const;

export type ProviderErrorCategory = (typeof PROVIDER_ERROR_CATEGORIES)[number];

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

export interface ProviderError {
	category?: string;
	status?: number;
	http_status?: number;
	upstream_status?: number | null;
	retryable?: boolean;
	at?: number;
	hint?: string;
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
