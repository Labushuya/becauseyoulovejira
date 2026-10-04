// Shared texts of the guidance (ADR-0026 section 2, plan EH-2). One wording for the hint after an
// update whose migration runs only after a restart: while the app runs, start.bat only opens the
// browser, so the hint names neu-starten.bat, which restarts exactly when an update needs it
// (ADR-0039 section 5). Since KX-1 (ADR-0057) a text names a script only where the tab may see one:
// the administrator on the machine of the app under Windows; elsewhere the same hint without it, the
// note "nur am PC" or "Bitte den Verwalter fragen." (currentCapabilities of lib/data/context.ts).
// Module without runes.

import { currentCapabilities } from '../data/context';
import {
	contextNote,
	unreachableHint,
	withoutCommands,
	type ContextNeed,
	type ContextNote
} from '../domain/context';

/** Texts of the context of the tab (KX-1, ADR-0057). */
export const CONTEXT_TEXTS = {
	pcOnlyTitle: 'Nur direkt am PC',
	askAdmin: 'Bitte den Verwalter fragen.',
	unavailable: 'Auf diesem Server nicht verfügbar.',
	adminOnlyTitle: 'Nur für den Verwalter',
	adminOnly: 'Diese Seite gehört zur Verwaltung der App. Bitte den Verwalter fragen.',
	/** Mark of a page of the administrator in the navigation on another device. */
	pcOnlyMark: 'nur am PC',
	/** The section "Betrieb" of the help for every account but the administrator. */
	operations: 'Betrieb und Sicherung übernimmt der Verwalter.',
	loading: 'Wird geladen …'
} as const;

/** The hint for the administrator on another device, with the address of the app on its machine. */
export function pcOnlyText(localUrl: string | null): string {
	const base = 'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft';
	return localUrl === null ? `${base}.` : `${base} (dort über ${localUrl} öffnen).`;
}

const RESTART_TITLE = 'Nach dem nächsten Neustart verfügbar';
const RESTART_BASE = 'Die App hat ein Update bekommen, das erst nach einem Neustart wirkt';

/** What stands instead of something the tab may not show; '' while the context loads. */
export function contextNoteText(note: ContextNote, localUrl: string | null): string {
	switch (note) {
		case 'pending':
			return '';
		case 'outdated':
			return `${RESTART_TITLE}.`;
		case 'pc-only':
			return pcOnlyText(localUrl);
		case 'ask-admin':
			return CONTEXT_TEXTS.askAdmin;
		case 'unavailable':
			return CONTEXT_TEXTS.unavailable;
	}
}

/**
 * A text of the server or a domain module (hints of a channel) for this tab: as it is for the
 * administrator on the machine of the app under Windows; elsewhere without what names a command or
 * a script, with the note "nur am PC" resp. "Bitte den Verwalter fragen." when something went.
 */
export function textForContext(text: string): string {
	const capabilities = currentCapabilities();
	if (capabilities.scripts) return text;
	const { text: lean, removed } = withoutCommands(text);
	if (!removed) return text;
	const note =
		capabilities.mode === 'remote'
			? pcOnlyText(capabilities.localUrl)
			: capabilities.mode === 'member'
				? CONTEXT_TEXTS.askAdmin
				: '';
	return [lean, note].filter((part) => part !== '').join(' ');
}

/** The note of this tab instead of something that needs `need`; null where it shows. */
export function currentNote(need: ContextNeed): string | null {
	const capabilities = currentCapabilities();
	const note = contextNote(capabilities, need);
	return note === null ? null : contextNoteText(note, capabilities.localUrl);
}

/**
 * Title and text of the section message "restart needed". The text names neu-starten.bat only for
 * the administrator on the machine of the app under Windows; read in a template it follows the
 * context of the tab.
 */
