import { SERVICE_PURPOSES, type ServicePurpose } from '$lib/utils/provider-services';

export type ModelPurpose = ServicePurpose | 'uncategorized';
export type ProviderModelRow = {
	upstream_id: string;
	name?: string;
	display_name?: string;
	uses?: Record<string, string>;
	enabled?: boolean;
};
export type ProviderConnectionRow = {
	id: string;
	name: string;
	owner_id?: string;
	visibility?: string;
	access_control?: { principal_type?: string; principal_id?: string; permission?: string }[];
	is_enabled?: boolean;
	models?: ProviderModelRow[];
};

export const MODEL_PURPOSES: readonly ModelPurpose[] = [...SERVICE_PURPOSES, 'uncategorized'];

export function purposesForModel(model: ProviderModelRow): ModelPurpose[] {
	const purposes = SERVICE_PURPOSES.filter((purpose) => Boolean(model.uses?.[purpose]));
	return purposes.length ? purposes : ['uncategorized'];
}

export function groupConnectionModels(connections: ProviderConnectionRow[]) {
	return MODEL_PURPOSES.map((purpose) => ({
		purpose,
		connections: connections
			.map((connection) => ({
				connection,
				models: (connection.models ?? []).filter((model) => purposesForModel(model).includes(purpose))
			}))
			.filter(({ models }) => models.length > 0)
	}));
}

export function connectionAccess(connection: ProviderConnectionRow): 'private' | 'shared' | 'public' {
	if (connection.visibility !== 'shared') return 'private';
	return connection.access_control?.some(
		(grant) => grant.principal_type === 'user' && grant.principal_id === '*' && grant.permission === 'read'
	)
		? 'public'
		: 'shared';
}
