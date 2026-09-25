// Mail files (E4 plan, package 8): type and size checks, parsing with the file as original,
// refusal of crafted mails, and the import one file after the other with its summary.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	EML_MAX_BYTES,
	NOT_EML_MESSAGE,
	TOO_LARGE_MESSAGE,
	UNREADABLE_MESSAGE,
	isMailFile,
	readMailFile
} from './mail-file';
import { importMailFiles, importSummary } from './stores/mail-import';

const FIXTURES = join(import.meta.dirname, '../../../tests/fixtures/eml');

function fixture(name: string, type = 'message/rfc822'): File {
	return new File([readFileSync(join(FIXTURES, name))], name, { type });
}

describe('readMailFile', () => {
	it('recognises mail files by name or type', () => {
		expect(isMailFile({ name: 'a.EML', type: '' })).toBe(true);
		expect(isMailFile({ name: 'mail', type: 'message/rfc822' })).toBe(true);
		expect(isMailFile({ name: 'a.txt', type: 'text/plain' })).toBe(false);
	});

	it('reads a mail with the file as original', async () => {
		const file = fixture('utf8-plain.eml', '');
		const result = await readMailFile(file);
		expect(result).toMatchObject({
			ok: true,
			draft: { channel: 'eml', kind: 'mail', title: 'Grüße aus Köln', original: file }
		});
	});

	it('refuses other files and files over 10 MB without parsing them', async () => {
		expect(await readMailFile(new File(['x'], 'bild.png', { type: 'image/png' }))).toEqual({
			ok: false,
			message: NOT_EML_MESSAGE
		});
		const big = new File([new Uint8Array(EML_MAX_BYTES + 1)], 'gross.eml');
		expect(await readMailFile(big)).toEqual({ ok: false, message: TOO_LARGE_MESSAGE });
		const head = 'Subject: Grenze\r\n\r\n';
		const limit = new File([head, 'a'.repeat(EML_MAX_BYTES - head.length)], 'grenze.eml');
		expect(limit.size).toBe(EML_MAX_BYTES);
		expect((await readMailFile(limit)).ok).toBe(true);
	});

	it('refuses a crafted mail with too deeply nested parts', async () => {
		const depth = 60;
		const parts: string[] = ['Subject: tief', 'MIME-Version: 1.0'];
		for (let level = 0; level < depth; level++) {
			parts.push(`Content-Type: multipart/mixed; boundary="b${level}"`, '', `--b${level}`);
		}
		parts.push('Content-Type: text/plain', '', 'innen');
		for (let level = depth - 1; level >= 0; level--) parts.push(`--b${level}--`);
		const file = new File([parts.join('\r\n')], 'tief.eml');
		expect(await readMailFile(file)).toEqual({ ok: false, message: UNREADABLE_MESSAGE });
	});
});

describe('importMailFiles', () => {
	const item = (id: string, title: string) => ({ id, title }) as never;

	it('reads and saves one file after the other, each with its result', async () => {
		const createItem = vi
			.fn()
			.mockResolvedValueOnce({ kind: 'created', item: item('item00000000001', 'Grüße aus Köln') })
			.mockResolvedValueOnce({
				kind: 'duplicate',
				state: 'converted',
				itemId: 'item00000000002',
				ticketId: 'tick00000000002',
				ticketKey: 'HAUS-2',
				message: 'Schon Ticket HAUS-2.'
			})
			.mockResolvedValueOnce({ kind: 'error', message: 'Server nicht erreichbar.', fields: {} });
		const files = [
			fixture('utf8-plain.eml'),
			fixture('latin1-qp.eml'),
			new File(['x'], 'bild.png', { type: 'image/png' }),
			fixture('attachments.eml')
		];
		const results = await importMailFiles(files, { read: readMailFile, createItem });
		expect(results).toEqual([
			{
				name: 'utf8-plain.eml',
				kind: 'created',
				itemId: 'item00000000001',
				title: 'Grüße aus Köln'
			},
			{
				name: 'latin1-qp.eml',
				kind: 'duplicate',
				message: 'Schon Ticket HAUS-2.',
				itemId: 'item00000000002',
				ticketId: 'tick00000000002'
			},
			{ name: 'bild.png', kind: 'error', message: NOT_EML_MESSAGE },
			{ name: 'attachments.eml', kind: 'error', message: 'Server nicht erreichbar.' }
		]);
		expect(createItem).toHaveBeenCalledTimes(3);
		expect(importSummary(results)).toBe('1 neu, 1 schon vorhanden, 2 mit Fehler.');
	});

	it('stops at a lost session', async () => {
		const createItem = vi.fn().mockResolvedValue({ kind: 'error', message: null, fields: {} });
		const results = await importMailFiles([fixture('utf8-plain.eml'), fixture('latin1-qp.eml')], {
			read: readMailFile,
			createItem
		});
		expect(results).toEqual([
			{
				name: 'utf8-plain.eml',
				kind: 'error',
				message: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.'
			}
		]);
		expect(importSummary([])).toBe('0 neu.');
	});
});
