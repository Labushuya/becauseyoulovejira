// Assistant "WhatsApp Web einrichten" (ADR-0038 §4, ADR-0026 §4; plan eigener-eingang-whatsapp-web
// EI-3). Pure: the steps with short labels, the ways to load the extension in Edge and Chrome, and
// the facts the app can check itself: a key exists, the key was used since the assistant opened
// ("Verbindung testen" in the extension touches it), keywords exist. Loading and entering the key
// happen in the browser; the app cannot see them.

import type { StepState } from './channel-setup';
import type { InboxKey } from './inbox-keys';

/** Folder of the build relative to the app, when the server does not name it (before a restart). */
export const EXTENSION_FOLDER = 'app\\erweiterung-whatsapp-web';

/** The steps; "Zielprojekt" (ADR-0049) is optional and never holds the assistant up. */
export const WHATSAPP_WEB_STEPS = [
	{ id: 'key', label: 'Schlüssel' },
	{ id: 'load', label: 'Erweiterung laden' },
	{ id: 'enter', label: 'Schlüssel eintragen' },
	{ id: 'test', label: 'Testen' },
	{ id: 'keywords', label: 'Stichwörter' },
	{ id: 'target', label: 'Zielprojekt' }
] as const;

export type WhatsAppWebStep = (typeof WHATSAPP_WEB_STEPS)[number]['id'];

export const BROWSERS = ['edge', 'chrome'] as const;
export type Browser = (typeof BROWSERS)[number];

export const BROWSER_LABELS: Readonly<Record<Browser, string>> = Object.freeze({
	edge: 'Microsoft Edge',
	chrome: 'Google Chrome'
});

/** Address of the page with the extensions; typed into the address bar (pages cannot link it). */
export const EXTENSIONS_PAGE: Readonly<Record<Browser, string>> = Object.freeze({
	edge: 'edge://extensions',
	chrome: 'chrome://extensions'
});

/** Steps to load the unpacked extension; Stand der Klickwege: 2026-09. */
export const LOAD_STEPS: Readonly<Record<Browser, readonly string[]>> = Object.freeze({
	edge: [
		'In die Adressleiste edge://extensions eingeben und Enter drücken.',
		'Links bzw. unten „Entwicklermodus“ einschalten.',
		'Oben „Entpackt laden“ wählen.',
		'Den Ordner unten auswählen und „Ordner auswählen“ klicken.',
		'Optional: Über das Puzzle-Symbol neben der Adressleiste die Erweiterung anheften.'
	],
	chrome: [
		'In die Adressleiste chrome://extensions eingeben und Enter drücken.',
		'Oben rechts „Entwicklermodus“ einschalten.',
		'Oben links „Entpackte Erweiterung laden“ wählen.',
		'Den Ordner unten auswählen und „Ordner auswählen“ klicken.',
		'Optional: Über das Puzzle-Symbol neben der Adressleiste die Erweiterung anheften.'
	]
});

/** Steps to enter address and key in the extension. */
export const ENTER_STEPS: readonly string[] = [
	'Auf das Symbol der Erweiterung „becauseyoulovejira für WhatsApp Web“ klicken (oder in der Liste der Erweiterungen „Details“ → „Erweiterungsoptionen“).',
	'Bei „App-Adresse“ die Adresse unten eintragen (sie steht schon da, wenn du nichts geändert hast).',
	'Bei „Zugangsschlüssel“ den Schlüssel einfügen und „Speichern“ klicken.'
];

/** When a key counts as used by the extension: at most this long before the assistant opened. */
const USED_SLACK_MS = 60_000;

function timeOf(stamp: string | null): number {
	if (stamp === null) return Number.NaN;
	return Date.parse(stamp.replace(' ', 'T'));
}

/**
 * The key the assistant watches: the one created in it, else the newest key; null without keys.
 * `createdId` is the ID of a key created in the assistant.
 */
export function watchedKey(keys: readonly InboxKey[], createdId: string | null): InboxKey | null {
	const created = createdId === null ? undefined : keys.find((key) => key.id === createdId);
	if (created !== undefined) return created;
	return [...keys].sort((a, b) => timeOf(b.created) - timeOf(a.created))[0] ?? null;
}

/**
 * Whether the extension reached the app with `key` since the assistant opened (`openedAt`, ms):
 * "Verbindung testen" writes "zuletzt benutzt" (at most once a minute, hence a minute of slack).
 */
export function keyUsedSince(key: InboxKey | null, openedAt: number): boolean {
	const used = timeOf(key?.lastUsedAt ?? null);
	return !Number.isNaN(used) && used >= openedAt - USED_SLACK_MS;
}

export interface WhatsAppWebFacts {
	keys: number;
	used: boolean;
	keywords: number;
}

/** Whether the app can see that a step is done; loading and entering it cannot see. */
export function stepDone(step: WhatsAppWebStep, facts: WhatsAppWebFacts): boolean {
	if (step === 'key') return facts.keys > 0;
	if (step === 'keywords') return facts.keywords > 0;
	// Optional (ADR-0049): the app does not ask whether a target was chosen; firstOpenStep skips it.
	if (step === 'target') return false;
	// Loaded, entered and tested show only together: the extension used the key.
	return facts.used;
}

/** States of the stepper: the current one, done ones, a keyword step without keywords a warning. */
export function whatsappStepStates(facts: WhatsAppWebFacts, current: number): StepState[] {
	return WHATSAPP_WEB_STEPS.map((step, index) => {
		if (index === current) return 'current';
		if (stepDone(step.id, facts)) return 'done';
		return step.id === 'keywords' && facts.used ? 'warning' : 'open';
	});
}

/**
 * The step the assistant opens at: the first the app does not see as done, the optional
 * "Zielprojekt" left out; with every other step done the last one.
 */
export function firstOpenStep(facts: WhatsAppWebFacts): number {
	const index = WHATSAPP_WEB_STEPS.findIndex(
		(step) => step.id !== 'target' && !stepDone(step.id, facts)
	);
	return index === -1 ? WHATSAPP_WEB_STEPS.length - 1 : index;
}
