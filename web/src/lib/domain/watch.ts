// Status of a watched source (ADR-0050 §5, ADR-0031 addendum I): an entry whose source a channel
// keeps watching (a version of a file and a pull request on GitHub, a file in a watched folder,
// ADR-0051 §5) says whether it still matches the source. Only shown: the ticket never changes, and
// nothing of it is an error (ADR-0009), so no tone is red. Pure; the data layer reads
// inbox_items.watch with watchOf.

import { formatBerlinDateTime } from './format';

export type WatchStatus =
	| { kind: 'file'; state: 'current' | 'changed' | 'gone'; since: string | null }
	| {
			kind: 'file';
			state: 'moved';
			since: string | null;
			/** New path below the folder of a moved or renamed file (ADR-0051 §5). */
			to: string;
			/** Name of that folder. */
			folder: string;
			/** Whether the content differs from the entry as well. */
			changed: boolean;
	  }
	| { kind: 'pull'; state: 'open' | 'merged' | 'closed'; since: string | null };

const FILE_STATES = ['current', 'changed', 'gone'] as const;
const PULL_STATES = ['open', 'merged', 'closed'] as const;

/** An instant as ISO text in UTC (what formatBerlinDateTime reads), null for anything else. */
function sinceOf(value: unknown): string | null {
	if (typeof value !== 'string' || value === '') return null;
	const ms = Date.parse(value.replace(' ', 'T'));
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** The status of an entry (inbox_items.watch), null for none or an unknown one. */
export function watchOf(value: unknown): WatchStatus | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (raw.kind === 'file') {
		if (raw.state === 'moved' && typeof raw.to === 'string' && raw.to !== '') {
			return {
				kind: 'file',
				state: 'moved',
				since: sinceOf(raw.since),
				to: raw.to,
				folder: typeof raw.folder === 'string' ? raw.folder : '',
				changed: raw.changed === true
			};
		}
		const state = FILE_STATES.find((entry) => entry === raw.state);
		return state === undefined ? null : { kind: 'file', state, since: sinceOf(raw.since) };
	}
	if (raw.kind === 'pull') {
		const state = PULL_STATES.find((entry) => entry === raw.state);
		return state === undefined ? null : { kind: 'pull', state, since: sinceOf(raw.since) };
	}
	return null;
}

/** Short label of the lozenge. */
export const WATCH_LABELS = Object.freeze({
	current: 'Unverändert',
	changed: 'Seit Import geändert',
	gone: 'Nicht mehr vorhanden',
	moved: 'Verschoben',
	open: 'PR offen',
	merged: 'PR gemergt',
	closed: 'PR geschlossen'
} satisfies Record<WatchStatus['state'], string>);

/** Look of the lozenge: a calm tone and an icon, never "danger". */
export const WATCH_LOZENGES = Object.freeze({
	current: { tone: 'muted', icon: 'check' },
	changed: { tone: 'neutral', icon: 'refresh' },
	gone: { tone: 'neutral', icon: 'warning' },
	moved: { tone: 'neutral', icon: 'refresh' },
	open: { tone: 'neutral', icon: 'pending' },
	merged: { tone: 'brand', icon: 'check' },
	closed: { tone: 'muted', icon: 'pause' }
} satisfies Record<
	WatchStatus['state'],
	{
		tone: 'neutral' | 'brand' | 'muted';
		icon: 'check' | 'refresh' | 'warning' | 'pending' | 'pause';
	}
>);

/**
 * The status in a sentence, e.g. "Seit Import erneut geändert (am 03.10.2026, 14:05)",
 * "Verschoben nach „Archiv/Bericht.pdf“ (am …)" or "PR gemergt (am …)".
 */
export function watchText(watch: WatchStatus): string {
	const at = watch.since === null ? '' : ` (am ${formatBerlinDateTime(watch.since)})`;
	switch (watch.state) {
		case 'current':
			return 'Unverändert seit dem Import';
		case 'changed':
			return `Seit Import erneut geändert${watch.since === null ? '' : ` (zuletzt am ${formatBerlinDateTime(watch.since)})`}`;
		case 'gone':
			return `Nicht mehr vorhanden${watch.since === null ? '' : ` (seit ${formatBerlinDateTime(watch.since)})`}`;
		case 'moved':
			return `Verschoben nach „${watch.to}“${watch.folder === '' ? '' : ` in „${watch.folder}“`}${at}${watch.changed ? ', seit Import auch geändert' : ''}`;
		case 'open':
			return 'PR offen';
		case 'merged':
			return `PR gemergt${at}`;
		case 'closed':
			return `PR geschlossen${at}`;
	}
}
