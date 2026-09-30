// "Ticket duplizieren" (ADR-0045): the store sends the question, shows the flag with the way back
// to the original and returns refusals per field.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { DEFAULT_TAKE, type DuplicateOutcome, type DuplicateRequest } from '$lib/domain/duplicate';
import type { FlagInput } from './flags.svelte';
import { DUPLICATE_GONE, TicketDuplicateStore } from './ticket-duplicate.svelte';

const ORIGINAL = { id: 'orig00000000001', key: 'HAUS-12' };

const REQUEST: DuplicateRequest = {
	title: 'Rasen (Kopie)',
	status: 'open',
	project: null,
	take: { ...DEFAULT_TAKE },
	source: 'none'
};

const OUTCOME: DuplicateOutcome = {
	id: 'dupl00000000001',
	key: 'HAUS-13',
	title: 'Rasen (Kopie)',
	original: ORIGINAL,
	subtasks: [],
	comments: 0,
	source: null
};

function setup(duplicate: (id: string, request: DuplicateRequest) => Promise<DuplicateOutcome>) {
	const shown: FlagInput[] = [];
	const flags = {
		show: vi.fn((input: FlagInput) => {
			shown.push(input);
			return 'flag-1';
		}),
		dismiss: vi.fn()
	};
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const data = { duplicate: vi.fn(duplicate) };
	const store = new TicketDuplicateStore(data, session, flags);
	return { store, data, session, shown };
}

describe('TicketDuplicateStore', () => {
	it('sends the request for the original and shows the flag with both keys and "HAUS-12 öffnen"', async () => {
		const { store, data, shown } = setup(async () => OUTCOME);
		const open = vi.fn();
		const result = await store.duplicate(ORIGINAL, REQUEST, open);
		expect(result).toEqual({ ok: true, outcome: OUTCOME });
		expect(data.duplicate).toHaveBeenCalledWith(ORIGINAL.id, REQUEST);
		expect(shown).toHaveLength(1);
		expect(shown[0]).toMatchObject({
			tone: 'success',
			title: 'HAUS-12 dupliziert.',
			description: 'Das Duplikat ist HAUS-13.',
			action: { label: 'HAUS-12 öffnen' }
		});
		shown[0]?.action?.run();
		expect(open).toHaveBeenCalledWith(ORIGINAL.id);
	});

	it('returns refusals per field and anything else as a message, without a flag', async () => {
		const refusal = new DataError('validation', {
			status: 400,
			fields: {
				status: { code: 'validation_duplicate_status', message: 'Nie „Erledigt“.' },
				project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' },
				fingerprint: { code: 'x', message: 'Anderes Problem.' }
			}
		});
		const { store, shown } = setup(async () => {
			throw refusal;
		});
		expect(await store.duplicate(ORIGINAL, REQUEST, vi.fn())).toEqual({
			ok: false,
			message: 'Anderes Problem.',
			fields: { status: 'Nie „Erledigt“.', project: 'Das Projekt ist archiviert.' }
		});
		expect(shown).toEqual([]);
	});

	it('names an original that is gone, and the text of the kind for other failures', async () => {
		const gone = setup(async () => {
			throw new DataError('not_found', { status: 404 });
		});
		expect(await gone.store.duplicate(ORIGINAL, REQUEST, vi.fn())).toEqual({
			ok: false,
			message: DUPLICATE_GONE,
			fields: {}
		});
		const failed = setup(async () => {
			throw new DataError('forbidden', { status: 403 });
		});
		expect(await failed.store.duplicate(ORIGINAL, REQUEST, vi.fn())).toEqual({
			ok: false,
			message: 'Dafür fehlt die Berechtigung.',
			fields: {}
		});
	});

	it('sends nothing without a session and logs out when it ended meanwhile', async () => {
		const without = setup(async () => OUTCOME);
		without.session.ensureValid.mockReturnValue(false);
		expect(await without.store.duplicate(ORIGINAL, REQUEST, vi.fn())).toEqual({
			ok: false,
			message: null,
			fields: {}
		});
		expect(without.data.duplicate).not.toHaveBeenCalled();

		const ended = setup(async () => {
			throw new DataError('session', { status: 401 });
		});
		expect((await ended.store.duplicate(ORIGINAL, REQUEST, vi.fn())).ok).toBe(false);
		expect(ended.session.logout).toHaveBeenCalledOnce();
	});
});
