// Colors of projects and tickets (ADR-0052) against the shared disposable instance: the select
// fields of projects, tickets and rules take exactly the keys of the palette of the SPA, anything
// else is refused at its field and empty means none ("wie Projekt"); a changed own color of a
// ticket goes into its history with the acting user; "Duplizieren" takes the own color over when
// asked, for its sub-tasks each their own; the data layer of the SPA reads and writes the colors.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueCode } from '../support/scenario.mjs';
import { PROJECT_COLORS } from '../../web/src/lib/domain/colors.ts';
import { createProject, listProjects, updateProject } from '../../web/src/lib/data/projects.ts';
import { createRule, setRuleActive, updateRule } from '../../web/src/lib/data/recurrence.ts';
import { createTicket, getTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';

let superuser;
let owner;
const rulesToPause = [];

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
});

afterAll(async () => {
	for (const id of rulesToPause) await setRuleActive(owner.client, id, false);
});

function draft(overrides = {}) {
	return { title: 'Ticket', description: '', status: 'open', priority: 'medium', due: null, ...overrides };
}

/** A rule far in the future, so no ticket comes from it while the tests run. */
function ruleDraft(overrides = {}) {
	return {
		title: 'Rasen mähen',
		description: '',
		project: null,
		tags: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['SA'],
		month_day: 0,
		anchor: '2048-05-02 00:00:00.000Z',
		lead_days: 0,
		initial_status: 'open',
		...overrides
	};
}

const colorEntries = async (ticketId) =>
	(await historyOf(superuser, ticketId))
		.filter((entry) => entry.field === 'color')
		.map(({ old_value, new_value, user }) => ({ old_value, new_value, user }));

describe('colors of projects and tickets (ADR-0052)', () => {
	it('takes exactly the palette of the SPA in projects, tickets and rules', async () => {
		for (const name of ['projects', 'tickets', 'recurrence_rules']) {
			const collection = await superuser.collections.getOne(name);
			const field = collection.fields.find((candidate) => candidate.name === 'color');
			expect(field, name).toMatchObject({ type: 'select', required: false, maxSelect: 1 });
			expect(field.values, name).toEqual([...PROJECT_COLORS]);
		}
	});

	it('refuses a value outside of the palette at its field, keeps an empty one and sets a key', async () => {
		const project = await owner.project(uniqueCode(), { color: 'blau' });
		expect(project.color).toBe('blau');
		expect(await rejectionOf(owner.project(uniqueCode(), { color: 'rot' }))).toMatchObject({
			status: 400,
			codes: { color: 'validation_invalid_value' }
		});
		expect(await rejectionOf(owner.client.collection('projects').update(project.id, { color: '#ff0000' }))).toMatchObject({
			status: 400,
			codes: { color: 'validation_invalid_value' }
		});
		expect((await owner.client.collection('projects').update(project.id, { color: '' })).color).toBe('');

		const ticket = await owner.ticket({ project: project.id });
		expect(ticket.color).toBe('');
		expect(await rejectionOf(owner.client.collection('tickets').update(ticket.id, { color: 'Blau' }))).toMatchObject({
			status: 400,
			codes: { color: 'validation_invalid_value' }
		});
		expect((await owner.client.collection('tickets').update(ticket.id, { color: 'gruen' })).color).toBe('gruen');

		expect(
			await rejectionOf(owner.client.collection('recurrence_rules').create({ owner: owner.id, ...ruleDraft({ color: 'orange' }) }))
		).toMatchObject({ status: 400, codes: { color: 'validation_invalid_value' } });
	});

	it('records a changed own color in the history with the acting user, not the color of the project', async () => {
		const project = await owner.project(uniqueCode(), { color: 'blau' });
		const ticket = await owner.ticket({ project: project.id });
		await owner.client.collection('tickets').update(ticket.id, { color: 'senf' });
		await owner.client.collection('tickets').update(ticket.id, { color: 'violett' });
		await owner.client.collection('tickets').update(ticket.id, { color: '' });
		// The color of the project is no change of the ticket.
		await owner.client.collection('projects').update(project.id, { color: 'braun' });

		expect(await colorEntries(ticket.id)).toEqual([
			{ old_value: '', new_value: 'senf', user: owner.id },
			{ old_value: 'senf', new_value: 'violett', user: owner.id },
			{ old_value: 'violett', new_value: '', user: owner.id }
		]);
	});

	it('takes the own color over into a duplicate when asked, each sub-task its own', async () => {
		const parent = await owner.ticket({ title: 'Umzug', color: 'indigo' });
		const child = await owner.ticket({ title: 'Kartons', parent: parent.id, color: 'oliv' });
		const plain = await owner.ticket({ title: 'Lampen', parent: parent.id });
		const send = (color) =>
			owner.client.send(`/api/byl/tickets/${parent.id}/duplicate`, {
				method: 'POST',
				body: { title: 'Umzug 2', status: 'open', source: 'none', subtasks: true, color }
			});

		const withColor = await send(true);
		expect((await superuser.collection('tickets').getOne(withColor.id)).color).toBe('indigo');
		const children = await Promise.all(withColor.subtasks.map((sub) => superuser.collection('tickets').getOne(sub.id)));
		expect(children.map((sub) => [sub.title, sub.color])).toEqual([
			['Kartons', 'oliv'],
			['Lampen', '']
		]);
		expect(await colorEntries(withColor.id)).toEqual([]);

		const without = await send(false);
		expect((await superuser.collection('tickets').getOne(without.id)).color).toBe('');
		const plainChildren = await Promise.all(without.subtasks.map((sub) => superuser.collection('tickets').getOne(sub.id)));
		expect(plainChildren.map((sub) => sub.color)).toEqual(['', '']);
		// The original stays as it was.
		expect((await superuser.collection('tickets').getOne(child.id)).color).toBe('oliv');
		expect((await superuser.collection('tickets').getOne(plain.id)).color).toBe('');
	});
});

