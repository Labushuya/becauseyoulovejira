// Drop zone of the inbox (E4 plan, package 8): several files by drag and drop, "Datei wählen" for
// the keyboard, lock while an import runs, results per file with links and errors with icon.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { FileImportResult } from '$lib/stores/mail-import';
import DropZone from './DropZone.svelte';

function renderZone(props: Record<string, unknown> = {}) {
	const onfiles = vi.fn();
	render(DropZone, {
		props: {
			onfiles,
			itemHref: (id: string) => `/eingang/${id}` as ResolvedPathname,
			ticketHref: (id: string) => `/tickets/${id}` as ResolvedPathname,
			...props
		}
	});
	return { onfiles, zone: screen.getByRole('group', { name: 'Dateien übernehmen' }) };
}

function transfer(files: File[]) {
	return { types: ['Files'], files, dropEffect: 'none' };
}

const A = new File(['a'], 'a.eml');
const B = new File(['b'], 'b.eml');

describe('drop zone', () => {
	it('explains the limits and takes several dropped files at once', async () => {
		const { onfiles, zone } = renderZone();
		expect(zone.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			screen.getByText(
				/\(\.eml; über 25 MB ohne Originaldatei\), Kalenderdateien \(\.ics\) und\s+WhatsApp-Chatexporte \(\.txt, \.zip; je höchstens 20 MB\)/
			)
		).toBeTruthy();
		await fireEvent.dragOver(zone, { dataTransfer: transfer([A, B]) });
		expect(zone.classList.contains('active')).toBe(true);
		await fireEvent.drop(zone, { dataTransfer: transfer([A, B]) });
		expect(onfiles).toHaveBeenCalledWith([A, B]);
		expect(zone.classList.contains('active')).toBe(false);
	});

	it('ignores drags without files', async () => {
		const { onfiles, zone } = renderZone();
		await fireEvent.dragOver(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
		expect(zone.classList.contains('active')).toBe(false);
		await fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
		expect(onfiles).not.toHaveBeenCalled();
	});

	it('offers "Datei wählen" for the keyboard with several .eml, .ics and chat files', async () => {
		const { onfiles } = renderZone();
		const input = document.querySelector<HTMLInputElement>('input[type="file"]');
		expect(input?.multiple).toBe(true);
		expect(input?.accept).toBe('.eml,message/rfc822,.ics,text/calendar,.txt,.zip');
		const click = vi.spyOn(input as HTMLInputElement, 'click');
		await fireEvent.click(screen.getByRole('button', { name: 'Datei wählen' }));
		expect(click).toHaveBeenCalledOnce();
		Object.defineProperty(input, 'files', { value: [A], configurable: true });
		await fireEvent.change(input as HTMLInputElement);
		expect(onfiles).toHaveBeenCalledWith([A]);
	});

	it('takes nothing while an import runs', async () => {
		const { onfiles, zone } = renderZone({ busy: true });
		const button = screen.getByRole('button', { name: 'Wird übernommen …' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(zone.getAttribute('aria-busy')).toBe('true');
		await fireEvent.drop(zone, { dataTransfer: transfer([A]) });
		expect(onfiles).not.toHaveBeenCalled();
	});

	it('lists the result of each file with links and errors with icon', () => {
		const results: FileImportResult[] = [
			{ name: 'a.eml', kind: 'created', itemId: 'item00000000001', title: 'Rechnung' },
			{
				name: 'b.eml',
				kind: 'duplicate',
				message: 'Schon Ticket HAUS-2.',
				itemId: 'item00000000002',
				ticketId: 'tick00000000002'
			},
			{
				name: 'c.eml',
				kind: 'duplicate',
				message: 'Schon verworfen.',
				itemId: 'item00000000003',
				ticketId: ''
			},
			{ name: 'd.eml', kind: 'error', message: 'Die Datei ließ sich nicht als Mail lesen.' },
			{
				name: 'kalender.ics',
				kind: 'calendar',
				created: 3,
				duplicates: 1,
				skipped: 1,
				failed: 0,
				itemId: ''
			},
			{
				name: 'termin.ics',
				kind: 'calendar',
				created: 1,
				duplicates: 0,
				skipped: 0,
				failed: 0,
				itemId: 'item00000000005'
			}
		];
		renderZone({ results });
		const items = screen.getAllByRole('listitem');
		expect(items.map((entry) => entry.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'a.eml: neu – Rechnung',
			'b.eml: schon vorhanden (Schon Ticket HAUS-2.) Ticket ansehen',
			'c.eml: schon vorhanden (Schon verworfen.) Eintrag ansehen',
			'd.eml: Die Datei ließ sich nicht als Mail lesen.',
			'kalender.ics: 3 neu, 1 schon vorhanden, 1 übersprungen',
			'termin.ics: 1 neu Eintrag ansehen'
		]);
		expect(
			within(items[5] as HTMLElement)
				.getByRole('link')
				.getAttribute('href')
		).toBe('/eingang/item00000000005');
		expect(
			within(items[0] as HTMLElement)
				.getByRole('link')
				.getAttribute('href')
		).toBe('/eingang/item00000000001');
		expect(
			within(items[1] as HTMLElement)
				.getByRole('link')
				.getAttribute('href')
		).toBe('/tickets/tick00000000002');
		expect(items[3]?.querySelector('svg')).not.toBeNull();
		expect(items[0]?.closest('[aria-live="polite"]')).not.toBeNull();
	});
});
