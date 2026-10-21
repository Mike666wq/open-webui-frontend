import { WEBUI_API_BASE_URL } from '$lib/constants';
import { get } from 'svelte/store';
import { user } from '$lib/stores';
import { v4 as uuid } from 'uuid';

const registered = new Map<string, boolean>();
const pending = new Map<string, Promise<void>>();

export function draftFileIds(draft: unknown): string[] {
	if (!draft || typeof draft !== 'object') return [];
	const files = (draft as { files?: { id?: string; file?: { id?: string } }[] }).files;
	if (!Array.isArray(files)) return [];
	return [...new Set(files.map((file) => file?.id ?? file?.file?.id).filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(id)))];
}

export async function markDraftFiles(draft: unknown, active: boolean, draftKey = 'session'): Promise<void> {
    const account = get(user)?.id;
    const token = localStorage.token;
    if (!account || !token) return;
    const client = sessionStorage.getItem('owui-resource-draft-client') ?? uuid();
    sessionStorage.setItem('owui-resource-draft-client', client);
    const draftId = `${client}:${draftKey}`;
    await Promise.all(draftFileIds(draft).map(async (id) => {
        const identity = `${location.origin}:${account}:${draftId}:${id}`;
        const previous = pending.get(identity) ?? Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            if (get(user)?.id !== account || localStorage.token !== token || registered.get(identity) === active) return;
            const response = await fetch(`${WEBUI_API_BASE_URL}/resources/uploads/${id}/temporary`, {
                method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ draft_active: active, draft_id: draftId })
            });
            // Older servers retain unregistered uploads conservatively.
            if (response.status === 404 || response.status === 405) return;
            if (!response.ok) throw new Error(`Attachment retention update failed (${response.status})`);
            registered.set(identity, active);
        });
        pending.set(identity, operation);
        try { await operation; } finally { if (pending.get(identity) === operation) pending.delete(identity); }
    }));
}

export async function updateDraftFiles(previous: unknown, next: unknown, draftKey: string): Promise<void> {
    const keep = new Set(draftFileIds(next));
    // Protect new files first; unchanged files never briefly lose protection.
    await markDraftFiles(next, true, draftKey);
    await markDraftFiles({ files: draftFileIds(previous).filter((id) => !keep.has(id)).map((id) => ({ id })) }, false, draftKey);
}
