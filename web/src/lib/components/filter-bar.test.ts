// Component tests for the filter bar (E3 plan, T-6 and package 10): chip groups as fieldset with
// radio inputs, the choices "Projekt" and "Tag" from the catalog (since UI-9 popovers of the
// overlay system instead of native selects), "Zurücksetzen", and the state in the URL (each change
// navigates with the new query; view settings stay). SvelteKit navigation and page state are
// mocked; the catalog runs for real on a fake data layer, the shared stubs stand in for the
// popover API (jsdom counts every popover as hidden, hence { hidden: true }).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FilterBar from './FilterBar.svelte';
import filterBarSource from './FilterBar.svelte?raw';
import source from './FilterPopover.svelte?raw';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const UPDATED = '2026-09-01 10:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: UPDATED
};
const OLD: Project = {
	id: 'proj00000000002',
	name: 'Umzug',
	code: 'UMZ',
	archived: true,
	updated: UPDATED
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: UPDATED };

async function showBar(path = '/', tags: Tag[] = [GARDEN]) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE, OLD]),
			listTags: vi.fn(async () => tags),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	return render(FilterBar, { props: { catalog } });
}

/** Target of the last navigation as path plus query. */
function lastTarget(): string {
	const call = mocks.goto.mock.calls.at(-1) as unknown[] | undefined;
	return String(call?.[0]);
}

function group(name: string) {
	return screen.getByRole('group', { name });
}

/** Button of a filter popover, found by the start of its name ("Projekt: Alle"). */
function toggle(legend: string) {
	return screen.getByRole('button', { name: new RegExp(`^${legend}:`) });
}

/** Fieldset in the popover of a choice (always "hidden" for jsdom). */
function choices(legend: string) {
	const popover = document.getElementById(String(toggle(legend).getAttribute('aria-controls')));
	return within(popover as HTMLElement).getByRole('group', { hidden: true, name: legend });
}

function choiceLabels(legend: string) {
	return within(choices(legend))
		.getAllByRole('radio', { hidden: true })
		.map((radio) => radio.closest('label')?.textContent?.trim());
}

function radio(legend: string, name: string) {
	return within(choices(legend)).getByRole<HTMLInputElement>('radio', { hidden: true, name });
}

async function open(legend: string) {
	await fireEvent.click(toggle(legend));
	await tick();
	await tick();
}

const isOpen = (legend: string) =>
	document
		.getElementById(String(toggle(legend).getAttribute('aria-controls')))
		?.matches(':popover-open');

