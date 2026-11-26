/**
 * Request guard for the resources page. Every async response is checked
 * against the account and generation that were active when it started, so a
 * response from a previous account or an obsolete refresh cannot overwrite
 * the current view.
 */
export type RequestIdentity = {
	account: string | undefined;
	generation: number;
};

export function createRequestGuard(initial: RequestIdentity = { account: undefined, generation: 0 }) {
	let identity: RequestIdentity = { ...initial };

	return {
		/** Begin a refresh: makes all previously issued requests stale. */
		begin(account: string | undefined): RequestIdentity {
			identity = { account, generation: identity.generation + 1 };
			return { ...identity };
		},
		/** Begin a non-refresh request (retry, prepare, execute) without
		 * invalidating other in-flight work. */
		issue(): RequestIdentity {
			return { ...identity };
		},
		/** True only when the response still belongs to the current view. */
		isCurrent(request: RequestIdentity, disposed: boolean, account: string | undefined): boolean {
			return (
				!disposed &&
				request.generation === identity.generation &&
				request.account === account &&
				request.account === identity.account
			);
		},
		get current(): RequestIdentity {
			return { ...identity };
		}
	};
}
