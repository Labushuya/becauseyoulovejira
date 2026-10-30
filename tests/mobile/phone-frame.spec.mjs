// Smoke test of the phone frame (MO-1a, ADR-0073; manifest BYL-E6-1907 ff.) in the installed Chrome
// against the disposable instance of the global setup. On a phone (390 × 844, touch) with the switch
// "Handy-Ansicht (Vorschau)" on: the bottom bar at the bottom with targets of at least 44 px, no
// horizontal scrolling, "Mehr" as a sheet with every other view and the pages "nur am PC", the start
// at the day plan. With the switch off the view of today; on a PC no element of the frame.
// Since MO-1b (manifest BYL-E6-1950 ff.) on a small phone (360 × 800): a dialog, a menu and a picker
// as sheets at the bottom, a confirmation too, each with a visible "Schließen" of at least 44 px and
// without horizontal scrolling; the flags above the bottom bar and at the top while a sheet is open,
// never covered, their buttons of 44 px. With the switch off the same overlays stay as today.
// Since MO-2 (manifest BYL-E6-1965 ff.) the day plan on a small phone: the plan first, each entry
// "Haken · Titel · •••" with targets of 44 px and the title in at least 60 % of the row, moving
// through "•••" with its announcement, a check with one tap, the folded suggestions and
// "Hinzufügen …" after the plan, "Sortierung" as a sheet, no sideways scrolling at 360 and 412 px;
// on a PC the day plan as before.
// Since MO-4 (manifest BYL-E6-1995 ff.) the ticket as a page on a small phone: the arrow back
// instead of × and "Vollansicht", every target of 44 px, nothing scrolls sideways (long title, link,
// code, table), the fields one below the other, the bar with "Erledigt" and the status at the
// bottom, the toolbar of the editor wrapping, "Kommentieren" in view, the suggestions of the tags at
// their field, and the arrow back to the list with its sort and scroll position; on a PC the panel
// of today.
// Since MO-5 (manifest BYL-E6-2009 ff.) the quick entry on a small phone: one tap on "＋" and the
// line has the focus, its two buttons side by side stay in view above a keyboard (the window
// shrinks like with interactive-widget=resizes-content), Enter and both buttons save and keep the
// focus in the empty line, the result stands right below it, and "Ticket ansehen" goes back to the
// day plan through the history without the sheet; on a PC the dialog of today.
// Since MO-6 (manifest BYL-E6-2022 ff.) the inbox on a small phone: cards instead of the table with
// targets of 44 px and nothing scrolling sideways (a subject of one long word, a long sender and a
// long link), the filter sheet, the entry as a page whose arrow goes back to the list through the
// history, "Verwerfen" with "Rückgängig" above the bottom bar, "Umwandeln" as a page and back,
// "Erfassen" with the keys of the keyboard, "Aus Zwischenablage" with the field to paste into, and
// "Eintrag ansehen" of "＋" back to the day plan; on a PC the table of today.
// Since MO-7a (ADR-0073 addendum MO-7a, concept MO-0 §5: at most 15 cases) 13 cases instead of 19:
// cases with the same window and the same start share one sign-in (the start and "Mehr"; the view and
// the overlays of today with the switch off; four and two cases of the PC), every check of before
// stays. A locked entry of a menu is muted, and the region of the hints has a tabindex only for one
// step.
// Since MO-7b (manifest BYL-E6-2206 ff.) without a case of its own: "Projekte", "Wiederholungen" and
// "Papierkorb" in the case of "Mehr" (cards at 360 and 412 px, the title in at least 60 % of its card,
// the filter sheet, each page with its arrow back through the history, "Auswählen" in the trash), and
// the bar of the selection at the bottom in the case of "Aufgaben" (flat above the bottom bar, its
// actions behind "Aktionen", uncovered above a keyboard); on the PC the three lists keep their
// tables. The case of the ticket no longer waits for the focus after "Kommentieren": the form takes
// it back only while it is still in the form (M-1 of the review of MO-7a). Round 2 of MO-7b: Enter on
// the locked "Aktionen" names why in a flag, opened the focus is on the first action, and "Mehr"
// expects the number of the trash the server lists, as a whole number.
//
// The phone stands for another device in the home network (header X-Byl-Test-Remote-Address of the
// test hooks, only in instances of the harness), so the pages of the administrator are "nur am PC".
// Tickets and entries of the day plan come through the API of the invented account (MO-2).

import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { BROWSER_STEP_MS } from '../support/timing.mjs';
import { mobileInstance } from './instance.mjs';

const PHONE = {
	viewport: { width: 390, height: 844 },
	isMobile: true,
	hasTouch: true,
	deviceScaleFactor: 3
};
/** A small phone (MO-1b): the narrowest width the views must serve. */
const SMALL_PHONE = { ...PHONE, viewport: { width: 360, height: 800 } };
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const ANOTHER_DEVICE = { 'X-Byl-Test-Remote-Address': '192.168.178.66' };
const TARGET_PX = 44;
/** 44 px as the browser reports it at a device scale of 3 (see expectTarget). */
const TARGET_MIN_PX = TARGET_PX - 0.01;
const VIEWPORT_BASE = 'width=device-width, initial-scale=1';
const VIEWPORT_PHONE = `${VIEWPORT_BASE}, viewport-fit=cover, interactive-widget=resizes-content`;

/** The switch of this device before the first page, as the page "Darstellung" stores it. */
async function switchOn(page) {
	await page.addInitScript(() => localStorage.setItem('byl-mobile-layout', 'on'));
}

/** Signs in on the login page; the app then opens its start page. */
async function signIn(page) {
	const { url, email, password } = mobileInstance();
	await page.goto(`${url}/login`);
	await page.getByLabel('E-Mail').fill(email);
	await page.getByLabel('Passwort').fill(password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	return url;
}

/** Whether the page scrolls sideways. */
function scrollsSideways(page) {
	return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** Width and height of every element of `locator`. */
async function sizes(locator) {
	const boxes = [];
	for (const element of await locator.all()) boxes.push(await element.boundingBox());
	return boxes;
}

function viewportContent(page) {
	return page.locator('meta[name="viewport"]').getAttribute('content');
}

/** The heading of a view (SectionBar); in the phone frame it is there for screen readers only. */
function viewHeading(page, name) {
	return page.getByRole('heading', { level: 2, name, exact: true });
}

/** Waits until the element has slid or faded in (its animations are over). */
function settled(locator) {
	return locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
}

/** The element stands at the bottom of the window over its full width, as a sheet; its box. */
async function expectSheet(locator, viewport) {
	await expect(locator).toBeVisible();
	await settled(locator);
	const box = await locator.boundingBox();
	expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
	return box;
}

/**
 * A target of at least 44 × 44 px. The box comes back in CSS pixels converted from device pixels
 * (deviceScaleFactor 3), so 2.75rem may read as 43.99998; a hundredth of a pixel is no smaller target.
 */
async function expectTarget(locator) {
	const box = await locator.boundingBox();
	expect(box.width).toBeGreaterThanOrEqual(TARGET_MIN_PX);
	expect(box.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
}

/** Nothing lies over the middle of the element, and it stands inside the window. */
async function expectUncovered(locator, viewport) {
	const box = await locator.boundingBox();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
	const onTop = await locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		return hit !== null && element.contains(hit);
	});
	expect(onTop).toBe(true);
	return box;
}

/** A request of the invented account to the instance; a refusal names only method, path and status. */
async function api(method, path, body, token) {
	const response = await fetch(`${mobileInstance().url}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(BROWSER_STEP_MS)
	});
	if (!response.ok) throw new Error(`${method} ${path} of the smoke test answered ${response.status}.`);
	return response.json();
}

/** Today in Berlin, as the day plan counts it. */
function berlinToday() {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());
}

/**
 * Open tickets of the account with these titles (a run mark appended), each one with `planned` in
 * the day plan of today in this order, one with `dueToday` due today (a suggestion while it is not
 * planned). Returns their titles.
 */
async function seed(entries) {
	const { email, password } = mobileInstance();
	const { token, record } = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password });
	const mark = randomBytes(3).toString('hex');
	const titles = [];
	for (const { title, planned = false, dueToday = false } of entries) {
		const name = `${title} ${mark}`;
		const ticket = await api(
			'POST',
			'/api/collections/tickets/records',
			{ owner: record.id, title: name, ...(dueToday ? { due: `${berlinToday()} 00:00:00.000Z` } : {}) },
			token
		);
		if (planned) await api('POST', '/api/byl/dayplan/items', { ticket: ticket.id }, token);
		titles.push(name);
	}
	return titles;
}

/** Scrolls the element to the middle of the window, away from the bottom bar and its flags (MO-3). */
function toCentre(locator) {
	return locator.evaluate((element) => element.scrollIntoView({ block: 'center' }));
}

/** The share of the row that the title takes (MO-2: at least 60 % at 360 px). */
async function titleShare(row) {
	const whole = await row.boundingBox();
	const title = await row.locator('.title-cell').boundingBox();
	return title.width / whole.width;
}

const LONG_LINK = 'https://example.com/ein/sehr/langer/pfad/ohne/leerzeichen/der/nie/umbricht/und/weiter/geht/index.html?mit=vielen&parametern=1234567890';

/**
 * A ticket for the page of MO-4 (a run mark appended to its title): a title of one long word, a
 * description with a long link, a code block, a wide table and two tasks, a tag, a sub-task and a
 * comment with a long link and code; `others` further open tickets, so the list scrolls. Returns its
 * record and the titles.
 */
async function seedTicket(others) {
	const { email, password } = mobileInstance();
	const { token, record } = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password });
	const mark = randomBytes(3).toString('hex');
	const tag = await api('POST', '/api/collections/tags/records', { owner: record.id, name: `Garten ${mark}` }, token);
	const description = [
		`Ein langer Link: ${LONG_LINK}`,
		'',
		'```',
		'const eineSehrLangeZeileImCodeblock = "die nicht umbricht und breiter ist als jedes Handy";',
		'```',
		'',
		'| Spalte 1 | Spalte 2 | Spalte 3 | Spalte 4 | Spalte 5 | Spalte 6 | Spalte 7 |',
		'|---|---|---|---|---|---|---|',
		'| Inhalt | Inhalt | Inhalt | Inhalt | Inhalt | Inhalt | Inhalt |',
		'',
		'- [ ] Erste Aufgabe',
		'- [ ] Zweite Aufgabe'
	].join('\n');
	// Sorted by title, the ticket stands after the others, so the list has scrolled to reach it.
	const title = `Mmm_Steuererklärung_für_das_vergangene_Jahr_mit_allen_Belegen_der_Handwerker_${mark}`;
	const ticket = await api('POST', '/api/collections/tickets/records', { owner: record.id, title, description, tags: [tag.id], priority: 'high' }, token);
	const subtask = `Belege sortieren ${mark}`;
	await api('POST', '/api/collections/tickets/records', { owner: record.id, title: subtask, parent: ticket.id }, token);
	await api(
		'POST',
		'/api/collections/comments/records',
		{ ticket: ticket.id, author: record.id, body: `Siehe ${LONG_LINK}\n\n\`\`\`\nnoch_eine_lange_zeile_im_codeblock_des_kommentars_die_nicht_umbricht\n\`\`\`` },
		token
	);
	const titles = [];
	for (let index = 0; index < others; index++) {
		const name = `Ccc Füller ${String(index + 1).padStart(2, '0')} ${mark}`;
		await api('POST', '/api/collections/tickets/records', { owner: record.id, title: name }, token);
		titles.push(name);
	}
	return { ticket, title, subtask, tag: tag.name, others: titles };
}

/**
 * Entries of the inbox for MO-6 (a run mark appended to their titles), made up, never real mails: a
 * mail with a subject of one long word, a long sender, a long link and a text with a long link and
 * code, and two plain notes. Returns their records with the titles.
 */
async function seedInbox() {
	const { email, password } = mobileInstance();
	const { token, record } = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password });
	const mark = randomBytes(3).toString('hex');
	const create = (body) => api('POST', '/api/collections/inbox_items/records', { owner: record.id, ...body }, token);
	const mail = await create({
		channel: 'eml',
		kind: 'mail',
		title: `Rechnung_über_die_Reparatur_der_Heizungsanlage_im_Keller_vom_vergangenen_Winter_${mark}`,
		body: `Guten Tag,\n\nhier die Rechnung: ${LONG_LINK}\n\n\`\`\`\nRechnungsnummer-2026-0001-0002-0003-0004-0005-0006-0007-0008\n\`\`\``,
		source_url: LONG_LINK,
		source_ref: `<${mark}@example.com>`,
		source_meta: { from: `Anna Beispiel <anna.beispiel.mit.einer.sehr.langen.adresse.${mark}@example.com>` }
	});
	const note = await create({ channel: 'manual', kind: 'todo', title: `Paket abholen ${mark}` });
	const other = await create({ channel: 'manual', kind: 'todo', title: `Fahrrad reparieren ${mark}` });
	return { mail, note, other, mark };
}

