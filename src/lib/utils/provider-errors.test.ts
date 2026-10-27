import { describe, expect, it } from 'vitest';
import {
	providerErrorCategory,
	providerErrorHint,
	providerErrorStatus,
	providerErrorTitle
} from './provider-errors';

describe('provider error taxonomy', () => {
	it('maps every documented category onto a title', () => {
		expect(providerErrorTitle({ category: 'connection' })).toBe('无法连接厂商');
		expect(providerErrorTitle({ category: 'provider_network' })).toBe('网络被安全策略拦截');
		expect(providerErrorTitle({ category: 'authentication' })).toBe('凭据被拒绝');
		expect(providerErrorTitle({ category: 'rate_limit' })).toBe('限流或额度不足');
		expect(providerErrorTitle({ category: 'upstream' })).toBe('厂商服务异常');
	});

	it('falls back to a connection error for unknown or missing categories', () => {
		expect(providerErrorCategory({ category: 'network' })).toBe('connection');
		expect(providerErrorCategory(null)).toBe('connection');
		expect(providerErrorCategory({})).toBe('connection');
	});

	it('prefers the backend hint over the local fallback', () => {
		expect(
			providerErrorHint({ category: 'provider_network', hint: '地址被拦截，请设置环境变量' })
		).toBe('地址被拦截，请设置环境变量');
		expect(providerErrorHint({ category: 'rate_limit' })).toContain('限流');
	});

	it('reports the upstream status first and falls back to the gateway status', () => {
		expect(providerErrorStatus({ status: 502, upstream_status: 500 })).toBe(500);
		expect(providerErrorStatus({ status: 502 })).toBe(502);
		expect(providerErrorStatus({ http_status: 401 })).toBe(401);
		expect(providerErrorStatus(null)).toBeNull();
	});
});
