import type { MessageChannel, MessageMember } from './types';

const absoluteUrl = (value: string | null | undefined) => {
	if (!value) return null;
	const base = typeof window === 'undefined' ? 'https://server.invalid' : window.location.href;
	try {
		return new URL(value, base).href;
	} catch {
		return null;
	}
};

export const stripMarkdown = (value: unknown) => {
	if (typeof value !== 'string') return '';
	return value
		.replace(/```[\s\S]*?```/g, '[代码]')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1 [图片]')
		.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
		.replace(/[*_~#>]+/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
};

export const truncateText = (value: string, maxLength = 60) => {
	const chars = [...value];
	return chars.length > maxLength ? `${chars.slice(0, maxLength).join('')}...` : value;
};

export const channelTitle = (channel: MessageChannel, currentUserId?: string | null) => {
	if (channel.type !== 'dm') return channel.name || 'Channel';
	const members = (channel.users ?? []).filter((member) => member.id !== currentUserId);
	return members[0]?.name || 'Private chat';
};

export const channelSubtitle = (channel: MessageChannel, currentUserId?: string | null) => {
	if (channel.type !== 'dm') {
		const memberCount = channel.user_count;
		return memberCount ? `${memberCount} members` : 'Channel';
	}
	const members = (channel.users ?? []).filter((member) => member.id !== currentUserId);
	return members[0]?.status_message ?? 'Private chat';
};

export const channelImage = (channel: MessageChannel, currentUserId?: string | null) => {
	if (channel.type !== 'dm') return null;
	const members = (channel.users ?? []).filter((member) => member.id !== currentUserId);
	return absoluteUrl(members[0]?.profile_image_url);
};

export const memberImage = (member: MessageMember) => absoluteUrl(member.profile_image_url);

export const isCurrentMemberActive = (member: MessageMember) => member.is_active === true;

export const channelSortKey = (channel: MessageChannel) => {
	const value = channel.last_message_at;
	let parsed = 0;
	if (typeof value === 'number') {
		parsed = value;
	} else if (typeof value === 'string' && value.trim()) {
		parsed = Number(value);
	}
	const time = Number.isFinite(parsed) ? parsed : 0;
	return time >= 1e18 ? time / 1e6 : time;
};

export const channelDate = (channel: MessageChannel) => {
	const time = channelSortKey(channel);
	return time > 0 && Number.isFinite(time) ? new Date(time) : null;
};

export const messagePreview = (message: unknown, maxLength = 60) => {
	if (!message || typeof message !== 'object') return '';
	const value = message as Record<string, unknown>;
	const content = stripMarkdown(value.content);
	if (content) return truncateText(content, maxLength);
	const data = value.data;
	const filesValue =
		data && typeof data === 'object' ? (data as Record<string, unknown>).files : undefined;
	const files = Array.isArray(filesValue) ? filesValue : [];
	if (files.length) return '[Attachment]';
	if (value.reply_to_id) return '[Reply]';
	return '';
};

export const sortChannels = (channels: MessageChannel[]) =>
	[...channels].sort((a, b) => {
		const unreadDelta = (b.unread_count ?? 0) - (a.unread_count ?? 0);
		if (unreadDelta !== 0) return unreadDelta;
		return channelSortKey(b) - channelSortKey(a);
	});
