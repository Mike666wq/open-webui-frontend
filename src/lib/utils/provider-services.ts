/**
 * Per-service provider configuration.
 *
 * The backend owns the service matrix. A template declares which services it
 * serves, how their models are discovered, which limits apply and which
 * options they accept. These helpers read that declaration and build the
 * payload the backend accepts.
 *
 * The interface never keeps a second list of what a provider can do: an
 * OpenAI-compatible chat endpoint says nothing about whether the vendor has a
 * transcription API, and an account sign-in never covers the media services.
 */

/** The four purposes a connection can serve. */
export const SERVICE_PURPOSES = ['chat', 'transcription', 'speech', 'image'] as const;

export type ServicePurpose = (typeof SERVICE_PURPOSES)[number];

/** The purposes that are configured one by one, apart from the chat service. */
export const MEDIA_PURPOSES = ['transcription', 'speech', 'image'] as const;

export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export type EndpointKind = 'base_url' | 'endpoint_url';

export type DiscoveryMode = 'remote' | 'preset' | 'manual' | 'none';

export type ModelRequirement = 'required' | 'defaulted' | 'none';

export interface ProviderPresetModel {
	upstream_id: string;
	display_name?: string;
	uses?: Record<string, string>;
}

export interface ProviderServiceDeclaration {
	supported?: boolean;
	unsupported_reason?: string | null;
	adapters?: string[];
	auth_types?: string[];
	discovery?: DiscoveryMode;
	model_requirement?: ModelRequirement;
	endpoint?: { kind?: string; url?: string };
	preset_models?: ProviderPresetModel[];
	limits?: Record<string, number | string[]>;
	options?: Record<string, (string | number)[]>;
	/** The operations of the adapter, when the service has more than one. */
	operations?: string[];
	notes?: string | null;
}

export interface ProviderServiceEndpoint {
	kind: EndpointKind;
	url: string;
}

export interface ProviderServiceConfig {
	enabled?: boolean;
	adapter?: string;
	endpoint?: ProviderServiceEndpoint;
	options?: Record<string, string | number>;
}

export interface ProviderServiceStatus {
	configuration?: 'valid' | 'invalid' | 'missing' | 'unsupported';
	catalog?: 'ok' | 'failed' | 'not_applicable' | 'unknown';
	probe?: 'ok' | 'failed' | 'not_available';
}

/** The shape of a template as far as the services are concerned. */
export interface ProviderServiceTemplate {
	id?: string;
	services?: Record<string, ProviderServiceDeclaration> | null;
}

/**
 * The declaration of one service of a template.
 *
 * A template that predates the service contract has no declaration at all.
 * The fallback keeps the old behaviour: only the chat service is known.
 */
export function serviceDeclaration(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): ProviderServiceDeclaration {
	const declaration = template?.services?.[purpose];
	if (declaration && typeof declaration === 'object') return declaration;
	return {
		supported: purpose === 'chat',
		unsupported_reason: purpose === 'chat' ? null : '该提供商未声明此服务。',
		adapters: [],
		auth_types: [],
		discovery: purpose === 'chat' ? 'remote' : 'none',
		model_requirement: 'required',
		endpoint: { kind: 'base_url', url: '' },
		preset_models: [],
		limits: {},
		options: {}
	};
}

/** Whether a template serves a purpose at all. */
export function supportsServicePurpose(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): boolean {
	return serviceDeclaration(template, purpose).supported === true;
}

/** The purposes a template serves, in the order the interface shows them. */
export function supportedServicePurposes(
	template: ProviderServiceTemplate | null | undefined
): ServicePurpose[] {
	return SERVICE_PURPOSES.filter((purpose) => supportsServicePurpose(template, purpose));
}

/**
 * How the models of a service are obtained.
 *
 * `preset` and `manual` never trigger a catalog call, so a service without a
 * remote model list is added without one.
 */
export function serviceDiscovery(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): DiscoveryMode {
	return serviceDeclaration(template, purpose).discovery ?? 'none';
}

/** Whether the service takes a model parameter at all. */
export function serviceNeedsModel(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): boolean {
	const requirement = serviceDeclaration(template, purpose).model_requirement ?? 'required';
	return requirement !== 'none';
}

/**
 * The model parameter is still sent when it has a vendor default.
 *
 * A defaulted parameter is not an absent parameter: the request carries it.
 */
export function serviceSendsDefaultedModel(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): boolean {
	return serviceDeclaration(template, purpose).model_requirement === 'defaulted';
}

/** The official presets of a service. */
export function servicePresetModels(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): ProviderPresetModel[] {
	return serviceDeclaration(template, purpose).preset_models ?? [];
}

/** The endpoint a service starts from. */
export function defaultServiceEndpoint(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): ProviderServiceEndpoint {
	const endpoint = serviceDeclaration(template, purpose).endpoint ?? {};
	const kind = endpoint.kind === 'endpoint_url' ? 'endpoint_url' : 'base_url';
	return { kind, url: endpoint.url ?? '' };
}

/** The adapters a service accepts. */
export function serviceAdapters(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): string[] {
	return serviceDeclaration(template, purpose).adapters ?? [];
}

