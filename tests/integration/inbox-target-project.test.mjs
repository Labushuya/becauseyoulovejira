// Target project of the ways into the inbox (ADR-0049, package 1 "Standardprojekt je Verbindung")
// against the shared disposable instance: an entry keeps the target of its way when it comes in
// (connection, own inbox, WhatsApp Web, files), a later change of the target counts for new entries
// only, only the server sets the field, a user chooses only an active project of the area, an
// archived target stays at the entries, a deleted one leaves a note, and the copy of a source keeps
// the target of its original.

import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, rejectionOf, superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { listConnections, setConnectionTarget } from '../../web/src/lib/data/connections.ts';
import { getItem, listHandledItems, listNewItems } from '../../web/src/lib/data/inbox.ts';
import { getInboxTargets, saveInboxTargets } from '../../web/src/lib/data/inbox-targets.ts';

let superuser;
let owner;
let other;

const itemOf = (id) => superuser.collection('inbox_items').getOne(id);
const connectionOf = (id) => superuser.collection('connections').getOne(id);

function calendar(who, data = {}) {
	return who.client.collection('connections').create({
		owner: who.id,
		type: 'calendar',
		label: `Kalender ${uniqueSuffix()}`,
		enabled: true,
		secret_env: 'BYL_TEST_CALENDAR',
		...data
	});
}

/** An entry as a way of the server would bring it: through the hook of the Record API. */
function entry(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'calendar',
		kind: 'event',
		title: `Termin ${uniqueSuffix()}`,
		source_ref: `uid-${uniqueSuffix()}`,
		...data
	});
}

function mailFile(who, data = {}) {
	return who.client.collection('inbox_items').create({
		owner: who.id,
		channel: 'eml',
		kind: 'mail',
		title: `Mail ${uniqueSuffix()}`,
		source_ref: `<${uniqueSuffix()}@example.com>`,
		...data
	});
}

function setTargets(who, targets) {
	return who.client.collection('users').update(who.id, { inbox_targets: targets });
}

async function ingest(token, json) {
	const response = await fetch(`${pocketBaseUrl()}/api/byl/inbox/ingest`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(json)
	});
	return { status: response.status, json: await response.json() };
}

beforeAll(async () => {
	superuser = await superuserClient();
	// Only an administrator of the app sets up connections with access data (ADR-0056 §5).
	owner = await createOwner(superuser, { admin: true });
	other = await createOwner(superuser);
});

