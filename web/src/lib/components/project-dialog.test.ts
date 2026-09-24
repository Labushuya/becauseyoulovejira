// Component tests for the project dialog (E3 plan, T-11, T-12 and package 14): code suggestion
// from the name, checks before sending (TASK, pattern), field errors of the server at the field,
// "Archivieren" / "Aus dem Archiv holen", "Löschen …" only without tickets with a second step,
// Escape. jsdom has no showModal()/close(); the test adds a minimal stand-in.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectDraft } from '$lib/domain/project';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { CatalogEditor, type CatalogEditorData, type EditResult } from '$lib/stores/catalog-editor';
import ProjectDialog from './ProjectDialog.svelte';
import source from './ProjectDialog.svelte?raw';

const T0 = '2026-09-24 08:00:00.000Z';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};

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

type SaveResult = EditResult<Project>;

function show(
	project: Project | null = null,
	total: number | null = null,
	overrides: Partial<{
		onsave: (draft: ProjectDraft) => Promise<SaveResult>;
		onarchive: (archived: boolean) => Promise<SaveResult>;
		ondelete: () => Promise<EditResult<void>>;
	}> = {}
) {
	const props = {
		project,
		total,
		onsave: vi.fn(async (draft: ProjectDraft): Promise<SaveResult> => ({
			ok: true,
			value: { ...HOUSE, ...draft }
		})),
		onarchive: vi.fn(async (archived: boolean): Promise<SaveResult> => ({
			ok: true,
			value: { ...HOUSE, archived }
		})),
		ondelete: vi.fn(async (): Promise<EditResult<void>> => ({ ok: true, value: undefined })),
		onclose: vi.fn(),
		...overrides
	};
	render(ProjectDialog, { props });
	return props;
}

const nameField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' });
const codeField = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Code' });

async function type(field: HTMLInputElement, value: string) {
	await fireEvent.input(field, { target: { value } });
}

describe('project dialog: creating', () => {
	it('opens as a modal dialog "Neues Projekt" with the focus on the name', async () => {
		show();
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'Neues Projekt' });
		expect((dialog as HTMLDialogElement).open).toBe(true);
		expect(document.activeElement).toBe(nameField());
		expect(screen.getByRole('button', { name: 'Anlegen' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Archivieren' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
	});

	it('suggests a code from the name until the user types one', async () => {
		show();

		await type(nameField(), 'Garten und Haus');
		expect(codeField().value).toBe('GUH');
		await type(nameField(), 'Büro');
		expect(codeField().value).toBe('BUER');
		expect(codeField().getAttribute('aria-describedby')).toBeTruthy();
		expect(
			document.getElementById(String(codeField().getAttribute('aria-describedby')))?.textContent
		).toMatch(/2 bis 6 Großbuchstaben \(A–Z\), nicht TASK\. Tickets des Projekts heißen\s+BUER-1/);

		await type(codeField(), 'bx');
		expect(codeField().value).toBe('BX');
		await type(nameField(), 'Büro alt');
		expect(codeField().value).toBe('BX');
	});

	it('sends name and code and closes after success', async () => {
		const props = show();
		await type(nameField(), 'Garten');

		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		expect(props.onsave).toHaveBeenCalledExactlyOnceWith({ name: 'Garten', code: 'GART' });
		await vi.waitFor(() => expect(props.onclose).toHaveBeenCalledOnce());
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
		const props = show(null, null, { onsave: (draft) => editor.createProject(draft) });

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
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('shows a field error of the server at the field and stays open', async () => {
		const props = show(null, null, {
			onsave: async () => ({ ok: false, message: null, fields: { code: 'Schon vergeben.' } })
		});
		await type(nameField(), 'Haus');

		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

		await vi.waitFor(() => expect(screen.getByText('Schon vergeben.')).toBeTruthy());
		const describedBy = String(codeField().getAttribute('aria-describedby')).split(' ');
		expect(describedBy[0] && document.getElementById(describedBy[0])?.textContent).toMatch(
			'Schon vergeben.'
		);
		expect(props.onclose).not.toHaveBeenCalled();
	});

	it('closes with "Abbrechen" and with Escape', async () => {
		const props = show();

		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(props.onclose).toHaveBeenCalledOnce();

		await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
		expect(props.onclose).toHaveBeenCalledTimes(2);
	});
});

describe('project dialog: editing', () => {
	it('shows name and code of the project and sends changes', async () => {
		const props = show(HOUSE, 0);

		expect(screen.getByRole('dialog', { name: 'Projekt bearbeiten' })).toBeTruthy();
		expect(nameField().value).toBe('Haus');
		expect(codeField().value).toBe('HAUS');
		await type(nameField(), 'Wohnung');
		expect(codeField().value).toBe('HAUS');
		await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

		expect(props.onsave).toHaveBeenCalledExactlyOnceWith({ name: 'Wohnung', code: 'HAUS' });
	});

	it('keeps the code fixed while tickets use the project', () => {
		show(HOUSE, 3);

		expect(codeField().readOnly).toBe(true);
		expect(
			screen.getByText('Der Code bleibt fest, weil Tickets das Projekt verwenden.')
		).toBeTruthy();
	});

	it('archives and takes out of the archive', async () => {
		const props = show(HOUSE, 3);
		await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
		expect(props.onarchive).toHaveBeenCalledExactlyOnceWith(true);
		await vi.waitFor(() => expect(props.onclose).toHaveBeenCalledOnce());

		document.body.innerHTML = '';
		const archived = show({ ...HOUSE, archived: true }, 3);
		await fireEvent.click(screen.getByRole('button', { name: 'Aus dem Archiv holen' }));
		expect(archived.onarchive).toHaveBeenCalledExactlyOnceWith(false);
	});

	it('offers "Löschen …" only without tickets', () => {
		show(HOUSE, 2);
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		expect(
			screen.getByText('Ein Projekt mit Tickets lässt sich nicht löschen, nur archivieren.')
		).toBeTruthy();

		document.body.innerHTML = '';
		show(HOUSE, null);
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();

		document.body.innerHTML = '';
		show(HOUSE, 0);
		expect(screen.getByRole('button', { name: 'Löschen …' })).toBeTruthy();
	});

	it('asks in a second step before deleting; Escape goes back to the form', async () => {
		const props = show(HOUSE, 0);

		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		await tick();
		expect(screen.getByText(/Projekt „Haus“ \(HAUS\) endgültig löschen\?/)).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));

		await fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
		await tick();
		expect(props.onclose).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(nameField());

		await fireEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));
		expect(props.ondelete).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(props.onclose).toHaveBeenCalledOnce());
	});

	it('shows a refusal of the server in the dialog', async () => {
		show(HOUSE, 0, {
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
	});

	it('uses no error colour for "Endgültig löschen" (ADR-0009)', () => {
		expect(source).not.toMatch(/--color-danger/);
	});
});
