// WhatsApp export into the inbox (E4 plan, package 16): the selection view with filters and
// "Alle sichtbaren auswählen", reading .txt and .zip files, and the hand-over of dropped files.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { InboxDraft } from '$lib/domain/inbox';
import { FORMAT_NOT_RECOGNISED, parseWhatsAppExport } from '$lib/domain/whatsapp-export';
import type { DraftsOutcome } from '$lib/stores/capture';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import { ONE_CHAT_AT_A_TIME, prepareDroppedFiles } from '$lib/stores/mail-import';
import {
	WHATSAPP_MAX_BYTES,
	WHATSAPP_TOO_LARGE_MESSAGE,
	isWhatsAppFile,
	readWhatsAppFile
} from '$lib/whatsapp-file';
import { ZIP_DAMAGED_MESSAGE } from '$lib/zip-text';
import WhatsAppImport from './WhatsAppImport.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/whatsapp');
const ANDROID = 'WhatsApp Chat mit Familie Beispiel.txt';
const bytes = (name: string) => readFileSync(join(FIXTURES, name));
const file = (name: string, content: BlobPart = new Uint8Array(bytes(name))) =>
	new File([content], name);

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP with one deflated `_chat.txt`, as the iOS export sends it. */
function chatZip(content: Uint8Array): Uint8Array<ArrayBuffer> {
	const name = new TextEncoder().encode('_chat.txt');
	const data = new Uint8Array(deflateRawSync(content));
	const local = new Uint8Array(30 + name.length + data.length);
	const lv = new DataView(local.buffer);
	lv.setUint32(0, 0x04034b50, true);
	lv.setUint16(8, 8, true);
	lv.setUint32(14, crc32(content), true);
	lv.setUint32(18, data.length, true);
	lv.setUint32(22, content.length, true);
	lv.setUint16(26, name.length, true);
	local.set(name, 30);
	local.set(data, 30 + name.length);
	const central = new Uint8Array(46 + name.length);
	const cv = new DataView(central.buffer);
	cv.setUint32(0, 0x02014b50, true);
	cv.setUint16(10, 8, true);
	cv.setUint32(16, crc32(content), true);
	cv.setUint32(20, data.length, true);
	cv.setUint32(24, content.length, true);
	cv.setUint16(28, name.length, true);
	central.set(name, 46);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, 1, true);
	ev.setUint16(10, 1, true);
	ev.setUint32(12, central.length, true);
	ev.setUint32(16, local.length, true);
	const out = new Uint8Array(local.length + central.length + end.length);
	out.set(local, 0);
	out.set(central, local.length);
	out.set(end, local.length + central.length);
	return out;
}

describe('readWhatsAppFile', () => {
	it('recognises .txt and .zip files', () => {
		expect(isWhatsAppFile({ name: 'WhatsApp Chat mit Anna.TXT', type: '' })).toBe(true);
		expect(isWhatsAppFile({ name: 'export.zip', type: 'application/zip' })).toBe(true);
		expect(isWhatsAppFile({ name: 'a.eml', type: '' })).toBe(false);
	});

	it('reads a .txt export with the chat name of the file', async () => {
		const result = await readWhatsAppFile(file(ANDROID));
		expect(result).toMatchObject({
			ok: true,
			chat: 'Familie Beispiel',
			format: 'android',
			leftOut: 4
		});
	});

	it('reads the iOS .zip with _chat.txt', async () => {
		const zipped = file('WhatsApp Chat - Familie Beispiel.zip', chatZip(bytes('_chat.txt')));
		const result = await readWhatsAppFile(zipped);
		expect(result).toMatchObject({ ok: true, chat: 'Familie Beispiel', format: 'ios' });
		expect(result.ok && result.messages).toHaveLength(2);
	});

	it('refuses other text, damaged archives and files over 20 MB', async () => {
		expect(await readWhatsAppFile(file('no-export.txt'))).toEqual({
			ok: false,
			message: FORMAT_NOT_RECOGNISED
		});
		expect(await readWhatsAppFile(file('chat.zip', 'kein zip'))).toEqual({
			ok: false,
			message: ZIP_DAMAGED_MESSAGE
		});
		const big = file('gross.txt', new Uint8Array(WHATSAPP_MAX_BYTES + 1));
		expect(await readWhatsAppFile(big)).toEqual({ ok: false, message: WHATSAPP_TOO_LARGE_MESSAGE });
	});
});

