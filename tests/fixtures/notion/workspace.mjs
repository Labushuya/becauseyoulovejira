// Invented Notion workspace for the tests of the import (ADR-0041): one database "Aufgaben
// Haushalt" with a status, a date and other properties, one page "Wochenplan" with lists, and one
// page that is not shared. Every name, address and person is made up (example.com, "Anna
// Beispiel"); the shapes follow the Notion API 2026-03-11 (data sources, in_trash).

/** A UUID of the fixture: kind digit and number, e.g. id(1, 3). */
export function id(kind, number) {
	return `00000000-0000-4000-800${kind}-${String(number).padStart(12, '0')}`;
}

const ANNOTATIONS = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };

/** One rich text item. */
export function rt(content, annotations = {}, link = null) {
	return {
		type: 'text',
		text: { content, link: link === null ? null : { url: link } },
		annotations: { ...ANNOTATIONS, ...annotations },
		plain_text: content,
		href: link
	};
}

/** A date mention in rich text. */
export function dateMention(start) {
	return { type: 'mention', mention: { type: 'date', date: { start, end: null, time_zone: null } }, annotations: ANNOTATIONS, plain_text: start, href: null };
}

let clock = 0;
function stamp() {
	clock += 1;
	return `2026-09-01T08:${String(clock).padStart(2, '0')}:00.000Z`;
}

/** A block of `type` with its payload. */
export function block(number, type, payload = {}) {
	const time = stamp();
	return {
		object: 'block',
		id: id(3, number),
		parent: { type: 'page_id', page_id: id(2, 1) },
		created_time: time,
		last_edited_time: time,
		has_children: false,
		in_trash: false,
		type,
		[type]: payload
	};
}

export const DATA_SOURCE_ID = id(1, 1);
export const DATABASE_ID = id(1, 2);
export const PAGE_ID = id(2, 1);
export const HIDDEN_PAGE_ID = id(2, 2);
export const TOKEN = 'ntn_' + 'Testtoken0Beispiel0Nurfuertests0123456789';

const STATUS = {
	id: 'stat',
	name: 'Status',
	type: 'status',
	status: {
		options: [
			{ id: 'opt-todo', name: 'Nicht begonnen', color: 'default' },
			{ id: 'opt-doing', name: 'In Arbeit', color: 'blue' },
			{ id: 'opt-done', name: 'Erledigt', color: 'green' }
		],
		groups: [
			{ id: 'grp-1', name: 'To-do', color: 'gray', option_ids: ['opt-todo'] },
			{ id: 'grp-2', name: 'In progress', color: 'blue', option_ids: ['opt-doing'] },
			{ id: 'grp-3', name: 'Complete', color: 'green', option_ids: ['opt-done'] }
		]
	}
};

const SCHEMA = {
	Name: { id: 'title', name: 'Name', type: 'title', title: {} },
	Status: STATUS,
	'Fällig': { id: 'due', name: 'Fällig', type: 'date', date: {} },
	Tags: { id: 'tags', name: 'Tags', type: 'multi_select', multi_select: { options: [] } },
	'Zuständig': { id: 'ppl', name: 'Zuständig', type: 'people', people: {} },
	Notiz: { id: 'note', name: 'Notiz', type: 'rich_text', rich_text: {} },
	Link: { id: 'link', name: 'Link', type: 'url', url: {} },
	Wichtig: { id: 'imp', name: 'Wichtig', type: 'checkbox', checkbox: {} },
	Erinnerung: { id: 'rem', name: 'Erinnerung', type: 'date', date: {} }
};

function status(optionId) {
	const option = STATUS.status.options.find((entry) => entry.id === optionId);
	return { id: 'stat', type: 'status', status: option };
}

function row(number, title, values) {
	const time = stamp();
	return {
		object: 'page',
		id: id(4, number),
		created_time: time,
		last_edited_time: time,
		in_trash: false,
		parent: { type: 'data_source_id', data_source_id: DATA_SOURCE_ID, database_id: DATABASE_ID },
		url: `https://www.notion.so/${title.replace(/[^A-Za-z]+/g, '-')}-${id(4, number).replace(/-/g, '')}`,
		properties: {
			Name: { id: 'title', type: 'title', title: [rt(title)] },
			Status: status('opt-todo'),
			'Fällig': { id: 'due', type: 'date', date: null },
			Tags: { id: 'tags', type: 'multi_select', multi_select: [] },
			'Zuständig': { id: 'ppl', type: 'people', people: [] },
			Notiz: { id: 'note', type: 'rich_text', rich_text: [] },
			Link: { id: 'link', type: 'url', url: null },
			Wichtig: { id: 'imp', type: 'checkbox', checkbox: false },
			Erinnerung: { id: 'rem', type: 'date', date: null },
			...values
		}
	};
}

