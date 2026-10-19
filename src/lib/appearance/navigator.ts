export type NavigatorEntry = {
	id: string;
	ordinal: number;
	preview: string;
	isCurrent: boolean;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function contentToText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (typeof part === 'string') return part;
			if (isRecord(part) && typeof part.text === 'string') return part.text;
			if (isRecord(part) && typeof part.content === 'string') return part.content;
			return '';
		})
		.join(' ');
}

export function summarizeQuestion(content: unknown, limit = 80): string {
	const text = contentToText(content)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[`*_>#|~-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\s+([?!.,:;])/g, '$1')
		.trim();
	const characters = Array.from(text);
	return characters.length > limit ? `${characters.slice(0, limit).join('')}…` : text;
}

export function buildNavigatorEntries(
	messages: unknown[],
	currentId?: string | null
): NavigatorEntry[] {
	const entries: NavigatorEntry[] = [];
	for (const value of messages) {
		if (!isRecord(value) || value.role !== 'user' || typeof value.id !== 'string') continue;
		const preview = summarizeQuestion(value.content);
		if (!preview) continue;
		entries.push({
			id: value.id,
			ordinal: entries.length + 1,
			preview,
			isCurrent: false
		});
	}
	const currentIndex = currentId
		? entries.findIndex((entry) => entry.id === currentId)
		: entries.length - 1;
	if (currentIndex >= 0) entries[currentIndex].isCurrent = true;
	return entries;
}

export function filterNavigatorEntries(
	entries: NavigatorEntry[],
	query: string
): NavigatorEntry[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return entries;
	return entries.filter((entry) => entry.preview.toLocaleLowerCase().includes(normalized));
}

export function nextNavigatorSelection(
	visibleEntries: NavigatorEntry[],
	selectedId: string | null,
	direction: -1 | 1
): string | null {
	if (!visibleEntries.length) return null;
	const currentIndex = visibleEntries.findIndex((entry) => entry.id === selectedId);
	if (currentIndex === -1) return visibleEntries[direction > 0 ? 0 : visibleEntries.length - 1].id;
	const nextIndex = Math.min(
		visibleEntries.length - 1,
		Math.max(0, currentIndex + direction)
	);
	return visibleEntries[nextIndex].id;
}

export function branchFingerprint(messages: unknown[]): string {
	return messages
		.map((message) => (isRecord(message) && typeof message.id === 'string' ? message.id : ''))
		.filter(Boolean)
		.join(':');
}

export function isSameNavigatorContext(
	left: {
		origin: string;
		chatId: string;
		branchId: string;
		generation: number;
	},
	right: {
		origin: string;
		chatId: string;
		branchId: string;
		generation: number;
	}
): boolean {
	return (
		left.origin === right.origin &&
		left.chatId === right.chatId &&
		left.branchId === right.branchId &&
		left.generation === right.generation
	);
}

export function messageElementId(messageId: string): string {
	return `message-${messageId}`;
}
