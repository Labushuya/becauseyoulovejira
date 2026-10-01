// Decision help of a blocked ticket in the trash (ADR-0047): every dependency with only the
// options our rules allow (the first ticket with open blocking sub-tasks only together with them,
// a sub-task also on its own, the main source never to another ticket), the requests they send,
// the collective ways with their preview, the focus after a decision, the message once nothing
// blocks, and the locked "Endgültig löschen …" of the preview. jsdom has no showModal(), the
// shared stubs stand in.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { TrashPreview } from '$lib/domain/trash';
import {
	optionsOf,
	type ResolveAction,
	type SourceDependency,
	type TicketDependency,
	type TrashDependency
} from '$lib/domain/trash-dependencies';
import type { SourceActionResult } from '$lib/stores/ticket-sources.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TrashDependencies from './TrashDependencies.svelte';
import TrashPanel from './TrashPanel.svelte';

useOverlayStubs();

function ticket(id: string, key: string, subtask: boolean, openBlocking = 0): TicketDependency {
	const base = { kind: 'ticket' as const, subtask, openBlocking };
	return {
		...base,
		ticket: id,
		key,
		title: `Titel ${key}`,
		status: 'open',
		options: optionsOf(base)
	};
}

function source(id: string, title: string, primary: boolean): SourceDependency {
	const base = { kind: 'source' as const, primary };
	return {
		...base,
		item: id,
		ticket: 'root',
		key: 'HAUS-1',
		title,
		channel: 'mail',
		scope: 'u:user',
		options: optionsOf(base)
	};
}

const DEPENDENCIES: TrashDependency[] = [
	ticket('root', 'HAUS-1', false, 1),
	ticket('child', 'HAUS-2', true),
	source('main', 'Rechnung', true),
	source('linked', 'Rückfrage', false)
];

const DETACH_CHILD = 'HAUS-2 lösen und als eigenständiges Ticket wiederherstellen';
const COMPLETE_ROOT = 'HAUS-1 mit 1 Unteraufgabe als erledigt markieren';
const MOVE_LINKED = '„Rückfrage“ anderem Ticket zuordnen …';

function preview(dependencyList: TrashDependency[]): TrashPreview {
	return {
		id: 'root',
		key: 'HAUS-1',
		title: 'Dach',
		status: 'open',
		priority: 'medium',
		due: '',
		project: null,
		recurring: false,
		children: 1,
		dependencies: dependencyList.length,
		deletedAt: '2026-09-28 10:00:00.000Z',
		deletedBy: '',
		updated: '',
		daysLeft: 0,
		description: '',
		tags: [],
		subtasks: [],
		group: '',
		sources: { handling: 'discard', count: 2 },
		dependencyList
	};
}