/** A fresh workspace; tests may change their copy. */
export function workspace() {
	clock = 0;
	const rows = [
		row(1, 'Fenster putzen', {
			'Fällig': { id: 'due', type: 'date', date: { start: '2026-10-05', end: null, time_zone: null } },
			Tags: { id: 'tags', type: 'multi_select', multi_select: [{ id: 't1', name: 'Haus', color: 'blue' }] },
			'Zuständig': { id: 'ppl', type: 'people', people: [{ object: 'user', id: id(9, 1), name: 'Anna Beispiel' }] },
			Notiz: { id: 'note', type: 'rich_text', rich_text: [rt('Auch '), rt('innen', { bold: true })] },
			Link: { id: 'link', type: 'url', url: 'https://example.com/fenster' },
			Wichtig: { id: 'imp', type: 'checkbox', checkbox: true }
		}),
		row(2, 'Steuererklärung abgeben', {
			Status: status('opt-doing'),
			'Fällig': { id: 'due', type: 'date', date: { start: '2026-10-31T14:30:00.000+01:00', end: null, time_zone: null } },
			Erinnerung: { id: 'rem', type: 'date', date: { start: '2026-10-20', end: null, time_zone: null } },
			Tags: { id: 'tags', type: 'multi_select', multi_select: [{ id: 't2', name: 'Büro', color: 'red' }, { id: 't3', name: 'Frist', color: 'red' }] }
		}),
		row(3, 'Keller aufräumen', { Status: status('opt-done') }),
		row(4, 'Ohne Datum', {}),
		row(5, 'Geschenk für Sam', {
			'Fällig': { id: 'due', type: 'date', date: { start: '2026-12-20', end: '2026-12-24', time_zone: null } }
		})
	];
	const page = {
		object: 'page',
		id: PAGE_ID,
		created_time: '2026-09-01T07:00:00.000Z',
		last_edited_time: '2026-09-02T07:00:00.000Z',
		in_trash: false,
		parent: { type: 'workspace', workspace: true },
		url: `https://www.notion.so/Wochenplan-${PAGE_ID.replace(/-/g, '')}`,
		properties: { title: { id: 'title', type: 'title', title: [rt('Wochenplan')] } }
	};
	const hidden = {
		...page,
		id: HIDDEN_PAGE_ID,
		url: `https://www.notion.so/Geheim-${HIDDEN_PAGE_ID.replace(/-/g, '')}`,
		properties: { title: { id: 'title', type: 'title', title: [rt('Geheim')] } }
	};
	const children = {
		[PAGE_ID]: [
			block(1, 'heading_2', { rich_text: [rt('Einkauf')], is_toggleable: false }),
			block(2, 'to_do', { rich_text: [rt('Milch')], checked: false }),
			block(3, 'to_do', { rich_text: [rt('Brot')], checked: true }),
			block(4, 'to_do', { rich_text: [rt('Äpfel')], checked: false }),
			block(5, 'heading_2', { rich_text: [rt('Termine')], is_toggleable: false }),
			block(6, 'bulleted_list_item', { rich_text: [rt('Zahnarzt anrufen '), dateMention('2026-10-02')] }),
			block(7, 'numbered_list_item', { rich_text: [rt('Erstens')] }),
			block(8, 'numbered_list_item', { rich_text: [rt('Formular '), rt('hier', {}, 'https://example.com/formular'), rt(' ausfüllen')] }),
			block(9, 'paragraph', { rich_text: [rt('Notiz ohne Liste')] }),
			block(10, 'toggle', { rich_text: [rt('Später')] }),
			block(11, 'child_page', { title: 'Unterseite' }),
			block(12, 'to_do', { rich_text: [], checked: false })
		],
		[id(3, 4)]: [block(20, 'bulleted_list_item', { rich_text: [rt('Boskop')] }), block(21, 'bulleted_list_item', { rich_text: [rt('Elstar')] })],
		[id(3, 10)]: [block(30, 'to_do', { rich_text: [rt('Garage streichen')], checked: false })],
		[id(3, 11)]: [block(40, 'to_do', { rich_text: [rt('Nicht lesen: Unterseite')], checked: false })],
		[id(4, 5)]: [
			block(50, 'heading_3', { rich_text: [rt('Ideen')], is_toggleable: false }),
			block(51, 'to_do', { rich_text: [rt('Buch')], checked: false }),
			block(52, 'to_do', { rich_text: [rt('Kino')], checked: true }),
			block(53, 'paragraph', { rich_text: [rt('Budget '), rt('30 €', { bold: true })] })
		],
		[HIDDEN_PAGE_ID]: [block(60, 'to_do', { rich_text: [rt('Nicht sichtbar')], checked: false })]
	};
	return {
		token: TOKEN,
		bot: { name: 'becauseyoulovejira', workspace_name: 'Beispiel-Arbeitsbereich' },
		pageSize: 3,
		dataSources: {
			[DATA_SOURCE_ID]: {
				object: 'data_source',
				id: DATA_SOURCE_ID,
				created_time: '2026-09-01T06:00:00.000Z',
				last_edited_time: '2026-09-03T06:00:00.000Z',
				in_trash: false,
				title: [rt('Aufgaben Haushalt')],
				parent: { type: 'database_id', database_id: DATABASE_ID },
				database_parent: { type: 'workspace', workspace: true },
				properties: SCHEMA
			}
		},
		rows: { [DATA_SOURCE_ID]: rows },
		pages: { [PAGE_ID]: page, [HIDDEN_PAGE_ID]: hidden },
		children,
		shared: new Set([DATA_SOURCE_ID, PAGE_ID])
	};
}
