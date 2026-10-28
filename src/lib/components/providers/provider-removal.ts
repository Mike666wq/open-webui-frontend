export type RemovalResult =
	| { state: 'removed'; revocationConfirmed: boolean | null }
	| { state: 'failed'; error: unknown }
	| { state: 'uncertain'; error: unknown };

/** Reconcile a lost response once. Never issue a second delete. */
export async function removeAndReconcile(
	id: string,
	remove: () => Promise<any>,
	readConnections: () => Promise<any>,
	oauth: boolean
): Promise<RemovalResult> {
	try {
		const response = await remove();
		return { state: 'removed', revocationConfirmed: oauth ? response?.revocation_confirmed === true : null };
	} catch (error) {
		// An explicit HTTP rejection is not a lost response. Never report it as
		// success merely because this user cannot see the connection on readback.
		if (error instanceof ProviderApiError) return { state: 'failed', error };
		try {
			const result = await readConnections();
			const rows = Array.isArray(result) ? result : result?.connections;
			if (!Array.isArray(rows)) return { state: 'uncertain', error };
			return rows.some((row) => row.id === id)
				? { state: 'failed', error }
				: { state: 'removed', revocationConfirmed: oauth ? false : null };
		} catch {
			return { state: 'uncertain', error };
		}
	}
}
import { ProviderApiError } from '$lib/apis/providers';

