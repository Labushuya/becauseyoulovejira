// Rules of the automatic mode (ADR-0038 §3). Only messages that appear after the switch was
// switched on, or after the last message seen in that chat, go to the app, never the history
// shown when a chat opens. WhatsApp gives the time to the minute; a message of the same minute
// counts as new, and the app finds a repeated one as duplicate. Pure.

import { chatKey, type AutoSettings } from './settings';

const MINUTE = 60_000;

/** Whether the automatic mode may send messages of `chat`: switched on, and the chat listed if there is a list. */
export function autoAllowed(settings: AutoSettings, chat: string): boolean {
	if (!settings.auto || settings.autoSince <= 0) return false;
	if (settings.chats.length === 0) return true;
	const key = chatKey(chat);
	return key !== '' && settings.chats.some((name) => chatKey(name) === key);
}

/** Earliest time (ms, start of its minute) of a message the automatic mode sends in a chat. */
export function autoThreshold(autoSince: number, lastSeen: number | undefined): number {
	const since = Math.max(autoSince, lastSeen ?? 0);
	return Math.floor(since / MINUTE) * MINUTE;
}

/** Whether a message with `time` is new for the automatic mode; without a time it never is. */
export function isNewMessage(time: number | null, threshold: number): boolean {
	return time !== null && time >= threshold;
}
