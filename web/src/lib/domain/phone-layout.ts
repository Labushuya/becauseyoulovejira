// Phone layout (MO-1a, ADR-0073): the rules of the preview "Handy-Ansicht (Vorschau)". The same
// components become responsive; the phone frame (compact top bar, bottom bar, "Mehr" as a sheet,
// the day plan as the start view) applies only while the switch of this device is on **and** the
// window is narrow. Off, or from 40rem on, everything stays as it was. Pure: no SvelteKit, no DOM;
// the store in lib/mobile-layout.svelte.ts reads the storage and the media query and applies the
// viewport and the root attribute. Since MO-1b also where a modal stands in the frame and when
// leaving the page asks first.

import type { AreaView } from './area';

/**
 * The one breakpoint of the phone layout: below 40rem (640 px at the default size, more with a
 * larger system font, because <meta name="text-scale"> lets rem follow it). CSS uses the same
 * literal `@media (max-width: 39.99rem)`, because custom properties do not work in media queries;
 * the calendar shows its agenda below the same width (CALENDAR_NARROW_QUERY).
 */
export const PHONE_QUERY = '(max-width: 39.99rem)';

/** Key of the switch in localStorage; only "on" is stored, "off" removes the key. */
export const MOBILE_LAYOUT_STORAGE_KEY = 'byl-mobile-layout';

/** The stored value and the value of data-mobile-layout on the root element while the switch is on. */
export const MOBILE_LAYOUT_ON = 'on';

/** Attribute on the root element; tokens.css and the phone rules of the CSS read it. */
export const MOBILE_LAYOUT_ATTRIBUTE = 'data-mobile-layout';

/** Only "on" switches the preview on; missing, "off" and anything else leave it off (the default). */
export function parseMobileLayout(value: string | null | undefined): boolean {
	return value === MOBILE_LAYOUT_ON;
}

/** The decision: the phone frame applies only with the switch on and a narrow window. */
export function isPhoneLayout(enabled: boolean, narrow: boolean): boolean {
	return enabled && narrow;
}

/** The meta viewport of app.html, unchanged while the phone frame does not apply. */
export const VIEWPORT_BASE = 'width=device-width, initial-scale=1';

/**
 * The meta viewport of the phone frame: `viewport-fit=cover` lets env(safe-area-inset-*) report
 * the system bars and the cut-out (the bars add them as padding), `interactive-widget=
 * resizes-content` shrinks the layout viewport with the on-screen keyboard, so fixed footers and
 * 100dvh stay above it. Both only here: without the frame nothing pads the safe areas, and the
 * keyboard keeps the behaviour of today.
 */
export const VIEWPORT_PHONE = `${VIEWPORT_BASE}, viewport-fit=cover, interactive-widget=resizes-content`;

/** The content of the meta viewport for the frame that applies. */
export function viewportContent(phone: boolean): string {
	return phone ? VIEWPORT_PHONE : VIEWPORT_BASE;
}

/** The sizes of the modal building block (ADR-0025 section 3). */
export type ModalSize = 's' | 'm' | 'l' | 'xl';

/** Where a modal stands: in the middle, as a sheet at the bottom, or as a page over the screen. */
export type ModalPlacement = 'center' | 'sheet' | 'page';

/**
 * Where a modal stands (MO-1b, ADR-0073 addendum): outside the phone frame where its owner asks
 * (the middle, or the sheet "Mehr"). In the frame the sizes S and M (questions, short forms, the
 * quick entry) stand as a sheet at the bottom, within reach of the thumb; L and XL (assistants,
 * imports, the full view) are large and full of fields and take the whole screen as a page. One
 * rule in the building block, so no caller decides it again.
 */
export function modalPlacement(
	size: ModalSize,
	requested: 'center' | 'sheet',
	phone: boolean
): ModalPlacement {
	if (requested === 'sheet') return 'sheet';
	if (!phone) return 'center';
	return size === 'l' || size === 'xl' ? 'page' : 'sheet';
}

/**
 * Whether leaving the page (reload, pulling down to refresh, closing the tab, a link out of the
 * app) asks the browser's question first (MO-1b): only in the phone frame and only while typed
 * input is not saved. On the PC nothing changes; there the view keeps its own questions.
 */
export function warnsBeforeLeaving(phone: boolean, unsaved: boolean): boolean {
	return phone && unsaved;
}

/** What the start of the app needs to know about the address it opened. */
export interface StartAddress {
	readonly pathname: string;
	readonly search: string;
	readonly hash: string;
	/** document.referrer of the page; empty when the app was opened from outside. */
	readonly referrer: string;
	/** Origin of the app, e.g. "http://192.168.178.20:8090". */
	readonly origin: string;
	/**
	 * How the document came (PerformanceNavigationTiming.type): "navigate", "reload",
	 * "back_forward"; empty where the browser does not say.
	 */
	readonly navigation: string;
}

