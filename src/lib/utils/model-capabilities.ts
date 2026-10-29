type ModelWithCapabilities = {
	id: string;
	provider_model_id?: string;
	info?: { meta?: { capabilities?: object } };
};

/** Provider models have three vision states; a missing declaration is not a denial. */
export function visionCapability(model: ModelWithCapabilities | null | undefined): boolean | undefined {
	if (!model) return undefined;
	const declared = (model.info?.meta?.capabilities as { vision?: boolean } | undefined)?.vision;
	if (model.id.startsWith('provider:') || model.provider_model_id)
		return declared;
	// Keep the existing workspace-model default when the capability is absent.
	return declared ?? true;
}

export function imageInputStatus(
	modelIds: string[],
	models: ModelWithCapabilities[]
): 'supported' | 'unknown' | 'unsupported' {
	const byId = new Map(models.map((model) => [model.id, model]));
	const states = modelIds
		.map((id) => byId.get(id))
		.filter((model) => model && (model.id.startsWith('provider:') || model.provider_model_id))
		.map((model) => visionCapability(model));
	if (states.includes(false)) return 'unsupported';
	if (states.includes(undefined)) return 'unknown';
	return 'supported';
}
