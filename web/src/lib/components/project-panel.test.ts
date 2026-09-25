// Component tests for the project panel (ADR-0025 section 10, decision 4 of the user; plan
// UI-Konsistenz, package UI-8), which replaces the project dialog: a side panel with the code in
// the header, the form (code suggestion from the name, checks before sending, field errors of the
// server at the field), the numbers with "Tickets anzeigen", "Archivieren" / "Aus dem Archiv
// holen", "Löschen …" only without tickets with the confirmation, and the question about unsaved
// input on × and Escape.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { Project, ProjectDraft } from '$lib/domain/project';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { CatalogEditor, type CatalogEditorData, type EditResult } from '$lib/stores/catalog-editor';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ProjectPanel from './ProjectPanel.svelte';
import source from './ProjectPanel.svelte?raw';

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};

useOverlayStubs();

type SaveResult = EditResult<Project>;

function show(
	project: Project | null = null,
	total: number | null = null,
	overrides: Partial<{
		onsave: (draft: ProjectDraft) => Promise<SaveResult>;
		onarchive: (archived: boolean) => Promise<SaveResult>;
		ondelete: () => Promise<EditResult<void>>;
		active: number | null;
		fresh: number;
	}> = {}
) {
	const props = {
		project,
		total,
		active: 2,
		fresh: 0,
		ticketsHref: '/?projekt=proj00000000001' as ResolvedPathname,
		onsave: vi.fn(async (draft: ProjectDraft): Promise<SaveResult> => ({
			ok: true,
			value: { ...HOUSE, ...draft }
		})),
		onsaved: vi.fn(),
		onclose: vi.fn(),
		...(project === null
			? {}
			: {
					onarchive: vi.fn(async (archived: boolean): Promise<SaveResult> => ({
						ok: true,
						value: { ...HOUSE, archived }
					})),
					ondelete: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
					ondeleted: vi.fn()
				}),
		...overrides
	};
	const result = render(ProjectPanel, { props });
	return { props, ...result };
}

const panel = (name: string) => screen.getByRole('complementary', { name });
const nameField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' });
const codeField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Code' });

async function type(field: HTMLInputElement, value: string) {
	await fireEvent.input(field, { target: { value } });
}

