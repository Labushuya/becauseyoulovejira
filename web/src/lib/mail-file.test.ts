// Mail files (E4 plan, package 8): type and size checks, parsing with the file as original and
// refusal of crafted mails; calendar files (package 14) are recognised by name or type. The import
// with its selection view is tested in stores/mail-import.test.ts (package 21).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	EML_MAX_BYTES,
	NOT_EML_MESSAGE,
	TOO_LARGE_MESSAGE,
	UNREADABLE_MESSAGE,
	isMailFile,
	readMailFile
} from './mail-file';
import { isCalendarFile } from './calendar-file';

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

describe('calendar files (E4 plan, package 14)', () => {
	it('recognises calendar files by name or type', () => {
		expect(isCalendarFile({ name: 'Termin.ICS', type: '' })).toBe(true);
		expect(isCalendarFile({ name: 'export', type: 'text/calendar' })).toBe(true);
		expect(isCalendarFile({ name: 'a.eml', type: 'message/rfc822' })).toBe(false);
	});
});
