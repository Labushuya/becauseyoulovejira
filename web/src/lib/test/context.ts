// Tests: sets the context of the tab (KOB-1, ADR-0057) like an answer of the server, for components
// that show commands, scripts or pages of the administrator only where they work.

import type { AppContext } from '$lib/domain/context';
import { appContext } from '$lib/stores/context.svelte';

/** The administrator on the machine of the app under Windows: everything as before KOB-1. */
export const PC_CONTEXT: AppContext = Object.freeze({
	admin: true,
	local: true,
	platform: 'windows',
	scripts: true,
	localUrl: 'http://127.0.0.1:8090'
});

/** The administrator on another device of the home network. */
export const REMOTE_CONTEXT: AppContext = Object.freeze({
	...PC_CONTEXT,
	local: false,
	scripts: false
});

/** Another account, on this machine. */
export const MEMBER_CONTEXT: AppContext = Object.freeze({
	...PC_CONTEXT,
	admin: false,
	scripts: false,
	localUrl: null
});

let stop: (() => void) | null = null;

/**
 * Sets the context of the tab: an answer, "outdated" (the server before the restart) or "pending"
 * (nothing known). Returns once the store has it.
 */
export async function useContext(context: AppContext | 'outdated' | 'pending'): Promise<void> {
	stop?.();
	stop = null;
	if (context === 'pending') return;
	stop = appContext.start(
		async () => (context === 'outdated' ? { kind: 'outdated' } : { kind: 'ready', context }),
		{ token: 'token', record: { id: 'u0000000000000a' }, onChange: () => () => undefined }
	);
	await appContext.refresh();
}
