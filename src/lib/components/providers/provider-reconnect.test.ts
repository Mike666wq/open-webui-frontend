import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderApiError, startChatGPTLogin, updateProviderConnection } from '$lib/apis/providers';
import {
	PROVIDER_RECOVERY_FOCUS_EVENT,
	providerErrorAction,
	providerErrorActionLabelKey,
	requestProviderRecoveryFocus,
	takeProviderRecoveryFocus
} from '$lib/utils/provider-errors';

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('provider recovery actions', () => {
	it('offers a sign-in for an OAuth account and a new key for an API key account', () => {
		const rejected = {
			category: 'authentication',
			reason: 'invalid_credentials',
			suggested_action: 'replace_key'
		};
		expect(providerErrorAction(rejected, { authType: 'oauth' })).toBe('reconnect');
		expect(providerErrorAction(rejected, { authType: 'api_key' })).toBe('replace_key');
		expect(providerErrorActionLabelKey(rejected, { authType: 'oauth' })).toBe('Sign in again');
		expect(providerErrorActionLabelKey(rejected, { authType: 'api_key' })).toBe(
			'Replace the API key'
		);
	});

	it('does not ask for a new key when the provider refused the permission', () => {
		const forbidden = {
			category: 'authentication',
			reason: 'insufficient_permissions',
			suggested_action: 'check_permissions'
		};
		expect(providerErrorAction(forbidden, { authType: 'api_key' })).toBe('check_permissions');
		expect(providerErrorAction(forbidden, { authType: 'oauth' })).toBe('check_permissions');
	});
});

class MemoryStorage {
	private store = new Map<string, string>();

	getItem(key: string) {
		return this.store.has(key) ? (this.store.get(key) as string) : null;
	}

	setItem(key: string, value: string) {
		this.store.set(key, String(value));
	}

	removeItem(key: string) {
		this.store.delete(key);
	}

	clear() {
		this.store.clear();
	}
}

describe('the recovery focus channel', () => {
	beforeEach(() => {
		// The unit tests run without a browser; the channel only needs an
		// event target and a storage.
		vi.stubGlobal(
			'window',
			Object.assign(new EventTarget(), { localStorage: new MemoryStorage() })
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('hands the failing connection over to the connection settings', () => {
		const received: string[] = [];
		const listener = (event: Event) => {
			received.push((event as CustomEvent<{ connectionId: string }>).detail.connectionId);
		};
		window.addEventListener(PROVIDER_RECOVERY_FOCUS_EVENT, listener);
		requestProviderRecoveryFocus('connection-a');
		window.removeEventListener(PROVIDER_RECOVERY_FOCUS_EVENT, listener);
		expect(received).toEqual(['connection-a']);
		expect(takeProviderRecoveryFocus()).toBe('connection-a');
		// The focus is read once: a later visit must not jump back to it.
		expect(takeProviderRecoveryFocus()).toBe('');
	});
});

describe('the provider API keeps the taxonomy', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('keeps the stage, the reason and the action of a failed request', async () => {
		fetchMock.mockImplementation(() =>
			jsonResponse(
				{
					detail: 'Provider rejected the configured credentials or permissions',
					error: {
						category: 'authentication',
						status: 403,
						http_status: 403,
						upstream_status: 403,
						retryable: false,
						at: 1,
						hint: '厂商拒绝了这次请求的权限。',
						stage: 'catalog',
						reason: 'insufficient_permissions',
						suggested_action: 'check_permissions'
					}
				},
				403
			)
		);
		const failure = await updateProviderConnection('connection-a', { api_key: 'new' }).catch(
			(error) => error as ProviderApiError
		);
		expect(failure).toBeInstanceOf(ProviderApiError);
		expect(failure.providerError?.stage).toBe('catalog');
		expect(failure.providerError?.reason).toBe('insufficient_permissions');
		expect(failure.providerError?.suggested_action).toBe('check_permissions');
	});

	it('signs in again on the same connection instead of creating a second one', async () => {
		fetchMock.mockImplementation(() => jsonResponse({ attempt_id: 'attempt-1' }));
		await startChatGPTLogin('connection-a');
		const [url, options] = fetchMock.mock.calls[0];
		expect(String(url)).toContain('/providers/auth/chatgpt/start');
		expect(JSON.parse(options.body)).toEqual({ mode: 'browser', connection_id: 'connection-a' });
	});
});
