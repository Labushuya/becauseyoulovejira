// Data layer of the Notion import (web/src/lib/data/notion.ts, ADR-0041, plan NI-2) against a
// disposable PocketBase in the test mode and the fake of the Notion API: a user creates the
// connection through the Record API, then check, sources, preview, import and the summary come
// back in the shapes of the SPA, also with "Unterseiten einbeziehen" (addendum of 2026-10-01);
// refusals and errors of Notion as outcomes, an unknown connection as DataError.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeNotion } from '../support/fake-notion.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { DATA_SOURCE_ID, PAGE_ID, TOKEN, id, workspace } from '../fixtures/notion/workspace.mjs';
import { createConnection } from '../../web/src/lib/data/connections.ts';
import {
	checkNotion,
	importNotion,
	listNotionImports,
	listNotionSources,
	previewNotion
} from '../../web/src/lib/data/notion.ts';
import { emptyConnectionDraft } from '../../web/src/lib/domain/connections.ts';

let fake;
let instance;
let pb;
let connection;

beforeAll(async () => {
	fake = await startFakeNotion(workspace());
	instance = await startPocketBase({
		env: { BYL_TEST_NOTION_PORT: String(fake.port), BYL_NOTION_TOKEN: TOKEN }
	});
	const superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password });
	pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('users').authWithPassword(email, password);
	connection = await createConnection(pb, emptyConnectionDraft('notion'));
});

afterAll(async () => {
	await fake?.close();
	await instance?.stop();
});

describe('data layer of the Notion import', () => {
	it('creates the connection with its variable and no settings', () => {
		expect(connection).toMatchObject({
			type: 'notion',
			label: 'Notion',
			secretEnv: 'BYL_NOTION_TOKEN',
			keywords: [],
			enabled: true
		});
	});

	it('checks and lists the sources', async () => {
		expect(await checkNotion(pb, connection.id)).toEqual({
			kind: 'ok',
			value: { workspace: 'Beispiel-Arbeitsbereich', bot: 'becauseyoulovejira', shared: true }
		});
		const listed = await listNotionSources(pb, connection.id, '');
		expect(listed.kind).toBe('ok');
		expect(listed.value.sources.map((source) => [source.type, source.title])).toEqual([
			['data_source', 'Aufgaben Haushalt'],
			['page', 'Wochenplan']
		]);
		expect(listed.value.truncated).toBe(false);
	});

	it('previews, imports and sums up in the shapes of the SPA', async () => {
		const preview = await previewNotion(pb, connection.id, {
			source: { type: 'data_source', id: DATA_SOURCE_ID },
			dateProperty: null,
			subpages: false
		});
		expect(preview.kind).toBe('ok');
		expect(preview.value).toMatchObject({
			dateProperties: ['Fällig', 'Erinnerung'],
			dateProperty: 'Fällig',
			truncated: false,
			blankPoints: 0,
			subpages: 0,
			hiddenSubpages: 0,
			limits: {
				maxRows: 1000,
				importBatch: 100,
				contentBlocks: 500,
				contentChars: 50000,
				treeBlocks: 5000,
				subpages: 50,
				subpageDepth: 3
			}
		});
		expect(preview.value.items[0]).toMatchObject({
			ref: id(4, 1),
			kind: 'task',
			title: 'Fenster putzen',
			sourceDate: '2026-10-04 22:00:00.000Z',
			allDay: true,
			state: ''
		});
		const done = await importNotion(pb, connection.id, {
			source: { type: 'data_source', id: DATA_SOURCE_ID },
			refs: [id(4, 1), id(4, 3)],
			skipDone: true,
			copyContent: false,
			dateProperty: null,
			subpages: false
		});
		expect(done).toEqual({
			kind: 'ok',
			value: {
				items: [
					{ ref: id(4, 1), status: 'created', message: '' },
					{ ref: id(4, 3), status: 'skipped', message: 'Erledigt, übersprungen.' }
				],
				counts: { created: 1, duplicates: 0, skipped: 1, failed: 0 },
				pending: []
			}
		});
		const imports = await listNotionImports(pb, connection.id);
		expect(imports).toEqual([
			{
				id: DATA_SOURCE_ID,
				type: 'data_source',
				title: 'Aufgaben Haushalt',
				url: expect.stringMatching(/^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/),
				count: 1,
				last: expect.any(String),
				dateProperty: 'Fällig',
				copyContent: false,
				subpages: false
			}
		]);
	});

	it('sends "Unterseiten einbeziehen" and reads what the preview says about the sub-pages', async () => {
		const page = { type: 'page', id: PAGE_ID };
		const preview = await previewNotion(pb, connection.id, { source: page, dateProperty: null, subpages: true });
		expect(preview.kind).toBe('ok');
		expect(preview.value).toMatchObject({ subpages: 2, hiddenSubpages: 1 });
		expect(preview.value.items.at(-1)).toMatchObject({ title: 'Silikon erneuern', section: 'Unterseite › Tiefer › Bad' });
		const taken = await importNotion(pb, connection.id, {
			source: page,
			refs: [id(3, 44)],
			skipDone: true,
			copyContent: false,
			dateProperty: null,
			subpages: true
		});
		expect(taken).toMatchObject({ kind: 'ok', value: { counts: { created: 1 } } });
		const imports = await listNotionImports(pb, connection.id);
		expect(imports.find((source) => source.id === PAGE_ID)).toMatchObject({ type: 'page', count: 1, subpages: true });
	});

	it('answers refusals and errors of Notion as outcomes, an unknown connection as DataError', async () => {
		const refused = await importNotion(pb, connection.id, {
			source: { type: 'page', id: PAGE_ID },
			refs: [],
			skipDone: true,
			copyContent: false,
			dateProperty: null,
			subpages: false
		});
		expect(refused).toEqual({
			kind: 'error',
			message: 'Bitte 1 bis 100 Einträge je Anfrage wählen.',
			reason: '',
			partial: null
		});
		const hidden = await previewNotion(pb, connection.id, {
			source: { type: 'page', id: id(2, 2) },
			dateProperty: null,
			subpages: false
		});
		expect(hidden).toMatchObject({ kind: 'error', reason: 'source' });
		expect(hidden.message).toContain('(404)');
		await expect(checkNotion(pb, 'kein000000000000')).rejects.toMatchObject({ kind: 'not_found' });
	});
});
