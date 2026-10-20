export type MessageMember = {
	id: string;
	name: string;
	email?: string;
	role?: string;
	profile_image_url?: string | null;
	presence_state?: string | null;
	status_emoji?: string | null;
	status_message?: string | null;
	status_expires_at?: number | null;
	is_active?: boolean | null;
};

export type MessageChannel = {
	id: string;
	type?: string | null | undefined;
	name?: string | null;
	user_count?: number | null;
	unread_count?: number;
	last_message_at?: number | null;
	last_message?: unknown;
	is_channel_muted?: boolean;
	users?: MessageMember[];
};

export type DirectoryUser = MessageMember & {
	pending?: boolean;
};
