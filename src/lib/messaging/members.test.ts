import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__setMemberDirectoryDependenciesForTests,
	loadMoreMembers,
	resetMemberDirectory,
	setMemberDirectoryQuery,
	setVisibleMemberIds,
	subscribeMembers
} from './members';
import type { DirectoryUser } from './types';

type MemberMeta = { loading: boolean; total: number | null; hasMore: boolean };

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const lastPublished = (subscriber: ReturnType<typeof vi.fn>) =>
	subscriber.mock.calls.at(-1) as [DirectoryUser[], MemberMeta] | undefined;

const waitForPublished = async (
	subscriber: ReturnType<typeof vi.fn>,
	predicate: (users: DirectoryUser[], meta: MemberMeta) => boolean
) => {
	await vi.waitFor(() => {
		const call = lastPublished(subscriber);
		expect(call !== undefined && predicate(call[0], call[1])).toBe(true);
	});
};

describe('member directory', () => {
	beforeEach(() => {
		resetMemberDirectory();
	});

	afterEach(() => {
		resetMemberDirectory();
		__setMemberDirectoryDependenciesForTests({});
	});

	it('loads one page initially and excludes the current or pending user', async () => {
		const searchUsers = vi.fn().mockResolvedValue({
			total: 3,
			users: [
				{ id: 'me', name: 'Me', role: 'user' },
				{ id: 'pending', name: 'Pending', role: 'pending' },
				{ id: 'ada', name: 'Ada', role: 'user' }
			]
		});
		__setMemberDirectoryDependenciesForTests({
			searchUsers,
			getUserActiveStatusById: vi.fn().mockResolvedValue({ active: true })
		});

		const subscriber = vi.fn();
		const unsubscribe = subscribeMembers('token', 'me', subscriber);
		await waitForPublished(
			subscriber,
			(_users, meta) => meta.loading === false && meta.total === 3
		);

		expect(searchUsers).toHaveBeenCalledTimes(1);
		expect(searchUsers).toHaveBeenCalledWith('token', undefined, 'name', 'asc', 0);
		expect(subscriber).toHaveBeenLastCalledWith(
			[expect.objectContaining({ id: 'ada', is_active: null })],
			expect.objectContaining({ total: 3, hasMore: true })
		);
		unsubscribe();
	});

	it('loads the next page only when requested and resets on a new search', async () => {
		const searchUsers = vi
			.fn()
			.mockResolvedValueOnce({
				total: 2,
				users: [{ id: 'ada', name: 'Ada', role: 'user' }]
			})
			.mockResolvedValueOnce({
				total: 2,
				users: [{ id: 'grace', name: 'Grace', role: 'user' }]
			})
			.mockResolvedValueOnce({
				total: 1,
				users: [{ id: 'linus', name: 'Linus', role: 'user' }]
			});
		__setMemberDirectoryDependenciesForTests({
			searchUsers,
			getUserActiveStatusById: vi.fn().mockResolvedValue({ active: false })
		});
		const subscriber = vi.fn();
		const unsubscribe = subscribeMembers('token', 'me', subscriber);
		await waitForPublished(
			subscriber,
			(users, meta) => meta.loading === false && users.some((user) => user.id === 'ada')
		);

		await loadMoreMembers('token', 'me');
		expect(searchUsers).toHaveBeenNthCalledWith(2, 'token', undefined, 'name', 'asc', 1);
		await waitForPublished(
			subscriber,
			(users, meta) =>
				meta.loading === false &&
				users.some((user) => user.id === 'ada') &&
				users.some((user) => user.id === 'grace')
		);
		expect(lastPublished(subscriber)?.[1]).toEqual(expect.objectContaining({ hasMore: false }));

		setMemberDirectoryQuery('token', 'me', 'lin');
		await waitForPublished(
			subscriber,
			(users, meta) => meta.loading === false && users.some((user) => user.id === 'linus')
		);
		expect(searchUsers).toHaveBeenLastCalledWith('token', 'lin', 'name', 'asc', 0);
		expect(subscriber).toHaveBeenLastCalledWith(
			[expect.objectContaining({ id: 'linus' })],
			expect.objectContaining({ total: 1 })
		);
		unsubscribe();
	});

	it('keeps presence unknown on failure and limits status requests to four', async () => {
		const users = Array.from({ length: 8 }, (_, index) => ({
			id: `user-${index}`,
			name: `User ${index}`,
			role: 'user'
		}));
		const searchUsers = vi.fn().mockResolvedValue({ total: users.length, users });
		let activeRequests = 0;
		let maxActiveRequests = 0;
		const statusRequests: ReturnType<typeof deferred<any>>[] = [];
		const getUserActiveStatusById = vi.fn((_token, userId) => {
			const request = deferred<any>();
			statusRequests.push(request);
			activeRequests += 1;
			maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
			return request.promise.finally(() => {
				activeRequests -= 1;
				if (userId === 'user-7') throw new Error('presence unavailable');
				return { active: Number(userId.split('-')[1]) % 2 === 0 };
			});
		});
		__setMemberDirectoryDependenciesForTests({ searchUsers, getUserActiveStatusById });
		const subscriber = vi.fn();
		const unsubscribe = subscribeMembers('token', 'me', subscriber);
		await vi.waitFor(() => expect(searchUsers).toHaveBeenCalledTimes(1));
		await Promise.resolve();

		setVisibleMemberIds(users.map((user) => user.id));
		await vi.waitFor(() => expect(statusRequests).toHaveLength(4));
		expect(maxActiveRequests).toBe(4);

		statusRequests[0].resolve({ active: true });
		statusRequests[1].resolve({ active: false });
		statusRequests[2].resolve({ active: true });
		statusRequests[3].resolve({ active: false });
		await vi.waitFor(() => expect(statusRequests).toHaveLength(8));
		statusRequests[4].resolve({ active: true });
		statusRequests[5].resolve({ active: false });
		statusRequests[6].resolve({ active: true });
		statusRequests[7].reject(new Error('presence unavailable'));
		await vi.waitFor(() =>
			expect(subscriber).toHaveBeenLastCalledWith(
				expect.arrayContaining([expect.objectContaining({ id: 'user-7', is_active: null })]),
				expect.any(Object)
			)
		);
		expect(maxActiveRequests).toBe(4);
		unsubscribe();
	});

	it('ignores stale status results after switching search generations', async () => {
		const firstStatus = deferred<any>();
		const searchUsers = vi
			.fn()
			.mockResolvedValueOnce({
				total: 1,
				users: [{ id: 'old', name: 'Old', role: 'user' }]
			})
			.mockResolvedValueOnce({
				total: 1,
				users: [{ id: 'new', name: 'New', role: 'user' }]
			});
		__setMemberDirectoryDependenciesForTests({
			searchUsers,
			getUserActiveStatusById: vi.fn().mockReturnValueOnce(firstStatus.promise)
		});
		const subscriber = vi.fn();
		const unsubscribe = subscribeMembers('token', 'me', subscriber);
		await waitForPublished(
			subscriber,
			(users, meta) => meta.loading === false && users.some((user) => user.id === 'old')
		);
		setVisibleMemberIds(['old']);
		await vi.waitFor(() => expect(__setMemberDirectoryDependenciesForTests).toBeTypeOf('function'));

		setMemberDirectoryQuery('token', 'me', 'new');
		await waitForPublished(
			subscriber,
			(users, meta) => meta.loading === false && users.some((user) => user.id === 'new')
		);
		const callsBeforeStaleResolve = subscriber.mock.calls.length;
		firstStatus.resolve({ active: true });
		await vi.waitFor(() =>
			expect(subscriber.mock.calls.length).toBeGreaterThan(callsBeforeStaleResolve)
		);
		expect(subscriber).toHaveBeenLastCalledWith(
			[expect.objectContaining({ id: 'new', is_active: null })],
			expect.any(Object)
		);
		unsubscribe();
	});
});
