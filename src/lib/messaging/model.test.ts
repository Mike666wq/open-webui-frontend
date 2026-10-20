import { describe, expect, it } from 'vitest';
import {
	channelDate,
	channelImage,
	channelSortKey,
	channelSubtitle,
	channelTitle,
	messagePreview,
	sortChannels,
	stripMarkdown,
	truncateText
} from './model';

describe('messaging model', () => {
	it('extracts readable message previews and limits length', () => {
		expect(stripMarkdown('![wallpaper](/img.png) **bold** `code`')).toBe(
			'wallpaper [图片] bold code'
		);
		expect(truncateText('x'.repeat(70), 60)).toBe(`${'x'.repeat(60)}...`);
	});

	it('uses the other participant for private channels', () => {
		const channel = {
			id: 'dm-1',
			type: 'dm',
			name: '',
			users: [
				{ id: 'me', name: 'Me', profile_image_url: '/me.png' },
				{
					id: 'other',
					name: 'Ada',
					profile_image_url: '/ada.png',
					is_active: true,
					status_message: 'Working'
				}
			]
		};
		expect(channelTitle(channel, 'me')).toBe('Ada');
		expect(channelSubtitle(channel, 'me')).toBe('Working');
		expect(channelImage(channel, 'me')).toContain('/ada.png');
	});

	it('sorts unread first and handles nanosecond timestamps', () => {
		const channels = [
			{ id: 'old', unread_count: 0, last_message_at: 1_760_000_000_000 },
			{ id: 'unread', unread_count: 2, last_message_at: 1 },
			{ id: 'new', unread_count: 1, last_message_at: 1_760_000_000_000_000_000 }
		];
		expect(sortChannels(channels).map((item) => item.id)).toEqual(['unread', 'new', 'old']);
		expect(channelSortKey(channels[2])).toBe(1_760_000_000_000);
		expect(channelDate(channels[2])?.getTime()).toBe(1_760_000_000_000);
	});

	it('formats message summaries without exposing markdown or file content', () => {
		expect(messagePreview({ content: '**hello** `world`' })).toBe('hello world');
		expect(messagePreview({ content: '', data: { files: [{ id: 'file-1' }] } })).toBe(
			'[Attachment]'
		);
		expect(messagePreview({ content: '', reply_to_id: 'message-1' })).toBe('[Reply]');
	});
});