export const RESTART_NEEDED = {
	title: RESTART_TITLE,
	get text(): string {
		const capabilities = currentCapabilities();
		if (capabilities.scripts)
			return `${RESTART_BASE}: neu-starten.bat im Ordner app doppelklicken.`;
		if (capabilities.mode === 'remote')
			return `${RESTART_BASE}. ${pcOnlyText(capabilities.localUrl)}`;
		if (capabilities.mode === 'member') return `${RESTART_BASE}. ${CONTEXT_TEXTS.askAdmin}`;
		return `${RESTART_BASE}.`;
	}
} as const;

/**
 * The same hint as one sentence for places without a title (errors of a store, results of a
 * file): `subject` names the area with its verb, e.g. "Der Eingang ist" or "Die Verbindungen sind".
 * The sentence follows the context of the tab at the moment of the call.
 */
export function restartNeeded(subject: string): string {
	return `${subject} nach dem nächsten Neustart verfügbar. ${RESTART_NEEDED.text}`;
}

/** What to do when the server does not answer; start.bat only for the administrator at the PC. */
export function serverUnreachableHint(): string {
	return unreachableHint(currentCapabilities());
}

/** The error "server not reachable" of the data layer and the sign-in (ADR-0006 section 4). */
export function serverUnreachable(): string {
	return `Server nicht erreichbar. ${serverUnreachableHint()}`;
}

/** Flag in an open tab when start.bat or the landing page opened the app again (ADR-0035 §5). */
export const APP_OPENED_AGAIN = {
	title: 'Du hast becauseyoulovejira erneut geöffnet.',
	description: 'Die App ist hier schon offen.'
} as const;

/**
 * Neutral flag in the open tabs when stop.bat, a restart or neu-starten.bat ends the app (ADR-0035
 * §5, ADR-0039); not an error. After a restart the tab reconnects on its own and the flag goes.
 */
export const APP_STOPPED = {
	title: 'becauseyoulovejira wurde beendet.',
	/** Names start.bat only for the administrator on the machine of the app (KX-1). */
	get description(): string {
		const reconnect = 'Nach einem Neustart verbindet sich dieser Tab von selbst.';
		return currentCapabilities().scripts
			? `Zum Weiterarbeiten start.bat ausführen. ${reconnect}`
			: reconnect;
	}
} as const;

/** Windows notification of a hidden tab (opt-in, ADR-0035 §5); a click brings the tab forward. */
export const APP_OPENED_NOTIFICATION = {
	title: 'becauseyoulovejira ist schon offen',
	body: 'Klicken, um dorthin zu wechseln.'
} as const;

/** Title a hidden tab alternates with while it asks for attention. */
export const ATTENTION_TITLE = '● Hier ist becauseyoulovejira';

/** Modal of a second tab of the same browser (ADR-0035 §6). */
export const DUPLICATE_TAB = {
	title: 'Die App ist schon offen',
	text: 'becauseyoulovejira ist in einem anderen Tab dieses Browsers geöffnet. Dort erscheint ein Hinweis.',
	closing: (seconds: number) => `Dieser Tab schließt sich in ${seconds} s.`,
	closeFailed: 'Du kannst diesen Tab jetzt schließen.',
	keep: 'Hier weiterarbeiten',
	close: 'Tab schließen'
} as const;

/**
 * Hint while a realtime subscription failed and is tried again (ADR-0011 E6, E2 plan §8): a
 * warning, not an error, because the data stays usable; "Neu laden" loads the page again.
 */
export const LIVE_INTERRUPTED = {
	text: 'Live-Aktualisierung unterbrochen – wird erneut versucht.',
	reload: 'Neu laden'
} as const;

/**
 * Hint once a new build of the app is published while the tab is open (ADR-0040): information,
 * not a warning, because the running version keeps working. `unsaved` is added while typed text
 * would be lost by loading the page again.
 */
export const APP_UPDATED = {
	text: 'Eine neue Version von becauseyoulovejira ist da.',
	unsaved: 'Speichere zuerst deine Eingaben, beim Neuladen gehen sie verloren.',
	reload: 'Neu laden'
} as const;
