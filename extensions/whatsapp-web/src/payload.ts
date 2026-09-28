// What the extension sends to the own inbox (ADR-0038 §1 and §3): the payload of
// POST /api/byl/inbox/ingest for one message. The ID of WhatsApp holds phone numbers; only its
// SHA-256 leaves the browser as external_id, so the same message stays the same entry.

import type { ChatMessage } from './extract';

export type Mode = 'manual' | 'auto';

export interface IngestPayload {
	channel: 'whatsapp-web';
	mode: Mode;
	text: string;
	external_id: string;
	sender?: string;
	chat?: string;
	sent_at?: string;
}

/** SHA-256 of a text as hex (Web Crypto, available on https pages and in the service worker). */
export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** external_id of a message: "wa:" and the hash of its ID. */
export async function externalIdOf(id: string): Promise<string> {
	return `wa:${await sha256Hex(id)}`;
}

/** The payload of a message; empty sender, chat and time are left out. */
export async function payloadOf(message: ChatMessage, mode: Mode): Promise<IngestPayload> {
	const payload: IngestPayload = {
		channel: 'whatsapp-web',
		mode,
		text: message.text,
		external_id: await externalIdOf(message.id)
	};
	if (message.sender !== '') payload.sender = message.sender.slice(0, 200);
	if (message.chat !== '') payload.chat = message.chat.slice(0, 200);
	if (message.sentAt !== null) payload.sent_at = message.sentAt;
	return payload;
}

/** Whether `value` is a payload the service worker may send (messages come from the page). */
export function isIngestPayload(value: unknown): value is IngestPayload {
	if (typeof value !== 'object' || value === null) return false;
	const payload = value as Record<string, unknown>;
	const optional = (key: string) => payload[key] === undefined || typeof payload[key] === 'string';
	return (
		payload.channel === 'whatsapp-web' &&
		(payload.mode === 'manual' || payload.mode === 'auto') &&
		typeof payload.text === 'string' &&
		payload.text.trim() !== '' &&
		typeof payload.external_id === 'string' &&
		/^wa:[0-9a-f]{64}$/.test(payload.external_id) &&
		optional('sender') &&
		optional('chat') &&
		optional('sent_at')
	);
}
