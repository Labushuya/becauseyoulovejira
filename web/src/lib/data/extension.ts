// Folder of the built browser extension for WhatsApp Web (ADR-0038 §4): GET
// /api/byl/whatsapp-web/extension for signed-in users. Only a hint for the assistant, so it never
// fails: before the restart after an update (no route yet), without a session or on any other
// error the answer is null and the assistant names the folder relative to the app.

import type PocketBase from 'pocketbase';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/whatsapp-web/extension';

export interface ExtensionInfo {
	/** Absolute folder on the machine of the app, e.g. C:\…\app\erweiterung-whatsapp-web. */
	folder: string;
	built: boolean;
	version: string;
}

export async function fetchExtensionInfo(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<ExtensionInfo | null> {
	try {
		const answer: unknown = await pb.send(ROUTE, {
			method: 'GET',
			requestKey: null,
			signal: options.signal
		});
		if (typeof answer !== 'object' || answer === null) return null;
		const { folder, built, version } = answer as Record<string, unknown>;
		if (typeof folder !== 'string' || typeof built !== 'boolean' || typeof version !== 'string') {
			return null;
		}
		return { folder, built, version };
	} catch {
		return null;
	}
}