describe('project panel: creating', () => {
	it('is a side panel "Neues Projekt" with the focus on the name and "Anlegen" in the footer', async () => {
		show();
		await tick();

		const aside = panel('Neues Projekt');
		expect(aside.hasAttribute('data-overlay')).toBe(true);
		expect(document.activeElement).toBe(nameField());
		const footer = within(aside.querySelector('footer') as HTMLElement);
		expect(footer.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
			'Abbrechen',
			'Anlegen'
		]);
		expect(screen.queryByRole('button', { name: 'Archivieren' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Tickets anzeigen' })).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('suggests a code from the name until the user types one', async () => {
		show();

		await type(nameField(), 'Garten und Haus');
		expect(codeField().value).toBe('GUH');
		await type(nameField(), 'Büro');
		expect(codeField().value).toBe('BUER');
		expect(
			document.getElementById(String(codeField().getAttribute('aria-describedby')))?.textContent
		).toMatch(/2 bis 6 Großbuchstaben \(A–Z\), nicht TASK\. Tickets des Projekts heißen\s+BUER-1/);

		await type(codeField(), 'bx');
		expect(codeField().value).toBe('BX');
		await type(nameField(), 'Büro alt');
		expect(codeField().value).toBe('BX');
	});

	it('sends name and code and hands the new project on', async () => {
		const { props } = show();
		await type(nameField(), 'Garten');

		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		expect(props.onsave).toHaveBeenCalledExactlyOnceWith({ name: 'Garten', code: 'GART' });
		await vi.waitFor(() =>
			expect(props.onsaved).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ name: 'Garten', code: 'GART' })
			)
		);
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('checks TASK and the pattern before sending and shows the problem at the field', async () => {
		const data = {
			createProject: vi.fn<CatalogEditorData['createProject']>()
		} as unknown as CatalogEditorData;
		const catalog = new CatalogStore(
			{ listProjects: async () => [], listTags: async () => [], createTag: vi.fn() },
			{ ensureValid: () => true, logout: vi.fn() }
		);
		const editor = new CatalogEditor(data, { ensureValid: () => true, logout: vi.fn() }, catalog);
		const { props } = show(null, null, { onsave: (draft) => editor.createProject(draft) });

		await type(nameField(), 'Aufgaben');
		await type(codeField(), 'TASK');
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		await vi.waitFor(() => expect(codeField().getAttribute('aria-invalid')).toBe('true'));
		expect(screen.getByText('Der Code TASK ist reserviert.')).toBeTruthy();
		await vi.waitFor(() => expect(document.activeElement).toBe(codeField()));

		await type(codeField(), 'A1');
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() =>
			expect(screen.getByText('Nur 2 bis 6 Großbuchstaben (A–Z).')).toBeTruthy()
		);
		expect(data.createProject).not.toHaveBeenCalled();
		expect(props.onsaved).not.toHaveBeenCalled();
	});

	it('shows a field error of the server at the field and stays open', async () => {
		const { props } = show(null, null, {
			onsave: async () => ({ ok: false, message: null, fields: { code: 'Schon vergeben.' } })
		});
		await type(nameField(), 'Haus');

		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		await vi.waitFor(() => expect(screen.getByText('Schon vergeben.')).toBeTruthy());
		const describedBy = String(codeField().getAttribute('aria-describedby')).split(' ');
		expect(describedBy[0] && document.getElementById(describedBy[0])?.textContent).toMatch(
			'Schon vergeben.'
		);
		expect(props.onsaved).not.toHaveBeenCalled();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('closes with "Abbrechen", × and Escape while nothing is typed', async () => {
		const { props } = show();

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(await fireEvent.keyDown(nameField(), { key: 'Escape' })).toBe(false);
		expect(props.onclose).toHaveBeenCalledTimes(3);
	});

	it('asks before typed input is lost', async () => {
		const { props } = show();
		await type(nameField(), 'Garten');

		await fireEvent.keyDown(nameField(), { key: 'Escape' });
		const question = screen.getByRole('dialog', { name: 'Neues Projekt verwerfen?' });
		expect(props.onclose).not.toHaveBeenCalled();
		await fireEvent.click(within(question).getByRole('button', { name: 'Weiter bearbeiten' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(nameField().value).toBe('Garten');

		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		await fireEvent.click(
			within(screen.getByRole('dialog')).getByRole('button', { name: 'Verwerfen' })
		);
		expect(props.onclose).toHaveBeenCalledOnce();
	});
});

describe('project panel: a project', () => {
	it('shows the code in the header, the numbers, "Tickets anzeigen" and focuses the title', async () => {
		show(HOUSE, 5, { fresh: 1 });
		await tick();

		const aside = panel('Haus');
		const header = within(aside.querySelector('header') as HTMLElement);
		expect(header.getByText('HAUS')).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Haus' }));
		expect(aside.querySelector('.stats')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'2 aktiv · 5 gesamt · 1 neu'
		);
		expect(screen.getByRole('link', { name: 'Tickets anzeigen' }).getAttribute('href')).toBe(
			'/?projekt=proj00000000001'
		);
		expect(nameField().value).toBe('Haus');
		expect(codeField().value).toBe('HAUS');
		expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
	});

	it('sends changes, stays open and is no longer dirty after saving', async () => {
		const { props } = show(HOUSE, 0);

		await type(nameField(), 'Wohnung');
		expect(codeField().value).toBe('HAUS');
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		expect(props.onsave).toHaveBeenCalledExactlyOnceWith({ name: 'Wohnung', code: 'HAUS' });
		await vi.waitFor(() => expect(props.onsaved).toHaveBeenCalledOnce());
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(props.onclose).toHaveBeenCalledOnce();
	});

	it('asks "Änderungen verwerfen?" before a changed name is lost', async () => {
		const { props } = show(HOUSE, 0);
		await type(nameField(), 'Wohnung');

		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(screen.getByRole('dialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
		expect(props.onclose).not.toHaveBeenCalled();

		// Typing the old name again is no change.
		await fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
		await type(nameField(), 'Haus');
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(props.onclose).toHaveBeenCalledOnce();
	});

	it('keeps the code fixed while tickets use the project', () => {
		show(HOUSE, 3);

		expect(codeField().readOnly).toBe(true);
		expect(
			screen.getByText('Der Code bleibt fest, weil Tickets das Projekt verwenden.')
		).toBeTruthy();
	});

	it('archives and takes out of the archive, and stays open', async () => {
		const { props } = show(HOUSE, 3);
		await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
		expect(props.onarchive).toHaveBeenCalledExactlyOnceWith(true);
		expect(props.onclose).not.toHaveBeenCalled();

		document.body.innerHTML = '';
		const archived = show({ ...HOUSE, archived: true }, 3);
		expect(screen.getByText('Archiviert')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Aus dem Archiv holen' }));
		expect(archived.props.onarchive).toHaveBeenCalledExactlyOnceWith(false);
	});

	it('shows a failure of archiving in the panel', async () => {
		show(HOUSE, 3, {
			onarchive: async () => ({ ok: false, message: 'Keine Verbindung.', fields: {} })
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
		await vi.waitFor(() => expect(screen.getByText('Keine Verbindung.')).toBeTruthy());
	});

	it('offers "Löschen …" in the header only without tickets and names the tickets otherwise', () => {
		show(HOUSE, 2);
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		expect(
			screen.getByText('Ein Projekt mit Tickets (2) lässt sich nicht löschen, nur archivieren.')
		).toBeTruthy();

		document.body.innerHTML = '';
		show(HOUSE, null);
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();

		document.body.innerHTML = '';
		show(HOUSE, 0);
		const header = panel('Haus').querySelector('header') as HTMLElement;
		expect(within(header).getByRole('button', { name: 'Löschen …' })).toBeTruthy();
	});

	it('deletes after the confirmation, which starts on "Abbrechen"', async () => {
		const { props } = show(HOUSE, 0);
		const trigger = screen.getByRole('button', { name: 'Löschen …' });
		trigger.focus();

		await fireEvent.click(trigger);
		await tick();
		const question = screen.getByRole('dialog', { name: 'Projekt „Haus“ löschen?' });
		expect(question.textContent).toMatch(/„Haus“ \(HAUS\) hat keine Tickets\./);
		expect(document.activeElement).toBe(
			within(question).getByRole('button', { name: 'Abbrechen' })
		);

		await fireEvent.click(within(question).getByRole('button', { name: 'Abbrechen' }));
		expect(props.ondelete).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(trigger);

		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
		expect(props.ondelete).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(props.ondeleted).toHaveBeenCalledOnce());
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('shows a refusal of the server in the confirmation', async () => {
		const { props } = show(HOUSE, 0, {
			ondelete: async () => ({
				ok: false,
				message: 'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.',
				fields: {}
			})
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

		await vi.waitFor(() =>
			expect(screen.getByRole('alert').textContent).toMatch(/Bitte archivieren\./)
		);
		expect(screen.getByRole('dialog', { name: 'Projekt „Haus“ löschen?' })).toBeTruthy();
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('uses the building blocks and no error colour for "Endgültig löschen" (ADR-0009)', () => {
		expect(source).toMatch(/import Drawer from '\.\/overlay\/Drawer\.svelte';/);
		expect(source).toMatch(/import ConfirmDialog from '\.\/overlay\/ConfirmDialog\.svelte';/);
		expect(source).not.toMatch(/--color-danger|<dialog\b|Modal/);
	});
});