/**
 * The operations a service supports.
 *
 * A service with a single operation does not declare any: the purpose already
 * names it. The image service declares what its adapter can do, so a
 * generate-only provider is never offered as an editing one.
 */
export function serviceOperations(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose
): string[] {
	return serviceDeclaration(template, purpose).operations ?? [];
}

/**
 * Whether a service can serve one operation.
 *
 * An operation the service does not declare is refused. A service that
 * declares no operation at all has exactly one, the purpose itself.
 */
export function serviceSupportsOperation(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose,
	operation: string
): boolean {
	const operations = serviceOperations(template, purpose);
	if (operations.length === 0) return operation === purpose;
	return operations.includes(operation);
}

/**
 * Build the configuration block of one service.
 *
 * Only the fields the adapter declares are sent; the backend refuses the rest
 * before the request leaves the server.
 */
export function buildServiceConfig(
	template: ProviderServiceTemplate | null | undefined,
	purpose: ServicePurpose,
	options: {
		enabled?: boolean;
		adapter?: string;
		/** `null` omits the address entirely, for the chat service. */
		endpoint?: ProviderServiceEndpoint | null;
		serviceOptions?: Record<string, string | number>;
	} = {}
): ProviderServiceConfig {
	const config: ProviderServiceConfig = {};
	if (options.enabled !== undefined) config.enabled = options.enabled;
	const adapters = serviceAdapters(template, purpose);
	const adapter = options.adapter ?? adapters[0];
	if (adapter) config.adapter = adapter;
	const endpoint =
		options.endpoint === null ? null : (options.endpoint ?? defaultServiceEndpoint(template, purpose));
	if (endpoint?.url) config.endpoint = { kind: endpoint.kind, url: endpoint.url };
	const allowed = serviceDeclaration(template, purpose).options ?? {};
	const serviceOptions: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(options.serviceOptions ?? {})) {
		if (key in allowed) serviceOptions[key] = value;
	}
	if (Object.keys(serviceOptions).length > 0) config.options = serviceOptions;
	return config;
}

/**
 * Build the `services` object of a connection configuration.
 *
 * A purpose the user did not enable is not part of the object, so the server
 * keeps the legacy behaviour for every connection that has no service block
 * at all.
 */
export function buildServicesPayload(
	template: ProviderServiceTemplate | null | undefined,
	configs: Partial<Record<ServicePurpose, ProviderServiceConfig>>
): Record<string, ProviderServiceConfig> {
	const payload: Record<string, ProviderServiceConfig> = {};
	for (const purpose of SERVICE_PURPOSES) {
		const config = configs[purpose];
		if (!config) continue;
		payload[purpose] = config;
	}
	return payload;
}

/** One model the user picked, with the purpose it serves. */
export interface ProviderModelSelection {
	upstream_id: string;
	display_name?: string;
	uses: Record<string, string>;
	source: 'preset' | 'manual' | 'provider';
}

/**
 * Build the model selections of a connection.
 *
 * A selection is a traceable declaration: it says which purpose a model
 * serves and where its id came from. It never claims the model works.
 */
export function buildModelSelections(
	entries: {
		upstream_id: string;
		display_name?: string;
		purpose: ServicePurpose;
		adapter: string;
		source?: 'preset' | 'manual' | 'provider';
	}[]
): ProviderModelSelection[] {
	return entries
		.filter((entry) => Boolean(entry?.upstream_id) && Boolean(entry?.adapter))
		.map((entry) => ({
			upstream_id: entry.upstream_id,
			...(entry.display_name ? { display_name: entry.display_name } : {}),
			uses: { [entry.purpose]: entry.adapter },
			source: entry.source ?? 'manual'
		}));
}

/** The status layers of one service, as the backend reports them. */
export function serviceStatus(
	connection: any,
	purpose: ServicePurpose
): ProviderServiceStatus {
	const status = connection?.service_statuses?.[purpose];
	return status && typeof status === 'object' ? (status as ProviderServiceStatus) : {};
}

/** The final URL of a service, without any credential in it. */
export function serviceEndpointPreview(connection: any, purpose: ServicePurpose): string {
	return connection?.resolved_services?.[purpose]?.endpoint ?? '';
}

/** The translation key of a service status. */
export function serviceStatusLabelKey(status: ProviderServiceStatus): string {
	if (status.configuration === 'unsupported') return 'Not supported';
	if (status.configuration === 'invalid') return 'The address needs to be fixed';
	if (status.configuration === 'missing') return 'Not configured yet';
	if (status.catalog === 'failed') return 'The model list failed';
	if (status.catalog === 'ok') return 'Models fetched';
	if (status.catalog === 'not_applicable') return 'Uses the official presets';
	return 'Configured, not tested yet';
}

/** The translation key of the discovery mode. */
export function discoveryLabelKey(discovery: DiscoveryMode): string {
	if (discovery === 'remote') return 'Fetch the model list';
	if (discovery === 'preset') return 'Use the official presets';
	if (discovery === 'manual') return 'Add the model by hand';
	return 'This service takes no model';
}

/** The translation key of the endpoint mode. */
export function endpointKindLabelKey(kind: EndpointKind): string {
	return kind === 'endpoint_url'
		? 'Complete request address'
		: 'API root address';
}
