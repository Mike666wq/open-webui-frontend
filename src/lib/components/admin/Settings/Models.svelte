<script lang="ts">
	import { marked } from 'marked';
	import Sortable from 'sortablejs';
	import fileSaver from 'file-saver';
	const { saveAs } = fileSaver;

	import { onMount, onDestroy, getContext, tick } from 'svelte';
	const i18n: any = getContext('i18n');

	import {
		config,
		models as _models,
		pinnedModels,
		settings,
		showSettings,
		user
	} from '$lib/stores';
	import {
		createNewModel,
		deleteAllModels,
		deleteModelById,
		getAllModels,
		getModelById,
		exportModels,
		toggleModelById,
		updateModelById,
		updateModelAccessGrants,
		importModels
	} from '$lib/apis/models';
	import { copyToClipboard } from '$lib/utils';
	import { updateUserSettings } from '$lib/apis/users';

	import { getModels } from '$lib/apis';
	import { getModelsConfig, setModelsConfig } from '$lib/apis/configs';
	import Search from '$lib/components/icons/Search.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import ModelEditor from '$lib/components/workspace/Models/ModelEditor.svelte';
	import { toast } from 'svelte-sonner';
	import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
	import ManageModelsModal from './Models/ManageModelsModal.svelte';
	import ModelDefaultsPanel from './Models/ModelDefaultsPanel.svelte';
	import ModelMenu from '$lib/components/admin/Settings/Models/ModelMenu.svelte';
	import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
	import EyeSlash from '$lib/components/icons/EyeSlash.svelte';
	import Eye from '$lib/components/icons/Eye.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import CheckCircle from '$lib/components/icons/CheckCircle.svelte';
	import GarbageBin from '$lib/components/icons/GarbageBin.svelte';
	import Minus from '$lib/components/icons/Minus.svelte';
	import DocumentArrowUp from '$lib/components/icons/DocumentArrowUp.svelte';
	import Download from '$lib/components/icons/Download.svelte';
	import EllipsisVertical from '$lib/components/icons/EllipsisVertical.svelte';
	import Wrench from '$lib/components/icons/Wrench.svelte';
	import Pin from '$lib/components/icons/Pin.svelte';
	import PinSlash from '$lib/components/icons/PinSlash.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import LockClosed from '$lib/components/icons/LockClosed.svelte';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { goto } from '$app/navigation';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import DropdownMenu from '$lib/components/common/DropdownMenu.svelte';
	import AdminViewSelector from './Models/AdminViewSelector.svelte';
	import { getProviderConnections, getProviderCatalog, updateProviderConnection, updateProviderModel } from '$lib/apis/providers';
	import { serviceAdapters, supportedServicePurposes, SERVICE_PURPOSES } from '$lib/utils/provider-services';
	import AccessControl from '$lib/components/workspace/common/AccessControl.svelte';
	import { connectionAccess, groupConnectionModels, type ProviderConnectionRow, type ProviderModelRow } from './Models/model-uses';
	import TagSelector from '$lib/components/workspace/common/TagSelector.svelte';

	type ModelListItem = { id: string; name?: string };

	let shiftKey = false;

	export let tabState: Record<string, unknown> | null = null;

	let modelsImportInProgress = false;
	let importFiles;
	let modelsImportInputElement: HTMLInputElement;
	let tagsContainerElement: HTMLDivElement;
	let modelListElement: HTMLDivElement;
	let sortable = null;

	let models = null;
	let modelsConfig = null;
	let modelOrderList: string[] = [];
	let defaultModelIds: string[] = [];
	let defaultPinnedModelIds: string[] = [];
	let defaultModelIdSet = new Set<string>();
	let defaultPinnedModelIdSet = new Set<string>();

	let savedModels: ModelListItem[] = [];
	let togglingModels = new Set<string>();
	let allModels: ModelListItem[] = [];
	let availableModelIds = new Set<string>();

	let filteredModels = [];
	let selectedModelId = null;

	let showManageModal = false;
	let showResetModal = false;
	let showDeleteModal = false;
	let modelToDelete: ModelListItem | null = null;
	let savingModelOrder = false;
	let savingModelsSettings = false;
	let modelOrderDirty = false;
	let modelDefaultsPanel = null;
	let modelDefaultsDirty = false;

	let providerConnections: ProviderConnectionRow[] = [];
	let providerTemplates: any[] = [];
	let providerError = '';
	let providerBusy = '';
	let editingProviderModel = '';
	let providerDisplayName = '';
	let providerUses: Record<string, string> = {};
	let editingProviderAccess = '';
	let providerVisibility: 'private' | 'shared' = 'private';
	let providerGrants: any[] = [];
	$: providerGroups = groupConnectionModels(providerConnections);
	const providerPurposeLabels: Record<string, string> = {
		chat: 'Chat', transcription: 'Transcription', speech: 'Speech', image: 'Image', uncategorized: 'Uncategorized'
	};
	const providerTemplateFor = (connection: ProviderConnectionRow) => providerTemplates.find((template) => template.id === (connection as any).provider_template || template.id === (connection as any).provider_id);
	const canManageProvider = (connection: ProviderConnectionRow) => connection.visibility === 'shared' ? $user?.role === 'admin' : connection.owner_id === $user?.id;
	const loadProviderConnections = async () => {
		try {
			const [rows, catalog] = await Promise.all([getProviderConnections(), getProviderCatalog()]);
			providerConnections = Array.isArray(rows) ? rows : (rows?.connections ?? []);
			providerTemplates = catalog.data;
			providerError = '';
		} catch (err) { providerError = String(err).replace(/^Error: /, ''); }
	};
	const beginProviderEdit = (connection: ProviderConnectionRow, model: ProviderModelRow) => {
		editingProviderModel = `${connection.id}:${model.upstream_id}`;
		providerDisplayName = model.name ?? model.display_name ?? model.upstream_id;
		providerUses = { ...(model.uses ?? {}) };
	};
	const saveProviderModel = async (connection: ProviderConnectionRow, model: ProviderModelRow, payload: { display_name?: string; uses?: Record<string, string>; enabled?: boolean }) => {
		providerBusy = `${connection.id}:${model.upstream_id}`;
		try {
			await updateProviderModel(connection.id, model.upstream_id, payload);
			await loadProviderConnections();
			editingProviderModel = '';
		} catch (err) { toast.error(String(err).replace(/^Error: /, '')); }
		finally { providerBusy = ''; }
	};
	const beginProviderAccess = (connection: ProviderConnectionRow) => {
		editingProviderAccess = connection.id;
		providerVisibility = connection.visibility === 'shared' ? 'shared' : 'private';
		providerGrants = [...(connection.access_control ?? [])];
	};
	const saveProviderAccess = async (connection: ProviderConnectionRow) => {
		providerBusy = connection.id;
		try {
			await updateProviderConnection(connection.id, { visibility: providerVisibility, ...(providerVisibility === 'shared' ? { access_control: providerGrants } : {}) });
			await loadProviderConnections();
			editingProviderAccess = '';
		} catch (err) { toast.error(String(err).replace(/^Error: /, '')); }
		finally { providerBusy = ''; }
	};
	let viewOption = 'available';
	let providerViewLoaded = false;
	$: if (viewOption === 'provider' && !providerViewLoaded) {
		providerViewLoaded = true;
		loadProviderConnections();
	} else if (viewOption !== 'provider') {
		providerViewLoaded = false;
	}
	let tags: string[] = [];
	let selectedTag = '';

	$: if (typeof tabState?.id === 'string' && tabState.id) {
		selectedModelId = tabState.id;
		tabState = null;
	}

	const isPublicModel = (model) => {
		return (model?.access_grants ?? []).some(
			(g) => g.principal_type === 'user' && g.principal_id === '*' && g.permission === 'read'
		);
	};

	const isSharedModel = (model) => (model?.access_grants ?? []).length > 0 && !isPublicModel(model);

	const isPresetModel = (model: any) =>
		!!(model?.preset || model?.base_model_id || model?.info?.base_model_id);
	const canResetModel = (model: ModelListItem | null) =>
		!!model && !isPresetModel(model) && availableModelIds.has(model.id);
	const modelTags = (model: any): string[] =>
		(model?.meta?.tags ?? [])
			.map((tag) => (typeof tag === 'string' ? tag : tag?.name))
			.filter(Boolean);

	const modelAccessLabel = (model) => {
		if (isPublicModel(model)) {
			return $i18n.t('Public');
		}
		if (isSharedModel(model)) {
			return $i18n.t('Shared');
		}
		return $i18n.t('Private');
	};

	const modelAccessClass = (model) => {
		if (isPublicModel(model)) {
			return 'text-[#4f7a5a] dark:text-[#8db395]';
		}
		if (isSharedModel(model)) {
			return 'text-[#4f6f93] dark:text-[#8ba6c6]';
		}
		return 'text-gray-500 dark:text-gray-400';
	};

	$: defaultModelIdSet = new Set(defaultModelIds);
	$: defaultPinnedModelIdSet = new Set(defaultPinnedModelIds);

	$: if (models) {
		const modelOrder = new Map(modelOrderList.map((id, idx) => [id, idx]));

		filteredModels = models
			.filter((m) => !selectedTag || modelTags(m).includes(selectedTag))
			.filter((m) => searchValue === '' || m.name.toLowerCase().includes(searchValue.toLowerCase()))
			.filter((m) => {
				if (viewOption === 'available') return availableModelIds.has(m.id) || isPresetModel(m);
				if (viewOption === 'unavailable') return !availableModelIds.has(m.id) && !isPresetModel(m);
				if (viewOption === 'base') return !isPresetModel(m);
				if (viewOption === 'workspace') return isPresetModel(m);
				if (viewOption === 'enabled') return m?.is_active ?? true;
				if (viewOption === 'disabled') return !(m?.is_active ?? true);
				if (viewOption === 'visible') return !(m?.meta?.hidden ?? false);
				if (viewOption === 'hidden') return m?.meta?.hidden === true;
				if (viewOption === 'public') return isPublicModel(m);
				if (viewOption === 'private') return !isPublicModel(m);
				if (viewOption === 'selected') return defaultModelIdSet.has(m.id);
				if (viewOption === 'pinned') return defaultPinnedModelIdSet.has(m.id);
				return true; // All
			})
			.sort((a, b) => {
				const orderA = modelOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
				const orderB = modelOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;

				if (orderA !== orderB) {
					return orderA - orderB;
				}

				return (a?.name ?? a?.id ?? '').localeCompare(b?.name ?? b?.id ?? '');
			});
	}

	let searchValue = '';

	const enableAllHandler = async () => {
		const modelsToEnable = filteredModels.filter((m) => !(m.is_active ?? true));
		// Optimistic UI update
		modelsToEnable.forEach((m) => (m.is_active = true));
		models = models;
		// Sync with server
		await Promise.all(
			modelsToEnable.map((model) => upsertModelHandler(model, { is_active: true }, false))
		);

		await tick();
		await init();
	};

	const disableAllHandler = async () => {
		const modelsToDisable = filteredModels.filter((m) => m.is_active ?? true);
		// Optimistic UI update
		modelsToDisable.forEach((m) => (m.is_active = false));
		models = models;
		// Sync with server
		await Promise.all(
			modelsToDisable.map((model) => upsertModelHandler(model, { is_active: false }, false))
		);

		await tick();
		await init();
	};

	const showAllHandler = async () => {
		const modelsToShow = filteredModels.filter((m) => m?.meta?.hidden === true);
		// Optimistic UI update
		modelsToShow.forEach((m) => {
			m.meta = { ...m.meta, hidden: false };
		});
		models = models;
		// Sync with server
		await Promise.all(
			modelsToShow.map((model) =>
				upsertModelHandler(model, { meta: { ...model.meta, hidden: false } }, false)
			)
		);

		toast.success($i18n.t('All models are now visible'));
		await tick();
		await init();
	};

	const hideAllHandler = async () => {
		const modelsToHide = filteredModels.filter((m) => !(m?.meta?.hidden ?? false));
		// Optimistic UI update
		modelsToHide.forEach((m) => {
			m.meta = { ...m.meta, hidden: true };
		});
		models = models;
		// Sync with server
		await Promise.all(
			modelsToHide.map((model) =>
				upsertModelHandler(model, { meta: { ...model.meta, hidden: true } }, false)
			)
		);

		toast.success($i18n.t('All models are now hidden'));
		await tick();
		await init();
	};

	const downloadModels = async (models) => {
		try {
			const exported = [];
			for (const model of models) exported.push(await getPortableModel(model));
			models = exported;
		} catch (error: any) {
			toast.error(`${error?.detail ?? error}`);
			return;
		}
		let blob = new Blob([JSON.stringify(models)], {
			type: 'application/json'
		});
		saveAs(blob, `models-export-${Date.now()}.json`);
	};

	const init = async () => {
		models = null;

		modelsConfig = await getModelsConfig(localStorage.token);
		modelOrderList = modelsConfig?.MODEL_ORDER_LIST ?? [];
		defaultModelIds = (modelsConfig?.DEFAULT_MODELS ?? '').split(',').filter((id) => id);
		defaultPinnedModelIds = (modelsConfig?.DEFAULT_PINNED_MODELS ?? '')
			.split(',')
			.filter((id) => id);

		savedModels = await getAllModels(localStorage.token);
		tags = [...new Set(savedModels.flatMap(modelTags))].sort();
		if (selectedTag && !tags.includes(selectedTag)) {
			selectedTag = '';
		}

		allModels = await getModels(localStorage.token);

		const providerModels = await getModels(localStorage.token, null, true);
		const allModelIds = new Set<string>(allModels.map((model: ModelListItem) => model.id));
		allModels = [
			...allModels,
			...providerModels.filter((model: ModelListItem) => !allModelIds.has(model.id))
		];
		availableModelIds = new Set(allModels.map((model) => model.id));
		allModels.push(...savedModels.filter((model) => !availableModelIds.has(model.id)));

		models = allModels.map((m: ModelListItem) => {
			const savedModel = savedModels.find((model: ModelListItem) => model.id === m.id);

			if (savedModel) {
				return {
					...m,
					...savedModel
				};
			} else {
				return {
					...m,
					id: m.id,
					name: m.name,

					is_active: true
				};
			}
		});

		modelOrderList = [
			...modelOrderList.filter((id) => models.some((model) => model.id === id)),
			...models
				.map((model) => model.id)
				.filter((id) => !modelOrderList.includes(id))
				.sort((a, b) => a.localeCompare(b))
		];
		modelOrderDirty = false;

		_models.set(
			await getModels(
				localStorage.token,
				$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
			)
		);
	};

	const saveModelOrder = async (orderedModelIds: string[]) => {
		savingModelOrder = true;

		const res = await setModelsConfig(localStorage.token, {
			DEFAULT_MODELS: defaultModelIds.join(','),
			DEFAULT_PINNED_MODELS: defaultPinnedModelIds.join(','),
			MODEL_ORDER_LIST: orderedModelIds,
			DEFAULT_MODEL_METADATA: modelsConfig?.DEFAULT_MODEL_METADATA ?? null,
			DEFAULT_MODEL_PARAMS: modelsConfig?.DEFAULT_MODEL_PARAMS ?? null
		}).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			modelsConfig = res;
			modelOrderDirty = false;
			toast.success($i18n.t('Model order saved successfully'));
			_models.set(
				await getModels(
					localStorage.token,
					$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
				)
			);
		}

		savingModelOrder = false;
	};

	const saveModelsSettings = async () => {
		savingModelsSettings = true;

		if (modelOrderDirty) {
			await saveModelOrder(modelOrderList);
		}

		if (modelDefaultsDirty) {
			await modelDefaultsPanel?.save();
		}

		savingModelsSettings = false;
	};

	const saveModelDefaults = async (
		nextDefaultModelIds: string[],
		nextDefaultPinnedModelIds: string[],
		successMessage: string
	) => {
		const previousDefaultModelIds = defaultModelIds;
		const previousDefaultPinnedModelIds = defaultPinnedModelIds;

		defaultModelIds = nextDefaultModelIds;
		defaultPinnedModelIds = nextDefaultPinnedModelIds;

		const res = await setModelsConfig(localStorage.token, {
			DEFAULT_MODELS: nextDefaultModelIds.join(','),
			DEFAULT_PINNED_MODELS: nextDefaultPinnedModelIds.join(','),
			MODEL_ORDER_LIST: modelsConfig?.MODEL_ORDER_LIST ?? [],
			DEFAULT_MODEL_METADATA: modelsConfig?.DEFAULT_MODEL_METADATA ?? null,
			DEFAULT_MODEL_PARAMS: modelsConfig?.DEFAULT_MODEL_PARAMS ?? null
		}).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			modelsConfig = res;
			toast.success(successMessage);
		} else {
			defaultModelIds = previousDefaultModelIds;
			defaultPinnedModelIds = previousDefaultPinnedModelIds;
		}
	};

	const toggleDefaultModelHandler = async (model) => {
		const isSelected = defaultModelIdSet.has(model.id);
		const nextDefaultModelIds = isSelected
			? defaultModelIds.filter((id) => id !== model.id)
			: [...new Set([...defaultModelIds, model.id])];

		await saveModelDefaults(
			nextDefaultModelIds,
			defaultPinnedModelIds,
			isSelected
				? $i18n.t('Model removed from selected models')
				: $i18n.t('Model added to selected models')
		);
	};

	const toggleDefaultPinnedModelHandler = async (model) => {
		const isPinned = defaultPinnedModelIdSet.has(model.id);
		const nextDefaultPinnedModelIds = isPinned
			? defaultPinnedModelIds.filter((id) => id !== model.id)
			: [...new Set([...defaultPinnedModelIds, model.id])];

		await saveModelDefaults(
			defaultModelIds,
			nextDefaultPinnedModelIds,
			isPinned
				? $i18n.t('Model removed from pinned models')
				: $i18n.t('Model added to pinned models')
		);
	};

	const positionChangeHandler = async (event) => {
		const { oldIndex, newIndex, item } = event;

		if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
			return;
		}

		const parent = item.parentNode;
		const target = parent.children[oldIndex < newIndex ? oldIndex : oldIndex + 1];
		parent.insertBefore(item, target);

		// Anchor on the visible neighbor so filtered-out models keep their place
		const movedModelId = filteredModels[oldIndex].id;
		const anchorModelId = filteredModels[newIndex].id;
		const reorderedIds = modelOrderList.filter((id) => id !== movedModelId);
		const anchorIndex = reorderedIds.indexOf(anchorModelId);
		reorderedIds.splice(oldIndex < newIndex ? anchorIndex + 1 : anchorIndex, 0, movedModelId);

		modelOrderList = reorderedIds;
		modelOrderDirty = true;
	};

	const initSortable = () => {
		if (sortable) {
			sortable.destroy();
			sortable = null;
		}

		if (viewOption !== 'provider' && modelListElement && filteredModels.length > 0) {
			sortable = new Sortable(modelListElement, {
				animation: 150,
				handle: '.model-item-handle',
				onUpdate: positionChangeHandler
			});
		}
	};

	$: if (modelListElement && filteredModels) {
		tick().then(() => {
			initSortable();
		});
	}

	const upsertModelHandler = async (model, overrides = {}, showToast = true) => {
		model = { ...model, ...(isPresetModel(model) ? {} : { base_model_id: null }), ...overrides };

		if (savedModels.find((m: ModelListItem) => m.id === model.id) || isPresetModel(model)) {
			const res = await updateModelById(localStorage.token, model.id, {
				...savedModels.find((m: ModelListItem) => m.id === model.id),
				...model
			}).catch((error) => {
				return null;
			});

			if (res && showToast) {
				toast.success($i18n.t('Model updated successfully'));
			}
			return !!res;
		} else {
			const res = await createNewModel(localStorage.token, {
				meta: {},
				id: model.id,
				name: model.name,
				base_model_id: null,
				params: {},
				access_grants: [],
				...model
			}).catch((error) => {
				return null;
			});

			if (res) {
				savedModels = [...savedModels, res];
			}

			if (res && showToast) {
				toast.success($i18n.t('Model updated successfully'));
				await init().catch((error) => toast.error(`${error}`));
			}
			return !!res;
		}
	};

	const toggleModelHandler = async (model) => {
		if (togglingModels.has(model.id)) return;
		togglingModels = new Set([...togglingModels, model.id]);
		const previousState = !model.is_active;
		try {
			if (!savedModels.find((m: ModelListItem) => m.id === model.id) && !isPresetModel(model)) {
				const res = await createNewModel(localStorage.token, {
					id: model.id,
					name: model.name,
					base_model_id: null,
					meta: {},
					params: {},
					access_grants: [],
					is_active: model.is_active
				});
				if (!res) throw new Error($i18n.t('Failed to update model'));
				savedModels = [...savedModels, res];
			} else {
				await toggleModelById(localStorage.token, model.id);
			}
		} catch (error) {
			model.is_active = previousState;
			allModels = [...allModels];
			toast.error(String(error instanceof Error ? error.message : error));
			return;
		} finally {
			togglingModels.delete(model.id);
			togglingModels = new Set(togglingModels);
		}
		try {
			_models.set(
				await getModels(
					localStorage.token,
					$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
				)
			);
		} catch (error) {
			toast.error(String(error instanceof Error ? error.message : error));
		}
	};

	const deleteModelHandler = async (model: ModelListItem) => {
		try {
			// Read fresh records: visibility and access changes can create saved settings.
			const savedModels = await getAllModels(localStorage.token);
			if (savedModels.some((savedModel: ModelListItem) => savedModel.id === model.id)) {
				const res = await deleteModelById(localStorage.token, model.id);
				if (!res) {
					toast.error($i18n.t('Failed to delete model'));
					return;
				}
			}

			toast.success(
				canResetModel(model)
					? $i18n.t('Model reset successfully')
					: $i18n.t('Deleted {{name}}', { name: model.name })
			);
			await init();
		} catch (error: any) {
			toast.error(`${error?.detail ?? error}`);
		}
	};

	const hideModelHandler = async (model) => {
		const updatedModel = {
			...model,
			meta: {
				...model.meta,
				hidden: !(model?.meta?.hidden ?? false)
			}
		};

		await upsertModelHandler(updatedModel, { meta: updatedModel.meta }, false);
		models = models.map((model) => (model.id === updatedModel.id ? updatedModel : model));
		_models.set(
			await getModels(
				localStorage.token,
				$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
			)
		);

		toast.success(
			updatedModel.meta.hidden
				? $i18n.t(`Model {{name}} is now hidden`, {
						name: updatedModel.id
					})
				: $i18n.t(`Model {{name}} is now visible`, {
						name: updatedModel.id
					})
		);
	};

	const toggleModelPrivacyHandler = async (model) => {
		const nextAccessGrants = isPublicModel(model)
			? []
			: [
					...(model?.access_grants ?? []),
					{
						principal_type: 'user',
						principal_id: '*',
						permission: 'read'
					}
				];

		const res = await updateModelAccessGrants(
			localStorage.token,
			model.id,
			model.name,
			nextAccessGrants
		).catch(() => null);

		if (res) {
			models = models.map((m) =>
				m.id === model.id ? { ...m, access_grants: res.access_grants ?? nextAccessGrants } : m
			);
			_models.set(
				await getModels(
					localStorage.token,
					$config?.features?.enable_direct_connections && ($settings?.directConnections ?? null)
				)
			);
			toast.success(
				isPublicModel({ access_grants: nextAccessGrants })
					? $i18n.t('Model is now public')
					: $i18n.t('Model is now private')
			);
		}
	};

	const copyLinkHandler = async (model) => {
		const baseUrl = window.location.origin;
		const res = await copyToClipboard(`${baseUrl}/?model=${encodeURIComponent(model.id)}`);

		if (res) {
			toast.success($i18n.t('Copied link to clipboard'));
		} else {
			toast.error($i18n.t('Failed to copy link'));
		}
	};

	const getFullModel = async (model: any) =>
		savedModels.some((savedModel) => savedModel.id === model.id) || isPresetModel(model)
			? ((await getModelById(localStorage.token, model.id).catch(() => null)) ?? model)
			: model;

	const getPortableModel = async (model: any) =>
		isPresetModel(model)
			? (await exportModels(localStorage.token, [model.id]))[0]
			: getFullModel(model);

	const openModelHandler = async (model: any) => {
		if (isPresetModel(model)) {
			showSettings.set(false);
			await goto(`/workspace/models/edit?id=${encodeURIComponent(model.id)}`);
			return;
		}

		selectedModelId = model.id;
	};

	const cloneHandler = async (model) => {
		model = await getFullModel(model);
		sessionStorage.model = JSON.stringify({
			...model,
			...(isPresetModel(model) ? {} : { base_model_id: model.id }),
			id: `${model.id}-clone`,
			name: `${model.name} (Clone)`
		});
		showSettings.set(false);
		await goto('/workspace/models/create');
	};

	const exportModelHandler = async (model) => {
		try {
			model = await getPortableModel(model);
		} catch (error: any) {
			toast.error(`${error?.detail ?? error}`);
			return;
		}
		let blob = new Blob([JSON.stringify([model])], {
			type: 'application/json'
		});
		saveAs(blob, `${model.id}-${Date.now()}.json`);
	};

	const pinModelHandler = async (modelId) => {
		settings.set({
			...$settings,
			pinnedModels: $pinnedModels.includes(modelId)
				? $pinnedModels.filter((id) => id !== modelId)
				: [...$pinnedModels, modelId]
		});
		await updateUserSettings(localStorage.token, { ui: { pinnedModels: $settings.pinnedModels } });
	};

	onMount(async () => {
		await init();

		const onKeyDown = (event) => {
			if (event.key === 'Shift') {
				shiftKey = true;
			}
		};

		const onKeyUp = (event) => {
			if (event.key === 'Shift') {
				shiftKey = false;
			}
		};

		const onBlur = () => {
			shiftKey = false;
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onBlur);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
		};
	});

	onDestroy(() => {
		if (sortable) {
			sortable.destroy();
		}
	});
