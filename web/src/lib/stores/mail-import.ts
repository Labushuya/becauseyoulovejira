// Import of dropped or chosen mail files (E4 plan, package 8): one file after the other, each with
// its own result "neu", "schon vorhanden" or a reason. Without runes and SDK; the layout passes
// the reader and InboxStore.create.

import { DATA_ERROR_MESSAGES } from '$lib/data/errors';
import type { InboxDraft } from '$lib/domain/inbox';
import type { MailFileResult } from '$lib/mail-file';
import type { InboxCreateResult } from './inbox.svelte';

export type FileImportResult =
	| { name: string; kind: 'created'; itemId: string; title: string }
	| { name: string; kind: 'duplicate'; message: string; itemId: string; ticketId: string }
	| { name: string; kind: 'error'; message: string };

export interface MailImportDeps {
	read(file: File): Promise<MailFileResult>;
	createItem(draft: InboxDraft): Promise<InboxCreateResult>;
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

/** Text for the live region, e.g. "2 neu, 1 schon vorhanden, 1 mit Fehler." */
export function importSummary(results: readonly FileImportResult[]): string {
	const count = (kind: FileImportResult['kind']) =>
		results.filter((result) => result.kind === kind).length;
	const parts = [`${count('created')} neu`];
	if (count('duplicate') > 0) parts.push(`${count('duplicate')} schon vorhanden`);
	if (count('error') > 0) parts.push(`${count('error')} mit Fehler`);
	return `${parts.join(', ')}.`;
}
