// Smoke test of the phone frame (MO-1a, ADR-0073; manifest BYL-E6-1907 ff.) in the installed Chrome
// against the disposable instance of the global setup. On a phone (390 × 844, touch) with the switch
// "Handy-Ansicht (Vorschau)" on: the bottom bar at the bottom with targets of at least 44 px, no
// horizontal scrolling, "Mehr" as a sheet with every other view and the pages "nur am PC", the start
// at the day plan. With the switch off the view of today; on a PC no element of the frame.
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
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const ANOTHER_DEVICE = { 'X-Byl-Test-Remote-Address': '192.168.178.66' };
const TARGET_PX = 44;
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
