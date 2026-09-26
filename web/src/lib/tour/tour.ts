// Guided tour (ADR-0026 section 8, plan EH-13): a thin wrapper around driver.js (MIT, bundled by
// Vite from node_modules, no CDN; loaded only when the tour starts). It sets German button texts,
// the veil and radius from the tokens, no animation with prefers-reduced-motion, and it goes to
// the page of a step before showing it. A target that does not appear in time (hidden on a narrow
// window, no project yet) is skipped. Escape ends the tour and nothing else (the side panel below
// keeps its own Escape). When the tour ends, the focus goes back to the element that started it,
// or to the heading of the view if that is gone. No other place of the app uses driver.js.

import type { ResolvedPathname } from '$app/types';
import type { Config, Driver, DriveStep, PopoverDOM } from 'driver.js';
import '$lib/styles/tour.css';
import { TOUR_STEPS, tourSelector, type TourStep } from './steps';

export const TOUR_TEXTS = {
	next: 'Weiter',
	previous: 'Zurück',
	done: 'Fertig',
	close: 'Einführung beenden',
	progress: '{{current}} von {{total}}'
} as const;

/** How long a step waits for its target after a change of page. */
export const TOUR_WAIT_MS = 1500;

/** Veil of the tour: the blanket of the modals (tokens.css), used as it is. */
export const TOUR_OVERLAY_COLOR = 'var(--color-blanket)';

export type CreateDriver = (config: Config) => Driver;

export interface TourDeps {
	/** Element to return the focus to; null or gone means the heading of the view. */
	trigger: HTMLElement | null;
	currentPath: () => string;
	navigate: (path: ResolvedPathname) => Promise<unknown>;
	reducedMotion: () => boolean;
	/** Loads driver.js; tests pass a fake. */
	load?: () => Promise<CreateDriver>;
	steps?: readonly TourStep[];
	/** Waits for a target; tests pass their own. */
	waitFor?: (selector: string, timeout: number) => Promise<Element | null>;
}

/** Whether an element is shown (a target hidden by CSS counts as missing). */
function isShown(element: Element): boolean {
	return typeof element.checkVisibility === 'function' ? element.checkVisibility() : true;
}

/** The target once it is in the document and shown, or null after `timeout` ms. */
export function waitForTarget(selector: string, timeout: number): Promise<Element | null> {
	const find = () => {
		const element = document.querySelector(selector);
		return element !== null && isShown(element) ? element : null;
	};
	const found = find();
	if (found !== null || timeout <= 0) return Promise.resolve(found);
	return new Promise((resolveTarget) => {
		const observer = new MutationObserver(() => {
			const element = find();
			if (element === null) return;
			finish();
			resolveTarget(element);
		});
		const timer = setTimeout(() => {
			finish();
			resolveTarget(find());
		}, timeout);
		function finish() {
			observer.disconnect();
			clearTimeout(timer);
		}
		observer.observe(document.body, { childList: true, subtree: true, attributes: true });
	});
}

/** The steps as driver.js reads them. */
export function driveSteps(steps: readonly TourStep[]): DriveStep[] {
	return steps.map((step) => ({
		element: tourSelector(step.target),
		popover: { title: step.title, description: step.description }
	}));
}

/** Puts the focus back where the tour started, else on the heading of the view. */
export function returnFocus(trigger: HTMLElement | null): void {
	if (trigger !== null && trigger.isConnected) {
		trigger.focus();
		return;
	}
	document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
}

/**
 * Starts the tour and resolves with the running driver, or null if no step has a target. Only
 * called on a click of the user (help menu, "Erste Schritte"), never on its own.
 */
export async function startTour(deps: TourDeps): Promise<Driver | null> {
	const steps = deps.steps ?? TOUR_STEPS;
	const waitFor = deps.waitFor ?? waitForTarget;
	const load = deps.load ?? (async (): Promise<CreateDriver> => (await import('driver.js')).driver);
	const createDriver = await load();
	const animate = !deps.reducedMotion();
	let tour: Driver | null = null;

	/** Shows the first step from `index` on (in `direction`) whose target appears; else ends. */
	async function show(index: number, direction: 1 | -1): Promise<boolean> {
		for (let at = index; at >= 0 && at < steps.length; at += direction) {
			const step = steps[at] as TourStep;
			if (step.path !== null && deps.currentPath() !== step.path) await deps.navigate(step.path);
			if (tour === null) return false;
			if ((await waitFor(tourSelector(step.target), TOUR_WAIT_MS)) === null) continue;
			if (tour === null) return false;
			if (tour.isActive()) tour.moveTo(at);
			else tour.drive(at);
			return true;
		}
		return false;
	}

	function move(direction: 1 | -1) {
		const current = tour?.getActiveIndex() ?? 0;
		void show(current + direction, direction).then((shown) => {
			if (!shown && direction === 1) tour?.destroy();
		});
	}

	/** Escape ends the tour before anything below it (panel, view) sees the key. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || tour === null) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		tour.destroy();
	}

	const config: Config = {
		steps: driveSteps(steps),
		animate,
		smoothScroll: animate,
		duration: 200,
		overlayColor: TOUR_OVERLAY_COLOR,
		overlayOpacity: 1,
		stagePadding: 6,
		stageRadius: 6,
		popoverClass: 'byl-tour',
		allowClose: true,
		overlayClickBehavior: 'close',
		allowKeyboardControl: true,
		skipMissingElement: true,
		showProgress: true,
		progressText: TOUR_TEXTS.progress,
		nextBtnText: TOUR_TEXTS.next,
		prevBtnText: TOUR_TEXTS.previous,
		doneBtnText: TOUR_TEXTS.done,
		showButtons: ['next', 'previous', 'close'],
		onPopoverRender: (popover: PopoverDOM, { driver: running }) => {
			popover.closeButton.setAttribute('aria-label', TOUR_TEXTS.close);
			popover.closeButton.setAttribute('title', TOUR_TEXTS.close);
			// "Zurück" only from the second step on.
			if (running.isFirstStep()) popover.previousButton.style.display = 'none';
		},
		onNextClick: () => move(1),
		onPrevClick: () => move(-1),
		onDestroyed: () => {
			window.removeEventListener('keydown', onkeydown, true);
			tour = null;
			// After driver.js has put the focus back itself, so ours wins.
			queueMicrotask(() => returnFocus(deps.trigger));
		}
	};

	tour = createDriver(config);
	window.addEventListener('keydown', onkeydown, true);
	if (!(await show(0, 1))) {
		// Not started: driver.js has nothing to destroy, so the wrapper cleans up itself.
		window.removeEventListener('keydown', onkeydown, true);
		tour = null;
		return null;
	}
	return tour;
}
