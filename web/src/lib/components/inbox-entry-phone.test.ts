// The entry, "Erfassen", the dialog of the clipboard and the files of the inbox in the phone frame
// (MO-6, ADR-0073 addendum MO-6) in jsdom with a controlled matchMedia: the entry is a page with the
// arrow back, "•••" with what is needed less often and only "Verwerfen" and "Umwandeln" in its
// footer; "Erfassen" gives the keyboard capital letters and the Enter key that fits, names no keys
// and keeps the focus in the field on a press of the button that saves; the dialog of the clipboard
// opens without a text to paste into; the files name only "Datei wählen". The counter-checks: on a
// PC with the switch on and on a phone with the switch off everything stays as before.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { CLIPBOARD_PASTE_MESSAGE } from '$lib/clipboard';
import type { InboxItem } from '$lib/domain/inbox';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import type { Capture, CaptureTarget, CaptureTemplate } from '$lib/domain/templates';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import type { CaptureSaveResult } from '$lib/stores/capture';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import CaptureForm from './CaptureForm.svelte';
import ClipboardImport from './ClipboardImport.svelte';
import DropZone from './DropZone.svelte';
import InboxPanel from './InboxPanel.svelte';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost:3000/eingang/item00000000001?quelle=mail') }
}));

useOverlayStubs();

const ID = 'item00000000001';

function entry(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		id: ID,
		channel: 'eml',
		kind: 'mail',
		title: 'Rechnung September',
		body: 'Bitte zahlen.',
		sourceUrl: 'https://shop.example.com/rechnung',
		sourceRef: '<a@b>',
		sourceDate: '2026-09-24 23:30:00.000Z',
		sourceMeta: { from: 'Shop <shop@example.com>' },
		original: 'mail_abc.eml',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

let stop: (() => void) | null = null;

/** The window of the test: narrow (a phone) or wide (a PC), with the switch on or off. */
function useWindow(narrow: boolean, enabled: boolean): void {
	vi.stubGlobal('matchMedia', (media: string) => ({
		matches: media === PHONE_QUERY ? narrow : false,
		media,
		addEventListener: () => undefined,
		removeEventListener: () => undefined
	}));
	stop = getMobileLayoutStore().connect();
	getMobileLayoutStore().choose(enabled);
}

function panel(item: InboxItem = entry()) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => []),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async () => item),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(async () => ({
			...item,
			state: 'discarded',
			handledAt: '2026-09-25 09:00:00.000Z',
			updated: '2026-09-25 09:00:00.000Z'
		})),
		restore: vi.fn<InboxData['restore']>(),
		assign: vi.fn<InboxData['assign']>(),
		originalUrl: vi.fn<InboxData['originalUrl']>(async () => null),
		importCalendar: vi.fn<InboxData['importCalendar']>(),
		savePage: vi.fn<InboxData['savePage']>()
	} satisfies InboxData;
	const sourcesData = {
		list: vi.fn<TicketSourcesData['list']>(async () => []),
		link: vi.fn<TicketSourcesData['link']>(),
		release: vi.fn<TicketSourcesData['release']>(),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
	} satisfies TicketSourcesData;
	const session = { ensureValid: () => true, logout: vi.fn() };
	const store = new InboxStore(data, session);
	const sources = new TicketSourcesStore(sourcesData, session);
	const onclose = vi.fn();
	const onback = vi.fn();
	render(InboxPanel, {
		props: {
			id: ID,
			store,
			openTickets: [],
			sources,
			onclose,
			backLabel: 'Zum Tagesplan',
			onback
		}
	});
	return { data, onclose, onback };
}

/** The page of the entry, its footer and the buttons and links of the footer. */
const page = () => within(screen.getByRole('complementary'));
const footer = () => screen.getByRole('complementary').querySelector('footer');
const footerActions = () => [...(footer()?.querySelectorAll<HTMLElement>('button, a') ?? [])];

beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

