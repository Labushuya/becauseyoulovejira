// Smoke test of the phone frame (MO-1a, ADR-0073; manifest BYL-E6-1907 ff.) in the installed Chrome
// against the disposable instance of the global setup. On a phone (390 × 844, touch) with the switch
// "Handy-Ansicht (Vorschau)" on: the bottom bar at the bottom with targets of at least 44 px, no
// horizontal scrolling, "Mehr" as a sheet with every other view and the pages "nur am PC", the start
// at the day plan. With the switch off the view of today; on a PC no element of the frame.
// Since MO-1b (manifest BYL-E6-1950 ff.) on a small phone (360 × 800): a dialog, a menu and a picker
// as sheets at the bottom, a confirmation too, each with a visible "Schließen" of at least 44 px and
// without horizontal scrolling; the flags above the bottom bar and at the top while a sheet is open,
// never covered, their buttons of 44 px. With the switch off the same overlays stay as today.
//
// The phone stands for another device in the home network (header X-Byl-Test-Remote-Address of the
// test hooks, only in instances of the harness), so the pages of the administrator are "nur am PC".

import { expect, test } from '@playwright/test';
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

test.describe('phone with the switch on', () => {
	test.use({ ...PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	test('starts at the day plan, with the bottom bar at the bottom and no horizontal scrolling', async ({ page }) => {
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
	});

	test('opens "Mehr" as a sheet with every other view and the pages "nur am PC", and keeps "Aufgaben" a tap away', async ({ page }) => {
		await switchOn(page);
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/tagesplan`);
		const bar = page.getByRole('navigation', { name: 'Hauptnavigation' });

		await bar.getByRole('button', { name: 'Mehr' }).click();
		const sheet = page.getByRole('dialog', { name: 'Mehr' });
		await expect(sheet).toBeVisible();
		const views = sheet.getByRole('navigation', { name: 'Ansichten' });
		await expect(views.getByRole('link')).toHaveText([
			'Projekte',
			'Wiederholungen',
			'Kalender',
			'Erledigte',
			'Papierkorb'
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

		// A dialog (the quick entry, size M) is a sheet; its × and its buttons have 44 px.
		await bar.getByRole('button', { name: 'Erfassen' }).click();
		const quick = page.getByRole('dialog', { name: 'Schnellerfassung' });
		await expectSheet(quick.locator('.frame'), viewport);
		await expectTarget(quick.getByRole('button', { name: 'Schließen', exact: true }));
		for (const name of ['Abbrechen', 'In den Eingang', 'Ticket anlegen']) {
			expect((await quick.getByRole('button', { name, exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		}
		expect(await scrollsSideways(page)).toBe(false);
		const line = quick.getByLabel('Titel mit Kurzsyntax');
		await expect(line).toHaveAttribute('enterkeyhint', 'done');
		await line.fill('Fenster putzen');
		await line.press('Enter');
		await quick.getByRole('link', { name: 'Ticket ansehen' }).click();

		// The panel of the ticket is a page; its menu "•••" is a sheet with "Schließen" at its end.
		const panel = page.getByRole('complementary', { name: 'Fenster putzen' });
		await expect(panel).toBeVisible();
		await expectTarget(panel.getByRole('button', { name: 'Panel schließen' }));
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

		// A picker (the panel "Gruppieren" with its choices) is a sheet with the button "Schließen".
		// Its button in the bar of the view comes with the view itself (MO-3).
		await bar.getByRole('link', { name: 'Aufgaben' }).click();
		await expect(viewHeading(page, 'Aufgaben')).toBeAttached();
		const grouping = page.getByRole('button', { name: 'Gruppieren', exact: true });
		await grouping.click();
		const picker = page.getByRole('dialog', { name: 'Gruppieren' });
		await expectSheet(picker, viewport);
		const none = picker.getByRole('group', { name: 'Gruppieren', exact: true }).getByRole('radio', { name: 'Keine' });
		await expect(none).toBeChecked();
		expect((await none.locator('xpath=..').boundingBox()).height).toBeGreaterThanOrEqual(TARGET_MIN_PX);
		expect(await scrollsSideways(page)).toBe(false);
		const done = picker.getByRole('button', { name: 'Schließen', exact: true });
		await expectTarget(done);
		await done.click();
		await expect(picker).toBeHidden();
		await expect(grouping).toBeFocused();
	});
});

test.describe('small phone with the switch off: overlays as today (MO-1b)', () => {
	test.use({ ...SMALL_PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	test('keeps a dialog in the middle and a picker at its button, without "Schließen"', async ({ page }) => {
		await signIn(page);
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

		await page.getByRole('button', { name: 'Gruppieren', exact: true }).click();
		const picker = page.getByRole('dialog', { name: 'Gruppieren' });
		await expect(picker).toBeVisible();
		await settled(picker);
		expect((await picker.boundingBox()).width).toBeLessThan(SMALL_PHONE.viewport.width);
		await expect(picker.getByRole('button', { name: 'Schließen' })).toHaveCount(0);
		expect(await scrollsSideways(page)).toBe(false);
	});
});

test.describe('phone with the switch off', () => {
	test.use({ ...PHONE, extraHTTPHeaders: ANOTHER_DEVICE });

	test('shows the view of today, and the switch is reachable there', async ({ page }) => {
		const url = await signIn(page);
		await expect(page).toHaveURL(`${url}/`);
		await expect(viewHeading(page, 'Aufgaben')).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toHaveCount(0);
		await expect(page.locator('[data-phone-frame]')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Ansicht' })).toBeVisible();
		await expect(page.getByRole('banner').getByRole('button', { name: 'Abmelden' })).toBeVisible();
		expect(await viewportContent(page)).toBe(VIEWPORT_BASE);

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

	test('shows no element of the phone frame and starts at "Aufgaben"', async ({ page }) => {
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
	});
});