/**
 * The visible targets inside `root` below 44 px: buttons, links, tabs, fields, the labels of check
 * marks and the entries of menus. Links inside a sentence or the text of a ticket (WCAG 2.5.8,
 * "inline") and the boxes inside their label count with the label; a task of the text counts with
 * the area around its box (prose.css).
 */
function smallTargets(root) {
	return root.evaluate((element) => {
		const small = [];
		for (const target of element.querySelectorAll('a[href], button, [role=tab], select, input:not([type=hidden]), [role=menuitem], label')) {
			if (target.tagName === 'A' && target.closest('p, .prose')) continue;
			if (target.tagName === 'LABEL' && target.querySelector('input[type=checkbox], input[type=radio]') === null) continue;
			if (target.tagName === 'INPUT' && target.closest('label') !== null && /^(checkbox|radio)$/.test(target.type)) continue;
			let rect = target.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0 || getComputedStyle(target).visibility === 'hidden') continue;
			if (target.tagName === 'INPUT' && target.closest('.prose li[data-task]') !== null) {
				const inset = Number.parseFloat(getComputedStyle(target, '::after').top) || 0;
				rect = { width: rect.width - 2 * inset, height: rect.height - 2 * inset };
			}
			if (rect.width < 43.99 || rect.height < 43.99) {
				const name = (target.getAttribute('aria-label') ?? target.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
				small.push(`${target.tagName.toLowerCase()} "${name}" ${Math.round(rect.width)}×${Math.round(rect.height)}`);
			}
		}
		return small;
	});
}

/** Whether the element scrolls sideways itself. */
function scrollsSidewaysInside(locator) {
	return locator.evaluate((element) => element.scrollWidth > element.clientWidth);
}

/** The page fills the window: the panel of an entry, a project, a rule or a form in the phone frame (MO-4). */
async function expectPageOf(locator, viewport) {
	await expect(locator).toBeVisible();
	await settled(locator);
	const box = await locator.boundingBox();
	expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
}

/** The share of a card that its title takes (MO-7b: no title below about 60 % of the card). */
async function cardTitleShare(card) {
	const whole = await card.boundingBox();
	const title = await card.locator('.card-title').boundingBox();
	return title.width / whole.width;
}

/** A deletion of the invented account; a ticket goes to the trash (ADR-0037). */
async function remove(path, token) {
	const response = await fetch(`${mobileInstance().url}${path}`, {
		method: 'DELETE',
		headers: { Authorization: token },
		signal: AbortSignal.timeout(BROWSER_STEP_MS)
	});
	if (!response.ok) throw new Error(`DELETE ${path} of the smoke test answered ${response.status}.`);
}

/** Capital letters A to Z for the code of a project. */
function letters(count) {
	return Array.from(randomBytes(count), (byte) => String.fromCharCode(65 + (byte % 26))).join('');
}

/**
 * The lists of MO-7b (a run mark appended), made up: a project with a name of one long word and a
 * sub project, a rule with a title of one long word, and two tickets in the trash, one with a title
 * of one long word. `trashCount` is the number of the trash as the server lists it afterwards: the two
 * and whatever another case put there before (round 2 of MO-7b, P-6).
 */
async function seedLists() {
	const { email, password } = mobileInstance();
	const { token, record } = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password });
	const mark = randomBytes(3).toString('hex');
	const projectName = `Renovierung_des_Dachbodens_mit_Dämmung_und_neuen_Fenstern_${mark}`;
	const project = await api('POST', '/api/collections/projects/records', { owner: record.id, name: projectName, code: letters(5) }, token);
	const subName = `Fenster ${mark}`;
	await api('POST', '/api/collections/projects/records', { owner: record.id, name: subName, code: letters(5), parent: project.id }, token);
	const ruleTitle = `Monatliche_Abrechnung_der_Nebenkosten_mit_allen_Belegen_${mark}`;
	await api(
		'POST',
		'/api/collections/recurrence_rules/records',
		{ owner: record.id, title: ruleTitle, description: '', priority: 'medium', initial_status: 'open', mode: 'calendar', freq: 'monthly', interval: 1, weekdays: [], month_day: 1, anchor: '2099-01-01', lead_days: 3 },
		token
	);
	const trashed = [];
	for (const title of [`Altes_Regal_im_Keller_abbauen_und_zum_Wertstoffhof_bringen_${mark}`, `Kaputte Lampe ${mark}`]) {
		const ticket = await api('POST', '/api/collections/tickets/records', { owner: record.id, title }, token);
		await remove(`/api/collections/tickets/records/${ticket.id}`, token);
		trashed.push(title);
	}
	const { items } = await api('GET', '/api/byl/trash', undefined, token);
	return { project: projectName, sub: subName, rule: ruleTitle, trashed, trashCount: items.length };
}