afterEach(() => {
	stop?.();
	stop = null;
	getMobileLayoutStore().choose(false);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('the entry as a page in the phone frame (MO-6)', () => {
	it('shows the arrow back, "•••" with what is needed less often and the main actions below', async () => {
		useWindow(true, true);
		const { onback, onclose } = panel();
		await screen.findByRole('heading', { name: 'Rechnung September' });

		const back = page().getByRole('button', { name: 'Zum Tagesplan' });
		expect(page().queryByRole('button', { name: 'Panel schließen' })).toBeNull();
		const more = page().getByRole('button', { name: 'Weitere Aktionen' });
		const menu = document.getElementById(more.getAttribute('aria-controls') ?? '') as HTMLElement;
		expect(
			within(menu)
				.getAllByRole('menuitem', { hidden: true })
				.map((item) => item.textContent?.trim())
		).toEqual(['Mit Ticket verknüpfen …', 'Originaldatei herunterladen', 'Schließen']);
		const actions = footerActions();
		expect(actions.map((action) => action.textContent?.trim())).toEqual(['Verwerfen', 'Umwandeln']);
		expect(actions.every((action) => action.classList.contains('entry-main'))).toBe(true);
		expect(actions[1]?.getAttribute('href')).toBe(`/tickets/neu?aus=${ID}`);

		await fireEvent.click(back);
		expect(onback).toHaveBeenCalledOnce();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('keeps "Wiederherstellen" for a discarded entry and no footer for a linked one', async () => {
		useWindow(true, true);
		panel(entry({ state: 'discarded', handledAt: '2026-09-26 10:00:00.000Z' }));
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(footerActions().map((action) => action.textContent?.trim())).toEqual([
			'Wiederherstellen'
		]);
		document.body.innerHTML = '';

		panel(
			entry({
				state: 'converted',
				ticketId: 'tick00000000001',
				ticket: { id: 'tick00000000001', key: 'HAUS-12', title: 'Rechnung', primary: true },
				original: ''
			})
		);
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(footer()).toBeNull();
		expect(page().queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
		expect(page().getByRole('link', { name: 'Ticket öffnen' })).toBeTruthy();
	});

	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'keeps the panel of the PC on %s: ×, every action in the footer, no "•••"',
		async (_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { onclose } = panel();
			await screen.findByRole('heading', { name: 'Rechnung September' });
			expect(page().queryByRole('button', { name: 'Zum Tagesplan' })).toBeNull();
			expect(page().queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
			const actions = footerActions();
			expect(actions.map((action) => action.textContent?.trim())).toEqual([
				'Originaldatei herunterladen',
				'Verwerfen',
				'Mit Ticket verknüpfen …',
				'Umwandeln'
			]);
			expect(actions.some((action) => action.classList.contains('entry-main'))).toBe(false);
			await fireEvent.click(page().getByRole('button', { name: 'Panel schließen' }));
			expect(onclose).toHaveBeenCalledOnce();
		}
	);
});

const SAVED: CaptureSaveResult = {
	ok: true,
	target: 'ticket',
	id: 'tick00000000001',
	message: 'Ticket TASK-3 angelegt.'
};

function captureForm(template: CaptureTemplate) {
	const onsave = vi.fn<(capture: Capture, target: CaptureTarget) => Promise<CaptureSaveResult>>(
		async () => SAVED
	);
	const onclose = vi.fn();
	render(CaptureForm, {
		props: {
			template,
			onsave,
			ontemplate: vi.fn(),
			onclose,
			backLabel: 'Zum Eingang',
			resultHref: (_target: CaptureTarget, id: string) => `/tickets/${id}` as ResolvedPathname
		}
	});
	return { onsave, onclose };
}

const field = (name: RegExp) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: /^(Ticket anlegen|In den Eingang)$/ });

describe('"Erfassen" in the phone frame (MO-6)', () => {
	it('gives the fields of prose capital letters and the Enter key "next" or "done"', () => {
		useWindow(true, true);
		captureForm('event');
		expect(field(/^Was\?/).getAttribute('autocapitalize')).toBe('sentences');
		expect(field(/^Was\?/).getAttribute('enterkeyhint')).toBe('next');
		expect(field(/^Ort/).getAttribute('autocapitalize')).toBe('sentences');
		expect(field(/^Ort/).getAttribute('enterkeyhint')).toBe('done');
		expect(field(/^Datum/).hasAttribute('autocapitalize')).toBe(false);
		document.body.innerHTML = '';

		captureForm('link');
		expect(field(/^Adresse/).getAttribute('enterkeyhint')).toBe('next');
		expect(field(/^Adresse/).hasAttribute('autocapitalize')).toBe(false);
		expect(field(/^Titel/).getAttribute('enterkeyhint')).toBe('done');
		expect(field(/^Auszug/).getAttribute('autocapitalize')).toBe('sentences');
		expect(field(/^Auszug/).hasAttribute('enterkeyhint')).toBe(false);
		document.body.innerHTML = '';

		captureForm('call');
		expect(field(/^Nummer/).hasAttribute('autocapitalize')).toBe(false);
		expect(field(/^Nummer/).getAttribute('enterkeyhint')).toBe('done');
	});

	it('names no keys, keeps the focus in the field on a press of "Ticket anlegen" and names the arrow', async () => {
		useWindow(true, true);
		const { onsave } = captureForm('todo');
		expect(screen.queryByText(/Strg\+Enter/)).toBeNull();
		expect(
			screen
				.getByRole('checkbox', { name: /In den Eingang statt/ })
				.hasAttribute('aria-describedby')
		).toBe(false);
		expect(screen.getByRole('button', { name: 'Zum Eingang' })).toBeTruthy();

		const what = field(/^Was\?/);
		what.focus();
		await fireEvent.input(what, { target: { value: 'Rasen mähen' } });
		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		submit().dispatchEvent(press);
		expect(press.defaultPrevented).toBe(true);
		await fireEvent.click(submit());
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledOnce());
		await tick();
		expect(document.activeElement).toBe(field(/^Was\?/));
	});

	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])('keeps the form of the PC on %s', (_name, narrow, enabled) => {
		useWindow(narrow, enabled);
		captureForm('event');
		expect(field(/^Was\?/).hasAttribute('autocapitalize')).toBe(false);
		expect(field(/^Was\?/).hasAttribute('enterkeyhint')).toBe(false);
		expect(
			screen.getByText('Tipp: Strg+Enter speichert, Alt+Enter legt in den Eingang.')
		).toBeTruthy();
		const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		submit().dispatchEvent(press);
		expect(press.defaultPrevented).toBe(false);
	});
});

