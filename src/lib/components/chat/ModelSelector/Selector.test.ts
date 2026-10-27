import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { providerCatalogFailures, providerCatalogStale } from '$lib/utils/provider-errors';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELECTOR = join(HERE, 'Selector.svelte');

const source = readFileSync(SELECTOR, 'utf8');

describe('model selector catalog warnings', () => {
	it('reports every connection that failed, with its own reason', () => {
		const failures = providerCatalogFailures([
			{
				connection_id: 'connection-a',
				connection_name: 'SiliconFlow',
				stale: true,
				error: {
					category: 'provider_network',
					stage: 'catalog',
					reason: 'address_blocked',
					suggested_action: 'check_server_network'
				}
			},
			{
				connection_id: 'connection-b',
				connection_name: 'ChatGPT',
				stale: true,
				error: {
					category: 'authentication',
					stage: 'oauth_refresh',
					reason: 'token_expired',
					suggested_action: 'reconnect'
				}
			}
		]);
		expect(failures.map((failure) => failure.connectionId)).toEqual([
			'connection-a',
			'connection-b'
		]);
		expect(failures[0].summary).toBe('获取模型列表时地址被本地安全策略拦截');
		expect(failures[0].action).toBe('check_server_network');
		expect(failures[1].summary).toBe('刷新登录状态时登录状态已失效');
		expect(failures[1].action).toBe('reconnect');
	});

	it('keeps a catalog that only waits for a refresh out of the failures', () => {
		const catalogs = [
			{ connection_id: 'connection-a', connection_name: 'Fresh', stale: false, error: null },
			{ connection_id: 'connection-b', connection_name: 'Waiting', stale: true, error: null }
		];
		expect(providerCatalogFailures(catalogs)).toEqual([]);
		expect(providerCatalogStale(catalogs)).toBe(1);
	});

	it('survives a catalog without an error or a name', () => {
		expect(providerCatalogFailures([null, undefined, {}, { stale: true }])).toEqual([]);
		expect(providerCatalogStale(null)).toBe(0);
	});

	it('shows a short reason and a reachable action instead of the long hint', () => {
		// The long explanation belongs to the connection details; the model list
		// only carries the reason and a way into the connection.
		expect(source).toContain('providerCatalogFailures');
		expect(source).toContain('data-testid="provider-catalog-open-connection"');
		expect(source).toContain("$i18n.t('View connection')");
		expect(source).not.toContain('providerErrorHint');
		expect(source).not.toContain('providerErrorTitle');
	});

	it('keeps the warning out of the way of the search field and the model list', () => {
		expect(source).toContain('max-h-28');
		expect(source).toContain('overflow-y-auto');
	});
});
