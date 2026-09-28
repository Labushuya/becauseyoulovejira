// Attention messages of the server (ADR-0035 sections 3 to 5): start.bat, the landing page and
// stop.bat send { nonce, reason } on the realtime topic byl/attention; the open tab confirms a
// message with an ack, so start.bat knows that a tab is awake and opens no second one. Same SSE
// connection as the other subscriptions (ADR-0007); subscribed without options, because the
// server counts the tabs by the plain topic.

import type PocketBase from 'pocketbase';
import type { Unsubscribe } from './realtime';

export const ATTENTION_TOPIC = 'byl/attention';

export const ATTENTION_REASONS = ['start', 'datei', 'stop'] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface AttentionMessage {
	nonce: string;
	reason: AttentionReason;
}

/** The nonce the server creates ($security.randomString(24)). */
const NONCE = /^[A-Za-z0-9]{24}$/;

/** The message of an event, or null for anything else (the event is dropped). */
export function parseAttention(data: unknown): AttentionMessage | null {
	if (data === null || typeof data !== 'object') return null;
	const { nonce, reason } = data as { nonce?: unknown; reason?: unknown };
	if (typeof nonce !== 'string' || !NONCE.test(nonce)) return null;
	if (!ATTENTION_REASONS.includes(reason as AttentionReason)) return null;
	return { nonce, reason: reason as AttentionReason };
}

export async function subscribeAttention(
	pb: PocketBase,
	onMessage: (message: AttentionMessage) => void
): Promise<Unsubscribe> {
	return pb.realtime.subscribe(ATTENTION_TOPIC, (data: unknown) => {
		const message = parseAttention(data);
		if (message !== null) onMessage(message);
	});
}

/** Confirms a message: this tab is awake and shows the hint (signed-in app users only). */
export async function ackAttention(pb: PocketBase, nonce: string): Promise<void> {
	if (!NONCE.test(nonce)) throw new Error('Invalid nonce');
	await pb.send(`/api/byl/attention/${nonce}/ack`, { method: 'POST' });
}
