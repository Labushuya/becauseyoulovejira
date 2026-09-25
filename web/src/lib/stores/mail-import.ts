// Import of dropped or chosen files (E4 plan, packages 8 and 14): mail files are parsed in the
// browser and saved as one entry each; calendar files go to the hook, which answers with counts.
// One file after the other, each with its own result. Without runes and SDK; the layout passes
// the reader, InboxStore.create and InboxStore.importCalendar.

import { CALENDAR_TOO_LARGE_MESSAGE, ICS_MAX_BYTES, isCalendarFile } from '$lib/calendar-file';
import { DATA_ERROR_MESSAGES } from '$lib/data/errors';
import type { InboxDraft } from '$lib/domain/inbox';
import type { MailFileResult } from '$lib/mail-file';
import type { CalendarImportResult, InboxCreateResult } from './inbox.svelte';

export type FileImportResult =
	| { name: string; kind: 'created'; itemId: string; title: string }
	| { name: string; kind: 'duplicate'; message: string; itemId: string; ticketId: string }
	| {
			name: string;
			kind: 'calendar';
			created: number;
			duplicates: number;
			skipped: number;
			failed: number;
			/** The only new entry, '' otherwise. */
			itemId: string;
	  }
	| { name: string; kind: 'error'; message: string };

export interface MailImportDeps {
	read(file: File): Promise<MailFileResult>;
	createItem(draft: InboxDraft): Promise<InboxCreateResult>;
	importCalendar(file: File): Promise<CalendarImportResult>;
}

/** Result of one calendar file, or null after a lost session (the rest stops). */
async function importCalendarFile(
	file: File,
	deps: MailImportDeps
): Promise<FileImportResult | null> {
	const name = file.name;
	if (file.size > ICS_MAX_BYTES)
		return { name, kind: 'error', message: CALENDAR_TOO_LARGE_MESSAGE };
	const outcome = await deps.importCalendar(file);
	if (outcome.kind === 'error') {
		return outcome.message === null ? null : { name, kind: 'error', message: outcome.message };
	}
	const { created, duplicates, skipped, failed, itemId } = outcome;
	return { name, kind: 'calendar', created, duplicates, skipped, failed, itemId };
}

/**
 * Reads and saves the files one after the other. A file that cannot be read or saved keeps its
 * reason and the others go on; a lost session stops the rest.
 */
export async function importMailFiles(
	files: readonly File[],
	deps: MailImportDeps
): Promise<FileImportResult[]> {
	const results: FileImportResult[] = [];
	for (const file of files) {
		const name = file.name;
		if (isCalendarFile(file)) {
			const result = await importCalendarFile(file, deps);
			if (result === null) {
				results.push({ name, kind: 'error', message: DATA_ERROR_MESSAGES.session });
				break;
			}
			results.push(result);
			continue;
		}
		const read = await deps.read(file);
		if (!read.ok) {
			results.push({ name, kind: 'error', message: read.message });
			continue;
		}
		const saved = await deps.createItem(read.draft);
		if (saved.kind === 'created') {
			results.push({ name, kind: 'created', itemId: saved.item.id, title: saved.item.title });
		} else if (saved.kind === 'duplicate') {
			results.push({
				name,
				kind: 'duplicate',
				message: saved.message,
				itemId: saved.itemId,
				ticketId: saved.ticketId
			});
		} else {
			const fields = Object.values(saved.fields);
			const message = saved.message ?? (fields.length > 0 ? fields.join(' ') : null);
			if (message === null) {
				results.push({ name, kind: 'error', message: DATA_ERROR_MESSAGES.session });
				break;
			}
			results.push({ name, kind: 'error', message });
		}
	}
	return results;
}

type Counts = Pick<
	Extract<FileImportResult, { kind: 'calendar' }>,
	'created' | 'duplicates' | 'skipped' | 'failed'
>;

/** "3 neu, 1 schon vorhanden, 1 übersprungen" (E4 plan, package 14); zero counts are left out. */
export function importCounts({ created, duplicates, skipped, failed }: Counts): string {
	const parts = [`${created} neu`];
	if (duplicates > 0) parts.push(`${duplicates} schon vorhanden`);
	if (skipped > 0) parts.push(`${skipped} übersprungen`);
	if (failed > 0) parts.push(`${failed} mit Fehler`);
	return parts.join(', ');
}

/**
 * Text for the live region, e.g. "2 neu, 1 schon vorhanden, 1 mit Fehler." A calendar file adds
 * its entries to the counts and its skipped (cancelled) events as "übersprungen".
 */
export function importSummary(results: readonly FileImportResult[]): string {
	const counts: Counts = { created: 0, duplicates: 0, skipped: 0, failed: 0 };
	for (const result of results) {
		if (result.kind === 'created') counts.created += 1;
		else if (result.kind === 'duplicate') counts.duplicates += 1;
		else if (result.kind === 'error') counts.failed += 1;
		else {
			counts.created += result.created;
			counts.duplicates += result.duplicates;
			counts.skipped += result.skipped;
			counts.failed += result.failed;
		}
	}
	return `${importCounts(counts)}.`;
}