describe('prepareDroppedFiles with chat exports', () => {
	const deps = {
		read: vi.fn(),
		readChat: readWhatsAppFile,
		previewCalendar: vi.fn(),
		lookup: vi.fn(),
		keywords: async () => EMPTY_IMPORT_KEYWORDS,
		onSessionLost: vi.fn()
	};

	it('opens the first chat and refuses further ones', async () => {
		const result = await prepareDroppedFiles(
			[file(ANDROID), file('_chat.txt'), file('no-export.txt')],
			deps
		);
		expect(result.chat).toMatchObject({ chat: 'Familie Beispiel' });
		expect(result.results).toEqual([
			{ name: '_chat.txt', kind: 'error', message: ONE_CHAT_AT_A_TIME },
			{ name: 'no-export.txt', kind: 'error', message: ONE_CHAT_AT_A_TIME }
		]);
	});

	it('names a file that is no export', async () => {
		const result = await prepareDroppedFiles([file('no-export.txt')], deps);
		expect(result.chat).toBeNull();
		expect(result.results).toEqual([
			{ name: 'no-export.txt', kind: 'error', message: FORMAT_NOT_RECOGNISED }
		]);
	});
});

describe('WhatsApp selection view', () => {
	const parsed = parseWhatsAppExport(bytes(ANDROID).toString('utf8'));
	if (!parsed.ok) throw new Error('fixture');
	const saved: DraftsOutcome = { created: 2, duplicates: 0, failures: [] };

	function renderView(outcome: DraftsOutcome = saved, keywords: string[] = []) {
		const onsave = vi.fn<(drafts: InboxDraft[]) => Promise<DraftsOutcome>>(async () => outcome);
		const onclose = vi.fn();
		render(WhatsAppImport, {
			props: {
				chat: 'Familie Beispiel',
				messages: parsed.ok ? parsed.messages : [],
				leftOut: 4,
				keywords,
				onsave,
				onclose
			}
		});
		return {
			onsave,
			onclose,
			dialog: screen.getByRole('dialog', { name: 'WhatsApp-Chat „Familie Beispiel“' })
		};
	}

	const submit = () => screen.getByRole('button', { name: /in den Eingang$/ });

	it('offers every message with a checkbox and chooses nothing at first', () => {
		const { dialog } = renderView();
		expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
		expect(screen.getByText(/4 Nachrichten zur Auswahl, 4 ausgelassen/)).toBeTruthy();
		const boxes = within(dialog).getAllByRole('checkbox');
		expect(boxes).toHaveLength(4);
		expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
		expect(submit().getAttribute('aria-disabled')).toBe('true');
		expect(submit().textContent).toContain('0 Nachrichten in den Eingang');
		expect(screen.getByText('29.03.2026 03:05 · Ben Muster')).toBeTruthy();
	});

	it('chooses the messages with a keyword at first and keeps the keyword (package 21)', async () => {
		const { onsave } = renderView(saved, ['getranke', 'Uhr']);
		expect(
			screen.getByText(/Nachrichten mit einem deiner Stichwörter sind vorausgewählt/)
		).toBeTruthy();
		const chosen = screen
			.getAllByRole('checkbox')
			.filter((box) => (box as HTMLInputElement).checked)
			.map((box) => box.closest('label')?.textContent ?? '');
		expect(chosen).toHaveLength(2);
		expect(chosen[0]).toMatch(/Wer holt am Samstag die Getränke\?\s*Stichwort: getranke/);
		expect(chosen[1]).toMatch(/Uhr umgestellt\?\s*Stichwort: Uhr/);
		await fireEvent.click(submit());
		expect(onsave.mock.calls[0]?.[0].map((draft) => draft.sourceMeta?.keyword)).toEqual([
			'getranke',
			'Uhr'
		]);
	});

	it('says that nothing is chosen without keywords', () => {
		renderView();
		const hint = screen.getByText(/keine Stichwörter festgelegt, deshalb ist nichts vorausgewählt/);
		// Section message of the tone "info" with the way to the keywords (EH-10).
		const message = hint.closest('[data-tone]') as HTMLElement;
		expect(message.getAttribute('data-tone')).toBe('info');
		expect(
			within(message)
				.getByRole('link', { name: 'Stichwörter unter „Datei-Importe“ festlegen' })
				.getAttribute('href')
		).toBe('/einstellungen/datei-importe');
	});

	it('saves only the chosen messages as drafts and closes', async () => {
		const { onsave, onclose } = renderView();
		await fireEvent.click(screen.getByLabelText(/Wer holt am Samstag/));
		await fireEvent.click(screen.getByLabelText(/Frohes neues Jahr/));
		expect(screen.getByText('4 Nachrichten sichtbar, 2 ausgewählt')).toBeTruthy();
		await fireEvent.click(submit());
		const drafts = onsave.mock.calls[0]?.[0] ?? [];
		expect(
			drafts.map((draft) => [draft.channel, draft.kind, draft.title, draft.sourceMeta])
		).toEqual([
			[
				'whatsapp',
				'message',
				'Wer holt am Samstag die Getränke?',
				{ chat: 'Familie Beispiel', sender: 'Anna Beispiel' }
			],
			[
				'whatsapp',
				'message',
				'Frohes neues Jahr: bis gleich!',
				{ chat: 'Familie Beispiel', sender: 'Carla Test' }
			]
		]);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledWith(saved));
	});

	it('filters by sender and period and chooses all visible messages', async () => {
		const { onsave } = renderView();
		await fireEvent.change(screen.getByLabelText('Absender'), { target: { value: 'Ben Muster' } });
		expect(screen.getAllByRole('checkbox')).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Alle sichtbaren auswählen' }));
		await fireEvent.change(screen.getByLabelText('Absender'), { target: { value: '' } });
		await fireEvent.input(screen.getByLabelText('Von'), { target: { value: '2026-10-01' } });
		expect(screen.getAllByRole('checkbox')).toHaveLength(2);
		expect(screen.getByText('2 Nachrichten sichtbar, 2 ausgewählt')).toBeTruthy();
		await fireEvent.click(submit());
		expect(onsave.mock.calls[0]?.[0].map((draft) => draft.sourceMeta?.sender)).toEqual([
			'Ben Muster',
			'Ben Muster'
		]);
	});

	it('marks a period that ends before it starts and empties the choice on request', async () => {
		renderView();
		await fireEvent.input(screen.getByLabelText('Von'), { target: { value: '2026-12-01' } });
		await fireEvent.input(screen.getByLabelText('Bis'), { target: { value: '2026-01-01' } });
		const to = screen.getByLabelText('Bis');
		expect(to.getAttribute('aria-invalid')).toBe('true');
		expect(
			document.getElementById(to.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('„Bis“ liegt vor „Von“.');
		// Compact empty state (EH-10): heading without full stop.
		expect(
			screen.getByRole('heading', { name: 'Keine Nachricht passt zu den Filtern' })
		).toBeTruthy();
		await fireEvent.input(screen.getByLabelText('Bis'), { target: { value: '' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Alle sichtbaren auswählen' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
		expect(submit().getAttribute('aria-disabled')).toBe('true');
	});

	it('keeps the view open with the failures and closes with Escape', async () => {
		const failed: DraftsOutcome = {
			created: 1,
			duplicates: 0,
			failures: [{ title: 'Uhr umgestellt?', message: 'Server nicht erreichbar.' }]
		};
		const { onclose, dialog } = renderView(failed);
		expect(dialog.classList.contains('size-l')).toBe(true);
		expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Alle sichtbaren auswählen' }));
		await fireEvent.click(submit());
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('„Uhr umgestellt?“: Server nicht erreichbar.');
		expect(alert.querySelector('svg')).not.toBeNull();
		expect(onclose).not.toHaveBeenCalled();
		// Some messages are saved: the footer says "Schließen" (× and footer).
		expect(within(dialog).queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		expect(within(dialog).getAllByRole('button', { name: 'Schließen' })).toHaveLength(2);
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		expect(onclose).toHaveBeenCalledWith(failed);
	});
});