describe('target of a connection', () => {
	it('gives new entries of the connection its target, and a change counts for new entries only', async () => {
		const haus = await owner.project(uniqueCode());
		const arbeit = await owner.project(uniqueCode());
		const connection = await calendar(owner, { target_project: haus.id });
		expect(connection.target_project).toBe(haus.id);

		const first = await entry(owner, { connection: connection.id });
		expect(first.target_project).toBe(haus.id);

		await owner.client.collection('connections').update(connection.id, { target_project: arbeit.id });
		const second = await entry(owner, { connection: connection.id });
		expect(second.target_project).toBe(arbeit.id);
		expect((await itemOf(first.id)).target_project).toBe(haus.id);

		await owner.client.collection('connections').update(connection.id, { target_project: '' });
		const third = await entry(owner, { connection: connection.id });
		expect(third.target_project).toBe('');
		expect((await itemOf(second.id)).target_project).toBe(arbeit.id);
	});

	it('takes no target of a card for an entry of a connection without one', async () => {
		const haus = await owner.project(uniqueCode());
		await setTargets(owner, { files: haus.id });
		const connection = await calendar(owner);
		const item = await entry(owner, { connection: connection.id, channel: 'eml', kind: 'mail' });
		expect(item.target_project).toBe('');
		await setTargets(owner, null);
	});

	it('lets a user choose only an active project of the area of the connection', async () => {
		const archived = await owner.project(uniqueCode(), { archived: true });
		const foreign = await other.project(uniqueCode());
		expect(await rejectionOf(calendar(owner, { target_project: archived.id }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_target_project_archived' }
		});
		expect(await rejectionOf(calendar(owner, { target_project: foreign.id }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_target_project_missing' }
		});
		const connection = await calendar(owner);
		const connections = owner.client.collection('connections');
		expect(await rejectionOf(connections.update(connection.id, { target_project: foreign.id }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_target_project_missing' }
		});
		expect(await rejectionOf(connections.update(connection.id, { target_project: archived.id }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_target_project_archived' }
		});
		expect((await connectionOf(connection.id)).target_project).toBe('');
	});

	it('keeps the target out of a rename, and keeps an archived target the connection had', async () => {
		const haus = await owner.project(uniqueCode());
		const arbeit = await owner.project(uniqueCode());
		const connection = await calendar(owner, { target_project: haus.id });
		const connections = owner.client.collection('connections');
		expect(
			await rejectionOf(connections.update(connection.id, { label: 'Neu', target_project: arbeit.id }))
		).toEqual({ status: 400, codes: { target_project: 'validation_connection_rename_only' } });

		await owner.client.collection('projects').update(haus.id, { archived: true });
		// The archived target stays: renaming and keywords still save, new entries still get it.
		expect((await connections.update(connection.id, { label: 'Kalender Haus' })).target_project).toBe(haus.id);
		expect(
			(await connections.update(connection.id, { settings: { keywords: ['todo'] } })).target_project
		).toBe(haus.id);
		expect((await entry(owner, { connection: connection.id })).target_project).toBe(haus.id);
	});
});

describe('only the server sets the target of an entry', () => {
	it('overwrites a target a client sends and refuses to change it', async () => {
		const haus = await owner.project(uniqueCode());
		const item = await entry(owner, { target_project: haus.id });
		expect(item.target_project).toBe('');
		const items = owner.client.collection('inbox_items');
		expect(await rejectionOf(items.update(item.id, { target_project: haus.id }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_inbox_immutable' }
		});

		const connection = await calendar(owner, { target_project: haus.id });
		const withTarget = await entry(owner, { connection: connection.id });
		expect(await rejectionOf(items.update(withTarget.id, { target_project: '' }))).toEqual({
			status: 400,
			codes: { target_project: 'validation_inbox_immutable' }
		});
		// Discarding and restoring leave it as it is.
		await items.update(withTarget.id, { state: 'discarded' });
		expect((await items.update(withTarget.id, { state: 'new' })).target_project).toBe(haus.id);
	});

	it('leaves entries of channels without a card or connection without a target', async () => {
		const haus = await owner.project(uniqueCode());
		await setTargets(owner, { api: haus.id, 'whatsapp-web': haus.id, files: haus.id });
		for (const channel of ['manual', 'quick', 'clipboard', 'link']) {
			const item = await owner.client.collection('inbox_items').create({
				owner: owner.id,
				channel,
				kind: channel === 'link' ? 'link' : 'todo',
				title: `Eintrag ${uniqueSuffix()}`,
				...(channel === 'link' ? { source_url: `https://example.com/${uniqueSuffix()}` } : {})
			});
			expect(item.target_project, channel).toBe('');
		}
		await setTargets(owner, null);
	});
});

describe('targets of the cards without a connection', () => {
	it('gives files, the own inbox and WhatsApp Web the target of their card', async () => {
		const files = await owner.project(uniqueCode());
		const api = await owner.project(uniqueCode());
		const chat = await owner.project(uniqueCode());
		const saved = await setTargets(owner, { api: api.id, 'whatsapp-web': chat.id, files: files.id });
		expect(saved.inbox_targets).toEqual({ api: api.id, 'whatsapp-web': chat.id, files: files.id });

		expect((await mailFile(owner)).target_project).toBe(files.id);
		const whatsapp = await owner.client.collection('inbox_items').create({
			owner: owner.id,
			channel: 'whatsapp',
			kind: 'message',
			title: `Nachricht ${uniqueSuffix()}`,
			body: `Brot kaufen ${uniqueSuffix()}`,
			source_meta: { chat: 'Familie', sender: 'Ben' }
		});
		expect(whatsapp.target_project).toBe(files.id);

		const key = await owner.client.send('/api/byl/inbox/keys', { method: 'POST', body: { name: 'Skript' } });
		const fromScript = await ingest(key.token, { mode: 'manual', text: 'Rechnung zahlen', external_id: uniqueSuffix() });
		expect(fromScript.status).toBe(201);
		expect((await itemOf(fromScript.json.item)).target_project).toBe(api.id);
		const fromChat = await ingest(key.token, {
			channel: 'whatsapp-web',
			mode: 'manual',
			text: 'Brot kaufen',
			external_id: uniqueSuffix()
		});
		expect(fromChat.status).toBe(201);
		expect((await itemOf(fromChat.json.item)).target_project).toBe(chat.id);

		// A new target counts for new entries only.
		await setTargets(owner, { api: '', 'whatsapp-web': chat.id, files: api.id });
		const later = await ingest(key.token, { mode: 'manual', text: 'Später', external_id: uniqueSuffix() });
		expect((await itemOf(later.json.item)).target_project).toBe('');
		expect((await itemOf(fromScript.json.item)).target_project).toBe(api.id);
		expect((await mailFile(owner)).target_project).toBe(api.id);
		await setTargets(owner, null);
	});

	it('checks the shape and lets a user choose only an active project of the own area', async () => {
		const archived = await owner.project(uniqueCode(), { archived: true });
		const foreign = await other.project(uniqueCode());
		for (const value of [{ mail: '' }, { files: 'kein-projekt' }, ['api'], 'files']) {
			expect(await rejectionOf(setTargets(owner, value)), JSON.stringify(value)).toEqual({
				status: 400,
				codes: { inbox_targets: 'validation_inbox_targets' }
			});
		}
		expect(await rejectionOf(setTargets(owner, { files: archived.id }))).toEqual({
			status: 400,
			codes: { inbox_targets: 'validation_target_project_archived' }
		});
		expect(await rejectionOf(setTargets(owner, { api: foreign.id }))).toEqual({
			status: 400,
			codes: { inbox_targets: 'validation_target_project_missing' }
		});
		// A target that stays is not checked again, also once its project is archived.
		const haus = await owner.project(uniqueCode());
		await setTargets(owner, { files: haus.id });
		await owner.client.collection('projects').update(haus.id, { archived: true });
		const kept = await setTargets(owner, { files: haus.id, api: '' });
		expect(kept.inbox_targets).toEqual({ files: haus.id, api: '' });
		expect((await mailFile(owner)).target_project).toBe(haus.id);
		await setTargets(owner, null);
	});
});

describe('deleted and copied targets', () => {
	it('notes at the entries that their target project was deleted, and empties the target of the connection', async () => {
		const gone = await owner.project(uniqueCode());
		const connection = await calendar(owner, { target_project: gone.id });
		const item = await entry(owner, { connection: connection.id, source_meta: { location: 'Küche' } });
		expect(item.target_project).toBe(gone.id);
		const unrelated = await entry(owner, { connection: (await calendar(owner)).id, source_meta: { location: 'Flur' } });

		await owner.client.collection('projects').delete(gone.id);

		const after = await itemOf(item.id);
		expect(after.target_project).toBe('');
		expect(after.source_meta).toEqual({ location: 'Küche', target_gone: true });
		expect((await connectionOf(connection.id)).target_project).toBe('');
		expect((await itemOf(unrelated.id)).source_meta).toEqual({ location: 'Flur' });
		expect((await entry(owner, { connection: connection.id })).target_project).toBe('');
	});

	it('gives the copy of a source for a duplicate the target of its original', async () => {
		const haus = await owner.project(uniqueCode());
		const connection = await calendar(owner, { target_project: haus.id });
		const item = await entry(owner, { connection: connection.id });
		const ticket = await owner.ticket({ source_item: item.id });
		// The duplicate goes to another project; the copy still remembers the way of its original.
		const project = await owner.project(uniqueCode());
		const answer = await owner.client.send(`/api/byl/tickets/${ticket.id}/duplicate`, {
			method: 'POST',
			body: {
				title: 'Kopie',
				status: 'open',
				project: project.id,
				source: 'copy',
				description: false,
				priority: false,
				tags: false,
				due: false,
				parent: false,
				subtasks: false,
				comments: false
			}
		});
		const copy = await itemOf(answer.source);
		expect(copy.connection).toBe('');
		expect(copy.target_project).toBe(haus.id);
	});
});

describe('filter of the inbox', () => {
	it('finds the entries of a project with its sub projects and those without a target', async () => {
		const haus = await owner.project(uniqueCode());
		const garten = await owner.project(uniqueCode(), { parent: haus.id });
		const run = randomBytes(4).toString('hex');
		const inHaus = await entry(owner, { connection: (await calendar(owner, { target_project: haus.id })).id, title: `Haus ${run}` });
		const inGarten = await entry(owner, {
			connection: (await calendar(owner, { target_project: garten.id })).id,
			title: `Garten ${run}`
		});
		const without = await entry(owner, { title: `Ohne ${run}` });
		const items = owner.client.collection('inbox_items');
		const ids = async (filter, params) =>
			(await items.getFullList({ filter: owner.client.filter(`title ~ {:run} && (${filter})`, { run, ...params }) }))
				.map((found) => found.id)
				.sort();
		expect(await ids('target_project = {:p} || target_project.parent = {:p}', { p: haus.id })).toEqual(
			[inHaus.id, inGarten.id].sort()
		);
		expect(await ids('target_project = {:p}', { p: garten.id })).toEqual([inGarten.id]);
		expect(await ids('target_project = ""', {})).toEqual([without.id]);
		// Another user does not find them, not even through the relation.
		const foreign = await other.client
			.collection('inbox_items')
			.getFullList({ filter: other.client.filter('target_project = {:p}', { p: haus.id }) });
		expect(foreign).toEqual([]);
	});
});

describe('data layer of the web app', () => {
	it('reads the target of entries and filters handled ones on the server', async () => {
		const pb = owner.client;
		const haus = await owner.project(uniqueCode());
		const garten = await owner.project(uniqueCode(), { parent: haus.id });
		const inHaus = await entry(owner, { connection: (await calendar(owner, { target_project: haus.id })).id });
		const inGarten = await entry(owner, { connection: (await calendar(owner, { target_project: garten.id })).id });
		const without = await entry(owner);
		const items = owner.client.collection('inbox_items');
		for (const item of [inHaus, inGarten, without]) await items.update(item.id, { state: 'discarded' });

		const fresh = await entry(owner, { connection: (await calendar(owner, { target_project: haus.id })).id });
		const listed = (await listNewItems(pb)).find((item) => item.id === fresh.id);
		expect(listed).toMatchObject({ targetProjectId: haus.id });
		expect(listed).not.toHaveProperty('withoutTargetField');
		expect((await getItem(pb, without.id)).targetProjectId).toBeNull();

		const page = async (target) =>
			(await listHandledItems(pb, 'discarded', 1, { perPage: 200, target })).items.map((item) => item.id);
		const project = await page({ project: haus.id });
		expect(project).toEqual(expect.arrayContaining([inHaus.id, inGarten.id]));
		expect(project).not.toContain(without.id);
		expect(await page({ project: garten.id })).toEqual([inGarten.id]);
		const none = await page({ project: null });
		expect(none).toContain(without.id);
		expect(none).not.toContain(inHaus.id);
		expect(await page(null)).toEqual(expect.arrayContaining([inHaus.id, inGarten.id, without.id]));
	});

	it('sets the target of a connection and the targets of the cards, and reads them back', async () => {
		const pb = owner.client;
		const haus = await owner.project(uniqueCode());
		const connection = await calendar(owner);
		const saved = await setConnectionTarget(pb, connection.id, haus.id);
		expect(saved).toMatchObject({ id: connection.id, targetProjectId: haus.id, targetReady: true });
		expect((await listConnections(pb)).find((item) => item.id === connection.id)?.targetProjectId).toBe(haus.id);
		expect((await setConnectionTarget(pb, connection.id, null)).targetProjectId).toBeNull();

		expect(await getInboxTargets(pb)).toEqual({ api: '', 'whatsapp-web': '', files: '' });
		expect(await saveInboxTargets(pb, { api: '', 'whatsapp-web': haus.id, files: haus.id })).toEqual({
			api: '',
			'whatsapp-web': haus.id,
			files: haus.id
		});
		expect(await getInboxTargets(pb)).toEqual({ api: '', 'whatsapp-web': haus.id, files: haus.id });
		await saveInboxTargets(pb, { api: '', 'whatsapp-web': '', files: '' });
	});
});
