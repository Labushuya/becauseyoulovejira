// Mailbox selection (E4 plan, package 23; ADR-0016 section 6, ADR-0020 section 4): the last mails of
// a mail connection, keyword matches chosen at first, mails in the inbox blocked, results per mail,
// the neutral hint for a stopped mail helper and errors with icon and reason.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	importSummary,
	preselectedUids,
	sizeText,
	type MailboxImportResult,
	type MailboxMail,
	type MailboxOutcome
} from '$lib/domain/mailbox';
import MailboxPicker from './MailboxPicker.svelte';

const nativeDialog = {
	showModal: HTMLDialogElement.prototype.showModal,
	close: HTMLDialogElement.prototype.close
};

beforeAll(() => {
	if (typeof nativeDialog.showModal !== 'function') {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof nativeDialog.close !== 'function') {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.open = false;
		};
	}
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
	HTMLDialogElement.prototype.close = nativeDialog.close;
});

function mail(uid: number, overrides: Partial<MailboxMail> = {}): MailboxMail {
	return {
		uid,
		size: 2048,
		subject: `Mail ${uid}`,
		from: 'Bert <bert@example.com>',
		date: '2026-09-25 08:00:00.000Z',
		keyword: '',
		state: '',
		stateMessage: '',
		...overrides
	};
}

const MAILS = [
	mail(5, { subject: 'Todo: Steuer', keyword: 'todo' }),
	mail(4, { subject: 'Hallo' }),
	mail(3, {
		subject: 'Todo: alt',
		keyword: 'todo',
		state: 'discarded',
		stateMessage: 'Schon verworfen.'
	}),
	mail(2, { subject: 'Rechnung', keyword: 'rechnung' })
];

function setup(
	outcome: MailboxOutcome<MailboxMail[]> = { kind: 'ok', value: MAILS },
	saved: MailboxOutcome<MailboxImportResult[]> = {
		kind: 'ok',
		value: [
			{ uid: 5, status: 'created', message: '' },
			{ uid: 2, status: 'failed', message: 'Größer als 10 MB, deshalb nicht übernommen.' }
		]
	}
) {
	const load = vi.fn<(limit: number, signal: AbortSignal) => Promise<typeof outcome>>(
		async () => outcome
	);
	const save = vi.fn<(uids: readonly number[]) => Promise<typeof saved>>(async () => saved);
	const onclose = vi.fn();
	render(MailboxPicker, { props: { label: 'Web.de', load, save, onclose } });
	return { load, save, onclose };
}

function row(subject: string) {
	return within(screen.getByText(subject).closest('li') as HTMLElement);
}

describe('mailbox domain', () => {
	it('chooses keyword matches that are not in the inbox and summarises an import', () => {
		expect(preselectedUids(MAILS)).toEqual([5, 2]);
		expect(importSummary([{ uid: 1, status: 'created', message: '' }])).toBe('1 neu.');
		expect(
			importSummary([
				{ uid: 1, status: 'created', message: '' },
				{ uid: 2, status: 'duplicate', message: '' },
				{ uid: 3, status: 'failed', message: 'x' }
			])
		).toBe('1 neu, 1 schon vorhanden, 1 mit Fehler.');
		expect(sizeText(100)).toBe('1 kB');
		expect(sizeText(1_500_000)).toBe('1,4 MB');
	});
});

describe('MailboxPicker', () => {
	it('lists the last 50 mails with keyword matches chosen and mails in the inbox blocked', async () => {
		const { load } = setup();
		const dialog = await screen.findByRole('dialog', { name: 'Aus dem Postfach wählen' });
		expect(load).toHaveBeenCalledWith(50, expect.any(AbortSignal));
		await screen.findByText('Todo: Steuer');
		expect((row('Todo: Steuer').getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
		expect(row('Todo: Steuer').getByText('Stichwort: todo')).toBeTruthy();
		expect((row('Hallo').getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
		const blocked = row('Todo: alt').getByRole('checkbox') as HTMLInputElement;
		expect(blocked.disabled).toBe(true);
		expect(row('Todo: alt').getByText('Schon verworfen.')).toBeTruthy();
		expect(
			row('Hallo').getByText('25.09.2026 10:00 · Bert <bert@example.com> · 2 kB')
		).toBeTruthy();
		expect(within(dialog).getByText('2 ausgewählt')).toBeTruthy();
		expect((dialog.textContent ?? '').replace(/\s+/g, ' ')).toMatch(
			/auch ohne Stichwort und auch aus der Zeit vor der Einrichtung/
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Alle auswählen' }));
		expect(within(dialog).getByText('3 ausgewählt')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
		expect(within(dialog).getByText('0 ausgewählt')).toBeTruthy();
		expect(
			screen.getByRole('button', { name: '0 Mails in den Eingang' }).getAttribute('aria-disabled')
		).toBe('true');
	});

	it('takes the chosen mails, shows the result per mail and keeps failed ones selectable', async () => {
		const { save } = setup();
		await screen.findByText('Todo: Steuer');
		await fireEvent.click(row('Hallo').getByRole('checkbox'));
		await fireEvent.click(screen.getByRole('button', { name: '3 Mails in den Eingang' }));
		expect(save).toHaveBeenCalledWith([5, 4, 2]);
		await screen.findByText('Jetzt im Eingang.');
		expect((row('Todo: Steuer').getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
		const failed = row('Rechnung').getByText('Größer als 10 MB, deshalb nicht übernommen.');
		expect(failed.closest('.failed')?.querySelector('svg')).not.toBeNull();
		expect((row('Rechnung').getByRole('checkbox') as HTMLInputElement).disabled).toBe(false);
		expect(screen.getByText('1 neu, 1 mit Fehler.')).toBeTruthy();
	});

	it('explains a stopped mail helper neutrally and tries again', async () => {
		const { load } = setup({
			kind: 'unavailable',
			message: 'Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet).',
			hint: 'stop.bat und dann start.bat ausführen.'
		});
		const status = await screen.findByText(/Der Mail-Hilfsprozess läuft nicht/);
		expect(status.closest('[role="status"]')).not.toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByText('stop.bat und dann start.bat ausführen.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shows a refused login as error with the hint', async () => {
		setup({
			kind: 'failed',
			message: 'Anmeldung bei Web.de abgelehnt.',
			hint: 'POP3/IMAP-Abruf einschalten.'
		});
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/Anmeldung bei Web.de abgelehnt/);
		expect(alert.querySelector('svg')).not.toBeNull();
		expect(screen.getByText('POP3/IMAP-Abruf einschalten.')).toBeTruthy();
	});

	it('shows an error of the import and keeps the choice', async () => {
		setup(undefined, { kind: 'failed', message: 'Anmeldung bei Web.de abgelehnt.', hint: '' });
		await screen.findByText('Todo: Steuer');
		await fireEvent.click(screen.getByRole('button', { name: '2 Mails in den Eingang' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(
			/Anmeldung bei Web.de abgelehnt/
		);
		expect((row('Todo: Steuer').getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
	});

	it('loads more mails on request, says when the inbox is empty and closes with Escape', async () => {
		const { load, onclose } = setup({ kind: 'ok', value: [] });
		await screen.findByText('Der Posteingang ist leer.');
		await fireEvent.change(screen.getByLabelText('Anzahl'), { target: { value: '200' } });
		await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(200, expect.any(AbortSignal)));
		await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
		expect(onclose).toHaveBeenCalledOnce();
	});
});