test.describe('phone with the switch on', () => {
	test.use({ ...PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	// MO-7a: the start and "Mehr" in one case (before two, each with its own sign-in). MO-7b: the views
	// under "Mehr" with lists ("Projekte", "Wiederholungen", "Papierkorb") in the same case.
	test('starts at the day plan with the bottom bar at the bottom, opens "Mehr" as a sheet with every other view and the pages "nur am PC", shows projects, rules and the trash as cards with their pages and the bar of the selection, and keeps "Aufgaben" a tap away', async ({ page }) => {
		const lists = await seedLists();
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await expect(viewHeading(page, 'Tagesplan')).toBeAttached();

		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(bar).toBeVisible();
		const entries = bar.locator('a, button');
		await expect(entries).toHaveText(['Tagesplan', 'Aufgaben', 'Erfassen', 'Eingang', 'Mehr']);
		for (const box of await sizes(entries)) {
			expect(box.width).toBeGreaterThanOrEqual(TARGET_PX);
			expect(box.height).toBeGreaterThanOrEqual(TARGET_PX);
		}
		const place = await bar.boundingBox();
		expect(place.x).toBe(0);
		expect(place.width).toBe(PHONE.viewport.width);
		expect(Math.abs(place.y + place.height - PHONE.viewport.height)).toBeLessThanOrEqual(1);
		await expect(bar.getByRole('link', { name: 'Tagesplan' })).toHaveAttribute('aria-current', 'page');

		// The top bar names the view; nothing of the header of the PC is left on the screen.
		await expect(page.getByRole('banner')).toContainText('Tagesplan');
		await expect(page.getByRole('navigation', { name: 'Ansicht' })).toHaveCount(0);
		await expect(page.locator('#new-ticket-link')).toHaveCount(0);
		expect(await viewportContent(page)).toBe(VIEWPORT_PHONE);
		expect(await scrollsSideways(page)).toBe(false);

		// "Mehr" from the start at the day plan.
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await bar.getByRole('button', { name: 'Mehr' }).click();
		const sheet = page.getByRole('dialog', { name: 'Mehr' });
		await expect(sheet).toBeVisible();
		const views = sheet.getByRole('navigation', { name: 'Ansichten' });
		// The trash names its number since the lists of MO-7b put two tickets into it: the number the
		// server lists, whole (no "2" of a "21").
		expect(lists.trashCount).toBeGreaterThanOrEqual(lists.trashed.length);
		await expect(views.getByRole('link')).toHaveText([
			'Projekte',
			'Wiederholungen',
			'Kalender',
			'Erledigte',
			new RegExp(`^\\s*Papierkorb ${lists.trashCount}\\b`)
		]);
		await expect(sheet.getByRole('link', { name: 'Neues Ticket' })).toBeVisible();
		const settings = sheet.getByRole('navigation', { name: 'Einstellungen' });
		await expect(settings.getByRole('link', { name: 'Darstellung' })).toBeVisible();
		await expect(settings.getByRole('link', { name: 'Hilfe' })).toBeAttached();
		await expect(settings.getByText(/^Verwaltung/)).toContainText('nur am PC');
		await expect(settings.getByRole('link', { name: 'Sicherheit nur am PC' })).toBeAttached();
		await expect(sheet.getByText(/^Angemeldet als/)).toContainText(mobileInstance().email);
		await expect(sheet.getByRole('button', { name: 'Abmelden' })).toBeAttached();
		for (const box of await sizes(views.getByRole('link'))) {
			expect(box.height).toBeGreaterThanOrEqual(TARGET_PX);
		}
		const close = sheet.getByRole('button', { name: 'Schließen' });
		const closeBox = await close.boundingBox();
		expect(closeBox.width).toBeGreaterThanOrEqual(TARGET_PX);
		expect(closeBox.height).toBeGreaterThanOrEqual(TARGET_PX);
		// A sheet: over the full width, at the bottom of the window, once it has slid in.
		await sheet
			.locator('.frame')
			.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
		const frame = await sheet.locator('.frame').boundingBox();
		expect(frame.width).toBe(PHONE.viewport.width);
		expect(Math.abs(frame.y + frame.height - PHONE.viewport.height)).toBeLessThanOrEqual(1);
		expect(await scrollsSideways(page)).toBe(false);

		await views.getByRole('link', { name: 'Kalender' }).click();
		await expect(page).toHaveURL(new RegExp(`^${url}/kalender`));
		await expect(sheet).toHaveCount(0);
		await expect(bar.getByRole('button', { name: 'Mehr, aktuell: Kalender' })).toBeVisible();

		// MO-7b on a small phone: "Projekte", "Wiederholungen" and "Papierkorb" two taps away, as cards
		// without sideways scrolling, every target of 44 px, the title in at least 60 % of its card; a tap
		// on a card opens its page, whose arrow goes back through the history without a second entry.
		const small = SMALL_PHONE.viewport;
		await page.setViewportSize(small);
		const historyLength = () => page.evaluate(() => window.history.length);
		/** A view under "Mehr": two taps. */
		async function openUnderMore(name) {
			await bar.getByRole('button', { name: /^Mehr/ }).tap();
			await page.getByRole('dialog', { name: 'Mehr' }).getByRole('navigation', { name: 'Ansichten' }).getByRole('link', { name }).tap();
			await expect(viewHeading(page, name)).toBeAttached();
		}
		async function expectCards(card) {
			await expect(card).toBeVisible();
			await expect(page.getByRole('table')).toHaveCount(0);
			expect(await scrollsSideways(page)).toBe(false);
			expect(await smallTargets(card.locator('xpath=..'))).toEqual([]);
			expect(await smallTargets(page.locator('.phone-tools'))).toEqual([]);
			expect(await cardTitleShare(card)).toBeGreaterThanOrEqual(0.6);
		}
		async function openAndBack(card, name, back, list) {
			const start = await historyLength();
			await card.locator('.card-meta').tap();
			const panel = page.getByRole('complementary', { name });
			await expectPageOf(panel, small);
			expect(await scrollsSideways(page)).toBe(false);
			expect(await scrollsSidewaysInside(panel.locator('.body').first())).toBe(false);
			expect(await smallTargets(panel)).toEqual([]);
			const arrow = panel.getByRole('button', { name: back, exact: true });
			await expectTarget(arrow);
			await arrow.tap();
			await expect(page).toHaveURL(list);
			await expect(panel).toHaveCount(0);
			expect(await historyLength()).toBe(start + 1);
		}

		await openUnderMore('Projekte');
		await expect(page).toHaveURL(`${url}/projekte`);
		const projectCard = (name) => page.locator('li[data-project-row]').filter({ has: page.getByRole('link', { name, exact: true }) });
		await expectCards(projectCard(lists.project));
		await expect(projectCard(lists.sub)).toHaveClass(/child/);
		// "Filter" opens the sheet with "Archivierte anzeigen" and the sort the cards have no headers for.
		await page.locator('.phone-tools').getByRole('button', { name: 'Filter', exact: true }).tap();
		const filters = page.getByRole('dialog', { name: 'Filter' });
		await expectSheet(filters.locator('.frame'), small);
		await expect(filters.getByRole('group', { name: 'Sortieren nach' })).toBeVisible();
		expect(await smallTargets(filters)).toEqual([]);
		await filters.getByRole('button', { name: /Projekte? anzeigen$/ }).tap();
		await expect(filters).toHaveCount(0);
		await openAndBack(projectCard(lists.project), lists.project, 'Zu den Projekten', `${url}/projekte`);

		await openUnderMore('Wiederholungen');
		const ruleCard = page.locator('li[data-rule-row]').filter({ hasText: lists.rule });
		await expectCards(ruleCard);
		await openAndBack(ruleCard, lists.rule, 'Zu den Wiederholungen', `${url}/wiederholungen`);

		await openUnderMore('Papierkorb');
		const trashCard = (title) => page.locator('li[data-trash-row]').filter({ hasText: title });
		const [shelf, lamp] = lists.trashed;
		await expectCards(trashCard(shelf));
		await openAndBack(trashCard(lamp), lamp, 'Zum Papierkorb', `${url}/papierkorb`);
		// "Auswählen": the bar of the selection, flat, fixed at the bottom right above the bottom bar,
		// also below the short list; "Aktionen" locked until a card is chosen, then one level deeper.
		await page.getByRole('button', { name: 'Weitere Aktionen der Liste' }).tap();
		await page.getByRole('menu', { name: 'Aktionen der Liste' }).getByRole('menuitem', { name: 'Auswählen' }).tap();
		const selection = page.locator('[data-selection-bar]');
		await expect(selection).toHaveAccessibleName('0 Tickets ausgewählt');
		await expectUncovered(selection.locator('.phone-row'), small);
		const flat = await selection.boundingBox();
		const tabs = await bar.boundingBox();
		expect(flat.height).toBeLessThanOrEqual(80);
		expect(flat.y + flat.height).toBeLessThanOrEqual(tabs.y);
		expect(tabs.y - (flat.y + flat.height)).toBeLessThanOrEqual(12);
		await expect(selection.getByRole('button', { name: 'Aktionen' })).toHaveAttribute('aria-disabled', 'true');
		// Round 2 (P-2): Enter on the locked "Aktionen" names why in a flag, not only to a screen reader.
		await selection.getByRole('button', { name: 'Aktionen' }).focus();
		await page.keyboard.press('Enter');
		const notes = page.getByRole('region', { name: 'Benachrichtigungen' });
		await expect(notes.getByRole('listitem').filter({ hasText: 'Erst Tickets auswählen.' })).toBeVisible();
		const closeNote = notes.getByRole('button', { name: 'Benachrichtigung schließen' });
		while ((await closeNote.count()) > 0) await closeNote.first().click();
		await expect(notes.getByRole('listitem')).toHaveCount(0);
		await trashCard(shelf).locator('.card-meta').tap();
		await expect(trashCard(shelf).getByRole('checkbox', { name: /auswählen$/ })).toBeChecked();
		await expect(selection).toHaveAccessibleName('1 Ticket ausgewählt');
		await selection.getByRole('button', { name: 'Aktionen' }).tap();
		// Round 2 (P-3): opened, the focus is on the first action.
		await expect(selection.getByRole('group', { name: 'Sammelaktionen' }).getByRole('button', { name: 'Wiederherstellen' })).toBeFocused();
		await expect(selection.getByRole('group', { name: 'Sammelaktionen' }).getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();
		expect(await smallTargets(selection)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);
		await selection.getByRole('button', { name: 'Fertig' }).tap();
		await expect(selection).toHaveCount(0);
		await expect(page.getByRole('checkbox', { name: /auswählen$/ })).toHaveCount(0);

		// A large phone: the three lists keep to their width, the titles their share.
		await page.setViewportSize({ width: 412, height: 915 });
		await expect(trashCard(shelf)).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
		expect(await cardTitleShare(trashCard(shelf))).toBeGreaterThanOrEqual(0.6);
		for (const [name, card] of [
			['Projekte', projectCard(lists.project)],
			['Wiederholungen', ruleCard]
		]) {
			await openUnderMore(name);
			await expect(card).toBeVisible();
			expect(await scrollsSideways(page)).toBe(false);
			expect(await cardTitleShare(card)).toBeGreaterThanOrEqual(0.6);
		}
		await page.setViewportSize(PHONE.viewport);

		// A tap on "Aufgaben" leads there: the day plan only opens first at the start of the app.
		await bar.getByRole('link', { name: 'Aufgaben' }).click();
		await expect(viewHeading(page, 'Aufgaben')).toBeAttached();
		await expect(page).toHaveURL(`${url}/`);
		await expect(bar.getByRole('link', { name: 'Aufgaben' })).toHaveAttribute('aria-current', 'page');
		expect(await scrollsSideways(page)).toBe(false);

		await bar.getByRole('button', { name: 'Erfassen' }).click();
		await expect(page.getByRole('dialog', { name: 'Schnellerfassung' })).toBeVisible();
	});
});

test.describe('small phone with the switch on: overlays (MO-1b)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	const viewport = SMALL_PHONE.viewport;

	test('shows dialogs, menus, pickers and questions as sheets with "Schließen", and the flags uncovered', async ({ page }) => {
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });

		// A dialog (the quick entry, size M) is a sheet; its × and its buttons have 44 px. Since MO-5
		// its footer holds only the two buttons that save; the × closes.
		await bar.getByRole('button', { name: 'Erfassen' }).click();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		await expectSheet(quick.locator('.frame'), viewport);
		await expectTarget(quick.getByRole('button', { name: 'Schließen', exact: true }));
		for (const name of ['In den Eingang', 'Ticket anlegen']) {
			expect((await quick.getByRole('button', { name, exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		}
		expect(await scrollsSideways(page)).toBe(false);
		const line = quick.getByLabel('Titel mit Kurzsyntax');
		await expect(line).toHaveAttribute('enterkeyhint', 'done');
		await line.fill('Fenster putzen');
		await line.press('Enter');
		await quick.getByRole('link', { name: 'Ticket ansehen' }).click();

		// The panel of the ticket is a page; its menu "•••" is a sheet with "Schließen" at its end.
		// Since MO-4 the arrow back to the day plan takes the place of the × in its head.
		const panel = page.getByRole('complementary', { name: 'Fenster putzen' });
		await expect(panel).toBeVisible();
		await expectTarget(panel.getByRole('button', { name: 'Zum Tagesplan' }));
		const more = panel.getByRole('button', { name: 'Weitere Aktionen', exact: true });
		await expectTarget(more);
		await more.click();
		const menu = page.getByRole('menu', { name: /^Weitere Aktionen für / });
		await expectSheet(menu, viewport);
		for (const box of await sizes(menu.getByRole('menuitem'))) {
			expect(box.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		}
		await expect(menu.getByRole('menuitem').last()).toHaveText('Schließen');
		expect(await scrollsSideways(page)).toBe(false);
		await menu.getByRole('menuitem', { name: 'Link kopieren' }).click();
		await expect(menu).toBeHidden();

		// The flag stands above the bottom bar, nothing covers it, its × has 44 px.
		const flags = page.getByRole('region', { name: 'Benachrichtigungen' });
		// "Link kopiert", or the error where the browser refuses the clipboard: a flag either way.
		const copied = flags.getByRole('listitem').filter({ hasText: /Link kopiert|Link konnte nicht/ });
		await expect(copied).toBeVisible();
		await settled(copied);
		const below = await expectUncovered(copied, viewport);
		expect(below.y + below.height).toBeLessThanOrEqual((await bar.boundingBox()).y);
		await expectTarget(copied.getByRole('button', { name: 'Benachrichtigung schließen' }));

		// While a sheet is open the flags stand at the top, above it.
		await more.click();
		const sheet = await expectSheet(menu, viewport);
		const above = await expectUncovered(copied, viewport);
		expect(above.y + above.height).toBeLessThanOrEqual(sheet.y);
		await menu.getByRole('menuitem', { name: 'Schließen', exact: true }).click();
		await expect(menu).toBeHidden();
		await expect(more).toBeFocused();

		// A question (size S) is a sheet as well, with buttons of 44 px.
		await more.click();
		await menu.getByRole('menuitem', { name: 'In den Papierkorb …' }).click();
		const question = page.getByRole('dialog', { name: /in den Papierkorb verschieben\?$/ });
		await expectSheet(question.locator('.frame'), viewport);
		for (const name of ['Schließen', 'Abbrechen', 'In den Papierkorb']) {
			await expectTarget(question.getByRole('button', { name, exact: true }));
		}
		await question.getByRole('button', { name: 'In den Papierkorb', exact: true }).click();
		await expect(panel).toBeHidden();

		// A flag in front of an open sheet stands at its top, uncovered, "Rückgängig" with 44 px.
		await bar.getByRole('button', { name: 'Erfassen' }).click();
		const frame = await expectSheet(quick.locator('.frame'), viewport);
		const moved = quick.getByRole('region', { name: 'Benachrichtigungen' }).getByRole('listitem').filter({ hasText: 'Papierkorb' });
		await expect(moved).toBeVisible();
		const top = await expectUncovered(moved, viewport);
		expect(top.y + top.height).toBeLessThanOrEqual(frame.y);
		await expectTarget(moved.getByRole('button', { name: 'Rückgängig' }));
		await quick.getByRole('button', { name: 'Schließen', exact: true }).click();
		await expect(quick).toHaveCount(0);

		// A picker is a sheet with the button "Schließen". Since MO-3 the choices of "Gruppieren" stand
		// in the filter sheet of "Aufgaben" (a sheet itself), and the picker "Projekt" in it opens as a
		// panel over the sheet.
		await bar.getByRole('link', { name: 'Aufgaben' }).click();
		await expect(viewHeading(page, 'Aufgaben')).toBeAttached();
		await page.getByRole('button', { name: 'Filter', exact: true }).click();
		const filterSheet = page.getByRole('dialog', { name: 'Filter' });
		await expectSheet(filterSheet.locator('.frame'), viewport);
		const none = filterSheet.getByRole('group', { name: 'Gruppieren', exact: true }).getByRole('radio', { name: 'Keine' });
		await expect(none).toBeChecked();
		expect((await none.locator('xpath=..').boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		const project = filterSheet.getByRole('button', { name: /^Projekt:/ });
		expect((await project.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		await project.click();
		const picker = page.getByRole('dialog', { name: 'Projekt' });
		await expectSheet(picker, viewport);
		await expect(picker.getByRole('radio', { name: 'Alle' })).toBeChecked();
		expect(await scrollsSideways(page)).toBe(false);
		const done = picker.getByRole('button', { name: 'Schließen', exact: true });
		await expectTarget(done);
		await done.click();
		await expect(picker).toBeHidden();
		await expect(project).toBeFocused();
	});
});

test.describe('small phone with the switch on: the day plan (MO-2)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	const viewport = SMALL_PHONE.viewport;

	test('shows the plan first with "Haken · Titel · •••", moves through "•••", checks with one tap and adds from "Hinzufügen …"', async ({ page }) => {
		const [laundry, flowers, doctor] = await seed([
			{ title: 'Wäsche aufhängen und danach den Keller gründlich aufräumen', planned: true },
			{ title: 'Blumen gießen', planned: true },
			{ title: 'Arzt anrufen', dueToday: true }
		]);
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const plan = page.getByRole('group', { name: 'Einträge des Plans' });
		const row = (title) => plan.locator('[data-item-id]').filter({ hasText: title });
		await expect(plan.locator('[data-item-id]')).toHaveCount(2);

		// A compact head right below the top bar: the day between its arrows of 44 px.
		const day = page.getByRole('navigation', { name: 'Tag des Plans' });
		const top = await page.getByRole('banner').boundingBox();
		expect((await day.boundingBox()).y - (top.y + top.height)).toBeLessThanOrEqual(24);
		await expectTarget(day.getByRole('link', { name: 'Vortag' }));
		await expectTarget(day.getByRole('link', { name: 'Folgetag' }));

		// Each entry is "Haken · Titel · •••": targets of 44 px, the title in at least 60 % of the row.
		for (const title of [laundry, flowers]) {
			await expectTarget(row(title).locator('.check-target'));
			await expectTarget(row(title).getByRole('button', { name: /^Weitere Aktionen für / }));
			await expect(row(title).getByRole('button', { name: /nach (oben|unten)$/ })).toHaveCount(0);
			expect(await titleShare(row(title))).toBeGreaterThanOrEqual(0.6);
		}
		expect(await scrollsSideways(page)).toBe(false);

		// The plan first; the suggestions and "Hinzufügen …" after it, folded, with 44 px.
		const last = await row(flowers).boundingBox();
		const suggestions = page.getByRole('button', { name: /^Vorschläge/ });
		await expect(suggestions).toHaveAttribute('aria-expanded', 'false');
		expect((await suggestions.boundingBox()).y).toBeGreaterThanOrEqual(last.y + last.height);
		expect((await suggestions.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		const add = page.getByRole('button', { name: 'Hinzufügen …' });
		await expect(add).toHaveAttribute('aria-expanded', 'false');
		expect((await add.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		// Open, a suggestion is a choice of 44 px; the chevron keeps its size.
		await suggestions.click();
		await expect(suggestions).toHaveAttribute('aria-expanded', 'true');
		const choice = page.getByRole('checkbox', { name: new RegExp(doctor) });
		expect((await choice.locator('xpath=..').boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		expect((await suggestions.locator('svg').boundingBox()).width).toBeLessThan(TARGET_PX / 2);
		await suggestions.click();

		// "Nach unten" is in "•••", a sheet; it moves the entry and says so, the focus stays on "•••".
		const more = row(laundry).getByRole('button', { name: /^Weitere Aktionen für / });
		await more.click();
		const menu = page.getByRole('menu', { name: /^Aktionen für / });
		await expectSheet(menu, viewport);
		const up = menu.getByRole('menuitem', { name: 'Nach oben' });
		await expect(up).toHaveAttribute('aria-disabled', 'true');
		// MO-7a: the locked entry is muted, in the color of muted text, unlike the entry beside it.
		const muted = await page.evaluate(() => {
			const probe = document.createElement('span');
			probe.style.color = 'var(--color-text-muted)';
			document.body.append(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		});
		const colorOf = (locator) => locator.evaluate((element) => getComputedStyle(element).color);
		expect(await colorOf(up)).toBe(muted);
		expect(await colorOf(menu.getByRole('menuitem', { name: 'Nach unten' }))).not.toBe(muted);
		await menu.getByRole('menuitem', { name: 'Nach unten' }).click();
		await expect(menu).toBeHidden();
		await expect(plan.locator('[data-item-id]').first()).toContainText(flowers);
		await expect(page.getByRole('status').filter({ hasText: /steht jetzt an Stelle 2 von 2\./ })).toHaveCount(1);
		await expect(more).toBeFocused();

		// "Sortierung" is a target of 44 px and opens as a sheet.
		const sort = page.getByRole('button', { name: /^Sortierung: / });
		expect((await sort.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		await sort.click();
		const sorting = page.getByRole('menu', { name: 'Sortierung' });
		await expectSheet(sorting, viewport);
		await sorting.getByRole('menuitem', { name: 'Schließen', exact: true }).click();
		await expect(sorting).toBeHidden();

		// "Hinzufügen …" opens the pool with its search; "+" with 44 px puts a ticket into the plan.
		await add.click();
		await expect(add).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('searchbox', { name: 'Pool durchsuchen' })).toBeVisible();
		const plus = page.locator('[data-pool-ticket]').filter({ hasText: doctor }).getByRole('button', { name: /zum Tagesplan$/ });
		await expectTarget(plus);
		await plus.click();
		await expect(row(doctor)).toBeVisible();
		expect(await titleShare(row(doctor))).toBeGreaterThanOrEqual(0.6);
		expect(await scrollsSideways(page)).toBe(false);

		// One tap anywhere in the target of 44 px checks, also beside the box itself.
		await row(flowers).locator('.check-target').tap({ position: { x: 3, y: 3 } });
		await expect(row(flowers).getByRole('checkbox')).toBeChecked();
		await expect(page.getByText('1/3 erledigt')).toBeVisible();

		// A large phone: no sideways scrolling either, the title keeps its share.
		await page.setViewportSize({ width: 412, height: 915 });
		await expect(row(laundry)).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
		expect(await titleShare(row(laundry))).toBeGreaterThanOrEqual(0.6);
	});
});

test.describe('small phone with the switch on: "Aufgaben" (MO-3)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	/** The window of the first screen of the concept (MO-0 §6: first card above 400 px at 360 × 780). */
	const viewport = { width: 360, height: 780 };

	test('shows the tasks as cards, filters and sorts in the sheet, checks with one tap and chooses by tap', async ({ page }) => {
		const [taxes, invoice, plants] = await seed([
			{ title: 'Steuererklärung für das vergangene Jahr fertig machen und dafür alle Belege der Handwerker zusammensuchen', dueToday: true },
			{ title: 'Strom ablesen' },
			{ title: 'Pflanzen umtopfen' }
		]);
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Aufgaben' }).click();
		await expect(viewHeading(page, 'Aufgaben')).toBeAttached();
		const cardOf = (title) => page.locator('li[data-ticket-id]').filter({ hasText: title });

		// Cards instead of the table; at 360 × 780 the first one starts in the first screen, above 400 px.
		await page.setViewportSize(viewport);
		await expect(cardOf(invoice)).toBeVisible();
		await expect(page.getByRole('table')).toHaveCount(0);
		expect((await page.locator('li[data-ticket-id]').first().boundingBox()).y).toBeLessThan(400);
		expect(await scrollsSideways(page)).toBe(false);

		// Each card: the check mark, "•••" and the status pill as targets of 44 px; the title whole up to three lines.
		for (const title of [taxes, invoice, plants]) {
			await expectTarget(cardOf(title).locator('.check-target'));
			await expectTarget(cardOf(title).getByRole('button', { name: /^Weitere Aktionen für / }));
			expect((await cardOf(title).getByRole('button', { name: /^Status von / }).boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		}
		const line = (await cardOf(invoice).locator('.title').boundingBox()).height;
		const long = (await cardOf(taxes).locator('.title').boundingBox()).height;
		expect(long).toBeGreaterThan(line * 1.5);
		expect(long).toBeLessThanOrEqual(line * 3 + 1);

		// "Filter" opens the sheet at the bottom; the sort is a choice there, a navigation with a history entry.
		const filter = page.getByRole('button', { name: 'Filter', exact: true });
		await expectTarget(filter);
		await filter.click();
		const sheet = page.getByRole('dialog', { name: 'Filter' });
		await expectSheet(sheet.locator('.frame'), viewport);
		const sortBy = sheet.getByRole('group', { name: 'Sortieren nach' });
		const byTitle = sortBy.getByRole('radio', { name: 'Titel' });
		expect((await byTitle.locator('xpath=..').boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		expect(await scrollsSideways(page)).toBe(false);
		await byTitle.check();
		await expect(page).toHaveURL(`${url}/?sort=titel`);
		const show = sheet.getByRole('button', { name: /Tickets? anzeigen$/ });
		await expectTarget(show);
		await show.click();
		await expect(sheet).toHaveCount(0);
		await expect(filter).toBeFocused();
		await expect(page.getByText('Sortiert nach Titel, A bis Z')).toBeVisible();
		const titles = await page.locator('li[data-ticket-id] .title-link').allTextContents();
		expect(titles.indexOf(plants)).toBeLessThan(titles.indexOf(taxes));
		expect(titles.indexOf(taxes)).toBeLessThan(titles.indexOf(invoice));
		// Back and forward as today.
		await page.goBack();
		await expect(page).toHaveURL(`${url}/`);
		await expect(page.getByText('Sortiert nach Titel, A bis Z')).toBeHidden();
		await page.goForward();
		await expect(page).toHaveURL(`${url}/?sort=titel`);

		// One tap anywhere in the target of the check mark completes; "Rückgängig" brings the card back.
		await cardOf(plants).locator('.check-target').tap({ position: { x: 3, y: 3 } });
		await expect(cardOf(plants)).toHaveCount(0);
		const flags = page.getByRole('region', { name: 'Benachrichtigungen' });
		await flags.getByRole('button', { name: 'Rückgängig' }).click();
		await expect(cardOf(plants)).toBeVisible();
		// The flag "… wieder offen." stands above the bottom bar for 8 s; closed, it covers no card.
		const closeFlag = flags.getByRole('button', { name: 'Benachrichtigung schließen' });
		await expect(flags.getByRole('listitem').filter({ hasText: 'wieder offen' })).toBeVisible();
		while ((await closeFlag.count()) > 0) await closeFlag.first().click();
		await expect(flags.getByRole('listitem')).toHaveCount(0);

		// "Auswählen" is in the menu of the list; "Bereich" chooses up to the next card tapped.
		await page.getByRole('button', { name: 'Weitere Aktionen der Liste' }).click();
		const list = page.getByRole('menu', { name: 'Aktionen der Liste' });
		await expectSheet(list, viewport);
		await list.getByRole('menuitem', { name: 'Auswählen' }).click();
		const choosing = page.getByRole('group', { name: 'Auswahl' });
		await expect(choosing).toBeVisible();
		// MO-7b: the bar of the selection stands from the start, flat and fixed at the bottom right above
		// the bottom bar, "Aktionen" locked while nothing is chosen.
		const tabBar = page.getByRole('navigation', { name: 'Hauptnavigation' });
		const chosen = page.locator('[data-selection-bar]');
		await expect(chosen).toHaveAccessibleName('0 Tickets ausgewählt');
		await expectUncovered(chosen.locator('.phone-row'), viewport);
		const flat = await chosen.boundingBox();
		const tabs = await tabBar.boundingBox();
		expect(flat.height).toBeLessThanOrEqual(80);
		expect(flat.y + flat.height).toBeLessThanOrEqual(tabs.y);
		expect(tabs.y - (flat.y + flat.height)).toBeLessThanOrEqual(12);
		await expect(chosen.getByRole('button', { name: 'Aktionen' })).toHaveAttribute('aria-disabled', 'true');
		await expectTarget(cardOf(plants).locator('.check-target'));
		await toCentre(cardOf(plants));
		await cardOf(plants).locator('.check-target').tap();
		const range = choosing.getByRole('button', { name: 'Bereich' });
		expect((await range.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		await range.click();
		await toCentre(cardOf(invoice));
		await cardOf(invoice).locator('.check-target').tap();
		for (const title of [plants, taxes, invoice]) {
			await expect(cardOf(title).getByRole('checkbox', { name: /auswählen$/ })).toBeChecked();
		}
		// The bulk actions one level deeper, behind "Aktionen", each a target of 44 px.
		await expect(chosen).toHaveAccessibleName('3 Tickets ausgewählt');
		await chosen.getByRole('button', { name: 'Aktionen' }).click();
		expect((await chosen.getByRole('button', { name: 'Erledigen' }).boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		expect(await smallTargets(chosen)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);
		// The keyboard covers nothing of it: with the focus in the search the bottom bar gives way, and in
		// the window above a keyboard the row with "Fertig" stays in view and uncovered.
		const typing = { width: 360, height: 500 };
		await page.getByRole('searchbox', { name: 'Suche' }).focus();
		await expect(tabBar).toBeHidden();
		await page.setViewportSize(typing);
		await expectUncovered(chosen.getByRole('button', { name: 'Fertig' }), typing);
		await page.setViewportSize(viewport);
		await chosen.getByRole('button', { name: 'Fertig' }).click();
		await expect(choosing).toHaveCount(0);
		await expect(chosen).toHaveCount(0);

		// A large phone: no sideways scrolling either, the cards stay.
		await page.setViewportSize({ width: 412, height: 915 });
		await expect(cardOf(taxes)).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
	});
});

test.describe('small phone with the switch on: the ticket as a page (MO-4)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	const viewport = SMALL_PHONE.viewport;

	test('opens the ticket as a page with targets of 44 px, edits it and goes back to the list with its sort and place', async ({ page }) => {
		const { ticket, title, subtask } = await seedTicket(12);
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await page.goto(`${url}/?sort=titel`);
		const card = page.locator('li[data-ticket-id]').filter({ hasText: title });
		await expect(card).toBeVisible();
		await toCentre(card);
		const scrolled = () => page.evaluate(() => window.scrollY);
		const place = await scrolled();
		expect(place).toBeGreaterThan(200);

		// A tap on the title opens the ticket as a page over the whole screen.
		await card.locator('.title-link').click();
		await expect(page).toHaveURL(`${url}/tickets/${ticket.id}?sort=titel`);
		const panel = page.getByRole('complementary', { name: title });
		await expect(panel).toBeVisible();
		await settled(panel);
		const box = await panel.boundingBox();
		expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);

		// The head: the arrow back, the pin and "•••", no × and no "Vollansicht öffnen".
		const back = panel.getByRole('button', { name: 'Zur Liste' });
		await expectTarget(back);
		await expectTarget(panel.getByRole('button', { name: /anheften$/ }));
		await expectTarget(panel.getByRole('button', { name: 'Weitere Aktionen', exact: true }));
		await expect(panel.getByRole('button', { name: 'Panel schließen' })).toHaveCount(0);
		await expect(panel.getByRole('link', { name: 'Vollansicht öffnen' })).toHaveCount(0);

		// Nothing scrolls sideways (one long word as title, link, code, table), every target has 44 px.
		const body = panel.locator('.body');
		expect(await scrollsSideways(page)).toBe(false);
		expect(await scrollsSidewaysInside(body)).toBe(false);
		expect(await smallTargets(panel)).toEqual([]);

		// The fields one below the other: the label above its value, over the width of the page.
		const label = await panel.getByText('Priorität', { exact: true }).boundingBox();
		const priority = await panel.getByLabel('Priorität').boundingBox();
		expect(label.y + label.height).toBeLessThanOrEqual(priority.y);
		expect(Math.abs(label.x - priority.x)).toBeLessThanOrEqual(1);

		// The bar at the bottom: "Erledigt" and the status; a tap asks about the open sub-task above them.
		const bar = panel.locator('[data-ticket-bar]');
		const done = bar.getByRole('checkbox', { name: /erledigt$/ });
		await expectTarget(done.locator('xpath=..'));
		await expectTarget(bar.getByLabel('Status'));
		const barTop = (await bar.boundingBox()).y;
		const foot = await panel.locator('footer').boundingBox();
		expect(Math.abs(foot.y + foot.height - viewport.height)).toBeLessThanOrEqual(1);
		await done.locator('xpath=..').tap();
		const question = bar.getByRole('heading', { name: /noch offen – trotzdem erledigen\?$/ });
		await expect(question).toBeVisible();
		await expectUncovered(question, viewport);
		await expectTarget(bar.getByRole('button', { name: 'Abbrechen' }));
		await bar.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(question).toHaveCount(0);
		await expect(bar.getByLabel('Status')).toHaveValue('open');
		await expect(panel.getByRole('link', { name: subtask })).toBeAttached();

		// A task of the text takes a tap beside its small box.
		const task = panel.getByRole('checkbox', { name: 'Erste Aufgabe' });
		await toCentre(task);
		const taskBox = await task.boundingBox();
		await page.touchscreen.tap(taskBox.x - 8, taskBox.y + taskBox.height / 2);
		await expect(task).toBeChecked();

		// The description: "Speichern" stays in view above the bar.
		await panel.getByRole('button', { name: /^Bearbeiten\s*:\s*Beschreibung$/ }).click();
		const save = panel.getByRole('button', { name: 'Speichern' });
		await expect(save).toBeVisible();
		expect(await smallTargets(panel)).toEqual([]);
		const saveBox = await expectUncovered(save, viewport);
		expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(barTop);
		await panel.getByRole('button', { name: 'Abbrechen' }).click();

		// A comment: the toolbar of the editor wraps with tools of 44 px, "Kommentieren" stays in view.
		await panel.getByRole('button', { name: 'Kommentar hinzufügen …' }).click();
		const toolbar = panel.getByRole('toolbar', { name: 'Formatierung' });
		await expect(toolbar).toBeVisible();
		expect(await scrollsSidewaysInside(toolbar)).toBe(false);
		expect((await toolbar.boundingBox()).height).toBeGreaterThan(2 * TARGET_PX);
		for (const tool of await toolbar.getByRole('button').all()) await expectTarget(tool);
		await expect(panel.getByRole('textbox', { name: 'Neuer Kommentar' })).toBeFocused();
		await page.keyboard.type('Am Handy angesehen');
		const send = panel.getByRole('button', { name: 'Kommentieren' });
		const sendBox = await expectUncovered(send, viewport);
		expect(sendBox.height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(barTop);
		await send.click();
		await expect(panel.getByText('Am Handy angesehen')).toBeVisible();
		// No wait for the focus before the next field since MO-7b: the form takes the focus back only
		// while it is still in the form (M-1), so typing into the tags right away keeps it there.

		// The suggestions of the tags stay at their field, with options of 44 px.
		const tags = panel.getByLabel('Tags', { exact: true });
		await toCentre(tags);
		await tags.fill('Neu');
		const suggestions = page.getByRole('listbox', { name: 'Vorschläge' });
		await expect(suggestions).toBeVisible();
		const field = await tags.boundingBox();
		const list = await suggestions.boundingBox();
		expect(list.width).toBeLessThan(viewport.width);
		expect(Math.min(Math.abs(list.y - (field.y + field.height)), Math.abs(list.y + list.height - field.y))).toBeLessThanOrEqual(8);
		for (const option of await suggestions.getByRole('option').all()) {
			expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		}
		await tags.press('Escape');
		await tags.fill('');
		expect(await scrollsSideways(page)).toBe(false);

		// The arrow goes back to the list with its sort and its place, through the history: "Vor"
		// opens the ticket again, there is no second entry of the list.
		await back.click();
		await expect(page).toHaveURL(`${url}/?sort=titel`);
		await expect(panel).toHaveCount(0);
		await expect.poll(async () => Math.abs((await scrolled()) - place)).toBeLessThanOrEqual(1);
		await page.goForward();
		await expect(panel).toBeVisible();
		// The back gesture of Android does the same.
		await page.goBack();
		await expect(page).toHaveURL(`${url}/?sort=titel`);
		await expect.poll(async () => Math.abs((await scrolled()) - place)).toBeLessThanOrEqual(1);

		// The menu of the card leaves out "In Vollansicht öffnen".
		await card.getByRole('button', { name: /^Weitere Aktionen für / }).click();
		const menu = page.getByRole('menu', { name: /^Weitere Aktionen für / });
		await expectSheet(menu, viewport);
		await expect(menu.getByRole('menuitem', { name: 'Im Seitenpanel öffnen' })).toBeVisible();
		await expect(menu.getByRole('menuitem', { name: 'In Vollansicht öffnen' })).toHaveCount(0);
		await menu.getByRole('menuitem', { name: 'Schließen', exact: true }).click();
		await expect(menu).toBeHidden();

		// A large phone: the page keeps to its width as well.
		await page.setViewportSize({ width: 412, height: 915 });
		await card.locator('.title-link').click();
		await expect(panel).toBeVisible();
		await settled(panel);
		expect(await scrollsSideways(page)).toBe(false);
		expect(await scrollsSidewaysInside(body)).toBe(false);
		expect(await smallTargets(panel)).toEqual([]);
	});
});

test.describe('small phone with the switch on: the quick entry (MO-5)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	const viewport = SMALL_PHONE.viewport;
	/** The window above an on-screen keyboard of 300 px: resizes-content shrinks it like this. */
	const typing = { width: 360, height: 500 };

	test('captures with "＋", typing and one tap, keeps the keyboard for the next line, and "Ticket ansehen" goes back without a loop', async ({ page }) => {
		const mark = randomBytes(3).toString('hex');
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });

		// One tap on "＋": the sheet, the focus in the line, ready to type; the bottom bar gives way.
		await bar.getByRole('button', { name: 'Erfassen' }).tap();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		await expectSheet(quick.locator('.frame'), viewport);
		const line = quick.getByLabel('Titel mit Kurzsyntax');
		await expect(line).toBeFocused();
		await expect(line).toHaveAttribute('enterkeyhint', 'done');
		await expect(line).toHaveAttribute('autocapitalize', 'sentences');
		await expect(bar).toBeHidden();

		// Two buttons side by side, "Ticket anlegen" on the right; no "Abbrechen", no keys, the help folded.
		const inbox = quick.getByRole('button', { name: 'In den Eingang', exact: true });
		const create = quick.getByRole('button', { name: 'Ticket anlegen', exact: true });
		await expect(quick.locator('.foot').getByRole('button')).toHaveText(['In den Eingang', 'Ticket anlegen']);
		const left = await inbox.boundingBox();
		const right = await create.boundingBox();
		expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
		expect(left.x + left.width).toBeLessThanOrEqual(right.x);
		await expect(quick.getByText(/Alt\+Enter/)).toHaveCount(0);
		const help = quick.locator('summary', { hasText: 'Hilfe zur Kurzsyntax' });
		await expectTarget(help);
		await expect(quick.locator('details')).not.toHaveAttribute('open', /.*/);
		expect(await smallTargets(quick)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);

		// The keyboard takes the lower part of the window: the line and both buttons stay in view.
		await page.setViewportSize(typing);
		await expectUncovered(line, typing);
		await expectUncovered(inbox, typing);
		await expectUncovered(create, typing);

		// Enter of the keyboard creates the ticket; the result stands right below the line, which is
		// empty and keeps the focus.
		await line.fill(`Fenster putzen ${mark}`);
		await line.press('Enter');
		const shown = quick.getByRole('link', { name: 'Ticket ansehen' });
		await expect(shown).toBeVisible();
		await expect(quick.getByText(/^Ticket .+ angelegt\./)).toBeVisible();
		await expectUncovered(shown, typing);
		await expectTarget(shown);
		await expect(line).toHaveValue('');
		await expect(line).toBeFocused();

		// "In den Eingang" without Alt, and "Ticket anlegen": one tap each, the focus stays in the line
		// all along (it never leaves it, so the keyboard does not close and open again).
		await line.evaluate((element) => {
			window.bylLineBlurs = 0;
			element.addEventListener('blur', () => (window.bylLineBlurs += 1));
		});
		const blurs = () => page.evaluate(() => window.bylLineBlurs);
		await line.fill(`Idee fürs Wochenende ${mark}`);
		await inbox.tap();
		await expect(quick.getByRole('link', { name: 'Eintrag ansehen' })).toBeVisible();
		await expect(line).toHaveValue('');
		await expect(line).toBeFocused();
		const title = `Rasen mähen ${mark}`;
		await line.fill(title);
		await create.tap();
		await expect(shown).toBeVisible();
		await expect(line).toHaveValue('');
		await expect(line).toBeFocused();
		expect(await blurs()).toBe(0);
		await expectUncovered(create, typing);
		await page.setViewportSize(viewport);
		expect(await scrollsSideways(page)).toBe(false);

		// "Ticket ansehen" opens the ticket as a page of the day plan. Its arrow goes back through the
		// history to the day plan without the sheet; "Vor" opens the ticket again: no second entry.
		const entries = () => page.evaluate(() => history.length);
		const start = await entries();
		await shown.tap();
		const ticket = page.getByRole('complementary', { name: title });
		await expect(ticket).toBeVisible();
		await expect(quick).toHaveCount(0);
		expect(await entries()).toBe(start + 1);
		await ticket.getByRole('button', { name: 'Zum Tagesplan' }).tap();
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await expect(ticket).toHaveCount(0);
		await expect(quick).toHaveCount(0);
		expect(await entries()).toBe(start + 1);
		await page.goForward();
		await expect(ticket).toBeVisible();
		// The back gesture of Android does the same.
		await page.goBack();
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await expect(ticket).toHaveCount(0);
		await expect(quick).toHaveCount(0);
		await expect(bar).toBeVisible();

		// A large phone: the sheet keeps to its width.
		const large = { width: 412, height: 915 };
		await page.setViewportSize(large);
		await bar.getByRole('button', { name: 'Erfassen' }).tap();
		await expectSheet(quick.locator('.frame'), large);
		expect(await smallTargets(quick)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);
	});
});

test.describe('small phone with the switch on: the inbox (MO-6)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });
	const viewport = SMALL_PHONE.viewport;

	/** The page fills the window: the panel of an entry or a form in the phone frame (MO-4). */
	async function expectPage(locator) {
		await expect(locator).toBeVisible();
		await settled(locator);
		const box = await locator.boundingBox();
		expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
	}

	test('shows the inbox as cards, opens an entry as a page and back without a loop, discards with "Rückgängig" and converts as a page', async ({ page }) => {
		const { mail, note, other } = await seedInbox();
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await bar.getByRole('link', { name: /^Eingang/ }).click();
		await expect(viewHeading(page, 'Eingang')).toBeAttached();
		const cardOf = (title) => page.locator('li[data-item-id]').filter({ hasText: title });

		// Cards instead of the table; the subject of one long word, the long sender and the link wrap.
		await expect(cardOf(mail.title)).toBeVisible();
		await expect(page.getByRole('table')).toHaveCount(0);
		expect(await scrollsSideways(page)).toBe(false);
		const title = cardOf(mail.title).locator('.card-title');
		expect(await scrollsSidewaysInside(title)).toBe(false);
		expect((await title.boundingBox()).width).toBeLessThan(viewport.width);
		expect(await smallTargets(page.locator('.card-list'))).toEqual([]);
		await expectTarget(cardOf(mail.title).getByRole('link', { name: /^Umwandeln/ }));
		await expectTarget(cardOf(mail.title).getByRole('button', { name: /^Verwerfen/ }));
		await expectTarget(cardOf(mail.title).getByRole('button', { name: /^Weitere Aktionen/ }));
		const tools = page.locator('.phone-tools');
		await expectTarget(tools.getByRole('link', { name: 'Erfassen' }));
		await expectTarget(tools.getByRole('button', { name: 'Filter', exact: true }));
		await expectTarget(tools.getByRole('button', { name: 'Weitere Aktionen der Liste' }));

		// "Filter" opens the sheet with the chips, "Zielprojekt" and the grouping, all 44 px.
		await tools.getByRole('button', { name: 'Filter', exact: true }).click();
		const sheet = page.getByRole('dialog', { name: 'Filter' });
		await expectSheet(sheet.locator('.frame'), viewport);
		await expect(sheet.getByRole('group', { name: 'Quelle' })).toBeVisible();
		await expect(sheet.getByRole('group', { name: 'Zustand' })).toBeVisible();
		expect(await smallTargets(sheet)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);
		await sheet.getByRole('button', { name: /Einträge? anzeigen$/ }).click();
		await expect(sheet).toHaveCount(0);

		// A tap on the card opens the entry as a page: the arrow instead of ×, nothing scrolls sideways.
		const entries = () => page.evaluate(() => history.length);
		const start = await entries();
		await cardOf(mail.title).locator('.card-meta').tap();
		await expect(page).toHaveURL(`${url}/eingang/${mail.id}`);
		const panel = page.getByRole('complementary', { name: mail.title });
		await expectPage(panel);
		const back = panel.getByRole('button', { name: 'Zum Eingang' });
		await expectTarget(back);
		await expect(panel.getByRole('button', { name: 'Panel schließen' })).toHaveCount(0);
		expect(await scrollsSideways(page)).toBe(false);
		expect(await scrollsSidewaysInside(panel.locator('.body').first())).toBe(false);
		expect(await smallTargets(panel)).toEqual([]);
		// The main actions side by side in the footer, the rest in "•••" as a sheet.
		const discard = panel.locator('footer').getByRole('button', { name: 'Verwerfen' });
		const convert = panel.locator('footer').getByRole('link', { name: 'Umwandeln' });
		expect(Math.abs((await discard.boundingBox()).y - (await convert.boundingBox()).y)).toBeLessThanOrEqual(1);
		await panel.getByRole('button', { name: 'Weitere Aktionen', exact: true }).click();
		const menu = page.getByRole('menu', { name: /^Weitere Aktionen für / });
		await expectSheet(menu, viewport);
		await expect(menu.getByRole('menuitem', { name: 'Mit Ticket verknüpfen …' })).toBeVisible();
		await menu.getByRole('menuitem', { name: 'Schließen', exact: true }).click();
		await expect(menu).toBeHidden();

		// The arrow goes back to the list through the history: no second entry, "Vor" opens it again.
		await back.tap();
		await expect(page).toHaveURL(`${url}/eingang`);
		await expect(panel).toHaveCount(0);
		expect(await entries()).toBe(start + 1);
		await page.goForward();
		await expect(panel).toBeVisible();
		// The back gesture of Android does the same.
		await page.goBack();
		await expect(page).toHaveURL(`${url}/eingang`);
		await expect(panel).toHaveCount(0);

		// "Verwerfen" on a card: it leaves, the flag above the bottom bar offers "Rückgängig".
		await cardOf(note.title).getByRole('button', { name: /^Verwerfen/ }).tap();
		await expect(cardOf(note.title)).toHaveCount(0);
		const flag = page.getByRole('region', { name: 'Benachrichtigungen' }).getByRole('listitem').filter({ hasText: 'verworfen' });
		await expect(flag).toBeVisible();
		await settled(flag);
		const flagBox = await expectUncovered(flag, viewport);
		expect(flagBox.y + flagBox.height).toBeLessThanOrEqual((await bar.boundingBox()).y);
		const undo = flag.getByRole('button', { name: 'Rückgängig' });
		await expectTarget(undo);
		await undo.tap();
		await expect(cardOf(note.title)).toBeVisible();

		// "Umwandeln" opens "Neues Ticket" from the entry as a page; its arrow goes back to the list.
		await cardOf(other.title).getByRole('link', { name: /^Umwandeln/ }).tap();
		await expect(page).toHaveURL(`${url}/tickets/neu?aus=${other.id}`);
		const form = page.getByRole('complementary', { name: 'Neues Ticket' });
		await expectPage(form);
		expect(await scrollsSideways(page)).toBe(false);
		await form.getByRole('button', { name: 'Zurück', exact: true }).tap();
		await expect(page).toHaveURL(`${url}/eingang`);
		await expect(form).toHaveCount(0);
		await expect(cardOf(other.title)).toBeVisible();

		// A large phone: no sideways scrolling either, in the list and in the entry.
		await page.setViewportSize({ width: 412, height: 915 });
		await expect(cardOf(mail.title)).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
		await cardOf(mail.title).locator('.card-meta').tap();
		await expect(panel).toBeVisible();
		await settled(panel);
		expect(await scrollsSideways(page)).toBe(false);
		expect(await scrollsSidewaysInside(panel.locator('.body').first())).toBe(false);
		expect(await smallTargets(panel)).toEqual([]);
	});

	test('captures with "Erfassen", pastes with "Aus Zwischenablage", and "Eintrag ansehen" of "＋" goes back to the day plan', async ({ page }) => {
		const mark = randomBytes(3).toString('hex');
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await bar.getByRole('link', { name: /^Eingang/ }).click();
		await expect(viewHeading(page, 'Eingang')).toBeAttached();

		// "Erfassen" is a page; the keyboard starts sentences with a capital and says what Enter does.
		const entries = () => page.evaluate(() => history.length);
		const start = await entries();
		await page.locator('.phone-tools').getByRole('link', { name: 'Erfassen' }).tap();
		const form = page.getByRole('complementary', { name: 'Erfassen' });
		await expectPage(form);
		const what = form.getByLabel(/^Was\?/);
		await expect(what).toHaveAttribute('autocapitalize', 'sentences');
		await expect(what).toHaveAttribute('enterkeyhint', 'done');
		await expect(form.getByText(/Strg\+Enter/)).toHaveCount(0);
		expect(await smallTargets(form)).toEqual([]);
		expect(await scrollsSideways(page)).toBe(false);
		// The arrow goes back to the list through the history.
		await form.getByRole('button', { name: 'Zum Eingang' }).tap();
		await expect(page).toHaveURL(`${url}/eingang`);
		expect(await entries()).toBe(start + 1);

		// "Aus Zwischenablage": the browser does not let the page read, so the dialog opens to paste into.
		await page.getByRole('button', { name: 'Weitere Aktionen der Liste' }).tap();
		const list = page.getByRole('menu', { name: 'Aktionen der Liste' });
		await expectSheet(list, viewport);
		await list.getByRole('menuitem', { name: 'Aus Zwischenablage' }).tap();
		const paste = page.getByRole('dialog', { name: 'Aus der Zwischenablage' });
		await expectSheet(paste.locator('.frame'), viewport);
		await expect(paste.getByText(/Lange ins Feld drücken/)).toBeVisible();
		await paste.getByLabel('Text').fill(`Notiz vom Handy ${mark}`);
		await paste.getByRole('button', { name: 'In den Eingang' }).tap();
		await expect(paste).toHaveCount(0);
		await expect(page.locator('li[data-item-id]').filter({ hasText: `Notiz vom Handy ${mark}` })).toBeVisible();

		// "＋" on the day plan, "In den Eingang", "Eintrag ansehen": the arrow leads back to the day plan.
		await bar.getByRole('link', { name: 'Tagesplan' }).tap();
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await bar.getByRole('button', { name: 'Erfassen' }).tap();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		await quick.getByLabel('Titel mit Kurzsyntax').fill(`Idee am Handy ${mark}`);
		await quick.getByRole('button', { name: 'In den Eingang', exact: true }).tap();
		const shown = quick.getByRole('link', { name: 'Eintrag ansehen' });
		await expect(shown).toBeVisible();
		const before = await entries();
		await shown.tap();
		const entry = page.getByRole('complementary', { name: `Idee am Handy ${mark}` });
		await expectPage(entry);
		await expect(quick).toHaveCount(0);
		expect(await entries()).toBe(before + 1);
		await entry.getByRole('button', { name: 'Zum Tagesplan' }).tap();
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await expect(entry).toHaveCount(0);
		await expect(quick).toHaveCount(0);
		expect(await entries()).toBe(before + 1);
		await page.goForward();
		await expect(entry).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(`${url}/tagesplan`);
		await expect(quick).toHaveCount(0);
	});
});

test.describe('small phone with the switch on: changes without a connection (OF-2)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	/** Open tickets of the account (a run mark appended) with the token, for checks through the API. */
	async function seedOpen(titles) {
		const { email, password } = mobileInstance();
		const { token, record } = await api('POST', '/api/collections/users/auth-with-password', { identity: email, password });
		const mark = randomBytes(3).toString('hex');
		const tickets = [];
		for (const title of titles) {
			tickets.push(await api('POST', '/api/collections/tickets/records', { owner: record.id, title: `${title} ${mark}` }, token));
		}
		return { token, tickets, user: record.id };
	}

	/** Signs in, waits until the outbox knows the server and has its storage, and opens "Aufgaben". */
	async function openTasks(page) {
		const asked = page.waitForResponse((response) => response.url().endsWith('/api/byl/tickets/create') && response.request().method() === 'GET');
		await switchOn(page);
		const url = await signIn(page);
		await asked;
		await page.waitForFunction(async () => (await indexedDB.databases()).some((database) => database.name === 'byl-offline'));
		await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Aufgaben' }).click();
		await expect(viewHeading(page, 'Aufgaben')).toBeAttached();
		return url;
	}

	test('keeps a check mark without a connection, sends it once the connection is back, and the history says "offline … laut Gerät"', async ({ page, context }) => {
		const { token, tickets, user } = await seedOpen(['Müll rausbringen']);
		const [trash] = tickets;
		await openTasks(page);
		const card = page.locator(`li[data-ticket-id="${trash.id}"]`);
		await expect(card).toBeVisible();

		await context.setOffline(true);
		await card.locator('.check-target').tap({ position: { x: 3, y: 3 } });
		await expect(card).toHaveCount(0);
		const flags = page.getByRole('region', { name: 'Benachrichtigungen' });
		const flag = flags.getByRole('listitem').filter({ hasText: `${trash.key} erledigt.` });
		await expect(flag).toContainText('Wird übertragen, sobald die Verbindung zurück ist.');
		await expectTarget(flag.getByRole('button', { name: 'Rückgängig' }));
		const symbol = page.getByRole('button', { name: 'Offline, 1 Änderung gemerkt' });
		await expect(symbol).toBeVisible();
		await expectTarget(symbol);
		await expect(page.getByText('Keine Verbindung. 1 Änderung ist gemerkt und wird übertragen, sobald die Verbindung zurück ist.')).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
		expect((await api('GET', `/api/collections/tickets/records/${trash.id}`, undefined, token)).status).toBe('open');

		await context.setOffline(false);
		await expect(flags.getByRole('listitem').filter({ hasText: '1 Änderung übertragen.' })).toBeVisible();
		await expect(symbol).toHaveCount(0);
		expect((await api('GET', `/api/collections/tickets/records/${trash.id}`, undefined, token)).status).toBe('done');
		const history = await api('GET', `/api/collections/ticket_history/records?filter=${encodeURIComponent(`ticket='${trash.id}' && field='status'`)}`, undefined, token);
		expect(history.items).toHaveLength(1);
		expect(history.items[0]).toMatchObject({ offline: true });
		expect(history.items[0].device_at).not.toBe('');

		// OF-4a: "＋" without a connection keeps the ticket under an ID of the client and shows it as "Neu";
		// once the connection is back the server has exactly one ticket with a key, in the same card.
		const created = `Zahnarzt anrufen ${randomBytes(3).toString('hex')}`;
		await context.setOffline(true);
		await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name: 'Erfassen' }).tap();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		await quick.getByLabel('Titel mit Kurzsyntax').fill(created);
		await quick.getByRole('button', { name: 'Ticket anlegen', exact: true }).tap();
		await expect(quick.getByText(`Ticket „${created}“ gemerkt. Es wird angelegt, sobald die Verbindung zurück ist.`)).toBeVisible();
		await quick.getByRole('button', { name: 'Schließen' }).first().tap();
		const kept = page.locator('li.card', { hasText: created });
		await expect(kept.locator('.key')).toHaveText(/^Neu/);
		await expect(kept.locator('.pending-mark')).toHaveCount(1);
		// OF-4b: a comment on the new ticket without a connection is kept behind its creation and shows at
		// once with its mark and "Offline geschrieben um … (laut Gerät)".
		const remark = `Rückruf bis Freitag ${randomBytes(3).toString('hex')}`;
		await kept.locator('.title-link').click();
		const sheet = page.getByRole('complementary', { name: created });
		await expect(sheet).toBeVisible();
		await sheet.getByRole('button', { name: 'Kommentar hinzufügen …' }).click();
		await expect(sheet.getByRole('textbox', { name: 'Neuer Kommentar' })).toBeFocused();
		await page.keyboard.type(remark);
		await sheet.getByRole('button', { name: 'Kommentieren' }).click();
		const note = sheet.locator('article', { hasText: remark });
		await expect(note).toContainText('Offline geschrieben um');
		await expect(note.locator('.pending-mark')).toHaveCount(1);
		await sheet.getByRole('button', { name: 'Zur Liste' }).click();
		await context.setOffline(false);
		await expect(kept.locator('.key')).toHaveText(/TASK-\d+$/);
		await expect(kept.locator('.pending-mark')).toHaveCount(0);
		const found = await api('GET', `/api/collections/tickets/records?filter=${encodeURIComponent(`title='${created}'`)}`, undefined, token);
		expect(found.items).toHaveLength(1);
		expect(found.items[0].key).toMatch(/^TASK-\d+$/);
		expect(await kept.getAttribute('data-ticket-id')).toBe(found.items[0].id);
		// Both arrived in the right order: the comment on the ticket, written after it, with the mark.
		const notesOf = async () =>
			(await api('GET', `/api/collections/comments/records?filter=${encodeURIComponent(`ticket='${found.items[0].id}'`)}`, undefined, token)).items;
		await expect.poll(async () => (await notesOf()).length).toBe(1);
		const [arrived] = await notesOf();
		expect(arrived.body.trim()).toBe(remark);
		expect(arrived).toMatchObject({ offline: true });
		expect(arrived.device_at).not.toBe('');
		expect(arrived.created >= found.items[0].created).toBe(true);

		// OF-3c: a change older than 7 days, as a closed tab left it in IndexedDB. The start after a reload
		// deletes it with its notice in one transaction; the notice stays on the device until "Schließen",
		// which deletes it there as well and leaves the focus in the hints.
		const action = {
			v: 1, op: 'smokeof3cdropped0001', seq: 999_999, user, scope: `u:${user}`, kind: 'ticket.update', target: trash.id, dependsOn: [],
			payload: { status: 'in_progress' }, expected: { status: 'done' }, key: trash.key, title: trash.title,
			createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000 - 60_000, state: 'queued', attempts: 0, nextAttemptAt: 0
		};
		/** Runs one request of IndexedDB "byl-offline" in the page: `put` an action, or `get` the notices of the account. */
		const device = (step) =>
			page.evaluate(
				({ step, action, user }) =>
					new Promise((resolve, reject) => {
						const open = indexedDB.open('byl-offline');
						open.onerror = () => reject(open.error);
						open.onsuccess = () => {
							const db = open.result;
							const store = step === 'put' ? 'actions' : 'meta';
							const request = db.transaction(store, step === 'put' ? 'readwrite' : 'readonly').objectStore(store)[step](step === 'put' ? action : `notices:${user}`);
							request.onerror = () => reject(request.error);
							request.onsuccess = () => {
								db.close();
								resolve(request.result ?? null);
							};
						};
					}),
				{ step, action, user }
			);
		await device('put');
		await page.reload();
		const dropped = `1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: ${trash.key}. Bitte im Ticket prüfen.`;
		const hints = page.locator('.offline-notice');
		await expect(hints.getByText(dropped)).toBeVisible();
		expect(await device('get')).toMatchObject([{ v: 1, kind: 'dropped', entries: [{ op: action.op, key: trash.key }] }]);
		// MO-7a: the region of the hints has no tabindex of its own, only for the step after "Schließen".
		await expect(hints).not.toHaveAttribute('tabindex');
		const close = hints.getByRole('button', { name: 'Schließen' });
		await expectTarget(close);
		await close.click();
		await expect(hints.getByText(dropped)).toHaveCount(0);
		await expect(hints).toBeFocused();
		await expect(hints).toHaveAttribute('tabindex', '-1');
		await expect.poll(() => device('get')).toBeNull();
	});

	test('shows a conflict with another device in the dialog instead of overwriting, and "Meine Änderung übernehmen" sends it', async ({ page, context }) => {
		const { token, tickets } = await seedOpen(['Strom ablesen']);
		const [meter] = tickets;
		await openTasks(page);
		const card = page.locator(`li[data-ticket-id="${meter.id}"]`);
		await expect(card).toBeVisible();

		await context.setOffline(true);
		await card.locator('.check-target').tap({ position: { x: 3, y: 3 } });
		await expect(page.getByRole('button', { name: 'Offline, 1 Änderung gemerkt' })).toBeVisible();
		// Meanwhile another device sets the status to "Wartet".
		await api('PATCH', `/api/collections/tickets/records/${meter.id}`, { status: 'waiting' }, token);

		await context.setOffline(false);
		const notice = page.getByText(`1 Änderung braucht deine Entscheidung: ${meter.key} wurde inzwischen geändert.`);
		await expect(notice).toBeVisible();
		expect((await api('GET', `/api/collections/tickets/records/${meter.id}`, undefined, token)).status).toBe('waiting');
		await page.locator('.offline-notice').getByRole('button', { name: 'Ansehen' }).click();
		const dialog = page.getByRole('dialog', { name: 'Gemerkte Änderungen' });
		await expectSheet(dialog.locator('.frame'), SMALL_PHONE.viewport);
		await expect(dialog).toContainText('Inzwischen: Der Status steht auf „Wartet“');
		const mine = dialog.getByRole('button', { name: 'Meine Änderung übernehmen' });
		await expectTarget(mine);
		expect(await scrollsSideways(page)).toBe(false);
		await mine.click();
		await expect(dialog).toContainText('Keine gemerkten Änderungen.');
		expect((await api('GET', `/api/collections/tickets/records/${meter.id}`, undefined, token)).status).toBe('done');
	});
});

test.describe('phone with the switch off', () => {
	test.use({ ...PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	// MO-7a: the view of today and the overlays of today (MO-1b, before a case of its own on a small
	// phone) in one case; the overlays on the small phone, the switch again on the phone.
	test('shows the view of today with the switch reachable, a dialog in the middle and a picker at its button, without "Schließen"', async ({ page }) => {
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/`);
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
		await expect(page.locator('[data-phone-frame]')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Ansicht' })).toBeVisible();
		await expect(page.getByRole('banner').getByRole('button', { name: 'Abmelden' })).toBeVisible();
		expect(await viewportContent(page)).toBe(VIEWPORT_BASE);

		// The overlays as today (MO-1b) on a small phone: a dialog in the middle, a picker at its button.
		await page.setViewportSize(SMALL_PHONE.viewport);
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await page.getByRole('banner').getByRole('button', { name: /Schnellerfassung/ }).click();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		const frame = quick.locator('.frame');
		await expect(frame).toBeVisible();
		await settled(frame);
		const box = await frame.boundingBox();
		expect(box.width).toBeLessThan(SMALL_PHONE.viewport.width);
		expect(box.y + box.height).toBeLessThan(SMALL_PHONE.viewport.height - 1);
		await quick.getByRole('button', { name: 'Schließen', exact: true }).click();
		await expect(quick).toHaveCount(0);

		const group = page.getByRole('button', { name: 'Gruppieren', exact: true });
		await group.click();
		const picker = page.getByRole('dialog', { name: 'Gruppieren' });
		await expect(picker).toBeVisible();
		await settled(picker);
		expect((await picker.boundingBox()).width).toBeLessThan(SMALL_PHONE.viewport.width);
		await expect(picker.getByRole('button', { name: 'Schließen' })).toHaveCount(0);
		expect(await scrollsSideways(page)).toBe(false);
		await page.keyboard.press('Escape');
		await expect(picker).toBeHidden();
		await page.setViewportSize(PHONE.viewport);

		// The gear of the header, then "Darstellung": the switch turns the frame on at once.
		await page.getByRole('banner').getByRole('link', { name: 'Einstellungen' }).click();
		await page.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Darstellung' }).click();
		const control = page.getByRole('switch', { name: 'Handy-Ansicht (Vorschau)' });
		await expect(control).not.toBeChecked();
		await control.check();
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
		expect(await viewportContent(page)).toBe(VIEWPORT_PHONE);
	});
});

test.describe('PC with the switch on', () => {
	test.use(DESKTOP);

	// MO-7a: the start, "Aufgaben", the quick entry and the side panel of the PC in one case (before
	// four, each with its own sign-in); the day plan and the inbox in the next.
	test('shows no element of the phone frame and keeps "Aufgaben", its table, the quick entry and the side panel of the PC (MO-1a, MO-3, MO-4, MO-5)', async ({ page }) => {
		const [open, cellar] = await seed([{ title: 'Garage aufräumen' }, { title: 'Keller entrümpeln' }]);
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/`);
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await expect(page.locator('[data-phone-frame]')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Ansicht' })).toBeVisible();
		const header = page.getByRole('banner');
		await expect(header.getByRole('link', { name: 'Neues Ticket' })).toBeVisible();
		await expect(header.getByRole('button', { name: 'Abmelden' })).toBeVisible();
		expect(await header.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
		await expect(page.locator('html')).toHaveAttribute('data-mobile-layout', 'on');
		expect(await viewportContent(page)).toBe(VIEWPORT_BASE);
		expect(await scrollsSideways(page)).toBe(false);

		// The table of "Aufgaben" on the PC: the filter bar, "Gruppieren", "Spalten", no cards (MO-3).
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();
		await expect(page.getByRole('row').filter({ hasText: open })).toBeVisible();
		await expect(page.locator('li[data-ticket-id]')).toHaveCount(0);
		await expect(page.getByRole('group', { name: 'Filter-Karten' })).toBeVisible();
		await expect(page.getByRole('region', { name: 'Filter' })).toBeVisible();
		await expect(page.getByRole('searchbox', { name: 'Suche' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Gruppieren', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Spalten' })).toBeVisible();
		await expect(page.getByRole('checkbox', { name: 'Alle angezeigten Tickets auswählen' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
		expect(await scrollsSideways(page)).toBe(false);

		// The quick entry of the PC: in the middle with "Abbrechen", the keys in the hint, no folded help (MO-5).
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await page.getByRole('banner').getByRole('button', { name: /Schnellerfassung/ }).click();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		const frame = quick.locator('.frame');
		await expect(frame).toBeVisible();
		await settled(frame);
		const box = await frame.boundingBox();
		expect(box.width).toBeLessThan(DESKTOP.viewport.width / 2);
		expect(box.y + box.height).toBeLessThan(DESKTOP.viewport.height - 1);
		await expect(quick.locator('.foot').getByRole('button')).toHaveText(['Abbrechen', 'In den Eingang', 'Ticket anlegen']);
		await expect(quick.getByText(/^Enter legt ein Ticket an, Alt\+Enter legt es in den Eingang\./)).toBeVisible();
		await expect(quick.locator('details')).toHaveCount(0);
		const line = quick.getByLabel('Titel mit Kurzsyntax');
		await expect(line).toBeFocused();
		expect(await line.evaluate((element) => element.hasAttribute('autocapitalize'))).toBe(false);
		await quick.getByRole('button', { name: 'Abbrechen' }).click();
		await expect(quick).toHaveCount(0);

		// The side panel of the PC: ×, "Vollansicht", the status in the fields, no bar (MO-4).
		await expect(page.getByRole('table')).toBeVisible();
		const row = page.getByRole('row').filter({ hasText: cellar });
		await row.getByRole('button', { name: /^Weitere Aktionen für / }).click();
		const menu = page.getByRole('menu', { name: /^Weitere Aktionen für / });
		await expect(menu.getByRole('menuitem', { name: 'In Vollansicht öffnen' })).toBeVisible();
		await page.keyboard.press('Escape');
		await row.getByRole('link', { name: cellar }).click();
		const panel = page.getByRole('complementary', { name: cellar });
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Panel schließen' })).toBeVisible();
		await expect(panel.getByRole('link', { name: 'Vollansicht öffnen' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Zur Liste' })).toHaveCount(0);
		await expect(panel.locator('[data-ticket-bar]')).toHaveCount(0);
		await expect(panel.locator('footer')).toHaveCount(0);
		const label = await panel.getByText('Priorität', { exact: true }).boundingBox();
		const priority = await panel.getByLabel('Priorität').boundingBox();
		expect(priority.x).toBeGreaterThan(label.x + label.width);
		await expect(panel.getByLabel('Status')).toBeVisible();
		expect(await scrollsSideways(page)).toBe(false);
	});

	// MO-7a: the day plan (MO-2) and the inbox (MO-6) of the PC in one case (before two).
	test('keeps the day plan and the inbox of the PC: arrows and handle, suggestions before the plan, the pool beside it; table, chips, bulk actions and the panel with ×; projects, rules and the trash as tables (MO-2, MO-6, MO-7b)', async ({ page }) => {
		const [planned] = await seed([{ title: 'Rechnung bezahlen', planned: true }]);
		const { mail } = await seedInbox();
		await seedLists();
		await switchOn(page);
		await signIn(page);
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: 'Tagesplan' }).click();
		await expect(viewHeading(page, 'Tagesplan')).toBeVisible();
		const row = page.getByRole('group', { name: 'Einträge des Plans' }).locator('[data-item-id]').filter({ hasText: planned });
		await expect(row.getByRole('button', { name: /nach oben$/ })).toBeVisible();
		await expect(row.getByRole('button', { name: /nach unten$/ })).toBeVisible();
		await expect(row.locator('.handle')).toBeVisible();
		await expect(row.locator('.check-target')).toHaveCount(0);
		const suggestions = page.getByRole('button', { name: /^Vorschläge/ });
		await expect(suggestions).toHaveAttribute('aria-expanded', 'true');
		const plan = page.getByRole('heading', { name: 'Plan', exact: true });
		expect((await suggestions.boundingBox()).y).toBeLessThan((await plan.boundingBox()).y);
		const pool = page.getByRole('heading', { name: 'Pool', exact: true });
		await expect(pool).toBeVisible();
		await expect(page.getByRole('button', { name: 'Hinzufügen …' })).toHaveCount(0);
		expect((await pool.boundingBox()).x).toBeGreaterThan((await plan.boundingBox()).x + 200);
		expect(await scrollsSideways(page)).toBe(false);

		// The inbox of the PC: the table, the chips, the bulk actions and the panel with × (MO-6).
		await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: /^Eingang/ }).click();
		await expect(viewHeading(page, 'Eingang')).toBeVisible();
		await expect(page.getByRole('table')).toBeVisible();
		await expect(page.locator('li[data-item-id]')).toHaveCount(0);
		await expect(page.getByRole('group', { name: 'Quelle' })).toBeVisible();
		await expect(page.getByRole('group', { name: 'Zustand' })).toBeVisible();
		await expect(page.getByRole('button', { name: /^Gesammelt umwandeln/ })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Spalten' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Filter', exact: true })).toHaveCount(0);
		await page.getByRole('row').filter({ hasText: mail.title }).getByRole('link', { name: mail.title, exact: true }).click();
		const panel = page.getByRole('complementary', { name: mail.title });
		await expect(panel).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Panel schließen' })).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Zum Eingang' })).toHaveCount(0);
		await expect(panel.locator('footer').getByRole('button', { name: 'Mit Ticket verknüpfen …' })).toBeVisible();
		// The columns of the table fit themselves to the narrower list once the panel stands beside it.
		await expect.poll(() => scrollsSideways(page)).toBe(false);

		// MO-7b: "Projekte", "Wiederholungen" and "Papierkorb" keep the tables of the PC with "Spalten",
		// no cards, and the bar of the selection above the table instead of at the bottom.
		for (const [name, cards] of [
			['Projekte', 'li[data-project-row]'],
			['Wiederholungen', 'li[data-rule-row]'],
			['Papierkorb', 'li[data-trash-row]']
		]) {
			await page.getByRole('navigation', { name: 'Ansicht' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
			await expect(viewHeading(page, name)).toBeVisible();
			await expect(page.getByRole('table')).toBeVisible();
			await expect(page.locator(cards)).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'Spalten' })).toBeVisible();
			expect(await scrollsSideways(page)).toBe(false);
		}
		await page.getByRole('checkbox', { name: 'Alle Tickets im Papierkorb auswählen' }).check();
		await expect(page.getByRole('region', { name: /Tickets ausgewählt$/ }).getByRole('button', { name: 'Wiederherstellen' })).toBeVisible();
		await expect(page.locator('[data-selection-bar]')).toHaveCount(0);
	});
});
