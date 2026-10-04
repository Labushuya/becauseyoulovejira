// Context of the app in this tab (KX-1, ADR-0057): GET /api/byl/context says whether the signed-in
// account is the administrator of the app, whether this browser runs on the machine of the app and
// the system of the server. From it follows what the tab shows: the pages of the administrator with
// their data, only marked "nur am PC" or not at all; commands, .bat files and scripts or a hint
// instead; "Ansehen" of files of this machine. The server decides on every route; this only leaves
// out what it would refuse. While the context loads or is missing, the most restrictive view holds.
// Pure module: no requests, no runes.

import { HOST_PLATFORMS, type HostPlatform } from './host-platform';

/** The answer of GET /api/byl/context (app/pb_hooks/lib/context-rules.js). */
export interface AppContext {
	/** The account is an active administrator of the app. */
	admin: boolean;
	/** The browser runs on the machine of the app (address of the connection is loopback). */
	local: boolean;
	platform: HostPlatform;
	/** Administrator on this machine of a server under Windows: the scripts of the folder app. */
	scripts: boolean;
	/** Address of the app on its machine, only for the administrator, e.g. http://127.0.0.1:8090. */
	localUrl: string | null;
}

/**
 * pending: no answer yet, no session or the request failed (the server may be down); outdated: the
 * server does not know the route yet (before the restart after an update); ready: the answer.
 */
export type ContextState =
	| { readonly kind: 'pending' }
	| { readonly kind: 'outdated' }
	| { readonly kind: 'ready'; readonly context: AppContext };

export const PENDING_CONTEXT: ContextState = Object.freeze({ kind: 'pending' });
export const OUTDATED_CONTEXT: ContextState = Object.freeze({ kind: 'outdated' });

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

/** The answer of the route, or null for anything that is not exactly that. */
export function parseContext(answer: unknown): AppContext | null {
	if (typeof answer !== 'object' || answer === null) return null;
	const value = answer as Record<string, unknown>;
	const { admin, local, platform, scripts, localUrl } = value;
	if (typeof admin !== 'boolean' || typeof local !== 'boolean' || typeof scripts !== 'boolean') {
		return null;
	}
	if (!(HOST_PLATFORMS as readonly unknown[]).includes(platform)) return null;
	const url = typeof localUrl === 'string' && LOCAL_URL.test(localUrl) ? localUrl : null;
	return {
		admin,
		local,
		platform: platform as HostPlatform,
		// Only what the parts allow, whatever the answer says.
		scripts: scripts && admin && local && platform === 'windows',
		localUrl: admin ? url : null
	};
}

/**
 * Who uses this tab, from where: pc (the administrator on the machine of the app), remote (the
 * administrator on another device), member (another account, on this machine or elsewhere),
 * pending and outdated as the state.
 */
export type ContextMode = 'pending' | 'outdated' | 'pc' | 'remote' | 'member';

/** The pages of the administrator: with data and actions, listed with the hint, or not listed. */
export type AdminPages = 'full' | 'pc-only' | 'hidden';

export interface Capabilities {
	readonly mode: ContextMode;
	readonly adminPages: AdminPages;
	/** Things only at the machine of the app: setx, Explorer, folders and files there. */
	readonly pc: boolean;
	/** The scripts of the folder app (.bat, byl-control.ps1): pc on a server under Windows. */
	readonly scripts: boolean;
	/** System of the server; null until it is known. */
	readonly platform: HostPlatform | null;
	/** Address of the app on its machine for the administrator; null otherwise. */
	readonly localUrl: string | null;
}

export function capabilitiesOf(state: ContextState): Capabilities {
	if (state.kind !== 'ready') {
		return {
			mode: state.kind,
			adminPages: 'hidden',
			pc: false,
			scripts: false,
			platform: null,
			localUrl: null
		};
	}
	const { admin, local, platform, localUrl } = state.context;
	const mode: ContextMode = !admin ? 'member' : local ? 'pc' : 'remote';
	return {
		mode,
		adminPages: mode === 'pc' ? 'full' : mode === 'remote' ? 'pc-only' : 'hidden',
		pc: mode === 'pc',
		scripts: mode === 'pc' && platform === 'windows',
		platform,
		localUrl: admin ? localUrl : null
	};
}

/**
 * What something needs: "pc" works only at the machine of the app (setx, Explorer, a shell, the
 * extension folder), "script" needs the scripts of the folder app there (.bat, byl-control.ps1).
 */
export type ContextNeed = 'pc' | 'script';

/**
 * What stands instead: pending (nothing yet, so nothing flashes), outdated (after the next
 * restart), pc-only (the administrator elsewhere), ask-admin (another account), unavailable (the
 * scripts on a server that is not Windows).
 */
export type ContextNote = 'pending' | 'outdated' | 'pc-only' | 'ask-admin' | 'unavailable';

/** The note instead of something that needs `need`; null where it shows. */
export function contextNote(capabilities: Capabilities, need: ContextNeed): ContextNote | null {
	switch (capabilities.mode) {
		case 'pending':
		case 'outdated':
			return capabilities.mode;
		case 'member':
			return 'ask-admin';
		case 'remote':
			return 'pc-only';
		case 'pc':
			return need === 'pc' || capabilities.scripts ? null : 'unavailable';
	}
}

/**
 * What to do when the server does not answer (the error "Server nicht erreichbar"): start.bat only
 * for the administrator at the machine of the app under Windows.
 */
export function unreachableHint(capabilities: Capabilities): string {
	if (capabilities.scripts) {
		return 'Bitte prüfen, ob becauseyoulovejira gestartet ist (start.bat), und erneut versuchen.';
	}
	if (capabilities.mode === 'remote') {
		return 'Bitte prüfen, ob becauseyoulovejira auf dem PC läuft, und erneut versuchen.';
	}
	if (capabilities.mode === 'member') {
		return 'Bitte später erneut versuchen; hält es an, den Verwalter fragen.';
	}
	return 'Bitte prüfen, ob becauseyoulovejira läuft, und erneut versuchen.';
}

/** The reasons of a refusal after which the tab asks for its context again. */
export const CONTEXT_REFUSALS = ['loopback', 'owner', 'platform'] as const;

/** Whether a refusal with `reason` says the context of the tab is out of date. */
export function isContextRefusal(reason: unknown): boolean {
	return (CONTEXT_REFUSALS as readonly unknown[]).includes(reason);
}

// A command, a script or a file of the folder app in a text of the server (hints of a channel):
// names such as neu-starten.bat or byl-control.ps1, and setx.
const COMMAND = /(?:[\w-]+\.(?:bat|ps1|vbs)\b|\bsetx\b)/i;
const PARENTHESIS = /\s*\([^()]*\)/g;
// The end of a sentence: a full stop, "!" or "?" before a space (not the dot of start.bat).
const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * `text` without what names a command or a script: first every part in parentheses that does,
 * then every sentence that still does. `removed` says whether anything went.
 */
export function withoutCommands(text: string): { text: string; removed: boolean } {
	if (!COMMAND.test(text)) return { text, removed: false };
	const lean = text.replace(PARENTHESIS, (part) => (COMMAND.test(part) ? '' : part));
	const kept = lean.split(SENTENCE_END).filter((sentence) => !COMMAND.test(sentence));
	return { text: kept.join(' ').trim(), removed: true };
}
