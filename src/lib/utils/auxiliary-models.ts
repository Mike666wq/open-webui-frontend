/**
 * Auxiliary tasks (title, tags, follow-up suggestions, search queries) may each run on
 * their own model. The shared task model stays the default so an existing installation
 * keeps working after the upgrade, and a purpose without its own model inherits it.
 * No auxiliary purpose ever falls back to the model of the current chat.
 */

export type AuxiliaryPurposeKey = 'title' | 'tags' | 'followup' | 'query';

export type AuxiliaryVariant = 'local' | 'external';

export type AuxiliaryPurpose = {
	key: AuxiliaryPurposeKey;
	localField: string;
	externalField: string;
};

export const AUXILIARY_PURPOSES: AuxiliaryPurpose[] = [
	{ key: 'title', localField: 'TASK_MODEL_TITLE', externalField: 'TASK_MODEL_TITLE_EXTERNAL' },
	{ key: 'tags', localField: 'TASK_MODEL_TAGS', externalField: 'TASK_MODEL_TAGS_EXTERNAL' },
	{
		key: 'followup',
		localField: 'TASK_MODEL_FOLLOWUP',
		externalField: 'TASK_MODEL_FOLLOWUP_EXTERNAL'
	},
	{ key: 'query', localField: 'TASK_MODEL_QUERY', externalField: 'TASK_MODEL_QUERY_EXTERNAL' }
];

export const AUXILIARY_DEFAULT_FIELDS: Record<AuxiliaryVariant, string> = {
	local: 'TASK_MODEL',
	external: 'TASK_MODEL_EXTERNAL'
};

export function auxiliaryPurposeField(
	purpose: AuxiliaryPurposeKey,
	variant: AuxiliaryVariant
): string {
	const definition = AUXILIARY_PURPOSES.find((item) => item.key === purpose);
	if (!definition) {
		return '';
	}
	return variant === 'local' ? definition.localField : definition.externalField;
}

/**
 * The model a purpose should use: its own selection when set, otherwise the shared
 * default for the same variant. An empty result means the purpose is not configured.
 */
export function resolveAuxiliaryModel(
	taskConfig: Record<string, any> | null | undefined,
	purpose: AuxiliaryPurposeKey,
	variant: AuxiliaryVariant
): string {
	const purposeField = auxiliaryPurposeField(purpose, variant);
	const purposeValue = purposeField ? taskConfig?.[purposeField] : '';
	if (purposeValue) {
		return purposeValue;
	}
	return taskConfig?.[AUXILIARY_DEFAULT_FIELDS[variant]] ?? '';
}

/**
 * Every auxiliary purpose still lacks a model. The chat model is never a valid answer,
 * so this is what the interface uses to warn the administrator.
 */
export function unconfiguredAuxiliaryPurposes(
	taskConfig: Record<string, any> | null | undefined
): AuxiliaryPurposeKey[] {
	return AUXILIARY_PURPOSES.filter((purpose) => {
		const local = resolveAuxiliaryModel(taskConfig, purpose.key, 'local');
		const external = resolveAuxiliaryModel(taskConfig, purpose.key, 'external');
		return !local && !external;
	}).map((purpose) => purpose.key);
}