function show(
	dependencies: TrashDependency[] = DEPENDENCIES,
	answer: (actions: readonly ResolveAction[]) => TrashDependency[] = () => []
) {
	const onresolve = vi.fn(
		async (actions: readonly ResolveAction[]): Promise<SourceActionResult<TrashPreview>> => {
			const next = answer(actions);
			view.rerender({ dependencies: next });
			return { ok: true, value: preview(next) };
		}
	);
	const onrestore = vi.fn();
	const ondetach = vi.fn();
	const view = render(TrashDependencies, {
		props: { rootKey: 'HAUS-1', dependencies, onresolve, onrestore, ondetach }
	});
	return { onresolve, onrestore, ondetach };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('decision help of the trash', () => {
	it('offers only the options our rules allow for every dependency', () => {
		show();
		expect(screen.getByRole('heading', { name: 'Abhängigkeiten' })).toBeTruthy();
		expect(
			screen.getByText(
				/HAUS-1 lässt sich erst endgültig löschen, wenn über 2 offene Tickets und 2 Quellen entschieden ist/
			)
		).toBeTruthy();
		// The first ticket with an open blocking sub-task only together with it (ADR-0033).
		expect(button(COMPLETE_ROOT)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'HAUS-1 als erledigt markieren' })).toBeNull();
		expect(button('HAUS-1 wiederherstellen')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /HAUS-1 lösen/ })).toBeNull();
		// A sub-task: done, back with its parent, or on its own.
		expect(button('HAUS-2 als erledigt markieren')).toBeTruthy();
		expect(button('HAUS-2 mit HAUS-1 wiederherstellen')).toBeTruthy();
		expect(button(DETACH_CHILD)).toBeTruthy();
		// The main source never moves to another ticket, and the help says why (ADR-0031).
		expect(button('„Rechnung“ zurück in den Eingang')).toBeTruthy();
		expect(button('„Rechnung“ verwerfen')).toBeTruthy();
		expect(
			screen.queryByRole('button', { name: '„Rechnung“ anderem Ticket zuordnen …' })
		).toBeNull();
		expect(screen.getByText(/Hauptquelle: Sie bleibt bei dem Ticket/)).toBeTruthy();
		expect(button(MOVE_LINKED)).toBeTruthy();
		expect(screen.getByText(/die Sperre gegen erneutes Eintreffen bleibt/)).toBeTruthy();
		expect(duplicateIds()).toEqual([]);
	});

	it('sends one decision, puts the focus on the heading and says when nothing blocks', async () => {
		const { onresolve } = show(DEPENDENCIES.slice(1, 2));
		await fireEvent.click(button('HAUS-2 als erledigt markieren'));
		expect(onresolve).toHaveBeenCalledWith([{ action: 'complete', ticket: 'child' }]);
		await vi.waitFor(() =>
			expect(
				screen.getByText(/Alles ist entschieden\. HAUS-1 lässt sich jetzt endgültig löschen\./)
			).toBeTruthy()
		);
		expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Abhängigkeiten' }));
	});

	it('sends the first ticket together with its sub-tasks and the sources one by one', async () => {
		const { onresolve } = show(DEPENDENCIES, () => DEPENDENCIES);
		await fireEvent.click(button(COMPLETE_ROOT));
		expect(onresolve).toHaveBeenLastCalledWith([
			{ action: 'complete', ticket: 'root', complete_children: true }
		]);
		await tick();
		await fireEvent.click(button('„Rechnung“ zurück in den Eingang'));
		expect(onresolve).toHaveBeenLastCalledWith([{ action: 'inbox', item: 'main' }]);
		await tick();
		await fireEvent.click(button('„Rückfrage“ verwerfen'));
		expect(onresolve).toHaveBeenLastCalledWith([{ action: 'discard', item: 'linked' }]);
	});

	it('restores the group or a sub-task on its own through the preview', async () => {
		const { onrestore, ondetach, onresolve } = show();
		await fireEvent.click(button('HAUS-1 wiederherstellen'));
		expect(onrestore).toHaveBeenCalledOnce();
		await fireEvent.click(button(DETACH_CHILD));
		expect(ondetach).toHaveBeenCalledWith('child');
		expect(onresolve).not.toHaveBeenCalled();
	});

	it('shows what a collective way touches before it runs', async () => {
		const { onresolve } = show();
		const discardAll = button('Alle Quellen verwerfen');
		expect(discardAll.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(discardAll);
		expect(discardAll.getAttribute('aria-expanded')).toBe('true');
		expect(
			screen.getByText(
				/Betrifft 2 Quellen: „Rechnung“, „Rückfrage“\. Sie stehen danach im Eingang unter „Verworfen“\./
			)
		).toBeTruthy();
		await fireEvent.click(button('Abbrechen'));
		expect(screen.queryByText(/Betrifft 2 Quellen/)).toBeNull();
		expect(onresolve).not.toHaveBeenCalled();

		await fireEvent.click(button('Alle als erledigt markieren'));
		expect(screen.getByText(/Betrifft 2 Tickets: HAUS-2, HAUS-1\./)).toBeTruthy();
		const run = screen
			.getAllByRole('button', { name: 'Alle als erledigt markieren' })
			.at(-1) as HTMLElement;
		await fireEvent.click(run);
		expect(onresolve).toHaveBeenCalledWith([
			{ action: 'complete', ticket: 'child' },
			{ action: 'complete', ticket: 'root' }
		]);
	});

	it('moves a source that is not the main source with the dialog of the sources', async () => {
		show();
		await fireEvent.click(button(MOVE_LINKED));
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Anderem Ticket zuordnen' });
		expect(within(dialog).getByText(/„Rückfrage“ gehört zu HAUS-1/)).toBeTruthy();
		expect(danglingReferences(dialog)).toEqual([]);
	});
});

describe('preview of a blocked ticket', () => {
	it('shows the decision help and locks "Endgültig löschen …" until nothing blocks', async () => {
		const onpurge = vi.fn();
		render(TrashPanel, {
			props: {
				preview: preview(DEPENDENCIES),
				selfId: null,
				projects: [],
				need: null,
				onrestore: vi.fn(),
				onresolve: vi.fn(),
				ondetach: vi.fn(),
				onpurge,
				ondismissneed: vi.fn(),
				onclose: vi.fn()
			}
		});
		expect(screen.getByRole('heading', { name: 'Abhängigkeiten' })).toBeTruthy();
		expect(
			screen.getByText(/nicht automatisch, solange es blockiert ist \(sonst heute\)/)
		).toBeTruthy();
		const purge = button('Endgültig löschen …');
		expect(purge.getAttribute('aria-disabled')).toBe('true');
		expect(purge.getAttribute('aria-busy')).toBeNull();
		expect(document.getElementById(purge.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Erst über die Abhängigkeiten entscheiden.'
		);
		await fireEvent.click(purge);
		expect(onpurge).not.toHaveBeenCalled();
	});
});
