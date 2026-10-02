// Ticket picker (ADR-0042) in jsdom: the list opens on focus without typing (recently viewed first,
// then by project), typing filters without case and umlaut dots, the keys of the APG combobox
// (arrows, Home, End, Enter, Escape), screen reader attributes and the live region, entries that
// cannot be chosen, "Mehr anzeigen", the chips "Nur offene" and "Projekt" with done tickets from
// the server. The list lies in the top layer (popover="manual"); jsdom counts it as hidden, so
// options are found with { hidden: true }.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { PICKER_REASONS, parentRules } from '$lib/domain/ticket-picker';
import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import TicketPicker from './TicketPicker.svelte';

useOverlayStubs();

const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };
const GARTEN: ProjectRef = {
	id: 'garten000000001',
	name: 'Garten',
	code: 'GART',
	archived: false,
	parent: { id: HAUS.id, name: 'Haus', code: 'HAUS' }
};

const APPLES = pickerTicket({
	key: 'GART-3',
	title: 'Äpfel ernten',
	projectId: GARTEN.id,
	status: 'in_progress',
	due: '2026-10-01'
});
const ROOF = pickerTicket({ key: 'HAUS-12', title: 'Dach prüfen', projectId: HAUS.id });
const TAX = pickerTicket({ key: 'TASK-4', title: 'Steuer 2025' });

function renderPicker(
	source: TicketPickerSource,
	props: Record<string, unknown> = {}
): { input: HTMLInputElement; onchoose: ReturnType<typeof vi.fn> } {
	const onchoose = vi.fn();
	render(TicketPicker, { props: { label: 'Ticket', source, onchoose, delay: 0, ...props } });
	return { input: screen.getByRole<HTMLInputElement>('combobox', { name: 'Ticket' }), onchoose };
}

/** The list; jsdom counts the popover as hidden, and a hidden element has no computed name. */
function listbox() {
	const list = screen.getByRole('listbox', { hidden: true });
	expect(list.getAttribute('aria-label')).toBe('Tickets');
	return list;
}

function options() {
	return within(listbox()).queryAllByRole('option', { hidden: true });
}

function optionKeys() {
	return options().map(
		(option) => option.querySelector('.key')?.textContent ?? option.textContent?.trim()
	);
}

/** The visible count next to the chips (the live region says the same after a pause). */
function count() {
	return document.querySelector('.count')?.textContent;
}

function optionOf(key: string) {
	return options().find(
		(option) => option.querySelector('.key')?.textContent === key
	) as HTMLElement;
}

function groupNames() {
	return within(listbox())
		.queryAllByRole('group', { hidden: true })
		.map((group) => group.getAttribute('aria-labelledby'))
		.map((id) => document.getElementById(id ?? '')?.textContent);
}

async function type(input: HTMLInputElement, value: string) {
	await fireEvent.input(input, { target: { value } });
}

