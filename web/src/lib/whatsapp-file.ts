// WhatsApp export files for the inbox (E4 plan, package 16; ADR-0016 section 3): the .txt of the
// export or the .zip with it, at most 20 MB. Reads the text and parses it; the selection view
// decides which messages become entries.

import { chatNameOf, parseWhatsAppExport, type ExportParseResult } from './domain/whatsapp-export';
import { readZipText } from './zip-text';

/** Largest export file (E4 plan, package 16). */
export const WHATSAPP_MAX_BYTES = 20 * 1024 * 1024;

export const WHATSAPP_TOO_LARGE_MESSAGE = 'Größer als 20 MB, deshalb nicht übernommen.';

export type WhatsAppFileResult =
	({ chat: string } & Extract<ExportParseResult, { ok: true }>) | { ok: false; message: string };

/** True for a file that may be a chat export: `.txt` or `.zip`. */
export function isWhatsAppFile(file: Pick<File, 'name' | 'type'>): boolean {
	return /\.(txt|zip)$/i.test(file.name);
}

/** Reads and parses one export file; the chat name comes from the file name. */
export async function readWhatsAppFile(file: File): Promise<WhatsAppFileResult> {
	if (file.size > WHATSAPP_MAX_BYTES) return { ok: false, message: WHATSAPP_TOO_LARGE_MESSAGE };
	const bytes = new Uint8Array(await file.arrayBuffer());
	let text: string;
	if (/\.zip$/i.test(file.name)) {
		const unzipped = await readZipText(bytes);
		if (!unzipped.ok) return unzipped;
		text = unzipped.text;
	} else {
		text = new TextDecoder('utf-8').decode(bytes);
	}
	const parsed = parseWhatsAppExport(text);
	if (!parsed.ok) return parsed;
	return { ...parsed, chat: chatNameOf(file.name) };
}
