import { describe, expect, it } from 'vitest';
import {
	providerErrorAction,
	providerErrorActionLabelKey,
	providerErrorCategory,
	providerErrorHint,
	providerErrorReason,
	providerErrorStage,
	providerErrorStatus,
	providerErrorSummary,
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

describe('provider error stage, reason and action', () => {
	it('reads the three new fields', () => {
		const error = {
			category: 'provider_network',
			stage: 'catalog',
			reason: 'address_blocked',
			suggested_action: 'check_server_network'
		};
		expect(providerErrorStage(error)).toBe('catalog');
		expect(providerErrorReason(error)).toBe('address_blocked');
		expect(providerErrorAction(error)).toBe('check_server_network');
	});

	it('keeps an old error object usable', () => {
		expect(providerErrorStage({ category: 'authentication' })).toBeNull();
		expect(providerErrorReason({ category: 'authentication' })).toBe('invalid_credentials');
		expect(providerErrorAction({ category: 'authentication' })).toBe('replace_key');
		expect(providerErrorSummary({ category: 'authentication' })).toBe('凭据无效');
	});

	it('does not claim a cause the backend did not report', () => {
		expect(providerErrorReason({ category: 'connection' })).toBe('unknown');
		expect(providerErrorSummary({ category: 'connection' })).toBe('无法连接厂商');
		expect(providerErrorSummary({ category: 'connection', stage: 'catalog' })).toBe(
			'获取模型列表时无法连接厂商'
		);
	});

	it('names the stage and the reason in one short line', () => {
		expect(
			providerErrorSummary({
				category: 'provider_network',
				stage: 'catalog',
				reason: 'address_blocked'
			})
		).toBe('获取模型列表时地址被本地安全策略拦截');
		expect(
			providerErrorSummary({
				category: 'authentication',
				stage: 'oauth_refresh',
				reason: 'token_expired'
			})
		).toBe('刷新登录状态时登录状态已失效');
		expect(
			providerErrorSummary({
				category: 'authentication',
				stage: 'catalog',
				reason: 'insufficient_permissions'
			})
		).toBe('获取模型列表时账号权限不足');
	});

	it('never asks an OAuth account for a new key', () => {
		const error = { category: 'authentication', reason: 'invalid_credentials' };
		expect(providerErrorAction(error, { authType: 'oauth' })).toBe('reconnect');
		expect(providerErrorAction(error, { authType: 'api_key' })).toBe('replace_key');
	});

	it('never asks an API key connection to sign in again', () => {
		const error = { category: 'authentication', suggested_action: 'reconnect' };
		expect(providerErrorAction(error, { authType: 'api_key' })).toBe('replace_key');
	});

	it('keeps the action the backend chose when it is possible', () => {
		const error = { category: 'authentication', reason: 'insufficient_permissions' };
		expect(providerErrorAction(error)).toBe('check_permissions');
		expect(providerErrorAction(error, { authType: 'oauth' })).toBe('check_permissions');
	});

	it('offers a translation key for every action', () => {
		for (const action of [
			'reconnect',
			'replace_key',
			'check_permissions',
			'check_server_network',
			'retry_later',
			'inspect_connection'
		]) {
			const key = providerErrorActionLabelKey({ suggested_action: action });
			expect(key.length).toBeGreaterThan(0);
		}
		expect(providerErrorActionLabelKey({ category: 'authentication' })).toBe('Replace the API key');
	});
});