</script>

<ConfirmDialog
	title={canResetModel(modelToDelete) ? $i18n.t('Reset') : $i18n.t('Delete')}
	message={canResetModel(modelToDelete)
		? $i18n.t(
				'This will reset the saved settings for this base model to their defaults. The model will remain available.'
			)
		: $i18n.t('Are you sure you want to delete **{{modelName}}**?', {
				modelName: modelToDelete?.name
			})}
	confirmLabel={canResetModel(modelToDelete) ? $i18n.t('Reset') : $i18n.t('Delete')}
	bind:show={showDeleteModal}
	onConfirm={async () => {
		if (modelToDelete) await deleteModelHandler(modelToDelete);
	}}
/>

<ConfirmDialog
	title={$i18n.t('Reset All Models')}
	message={$i18n.t('This will delete all models including custom models and cannot be undone.')}
	bind:show={showResetModal}
	onConfirm={async () => {
		const res = await deleteAllModels(localStorage.token);
		if (res) {
			toast.success($i18n.t('All models deleted successfully'));
			await init();
		}
	}}
/>

<ManageModelsModal bind:show={showManageModal} />

{#if models !== null}
	{#if selectedModelId === null}
		<div class="flex h-full min-h-0 flex-col text-sm">
			<div class="mb-0.5 flex items-center justify-between">
				<h2 class="text-sm font-medium text-gray-900 dark:text-white">
					{$i18n.t('settings.admin.models.title')}
					<span class="ml-2 font-normal text-gray-500 dark:text-gray-500">
						{viewOption === 'provider' ? '' : filteredModels.length}
					</span>
				</h2>
			</div>

			{#if $user?.role === 'admin'}
				<input
					id="models-import-input"
					bind:this={modelsImportInputElement}
					bind:files={importFiles}
					type="file"
					accept=".json"
					hidden
					on:change={() => {
						if (importFiles.length > 0) {
							const reader = new FileReader();
							reader.onload = async (event) => {
								modelsImportInProgress = true;

								try {
									const models = JSON.parse(String(event.target.result));
									const res = await importModels(localStorage.token, models);

									if (res) {
										toast.success($i18n.t('Models imported successfully'));
										await init();
									} else {
										toast.error($i18n.t('Failed to import models'));
									}
								} catch (e) {
									toast.error(e?.detail ?? $i18n.t('Invalid JSON file'));
									console.error(e);
								}

								modelsImportInProgress = false;
							};
							reader.readAsText(importFiles[0]);
						}
					}}
				/>
			{/if}

			<div class="flex min-h-0 flex-1 flex-col space-y-1">
				{#if viewOption !== 'provider'}
					<ModelDefaultsPanel
						bind:this={modelDefaultsPanel}
						bind:dirty={modelDefaultsDirty}
						initHandler={init}
					/>
				{/if}

				<div class="flex h-8 shrink-0 items-center w-full gap-2">
					<div class="flex min-w-0 flex-1 items-center">
						{#if viewOption !== 'provider'}
						<div class=" self-center ml-1 mr-3">
							<Search className="size-3.5" />
						</div>
						<input
							data-settings-search
							class=" w-full text-sm py-1 rounded-r-xl outline-hidden bg-transparent"
							bind:value={searchValue}
							placeholder={$i18n.t('Search Models')}
						/>
						{#if searchValue}
							<div class="self-center pl-1.5 translate-y-[0.5px] rounded-l-xl bg-transparent">
								<button
									class="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition"
									aria-label={$i18n.t('Clear search')}
									on:click={() => {
										searchValue = '';
									}}
								>
									<XMark className="size-3" strokeWidth="2" />
								</button>
							</div>
						{/if}
						{/if}
					</div>

					<div
						class="flex max-w-[60%] shrink-0 items-center gap-1 overflow-x-auto scrollbar-none"
						bind:this={tagsContainerElement}
						on:wheel={(e) => {
							if (e.deltaY !== 0) {
								e.preventDefault();
								e.currentTarget.scrollLeft += e.deltaY;
							}
						}}
					>
						<div
							class="flex w-fit gap-0.5 text-center text-sm rounded-full bg-transparent whitespace-nowrap"
						>
							<AdminViewSelector bind:value={viewOption} align="end" />

							{#if viewOption !== 'provider' && (tags ?? []).length > 0}
								<TagSelector
									bind:value={selectedTag}
									align="end"
									items={tags.map((tag) => {
										return { value: tag, label: tag };
									})}
								/>
							{/if}
						</div>

						{#if viewOption !== 'provider'}
						<Dropdown closeOnSelect align="end">
							<Tooltip content={$i18n.t('Actions')}>
								<button
									class="flex h-8 items-center gap-1.5 rounded-xl bg-transparent px-1.5 text-[0.8125rem] font-normal text-gray-700 transition hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100"
									type="button"
								>
									<span>{$i18n.t('Actions')}</span>
									<ChevronDown className="size-3" strokeWidth="2.5" />
								</button>
							</Tooltip>

							<div slot="content">
								<DropdownMenu className="min-w-[10.625rem] shadow-sm">
									{#if $user?.role === 'admin'}
										<button
											class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] disabled:pointer-events-none disabled:opacity-40 hover:text-gray-900 dark:hover:text-gray-100"
											type="button"
											disabled={modelsImportInProgress}
											on:click={() => {
												modelsImportInputElement?.click();
											}}
										>
											<DocumentArrowUp className="size-3.5" />
											<div class="flex items-center">
												{$i18n.t('settings.admin.models.importModels.label')}
											</div>
										</button>

										<button
											class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
											type="button"
											on:click={() => {
												downloadModels(
													(models ?? []).filter(
														(model) => !selectedTag || modelTags(model).includes(selectedTag)
													)
												);
											}}
										>
											<Download className="size-3.5" />
											<div class="flex items-center">
												{$i18n.t('settings.admin.models.exportModels.label')}
											</div>
										</button>
									{/if}

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showManageModal = true;
										}}
									>
										<Wrench className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.manageModels.label')}
										</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showResetModal = true;
										}}
									>
										<GarbageBin className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.resetModels.label')}
										</div>
									</button>

									<hr class="mx-1 my-0.5 border-gray-100 dark:border-gray-800" />

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											enableAllHandler();
										}}
									>
										<CheckCircle className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.enableAllModels.label')}
										</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											disableAllHandler();
										}}
									>
										<Minus className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.disableAllModels.label')}
										</div>
									</button>

									<hr class="mx-1 my-0.5 border-gray-100 dark:border-gray-800" />

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											showAllHandler();
										}}
									>
										<Eye className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.showAllModels.label')}
										</div>
									</button>

									<button
										class="flex h-[1.6875rem] w-full cursor-pointer select-none items-center gap-2 rounded-xl bg-transparent px-2 text-[0.8125rem] hover:text-gray-900 dark:hover:text-gray-100"
										type="button"
										on:click={() => {
											hideAllHandler();
										}}
									>
										<EyeSlash className="size-3.5" />
										<div class="flex items-center">
											{$i18n.t('settings.admin.models.hideAllModels.label')}
										</div>
									</button>
								</DropdownMenu>
							</div>
						</Dropdown>
						{/if}
					</div>
				</div>

				{#if viewOption === 'provider'}
					<div class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 text-sm" data-testid="provider-purpose-view">
						{#if providerError}<p role="alert" class="break-words text-red-600">{providerError} <button type="button" class="underline" on:click={loadProviderConnections}>{$i18n.t('Try again')}</button></p>{/if}
						<p class="text-xs text-gray-600 dark:text-gray-300">{$i18n.t('Sharing applies to the entire connection, including all its models.')}</p>
						{#each providerGroups as group}
							<section aria-label={$i18n.t(providerPurposeLabels[group.purpose])} class="space-y-2">
								<h3 class="border-b pb-1 font-medium dark:border-gray-700">{$i18n.t(providerPurposeLabels[group.purpose])}</h3>
								{#each group.connections as { connection, models }}
									<div class="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
										<div class="flex flex-wrap items-center gap-2">
											<strong>{connection.name}</strong><span class="text-xs text-gray-500">{models.length} {$i18n.t('models')} · {connection.is_enabled === false ? $i18n.t('Disabled') : $i18n.t('Enabled')} · {$i18n.t(connectionAccess(connection) === 'public' ? 'Public' : connectionAccess(connection) === 'shared' ? 'Shared' : 'Private')}</span>
											{#if canManageProvider(connection) && $user?.role === 'admin' && (connection as any).auth_type !== 'oauth'}<button type="button" class="ml-auto rounded-lg border px-2 py-1 text-xs dark:border-gray-600" on:click={() => beginProviderAccess(connection)}>{$i18n.t('Sharing')}</button>{/if}
										</div>
										{#if editingProviderAccess === connection.id}
											<div class="mt-2 space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800">
												<label class="block">{$i18n.t('Visibility')} <select bind:value={providerVisibility} class="ml-2 rounded border bg-transparent p-1"><option value="private">{$i18n.t('Private')}</option><option value="shared">{$i18n.t('Shared')}</option></select></label>
												{#if providerVisibility === 'shared'}<AccessControl bind:accessGrants={providerGrants} accessRoles={['read']} />{/if}
												<button type="button" disabled={providerBusy !== ''} class="rounded border px-2 py-1" on:click={() => saveProviderAccess(connection)}>{$i18n.t('Save')}</button>
												<button type="button" class="ml-2 underline" on:click={() => (editingProviderAccess = '')}>{$i18n.t('Cancel')}</button>
											</div>
										{/if}
										{#each models as model (model.upstream_id)}
											<div class="mt-2 border-t pt-2 dark:border-gray-700">
												<div class="flex flex-wrap items-center gap-2"><span class="min-w-0 break-all">{model.name ?? model.display_name ?? model.upstream_id}</span><span class="text-xs text-gray-500">{model.enabled === false ? $i18n.t('Disabled') : $i18n.t('Enabled')}</span>
													{#if canManageProvider(connection)}
														<button type="button" class="ml-auto underline" on:click={() => beginProviderEdit(connection, model)}>{$i18n.t('Edit')}</button>
														<button type="button" class="underline" disabled={providerBusy !== ''} on:click={() => saveProviderModel(connection, model, { enabled: model.enabled === false })}>{$i18n.t(model.enabled === false ? 'Enable' : 'Disable')}</button>
													{/if}
												</div>
												{#if editingProviderModel === `${connection.id}:${model.upstream_id}`}
													<div class="mt-2 space-y-2"><label class="block">{$i18n.t('Display name')} <input class="w-full rounded border bg-transparent p-2" bind:value={providerDisplayName} /></label>
														<div class="flex flex-wrap gap-2">
															{#each SERVICE_PURPOSES.filter((purpose) => supportedServicePurposes(providerTemplateFor(connection)).includes(purpose)) as purpose}
																{@const adapters = serviceAdapters(providerTemplateFor(connection), purpose)}
																{#if adapters.length}<label class="text-xs">{$i18n.t(providerPurposeLabels[purpose])} <select class="rounded border bg-transparent p-1" value={providerUses[purpose] ?? ''} on:change={(event) => { const value = event.currentTarget.value; providerUses = { ...providerUses }; if (value) providerUses[purpose] = value; else delete providerUses[purpose]; }}><option value="">{$i18n.t('Disabled')}</option>{#each adapters as adapter}<option value={adapter}>{adapter}</option>{/each}</select></label>{/if}
															{/each}
														</div>
														<button type="button" class="rounded border px-2 py-1" disabled={providerBusy !== ''} on:click={() => saveProviderModel(connection, model, { display_name: providerDisplayName.trim() || model.upstream_id, uses: providerUses })}>{$i18n.t('Save')}</button>
														<button type="button" class="ml-2 underline" on:click={() => (editingProviderModel = '')}>{$i18n.t('Cancel')}</button>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/each}
							</section>
						{/each}
					</div>
				{:else}
				<div
					class="my-0.5 min-h-0 flex-1 space-y-px {filteredModels.length > 0
						? 'overflow-y-auto scrollbar-hover pr-1.5'
						: 'overflow-hidden'}"
					id="model-list"
					bind:this={modelListElement}
				>
					{#if filteredModels.length > 0}
						{#each filteredModels as model, modelIdx (`${model.id}-${modelIdx}`)}
							<div
								class="flex cursor-pointer transition w-full px-2 py-1 rounded-xl hover:bg-gray-50/70 dark:hover:bg-gray-850/50 {model
									?.meta?.hidden
									? 'opacity-50 dark:opacity-50'
									: ''}"
								id="model-item-{model.id}"
							>
								<div class="self-center pr-1 -ml-1 text-gray-400 dark:text-gray-600">
									<Tooltip content={$i18n.t('Drag to reorder')}>
										<EllipsisVertical className="size-4 cursor-move model-item-handle" />
									</Tooltip>
								</div>

								<button
									class="flex group/item gap-2.5 w-full min-w-0 flex-1 text-left cursor-pointer"
									type="button"
									on:click={() => {
										openModelHandler(model);
									}}
								>
									<div class="self-center">
										<div class="flex rounded-xl">
											<div
												class="{(model?.is_active ?? true)
													? ''
													: 'opacity-50 dark:opacity-50'} bg-transparent rounded-xl"
											>
												<img
													src={`${WEBUI_API_BASE_URL}/models/model/profile/image?id=${model.id}&lang=${$i18n.language}`}
													alt={$i18n.t('modelfile profile')}
													class=" rounded-xl size-7 object-cover"
													loading="lazy"
													decoding="async"
													on:error={(e) => {
														// LICENSE covers this Open WebUI fallback logo.
														// Do not alter, remove, obscure, or replace it except as LICENSE permits:
														// https://docs.openwebui.com/license.
														e.target.src = '/favicon.png';
													}}
												/>
											</div>
										</div>
									</div>

									<div
										class="flex min-w-0 flex-1 pr-1 self-center {(model?.is_active ?? true)
											? ''
											: 'text-gray-500'}"
									>
										<Tooltip
											content={marked.parse(
												!!model?.meta?.description
													? model?.meta?.description
													: model?.ollama?.digest
														? `${model?.ollama?.digest} **(${model?.ollama?.modified_at})**`
														: model.id
											)}
											className="min-w-0 flex-1"
											placement="top-start"
										>
											<div
												class="flex min-w-0 items-center gap-1.5 text-[0.8125rem] font-normal leading-4"
											>
												<span class="min-w-0 truncate">{model.name}</span>

												<span
													class="shrink-0 text-[0.6875rem] font-normal leading-4 {modelAccessClass(
														model
													)}"
												>
													{modelAccessLabel(model)}
												</span>

												{#if defaultModelIdSet.has(model.id)}
													<span
														class="shrink-0 text-[0.6875rem] font-normal leading-4 text-gray-500 dark:text-gray-400"
													>
														{$i18n.t('Selected')}
													</span>
												{/if}

												{#if defaultPinnedModelIdSet.has(model.id)}
													<span
														class="shrink-0 text-[0.6875rem] font-normal leading-4 text-gray-500 dark:text-gray-400"
													>
														{$i18n.t('Pinned')}
													</span>
												{/if}
											</div>
										</Tooltip>
									</div>
								</button>
								<div class="flex shrink-0 flex-row gap-0.5 items-center self-center">
									{#if shiftKey}
										<Tooltip content={model?.meta?.hidden ? $i18n.t('Show') : $i18n.t('Hide')}>
											<button
												class="self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
												type="button"
												on:click={() => {
													hideModelHandler(model);
												}}
											>
												{#if model?.meta?.hidden}
													<EyeSlash />
												{:else}
													<Eye />
												{/if}
											</button>
										</Tooltip>

										<Tooltip
											content={defaultModelIdSet.has(model.id)
												? $i18n.t('Remove Selected Model')
												: $i18n.t('Set as Selected Model')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 {defaultModelIdSet.has(
													model.id
												)
													? 'text-gray-900 dark:text-white'
													: 'text-gray-500 dark:text-gray-400 dark:hover:text-white'}"
												type="button"
												aria-label={defaultModelIdSet.has(model.id)
													? $i18n.t('Remove Selected Model')
													: $i18n.t('Set as Selected Model')}
												on:click={() => {
													toggleDefaultModelHandler(model);
												}}
											>
												<Check className="size-3.5" />
											</button>
										</Tooltip>

										<Tooltip
											content={defaultPinnedModelIdSet.has(model.id)
												? $i18n.t('Remove Pinned Model')
												: $i18n.t('Set as Pinned Model')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 {defaultPinnedModelIdSet.has(
													model.id
												)
													? 'text-gray-900 dark:text-white'
													: 'text-gray-500 dark:text-gray-400 dark:hover:text-white'}"
												type="button"
												aria-label={defaultPinnedModelIdSet.has(model.id)
													? $i18n.t('Remove Pinned Model')
													: $i18n.t('Set as Pinned Model')}
												on:click={() => {
													toggleDefaultPinnedModelHandler(model);
												}}
											>
												{#if defaultPinnedModelIdSet.has(model.id)}
													<PinSlash className="size-3.5" />
												{:else}
													<Pin className="size-3.5" />
												{/if}
											</button>
										</Tooltip>

										<Tooltip
											content={isPublicModel(model)
												? $i18n.t('Make Private')
												: $i18n.t('Make Public')}
										>
											<button
												class="self-center w-fit text-sm p-1.5 rounded-xl text-gray-500 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white"
												type="button"
												aria-label={isPublicModel(model)
													? $i18n.t('Make Private')
													: $i18n.t('Make Public')}
												on:click={() => {
													toggleModelPrivacyHandler(model);
												}}
											>
												{#if isPublicModel(model)}
													<LockClosed className="size-3.5" />
												{:else}
													<GlobeAlt className="size-3.5" />
												{/if}
											</button>
										</Tooltip>
									{/if}

									<button
										class="hidden sm:flex self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
										type="button"
										aria-label={$i18n.t('Edit')}
										on:click={() => {
											openModelHandler(model);
										}}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											stroke-width="1.5"
											stroke="currentColor"
											class="size-3.5"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
											/>
										</svg>
									</button>

									<ModelMenu
										user={$user}
										{model}
										deleteLabel={canResetModel(model) ? $i18n.t('Reset') : $i18n.t('Delete')}
										deleteHandler={() => {
											modelToDelete = model;
											showDeleteModal = true;
										}}
										exportHandler={() => {
											exportModelHandler(model);
										}}
										hideHandler={() => {
											hideModelHandler(model);
										}}
										privacyHandler={() => {
											toggleModelPrivacyHandler(model);
										}}
										isDefaultSelected={defaultModelIdSet.has(model.id)}
										isDefaultPinned={defaultPinnedModelIdSet.has(model.id)}
										defaultSelectedHandler={() => {
											toggleDefaultModelHandler(model);
										}}
										defaultPinnedHandler={() => {
											toggleDefaultPinnedModelHandler(model);
										}}
										pinModelHandler={() => {
											pinModelHandler(model.id);
										}}
										copyLinkHandler={() => {
											copyLinkHandler(model);
										}}
										cloneHandler={() => {
											cloneHandler(model);
										}}
										onClose={() => {}}
									>
										<button
											class="self-center w-fit text-sm p-1.5 dark:text-gray-300 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
											type="button"
										>
											<EllipsisHorizontal className="size-3.5" />
										</button>
									</ModelMenu>

									<div class="ml-1">
										<Tooltip
											content={(model?.is_active ?? true)
												? $i18n.t('Enabled')
												: $i18n.t('Disabled')}
										>
											<Switch
												disabled={togglingModels.has(model.id)}
												bind:state={model.is_active}
												on:change={async () => {
													toggleModelHandler(model);
												}}
											/>
										</Tooltip>
									</div>
								</div>
							</div>
						{/each}
					{:else}
						<div class="flex h-full w-full items-center justify-center py-10">
							<div class="max-w-md text-center">
								<div class="mb-2 text-xl">😕</div>
								<div class="mb-1 text-sm text-gray-700 dark:text-gray-300">
									{$i18n.t('No models found')}
								</div>
								<div class=" text-gray-500 text-center text-xs">
									{$i18n.t('Try adjusting your search or filter to find what you are looking for.')}
								</div>
							</div>
						</div>
					{/if}
				</div>

				<div class="flex justify-end pt-6 text-sm font-normal">
					<button
						class="flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-2.5 text-xs font-normal text-white transition hover:bg-black disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white disabled:cursor-not-allowed"
						type="button"
						disabled={(!modelOrderDirty && !modelDefaultsDirty) ||
							savingModelOrder ||
							savingModelsSettings}
						on:click={async () => {
							await saveModelsSettings();
						}}
					>
						{$i18n.t('Save')}
						{#if savingModelOrder || savingModelsSettings}
							<span class="shrink-0">
								<Spinner className="size-3" />
							</span>
						{/if}
					</button>
				</div>
				{/if}
			</div>
		</div>
	{:else}
		<ModelEditor
			admin
			edit
			model={models.find((m) => m.id === selectedModelId)}
			preset={false}
			onSubmit={async (model) => {
				console.log(model);
				if (!(await upsertModelHandler(model))) {
					toast.error($i18n.t('Failed to save model'));
					return false;
				}
				selectedModelId = null;
				await init().catch((error) => toast.error(`${error}`));
				return true;
			}}
			onBack={async () => {
				selectedModelId = null;
				await init();
			}}
		/>
	{/if}
{:else}
	<div class=" h-full w-full flex justify-center items-center">
		<Spinner className="size-5" />
	</div>
{/if}