describe('web data layer: colors (ADR-0052)', () => {
	it('reads and writes the color of a project; none is null', async () => {
		const created = await createProject(owner.client, { name: 'Werkstatt', code: uniqueCode(), color: 'himmel' });
		expect(created).toMatchObject({ color: 'himmel' });
		expect(created).not.toHaveProperty('withoutColorField');
		const sub = await createProject(owner.client, { name: 'Regal', code: uniqueCode(), parentId: created.id });
		expect(sub.color).toBeNull();
		expect((await updateProject(owner.client, created.id, { color: null })).color).toBeNull();
		expect((await updateProject(owner.client, created.id, { color: 'grau' })).color).toBe('grau');
		const listed = (await listProjects(owner.client)).find((project) => project.id === created.id);
		expect(listed).toMatchObject({ color: 'grau', parentId: null });
	});

	it('reads and writes the own color of a ticket, with the color of its project expanded', async () => {
		const project = await createProject(owner.client, { name: 'Keller', code: uniqueCode(), color: 'braun' });
		const ticket = await createTicket(owner.client, draft({ project: project.id, color: 'tuerkis' }));
		expect(ticket).toMatchObject({ color: 'tuerkis', project: { id: project.id, color: 'braun' } });
		expect((await updateTicket(owner.client, ticket.id, { color: null })).color).toBeNull();
		expect((await getTicket(owner.client, ticket.id)).color).toBeNull();
		// Without a color nothing is sent, and the ticket has none.
		expect((await createTicket(owner.client, draft())).color).toBeNull();
	});

	it('reads and writes the color of the template of a rule', async () => {
		const rule = await createRule(owner.client, ruleDraft({ color: 'senf' }));
		rulesToPause.push(rule.id);
		expect(rule.color).toBe('senf');
		expect((await updateRule(owner.client, rule.id, { color: null })).color).toBeNull();
	});
});