describe('ticket picker', () => {
	it('opens on focus without typing: recently viewed first, then the open tickets by project', async () => {
		const many = Array.from({ length: 6 }, (_, index) =>
			pickerTicket({
				key: `HAUS-${20 + index}`,
				projectId: HAUS.id,
				updated: '2026-08-01 10:00:00.000Z'
			})
		);
		const { source, load } = fakePickerSource({
			open: [APPLES, ROOF, TAX, ...many],
			projects: [HAUS, GARTEN],
			recentIds: [TAX.id],
			openState: 'idle'
		});
		const { input } = renderPicker(source);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(input.getAttribute('aria-autocomplete')).toBe('list');
		expect(input.getAttribute('aria-controls')).toBe(listbox().id);

		await fireEvent.focus(input);
		expect(load).toHaveBeenCalledOnce();
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(listbox().matches(':popover-open')).toBe(true);
		expect(groupNames()).toEqual(['Zuletzt angesehen oder bearbeitet', 'Haus']);
		// The viewed one, then the most recently changed ones (the ID breaks ties).
		expect(optionKeys().slice(0, 5)).toEqual(['TASK-4', 'HAUS-12', 'GART-3', 'HAUS-25', 'HAUS-24']);
		expect(optionKeys()).toHaveLength(9);
		// The first entry is active; the keyboard stays in the field.
		expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]?.id);
		expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
		// Key, title, status and due date in every entry.
		const apples = optionOf('GART-3');
		expect(apples.textContent).toContain('Äpfel ernten');
		expect(apples.textContent).toContain('In Arbeit');
		expect(apples.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-01');
	});

	it('shows the groups of sub projects as "Haus › Garten"', async () => {
		const recent = Array.from({ length: 5 }, () =>
			pickerTicket({ updated: '2026-09-20 10:00:00.000Z' })
		);
		const { source } = fakePickerSource({ open: [...recent, APPLES], projects: [HAUS, GARTEN] });
		const { input } = renderPicker(source);
		await fireEvent.click(input);
		expect(groupNames()).toEqual(['Zuletzt angesehen oder bearbeitet', 'Haus › Garten']);
	});

	it('shows the color of every ticket as a short bar, named after the title (ADR-0052)', async () => {
		const house: ProjectRef = { ...HAUS, color: 'blau' };
		const garden: ProjectRef = {
			...GARTEN,
			color: null,
			parent: { ...GARTEN.parent!, color: 'blau' }
		};
		const own = pickerTicket({
			key: 'HAUS-20',
			title: 'Fenster',
			projectId: HAUS.id,
			color: 'oliv'
		});
		const plain = pickerTicket({ key: 'TASK-21', title: 'Ohne' });
		const { source } = fakePickerSource({ open: [APPLES, own, plain], projects: [house, garden] });
		const { input } = renderPicker(source);
		await fireEvent.click(input);
		const option = (key: string) =>
			options().find((entry) => entry.querySelector('.key')?.textContent === key) as HTMLElement;
		const bar = (key: string) => option(key).querySelector<HTMLElement>('.color-mark.stripe');
		expect(bar('GART-3')?.getAttribute('title')).toBe('Farbe Blau, vom Oberprojekt „Haus“');
		expect(bar('GART-3')?.getAttribute('aria-hidden')).toBe('true');
		// The name follows the title in the text of the option.
		const named = (key: string) =>
			option(key).querySelector('.title ~ .visually-hidden')?.textContent;
		expect(named('GART-3')).toBe(', Farbe Blau, vom Oberprojekt „Haus“');
		expect(bar('HAUS-20')?.dataset.color).toBe('oliv');
		expect(named('HAUS-20')).toBe(', Farbe Oliv');
		expect(bar('TASK-21')).toBeNull();
	});

	it('filters over key and title without case and umlaut dots, several words with AND', async () => {
		const pears = pickerTicket({ key: 'GART-4', title: 'Birnen ernten', projectId: GARTEN.id });
		const { source } = fakePickerSource({
			open: [APPLES, ROOF, TAX, pears],
			projects: [HAUS, GARTEN]
		});
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		await type(input, 'äpfel');
		expect(optionKeys()).toEqual(['GART-3']);
		await type(input, 'APFEL');
		expect(optionKeys()).toEqual(['GART-3']);
		await type(input, 'ernten gart');
		expect(optionKeys().sort()).toEqual(['GART-3', 'GART-4']);
		await type(input, 'ernten birnen');
		expect(optionKeys()).toEqual(['GART-4']);
		await type(input, 'haus-12');
		expect(optionKeys()).toEqual(['HAUS-12']);
		await type(input, 'gibt es nicht');
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(count()).toBe('Kein Ticket gefunden.');
	});

	it('moves with the arrows, Home and End, chooses with Enter and consumes Escape twice', async () => {
		const { source } = fakePickerSource({ open: [APPLES, ROOF, TAX], projects: [HAUS, GARTEN] });
		const { input, onchoose } = renderPicker(source);
		await fireEvent.focus(input);
		const ids = options().map((option) => option.id);
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input.getAttribute('aria-activedescendant')).toBe(ids[1]);
		await fireEvent.keyDown(input, { key: 'End' });
		expect(input.getAttribute('aria-activedescendant')).toBe(ids.at(-1));
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		expect(input.getAttribute('aria-activedescendant')).toBe(ids[0]);
		await fireEvent.keyDown(input, { key: 'ArrowUp' });
		expect(input.getAttribute('aria-activedescendant')).toBe(ids.at(-1));
		await fireEvent.keyDown(input, { key: 'Home' });
		expect(input.getAttribute('aria-activedescendant')).toBe(ids[0]);
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		const second = options()[1]?.querySelector('.key')?.textContent;
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onchoose).toHaveBeenCalledOnce();
		const picked = onchoose.mock.calls[0]?.[0] as TicketSummary;
		expect(picked.key).toBe(second);
		expect(input.value).toBe(`${picked.key} ${picked.title}`);
		expect(input.getAttribute('aria-expanded')).toBe('false');

		// Escape: first the list, then the text; both stay inside the picker.
		const outside = vi.fn();
		document.addEventListener('keydown', outside);
		try {
			await fireEvent.click(input);
			expect(input.getAttribute('aria-expanded')).toBe('true');
			// After a choice the whole list shows again, with the chosen one marked.
			expect(options()).toHaveLength(3);
			expect(screen.getByText('(gewählt)')).toBeTruthy();
			await fireEvent.keyDown(input, { key: 'Escape' });
			expect(input.getAttribute('aria-expanded')).toBe('false');
			await fireEvent.keyDown(input, { key: 'Escape' });
			expect(input.value).toBe('');
			expect(outside).not.toHaveBeenCalled();
			await fireEvent.keyDown(input, { key: 'Escape' });
			expect(outside).toHaveBeenCalledOnce();
		} finally {
			document.removeEventListener('keydown', outside);
		}
	});

	it('leaves Home and End to the text while typing, until an arrow enters the list', async () => {
		const { source } = fakePickerSource({ open: [APPLES, ROOF, TAX] });
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		await type(input, 'e');
		const first = input.getAttribute('aria-activedescendant');
		const home = new KeyboardEvent('keydown', { key: 'End', cancelable: true, bubbles: true });
		input.dispatchEvent(home);
		expect(home.defaultPrevented).toBe(false);
		expect(input.getAttribute('aria-activedescendant')).toBe(first);
		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'End' });
		expect(input.getAttribute('aria-activedescendant')).toBe(options().at(-1)?.id);
	});

	it('chooses with the mouse and prefers the typed key', async () => {
		const other = pickerTicket({ key: 'HAUS-120', title: 'Dach streichen', projectId: HAUS.id });
		const { source } = fakePickerSource({ open: [other, ROOF], projects: [HAUS] });
		const { input, onchoose } = renderPicker(source);
		await fireEvent.focus(input);
		await type(input, 'haus-12');
		const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
		expect(active?.querySelector('.key')?.textContent).toBe('HAUS-12');
		await fireEvent.click(optionOf('HAUS-120'));
		expect(onchoose).toHaveBeenCalledWith(other);
		expect(input.value).toBe('HAUS-120 Dach streichen');
	});

	it('keeps entries that cannot be chosen visible, greyed with the reason, and hides the ticket itself', async () => {
		const self = pickerTicket({ key: 'HAUS-1', title: 'Selbst', projectId: HAUS.id });
		const child = pickerTicket({
			key: 'HAUS-2',
			title: 'Kind',
			projectId: HAUS.id,
			parentId: ROOF.id
		});
		const { source } = fakePickerSource({ open: [self, child, ROOF], projects: [HAUS] });
		const { input, onchoose } = renderPicker(source, { rules: parentRules(self) });
		await fireEvent.focus(input);
		expect(optionKeys().sort()).toEqual(['HAUS-12', 'HAUS-2']);
		const blocked = optionOf('HAUS-2');
		expect(blocked.getAttribute('aria-disabled')).toBe('true');
		expect(optionOf('HAUS-12').getAttribute('aria-disabled')).toBeNull();
		expect(blocked.textContent).toContain(`Nicht wählbar: ${PICKER_REASONS.isSubtask}`);
		// The first choosable entry is active, a click on the blocked one chooses nothing.
		expect(
			document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent
		).toContain('HAUS-12');
		await fireEvent.click(blocked);
		expect(onchoose).not.toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(screen.getByText(`HAUS-2 ist nicht wählbar: ${PICKER_REASONS.isSubtask}`)).toBeTruthy()
		);
	});

	it('shows 25 entries and adds more with "Mehr anzeigen"', async () => {
		const open = Array.from({ length: 40 }, (_, index) =>
			pickerTicket({ key: `HAUS-${100 + index}`, projectId: HAUS.id })
		);
		const { source } = fakePickerSource({ open, projects: [HAUS] });
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		expect(options()).toHaveLength(26);
		const more = options().at(-1) as HTMLElement;
		expect(more.textContent?.trim()).toBe('Mehr anzeigen');
		expect(count()).toBe('25 von 40 Tickets angezeigt.');
		await fireEvent.keyDown(input, { key: 'End' });
		expect(input.getAttribute('aria-activedescendant')).toBe(more.id);
		await fireEvent.keyDown(input, { key: 'Enter' });
		await vi.waitFor(() => expect(options()).toHaveLength(40));
		expect(count()).toBe('40 Tickets.');
		// The first new entry is active.
		expect(input.getAttribute('aria-activedescendant')).toBe(options()[25]?.id);
	});

	it('loads done tickets from the server without "Nur offene" and pages them', async () => {
		const done = Array.from({ length: 25 }, (_, index) =>
			pickerTicket({ key: `ALT-${index + 1}`, title: `Straße ${index + 1}`, status: 'done' })
		);
		const { source, listDone } = fakePickerSource({ open: [ROOF], done, projects: [HAUS] });
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		const chip = screen.getByRole('button', { name: 'Nur offene' });
		expect(chip.getAttribute('aria-pressed')).toBe('true');
		expect(listDone).not.toHaveBeenCalled();

		await fireEvent.click(chip);
		expect(chip.getAttribute('aria-pressed')).toBe('false');
		await vi.waitFor(() => expect(groupNames()).toContain('Erledigt'));
		expect(listDone).toHaveBeenCalledWith(
			{ patterns: [], project: null, withSubProjects: false },
			1,
			{ signal: expect.any(AbortSignal) }
		);

		await type(input, 'straße');
		await vi.waitFor(() =>
			expect(listDone).toHaveBeenLastCalledWith(
				{ patterns: ['%_tr_%_%'], project: null, withSubProjects: false },
				1,
				expect.anything()
			)
		);
		await vi.waitFor(() => expect(options()).toHaveLength(21));
		expect(count()).toBe('20 von mehr als 20 Tickets angezeigt.');
		await fireEvent.click(options().at(-1) as HTMLElement);
		await vi.waitFor(() => expect(options()).toHaveLength(25));
		expect(listDone).toHaveBeenLastCalledWith(expect.anything(), 2, expect.anything());

		await fireEvent.click(chip);
		expect(groupNames()).not.toContain('Erledigt');
	});

	it('narrows by project with its sub projects and says so in the title of the select', async () => {
		const { source } = fakePickerSource({
			open: [APPLES, ROOF, TAX],
			projects: [HAUS, GARTEN],
			subProjects: { [HAUS.id]: [GARTEN.id] }
		});
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Projekt' });
		expect([...select.options].map((option) => option.textContent)).toEqual([
			'Alle',
			'Haus (HAUS)',
			'Haus › Garten (GART)',
			'Ohne Projekt'
		]);
		await fireEvent.change(select, { target: { value: HAUS.id } });
		expect(optionKeys().sort()).toEqual(['GART-3', 'HAUS-12']);
		expect(select.title).toBe('Haus (HAUS)');
		await fireEvent.change(select, { target: { value: 'ohne' } });
		expect(optionKeys()).toEqual(['TASK-4']);
		expect(input.getAttribute('aria-expanded')).toBe('true');
	});

	it('marks new tickets, names the keys and announces the hits after a pause', async () => {
		vi.useFakeTimers();
		try {
			const { source } = fakePickerSource({ open: [ROOF, TAX], newIds: [TAX.id] });
			const { input } = renderPicker(source, { hint: 'Aus der Liste wählen' });
			const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
			expect(described.map((id) => document.getElementById(id)?.textContent?.trim())).toEqual([
				'Aus der Liste wählen',
				expect.stringContaining('Pfeiltasten wählen aus')
			]);
			await fireEvent.focus(input);
			const tax = options().find((option) => option.textContent?.includes('TASK-4')) as HTMLElement;
			expect(tax.textContent).toContain('Neu:');
			const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
			expect(live.textContent).toBe('');
			await vi.advanceTimersByTimeAsync(600);
			expect(live.textContent).toBe('2 Tickets.');
			await type(input, 'steuer');
			await vi.advanceTimersByTimeAsync(600);
			expect(live.textContent).toBe('1 Ticket.');
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the focus in the field on a press into the list and closes when the focus leaves', async () => {
		const { source } = fakePickerSource({ open: [ROOF, TAX] });
		const { input } = renderPicker(source);
		await fireEvent.focus(input);
		// The list stays out of the tab order, a press into it (scroll bar, heading) keeps the focus.
		expect(listbox().getAttribute('tabindex')).toBe('-1');
		expect(await fireEvent.mouseDown(listbox())).toBe(false);
		expect(await fireEvent.mouseDown(optionOf('TASK-4'))).toBe(false);
		// Moving to a chip keeps the list, leaving the picker closes it.
		const chip = screen.getByRole('button', { name: 'Nur offene' });
		await fireEvent.focusOut(input, { relatedTarget: chip });
		expect(input.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.focusOut(input, { relatedTarget: document.body });
		expect(input.getAttribute('aria-expanded')).toBe('false');
	});

	it('says while the open tickets load', () => {
		renderPicker(fakePickerSource({ openState: 'loading' }).source);
		expect(count()).toBe('Tickets werden geladen …');
	});

	it('says when loading failed and tries again on opening', async () => {
		const { source, load } = fakePickerSource({ openState: 'error' });
		const { input } = renderPicker(source);
		expect(count()).toBe('Die offenen Tickets konnten nicht geladen werden.');
		await fireEvent.focus(input);
		expect(load).toHaveBeenCalledOnce();
	});
});
