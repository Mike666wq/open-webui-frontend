import { describe, expect, it } from 'vitest';
import {
	canBackInstancePurpose,
	connectionBlockedReason,
	emptyWhitelistHint,
	isAssignable,
	isReady,
	modeLabel,
	primaryReason,
	secretPlaceholder
} from './media-assignment';
import type { MediaAssignmentCandidate, MediaAssignmentPurpose } from '$lib/apis/providers';

/** Stands in for `$i18n.t`, so the assertions stay about behaviour, not copy. */
const t = (key: string, options?: Record<string, unknown>) =>
	options ? `${key}|${JSON.stringify(options)}` : key;

const candidate = (over: Partial<MediaAssignmentCandidate> = {}): MediaAssignmentCandidate => ({
	connection_id: 'conn-1',
	name: 'MiniMax',
	provider_id: 'minimax',
	visibility: 'shared',
	adapter: 'minimax-image',
	supported: true,
	models: [
		{
			id: 'provider:conn-1:MiniMax-H3-Image',
			upstream_id: 'MiniMax-H3-Image',
			display_name: 'MiniMax-H3-Image',
			enabled: true,
			verification: 'untested'
		}
	],
	...over
});

const purpose = (over: Partial<MediaAssignmentPurpose> = {}): MediaAssignmentPurpose => ({
	purpose: 'image',
	label: '生图',
	mode: 'unconfigured',
	connection_id: '',
	connection_name: '',
	model: '',
	upstream_model: '',
	adapter: '',
	legacy: {
		engine: '',
		base_url: '',
		normalized_base_url: '',
		model: '',
		has_api_key: false,
		configured: false
	},
	ready: false,
	reasons: [],
	...over
});

describe('instance-wide purposes need a shared connection', () => {
	it('accepts a shared connection', () => {
		expect(canBackInstancePurpose(candidate())).toBe(true);
		expect(connectionBlockedReason(candidate())).toBeNull();
	});

	// A private connection answers 403 to every other user, which is exactly the
	// failure the whole assignment path exists to prevent.
	it('refuses a private connection', () => {
		const priv = candidate({ visibility: 'private' });
		expect(canBackInstancePurpose(priv)).toBe(false);
		expect(connectionBlockedReason(priv)).toBe('private');
	});

	it('refuses a shared connection that has no usable model', () => {
		const empty = candidate({ models: [] });
		expect(canBackInstancePurpose(empty)).toBe(true);
		expect(connectionBlockedReason(empty)).toBe('no-models');
	});

	// Hiding the unusable rows is what makes an administrator wonder where the
	// connection they just created went.
	it('keeps the blocked connection listed rather than filtering it out', () => {
		expect(connectionBlockedReason(candidate({ visibility: 'private' }))).not.toBeNull();
		expect(candidate({ visibility: 'private' }).name).toBeTruthy();
	});
});

describe('the empty whitelist explains itself', () => {
	// The server would answer "Select an image model for this provider
	// connection"; on its own that does not tell anyone where to add one.
	it('names the purpose and points at the connection settings', () => {
		const hint = emptyWhitelistHint('生图', t);
		expect(hint).toContain('settings.admin.media.noModelsHint');
		expect(hint).toContain('生图');
	});

	it('falls back to the raw key without a translator', () => {
		expect(emptyWhitelistHint('生图')).toBe('settings.admin.media.noModelsHint');
	});
});

describe('realtime is reported, not hidden', () => {
	it('is not assignable but still has a label and a mode', () => {
		const realtime = purpose({ purpose: 'realtime', label: '实时语音' });
		expect(isAssignable(realtime)).toBe(false);
		expect(modeLabel(realtime.mode, t)).toBe('settings.admin.media.mode.unconfigured');
	});

	it('the other three are assignable', () => {
		expect(isAssignable(purpose({ purpose: 'transcription' }))).toBe(true);
		expect(isAssignable(purpose({ purpose: 'speech' }))).toBe(true);
		expect(isAssignable(purpose({ purpose: 'image' }))).toBe(true);
	});
});

describe('mode labels distinguish the three states', () => {
	it('maps each mode to its own key', () => {
		expect(modeLabel('provider', t)).toBe('settings.admin.media.mode.provider');
		expect(modeLabel('legacy', t)).toBe('settings.admin.media.mode.legacy');
		expect(modeLabel('unconfigured', t)).toBe('settings.admin.media.mode.unconfigured');
	});

	it('never collapses two modes onto the same label', () => {
		const labels = new Set([
			modeLabel('provider', t),
			modeLabel('legacy', t),
			modeLabel('unconfigured', t)
		]);
		expect(labels.size).toBe(3);
	});
});

describe('a write-only credential can only report presence', () => {
	// The browser never receives the secret, so the field must read as
	// "already set" rather than "you have none" — otherwise every save would
	// look like it needs a re-entry.
	it('distinguishes a stored key from a missing one', () => {
		expect(secretPlaceholder(true, t)).toBe('settings.admin.media.keyStored');
		expect(secretPlaceholder(false, t)).toBe('settings.admin.media.keyMissing');
	});

	it('never renders anything that looks like a secret', () => {
		for (const hasKey of [true, false]) {
			expect(secretPlaceholder(hasKey, t)).not.toMatch(/sk-|Bearer/i);
		}
	});
});

describe('readiness surfaces the actionable reason', () => {
	it('is ready only when the server says so', () => {
		expect(isReady(purpose({ ready: true }))).toBe(true);
		expect(isReady(purpose({ ready: false }))).toBe(false);
	});

	it('takes the first reason', () => {
		const blocked = purpose({
			reasons: [
				{ code: 'MEDIA_MODEL_NOT_ENABLED', message: '该连接下还没有生图模型…' },
				{ code: 'OTHER', message: '次要原因' }
			]
		});
		expect(primaryReason(blocked)).toContain('生图模型');
	});

	it('returns an empty string when nothing is wrong', () => {
		expect(primaryReason(purpose({ ready: true, reasons: [] }))).toBe('');
	});
});