beforeEach(() => {
	mocks.goto.mockClear();
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('filter bar', () => {
	it('shows the chip groups as fieldsets with radio inputs, "Alle" chosen', async () => {
		await showBar();

		expect(screen.getByRole('region', { name: 'Filter' })).toBeTruthy();
		const status = within(group('Status'));
		expect(
			status.getAllByRole('radio').map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Backlog', 'Offen', 'In Arbeit', 'Wartet', 'Erledigt']);
		expect(status.getByRole('radio', { name: 'Alle' })).toHaveProperty('checked', true);
		expect(
			within(group('Priorität'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Dringend', 'Hoch', 'Mittel', 'Niedrig']);
		expect(
			within(group('Fällig'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Überfällig', 'Heute', 'Bald', 'Ohne Datum']);
	});

	it.each([
		['Status', 'In Arbeit', '/?status=in_progress'],
		['Status', 'Erledigt', '/?status=done'],
		['Priorität', 'Dringend', '/?prio=urgent'],
		['Fällig', 'Überfällig', '/?faellig=ueberfaellig'],
		['Fällig', 'Bald', '/?faellig=bald'],
		['Fällig', 'Ohne Datum', '/?faellig=ohne']
	])('group %s, chip %s sets %s', async (legend, chip, target) => {
		await showBar();

		await fireEvent.click(within(group(legend)).getByRole('radio', { name: chip }));

		expect(mocks.goto).toHaveBeenCalledOnce();
		expect(lastTarget()).toBe(target);
		expect(mocks.goto).toHaveBeenCalledWith(target, { keepFocus: true, noScroll: true });
	});

	it('marks the chosen chip and removes the parameter with "Alle"', async () => {
		await showBar('/?prio=high&faellig=heute');

		const priority = within(group('Priorität'));
		const high = priority.getByRole('radio', { name: 'Hoch' });
		expect(high).toHaveProperty('checked', true);
		expect(high.parentElement?.querySelector('svg')).not.toBeNull();

		await fireEvent.click(priority.getByRole('radio', { name: 'Alle' }));
		expect(lastTarget()).toBe('/?faellig=heute');
	});

	it('keeps the panel path and unknown parameters when filtering', async () => {
		await showBar('/tickets/abc123def456ghi?x=1&erledigte=1');

		await fireEvent.click(within(group('Status')).getByRole('radio', { name: 'Offen' }));

		expect(lastTarget()).toBe('/tickets/abc123def456ghi?x=1&status=open&erledigte=1');
	});

	it('offers the projects in a popover with "Ohne Projekt" and the archived ones in their own group', async () => {
		await showBar('/?projekt=ohne');

		const button = toggle('Projekt');
		expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Projekt: Ohne Projekt');
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		const popover = document.getElementById(String(button.getAttribute('aria-controls')));
		expect(popover?.getAttribute('popover')).toBe('auto');
		expect(screen.queryByRole('combobox', { name: 'Projekt' })).toBeNull();
		expect(choiceLabels('Projekt')).toEqual([
			'Alle',
			'Ohne Projekt',
			'Haushalt (HAUS)',
			'Umzug (UMZ)'
		]);
		expect(
			within(choices('Projekt')).getByRole('group', { hidden: true, name: 'Archiviert' })
				.textContent
		).toContain('Umzug (UMZ)');
		expect(radio('Projekt', 'Ohne Projekt').checked).toBe(true);
		// No search field below 10 entries.
		expect(within(choices('Projekt')).queryByRole('searchbox', { hidden: true })).toBeNull();

		await open('Projekt');
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(radio('Projekt', 'Ohne Projekt'));
		await fireEvent.click(radio('Projekt', 'Haushalt (HAUS)'), { detail: 1 });
		expect(lastTarget()).toBe(`/?projekt=${HOUSE.id}`);
		expect(isOpen('Projekt')).toBe(false);
	});

	it('chooses like "Gruppieren": arrows apply and stay open, Enter closes, Escape returns the focus', async () => {
		await showBar();
		await open('Tag');

		const garden = radio('Tag', 'Garten');
		await fireEvent.click(garden);
		expect(lastTarget()).toBe(`/?tag=${GARDEN.id}`);
		expect(isOpen('Tag')).toBe(true);

		const enter = await fireEvent.keyDown(garden, { key: 'Enter' });
		expect(enter).toBe(false);
		expect(isOpen('Tag')).toBe(false);
		expect(document.activeElement).toBe(toggle('Tag'));

		await open('Tag');
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		(document.activeElement as HTMLElement).dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(true);
		expect(isOpen('Tag')).toBe(false);
		expect(document.activeElement).toBe(toggle('Tag'));
	});

	it('removes the parameter with "Alle" and shows the chosen tag in the button', async () => {
		await showBar(`/?tag=${GARDEN.id}&faellig=heute`);

		const button = toggle('Tag');
		expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Tag: Garten');
		expect(button.classList.contains('active')).toBe(true);
		expect(toggle('Projekt').classList.contains('active')).toBe(false);
		await open('Tag');
		await fireEvent.click(radio('Tag', 'Alle'), { detail: 1 });
		expect(lastTarget()).toBe('/?faellig=heute');
	});

	it('shows an unknown project or tag of the URL as chosen', async () => {
		await showBar('/?projekt=zzzzzzzzzzzzzzz&tag=yyyyyyyyyyyyyyy');

		expect(toggle('Projekt').textContent?.replace(/\s+/g, ' ').trim()).toBe('Projekt: Unbekannt');
		expect(toggle('Tag').textContent?.replace(/\s+/g, ' ').trim()).toBe('Tag: Unbekannt');
		expect(radio('Projekt', 'Unbekannt').checked).toBe(true);
		expect(radio('Tag', 'Unbekannt').value).toBe('yyyyyyyyyyyyyyy');
	});

	it('offers a search field from 10 entries, which narrows the list and takes the first match', async () => {
		const tags: Tag[] = [
			'Arbeit',
			'Auto',
			'Bank',
			'Einkauf',
			'Garten',
			'Gesundheit',
			'Haushalt',
			'Kinder',
			'Reise',
			'Steuer'
		].map((name, index) => ({
			id: `tag0000000000${String(index).padStart(2, '0')}`,
			name,
			updated: UPDATED
		}));
		await showBar('/', tags);
		await open('Tag');

		const search = within(choices('Tag')).getByRole<HTMLInputElement>('searchbox', {
			hidden: true,
			name: 'Tag suchen'
		});
		expect(document.activeElement).toBe(search);
		await fireEvent.input(search, { target: { value: 'ge' } });
		expect(choiceLabels('Tag')).toEqual(['Alle', 'Gesundheit']);
		await fireEvent.input(search, { target: { value: 'xyz' } });
		expect(choiceLabels('Tag')).toEqual(['Alle']);
		expect(within(choices('Tag')).getByText('Keine Treffer.')).toBeTruthy();

		await fireEvent.input(search, { target: { value: 'au' } });
		expect(choiceLabels('Tag')).toEqual(['Alle', 'Auto', 'Einkauf', 'Haushalt']);
		await fireEvent.keyDown(search, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(radio('Tag', 'Alle'));
		search.focus();
		await fireEvent.keyDown(search, { key: 'Enter' });
		expect(lastTarget()).toBe('/?tag=tag000000000001');
		expect(isOpen('Tag')).toBe(false);
	});

	it('has no native select any more and uses the popover building block', () => {
		expect(filterBarSource).not.toMatch(/<select\b/);
		expect(filterBarSource).toMatch(/import FilterPopover from '\.\/FilterPopover\.svelte';/);
		expect(source).toMatch(/import Popover from '\.\/overlay\/Popover\.svelte';/);
		expect(source).toMatch(/kind="panel"/);
	});

	it('resets the filters but keeps sort, grouping and the switch', async () => {
		await showBar(
			`/?status=open&prio=urgent&faellig=heute&projekt=${HOUSE.id}&tag=${GARDEN.id}&sort=-titel&gruppe=prio&erledigte=1`
		);

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(reset);

		expect(lastTarget()).toBe('/?sort=-titel&gruppe=prio&erledigte=1');
	});

	it('resets the filter cards as well, back to "Alle offenen" (FI-1)', async () => {
		await showBar('/?karte=heute&karte=dringend&gruppe=prio');

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(reset);

		expect(lastTarget()).toBe('/?gruppe=prio');
	});

	it('keeps the chosen cards while a chip changes (FI-1)', async () => {
		await showBar('/?karte=in-arbeit&karte=dringend');

		await fireEvent.click(within(group('Priorität')).getByRole('radio', { name: 'Hoch' }));

		expect(lastTarget()).toBe('/?karte=in-arbeit&karte=dringend&prio=high');
	});

	it('locks "Zurücksetzen" without a filter', async () => {
		await showBar('/?sort=titel');

		const reset = screen.getByRole('button', { name: 'Zurücksetzen' });
		expect(reset.getAttribute('aria-disabled')).toBe('true');
		expect(reset.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(String(reset.getAttribute('aria-describedby')))?.textContent
		).toBe('Kein Filter gesetzt.');
		await fireEvent.click(reset);
		expect(mocks.goto).not.toHaveBeenCalled();
	});

	it('moves within a chip group with the arrow keys of the radio inputs', async () => {
		await showBar();

		const radios = within(group('Status')).getAllByRole('radio') as HTMLInputElement[];
		// Native radio inputs of one name form one tab stop; the browser moves with the arrows.
		expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
		expect(radios.every((radio) => radio.type === 'radio' && radio.tabIndex === 0)).toBe(true);
		const names = new Set(
			(screen.getAllByRole('radio') as HTMLInputElement[]).map((radio) => radio.name)
		);
		// Status, Priorität, Fällig, Quelle and Wiederkehrend (plan OR-2).
		expect(names.size).toBe(5);
	});
});

describe('filter bar: search (E3 plan, package 11)', () => {
	async function showSearch(path = '/', props: Record<string, unknown> = {}) {
		mocks.page.url = new URL(path, 'http://localhost:3000');
		const catalog = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			SESSION
		);
		await catalog.load();
		render(FilterBar, { props: { catalog, ...props } });
		return screen.getByRole<HTMLInputElement>('searchbox', { name: 'Suche' });
	}

	it('is a search field with a label, placeholder, limit and the hint on two characters', async () => {
		const field = await showSearch('/?q=Miete');

		expect(field.type).toBe('search');
		expect(field.placeholder).toBe('Titel, Beschreibung oder Key');
		expect(field.maxLength).toBe(200);
		expect(field.value).toBe('Miete');
		expect(field.getAttribute('aria-busy')).toBe('false');
		expect(
			document.getElementById(String(field.getAttribute('aria-describedby')))?.textContent?.trim()
		).toBe('Die Suche beginnt ab 2 Zeichen.');
	});

	it('writes the text into the URL and replaces the history entry', async () => {
		const field = await showSearch('/tickets/abc123def456ghi?status=open&sort=titel');

		await fireEvent.input(field, { target: { value: 'Miete' } });

		expect(mocks.goto).toHaveBeenCalledExactlyOnceWith(
			'/tickets/abc123def456ghi?status=open&q=Miete&sort=titel',
			{ replaceState: true, keepFocus: true, noScroll: true }
		);
		expect(field.value).toBe('Miete');
	});

	it('empties a field that is not empty with Escape and leaves Escape alone otherwise', async () => {
		const field = await showSearch('/?q=Miete');
		const outside = vi.fn();
		document.addEventListener('keydown', outside);

		await fireEvent.keyDown(field, { key: 'Escape' });
		expect(lastTarget()).toBe('/');
		expect(outside).not.toHaveBeenCalled();

		mocks.goto.mockClear();
		field.value = '';
		await fireEvent.keyDown(field, { key: 'Escape' });
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(outside).toHaveBeenCalledOnce();
		document.removeEventListener('keydown', outside);
	});

	it('shows aria-busy while the search waits', async () => {
		const field = await showSearch('/?q=Miete', { searchBusy: true });

		expect(field.getAttribute('aria-busy')).toBe('true');
	});

	it('shows a failure with "Erneut versuchen" and says that the table shows no search', async () => {
		const onretrysearch = vi.fn();
		const field = await showSearch('/?q=Miete', {
			searchError: 'Server nicht erreichbar.',
			onretrysearch
		});

		const alert = screen.getByRole('alert');
		expect(alert.classList.contains('alert-error')).toBe(true);
		expect(alert.textContent).toMatch(
			'Die Suche ist fehlgeschlagen. Server nicht erreichbar. Die Tabelle zeigt die Tickets ohne Suche.'
		);
		expect(field.getAttribute('aria-describedby')?.split(' ')[0]).toBe(alert.id);
		await fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
		expect(onretrysearch).toHaveBeenCalledOnce();
	});

	it('clears the search with "Zurücksetzen"', async () => {
		await showSearch('/?q=Miete&gruppe=status');

		await fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));

		expect(lastTarget()).toBe('/?gruppe=status');
	});
});

describe('filter bar: sub projects (ADR-0034, UP-5)', () => {
	const GARDEN_PROJECT: Project = {
		id: 'proj00000000011',
		name: 'Garten',
		code: 'GART',
		archived: false,
		updated: UPDATED,
		parentId: HOUSE.id
	};
	const CAR: Project = {
		id: 'proj00000000003',
		name: 'Auto',
		code: 'AUTO',
		archived: false,
		updated: UPDATED
	};

	async function showTree(path: string) {
		mocks.page.url = new URL(path, 'http://localhost:3000');
		const catalog = new CatalogStore(
			{
				listProjects: vi.fn(async () => [HOUSE, OLD, GARDEN_PROJECT, CAR]),
				listTags: vi.fn(async () => [GARDEN]),
				createTag: vi.fn()
			},
			SESSION
		);
		await catalog.load();
		return render(FilterBar, { props: { catalog } });
	}

	const subProjects = () =>
		within(
			document.getElementById(
				String(toggle('Projekt').getAttribute('aria-controls'))
			) as HTMLElement
		).getByRole<HTMLInputElement>('checkbox', { hidden: true, name: 'Unterprojekte einbeziehen' });

	it('offers the projects in tree order with the path of a sub project', async () => {
		await showTree('/');
		expect(choiceLabels('Projekt')).toEqual([
			'Alle',
			'Ohne Projekt',
			'Auto (AUTO)',
			'Haushalt (HAUS)',
			'Haushalt › Garten (GART)',
			'Umzug (UMZ)'
		]);
	});

	it('takes the sub projects in by default and switches them off in the URL', async () => {
		await showTree(`/?projekt=${HOUSE.id}`);
		expect(subProjects().checked).toBe(true);
		expect(subProjects().hasAttribute('aria-disabled')).toBe(false);
		const hint = document.getElementById(String(subProjects().getAttribute('aria-describedby')));
		expect(hint?.textContent?.trim()).toBe('1 Unterprojekt: Garten');

		await fireEvent.click(subProjects());
		expect(lastTarget()).toBe(`/?projekt=${HOUSE.id}&unterprojekte=0`);

		document.body.innerHTML = '';
		await showTree(`/?projekt=${HOUSE.id}&unterprojekte=0`);
		expect(subProjects().checked).toBe(false);
		expect(toggle('Projekt').textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Projekt: Haushalt (HAUS), ohne Unterprojekte'
		);
		await fireEvent.click(subProjects());
		expect(lastTarget()).toBe(`/?projekt=${HOUSE.id}`);
	});

	it('locks the checkbox without sub projects and takes them in again for another project', async () => {
		await showTree(`/?projekt=${CAR.id}&unterprojekte=0`);
		expect(subProjects().getAttribute('aria-disabled')).toBe('true');
		const hint = document.getElementById(String(subProjects().getAttribute('aria-describedby')));
		expect(hint?.textContent?.trim()).toBe('Das gewählte Projekt hat keine Unterprojekte.');
		await fireEvent.click(subProjects());
		expect(mocks.goto).not.toHaveBeenCalled();

		await open('Projekt');
		await fireEvent.click(radio('Projekt', 'Haushalt (HAUS)'), { detail: 1 });
		expect(lastTarget()).toBe(`/?projekt=${HOUSE.id}`);
	});
});

describe('filter bar: source (E4 plan, package 9; ADR-0019 section 2)', () => {
	it('offers the chip group "Quelle" after "Fällig", with Notion since its import (ADR-0041) and GitHub (ADR-0050), then folders (ADR-0051)', async () => {
		await showBar();
		const legends = screen
			.getAllByRole('group')
			.map((entry) => entry.querySelector('legend')?.textContent);
		expect(legends.indexOf('Quelle')).toBe(legends.indexOf('Fällig') + 1);
		expect(
			within(group('Quelle'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual([
			'Alle',
			'Manuell',
			'Web-Link',
			'Mail',
			'Kalender',
			'Chat',
			'Notion',
			'GitHub',
			'Ordner'
		]);
	});

	it.each([
		['Manuell', '/?quelle=manuell'],
		['Mail', '/?quelle=mail'],
		['Kalender', '/?quelle=kalender'],
		['Chat', '/?quelle=chat']
	])('chip %s sets %s', async (chip, target) => {
		await showBar();
		await fireEvent.click(within(group('Quelle')).getByRole('radio', { name: chip }));
		expect(lastTarget()).toBe(target);
	});

	it('shows the source of the URL and clears it with "Zurücksetzen"', async () => {
		await showBar('/?faellig=heute&quelle=link&gruppe=quelle');
		expect(within(group('Quelle')).getByRole('radio', { name: 'Web-Link' })).toHaveProperty(
			'checked',
			true
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
		expect(lastTarget()).toBe('/?gruppe=quelle');
	});
});

describe('filter bar: recurring (plan OR-2)', () => {
	it('offers "Wiederkehrend" after "Quelle" with "Alle", "Nur wiederkehrende", "Nur einmalige"', async () => {
		await showBar();
		const legends = screen
			.getAllByRole('group')
			.map((entry) => entry.querySelector('legend')?.textContent);
		expect(legends.indexOf('Wiederkehrend')).toBe(legends.indexOf('Quelle') + 1);
		expect(
			within(group('Wiederkehrend'))
				.getAllByRole('radio')
				.map((radio) => radio.parentElement?.textContent?.trim())
		).toEqual(['Alle', 'Nur wiederkehrende', 'Nur einmalige']);
		expect(within(group('Wiederkehrend')).getByRole('radio', { name: 'Alle' })).toHaveProperty(
			'checked',
			true
		);
	});

	it.each([
		['Nur wiederkehrende', '/?status=open&wiederholung=wiederkehrend&gruppe=projekt'],
		['Nur einmalige', '/?status=open&wiederholung=einmalig&gruppe=projekt']
	])('chip %s sets the URL and keeps the rest', async (chip, target) => {
		await showBar('/?status=open&gruppe=projekt');
		await fireEvent.click(within(group('Wiederkehrend')).getByRole('radio', { name: chip }));
		expect(lastTarget()).toBe(target);
	});

	it('shows the chosen chip, "Alle" removes it, and "Zurücksetzen" clears it', async () => {
		await showBar('/?wiederholung=einmalig&gruppe=wiederholung');
		const recurring = within(group('Wiederkehrend'));
		expect(recurring.getByRole('radio', { name: 'Nur einmalige' })).toHaveProperty('checked', true);

		await fireEvent.click(recurring.getByRole('radio', { name: 'Alle' }));
		expect(lastTarget()).toBe('/?gruppe=wiederholung');

		await fireEvent.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
		expect(lastTarget()).toBe('/?gruppe=wiederholung');
	});
});