/** The bare start page and the bare login page, which leads there after the sign-in (guard.ts). */
const START_PATHS: readonly string[] = ['/', '/login'];

/**
 * Whether the app was opened at its start page, so the phone frame starts with the day plan
 * (decision of the user): only the bare "/" (the shortcut on the home screen, the address typed),
 * or since MO-7c2 the bare login page, which leads to it after the sign-in; not a link with a state
 * ("/?karte=heute", "/tickets/…", "/login?redirect=…"), not a page of the app that loaded "/" as a
 * new document after an update (its referrer is the app itself), and not a reload ("Aufgaben"
 * pulled down to refresh stays "Aufgaben") or a way back to it. A tap on "Aufgaben" never comes
 * here: it navigates inside the open app.
 */
export function isPhoneStart(address: StartAddress): boolean {
	if (!START_PATHS.includes(address.pathname) || address.search !== '' || address.hash !== '') {
		return false;
	}
	if (address.navigation !== 'navigate' && address.navigation !== '') return false;
	if (address.referrer === '') return true;
	try {
		return new URL(address.referrer).origin !== address.origin;
	} catch {
		return true;
	}
}

/**
 * Whether the app opens the day plan as it shows (MO-7c2, ADR-0073 addendum MO-7c2): the frame
 * applies, the document opened at the start page (`start`, held before the session check, null once
 * taken) and the app shows the bare start page now; after the sign-in that is the page the login
 * led to. Decided once, when the app layout mounts: with a stored session that is after the first
 * navigation, so no later navigation, a tap on "Aufgaben" included, ever comes here.
 */
export function opensWithDayPlan(
	start: StartAddress | null,
	shown: Pick<StartAddress, 'pathname' | 'search' | 'hash'>,
	phone: boolean
): boolean {
	if (!phone || start === null || !isPhoneStart(start)) return false;
	return shown.pathname === '/' && shown.search === '' && shown.hash === '';
}

/** The views in the fixed order of the navigation (ADR-0066 §1). */
export const VIEW_ORDER: readonly AreaView[] = [
	'tasks',
	'dayplan',
	'projects',
	'inbox',
	'recurrences',
	'calendar',
	'done',
	'trash'
];

/**
 * The views of the bottom bar (decision of the user, addendum MO-1a to ADR-0066 §1): "Tagesplan ·
 * Aufgaben · ＋ · Eingang · Mehr". The "＋" stands between "Aufgaben" and "Eingang".
 */
export const PHONE_BAR_VIEWS: readonly AreaView[] = ['dayplan', 'tasks', 'inbox'];

/** The other views under "Mehr", in the fixed order of the navigation. */
export const PHONE_MORE_VIEWS: readonly AreaView[] = VIEW_ORDER.filter(
	(view) => !PHONE_BAR_VIEWS.includes(view)
);

/** Inputs that open a picker or nothing, but no on-screen keyboard. */
const NO_KEYBOARD_INPUTS = new Set([
	'button',
	'checkbox',
	'color',
	'date',
	'datetime-local',
	'file',
	'hidden',
	'image',
	'month',
	'radio',
	'range',
	'reset',
	'submit',
	'time',
	'week'
]);

/** What the bottom bar needs to know about the element with the focus. */
export interface FocusTarget {
	readonly tagName: string;
	readonly type?: string;
	readonly readOnly?: boolean;
	readonly isContentEditable?: boolean;
}

/**
 * Whether the element with the focus opens the on-screen keyboard: a text field, a text area or an
 * editable element (the editor), unless it is read-only. Then the bottom bar gives way to it.
 */
export function opensKeyboard(target: FocusTarget | null | undefined): boolean {
	if (target === null || target === undefined) return false;
	if (target.isContentEditable === true) return true;
	const tag = target.tagName.toLowerCase();
	if (tag === 'textarea') return target.readOnly !== true;
	if (tag !== 'input') return false;
	return !NO_KEYBOARD_INPUTS.has((target.type ?? 'text').toLowerCase()) && target.readOnly !== true;
}

/** What the bottom bar marks as current: one of its views, "Mehr" for the others and the settings. */
export type PhoneBarTarget = AreaView | 'more';

/**
 * The entry of the bottom bar that stands for the page: a view of the bar itself, "more" for a view
 * under "Mehr" and for the settings, null for nothing (another page of the app).
 */
export function phoneBarTarget(view: AreaView | null, inSettings: boolean): PhoneBarTarget | null {
	if (view !== null) return PHONE_BAR_VIEWS.includes(view) ? view : 'more';
	return inSettings ? 'more' : null;
}