describe('"Aus Zwischenablage" with the dialog to paste into (MO-6)', () => {
	it('opens without a text, says how to paste and shows no error while the field is empty', async () => {
		render(ClipboardImport, {
			props: { text: '', hint: CLIPBOARD_PASTE_MESSAGE, onsave: vi.fn(), onclose: vi.fn() }
		});
		const dialog = within(screen.getByRole('dialog', { name: 'Aus der Zwischenablage' }));
		expect(dialog.getByText(CLIPBOARD_PASTE_MESSAGE)).toBeTruthy();
		const area = dialog.getByLabelText<HTMLTextAreaElement>('Text');
		expect(area.value).toBe('');
		expect(area.getAttribute('aria-describedby')).toMatch(/hint/);
		expect(dialog.queryByText(/darf nicht leer|Kein Text/)).toBeNull();
		expect(screen.getByRole('dialog').querySelector('.field-error')).toBeNull();
		expect(
			dialog.getByRole('button', { name: 'In den Eingang' }).getAttribute('aria-disabled')
		).toBe('true');

		await fireEvent.input(area, { target: { value: 'Paket abholen' } });
		expect(dialog.getByText('Wird ein Eintrag: „Paket abholen“')).toBeTruthy();
	});
});

describe('the files of the inbox in the phone frame (MO-6)', () => {
	const props = {
		onfiles: vi.fn(),
		itemHref: (id: string) => `/eingang/${id}` as ResolvedPathname,
		ticketHref: (id: string) => `/tickets/${id}` as ResolvedPathname
	};

	it('names only "Datei wählen", not dragging', () => {
		useWindow(true, true);
		render(DropZone, { props });
		const zone = screen.getByRole('group', { name: 'Dateien übernehmen' });
		expect(zone.textContent).toContain('mit „Datei wählen“ übernehmen');
		expect(zone.textContent).not.toContain('hierher ziehen');
		expect(within(zone).getByRole('button', { name: 'Datei wählen' })).toBeTruthy();
	});

	it('keeps dragging in the hint outside the frame', () => {
		useWindow(false, true);
		render(DropZone, { props });
		expect(screen.getByRole('group', { name: 'Dateien übernehmen' }).textContent).toContain(
			'(.txt, .zip; je höchstens 20 MB) hierher ziehen. Bilder'
		);
	});
});
