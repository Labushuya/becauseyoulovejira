// Guided tour (plan EH-13): the wrapper around driver.js starts only when called, gives German
// button texts, the veil from the tokens and no animation for reduced motion, goes to the page of
// a step first, skips missing targets, ends on Escape without passing the key on, and returns the
// focus to its trigger (or the heading of the view). driver.js is replaced by a fake.

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Config, Driver, PopoverDOM } from 'driver.js';
import { TOUR_STEPS } from './steps';
import {
	TOUR_OVERLAY_COLOR,
	TOUR_TEXTS,
	driveSteps,
	returnFocus,
	startTour,
	waitForTarget,
	type TourDeps
} from './tour';

const libraryDriver = vi.hoisted(() => vi.fn());
vi.mock('driver.js', () => ({ driver: libraryDriver }));

interface FakeTour {
	config: Config;
	driver: Driver;
	drive: Mock<(at?: number) => void>;
	moveTo: Mock<(at: number) => void>;
	destroy: Mock<() => void>;
}

/** The options driver.js hands to a hook, for the fake. */
function hook(tour: FakeTour) {
	return {
		config: tour.config,
		state: {},
		driver: tour.driver,
		index: tour.driver.getActiveIndex()
	};
}

/** Every fake of every test; afterEach ends the ones still running (their key listeners too). */
const running: FakeTour[] = [];

function fakeCreate() {
	const created: FakeTour[] = [];
	const create = (config: Config): Driver => {
		let active = false;
		let index: number | undefined;
		const drive = vi.fn((at = 0) => {
			active = true;
			index = at;
		});
		const moveTo = vi.fn((at: number) => {
			index = at;
		});
		const tour = {
			isActive: () => active,
			drive,
			moveTo,
			getActiveIndex: () => index,
			isFirstStep: () => index === 0
		} as unknown as Driver;
		const destroy = vi.fn(() => {
			if (!active) return;
			active = false;
			config.onDestroyed?.(undefined, {}, { config, state: {}, driver: tour, index });
		});
		Object.assign(tour, { destroy });
		created.push({ config, driver: tour, drive, moveTo, destroy });
		running.push({ config, driver: tour, drive, moveTo, destroy });
		return tour;
	};
	return { create, created };
}

function deps(overrides: Partial<TourDeps> = {}) {
	const fake = fakeCreate();
	let path = '/';
	const navigate = vi.fn(async (next: string) => {
		path = next;
	});
	const all: TourDeps = {
		trigger: null,
		currentPath: () => path,
		navigate,
		reducedMotion: () => false,
		load: async () => fake.create,
		waitFor: async () => document.body,
		...overrides
	};
	return { all, fake, navigate };
}

/** Lets the chain of awaits of the wrapper run. */
async function settle() {
	for (let round = 0; round < 10; round += 1) await Promise.resolve();
}

afterEach(() => {
	for (const tour of running.splice(0)) tour.driver.destroy();
	document.body.innerHTML = '';
	libraryDriver.mockReset();
});

describe('guided tour (EH-13)', () => {
	it('starts only when called and loads driver.js from the package', async () => {
		expect(libraryDriver).not.toHaveBeenCalled();
		const { all } = deps();
		libraryDriver.mockImplementation(fakeCreate().create);
		await startTour({ ...all, load: undefined });
		expect(libraryDriver).toHaveBeenCalledOnce();
	});

	it('configures German buttons, the veil of the tokens and at most five steps', async () => {
		const { all, fake } = deps();
		await startTour(all);
		const { config, drive } = fake.created[0] as FakeTour;

		expect(config.nextBtnText).toBe('Weiter');
		expect(config.prevBtnText).toBe('Zurück');
		expect(config.doneBtnText).toBe('Fertig');
		expect(config.progressText).toBe(TOUR_TEXTS.progress);
		expect(config.overlayColor).toBe(TOUR_OVERLAY_COLOR);
		expect(TOUR_OVERLAY_COLOR).toBe('var(--color-blanket)');
		expect(config.overlayOpacity).toBe(1);
		expect(config.allowClose).toBe(true);
		expect(config.showButtons).toEqual(['next', 'previous', 'close']);
		expect(config.steps).toEqual(driveSteps(TOUR_STEPS));
		expect(config.steps?.length).toBeLessThanOrEqual(5);
		expect(config.animate).toBe(true);
		expect(drive).toHaveBeenCalledWith(0);
	});

	it('switches off the animation for reduced motion', async () => {
		const { all, fake } = deps({ reducedMotion: () => true });
		await startTour(all);
		expect(fake.created[0]?.config.animate).toBe(false);
		expect(fake.created[0]?.config.smoothScroll).toBe(false);
	});

	it('goes to the page of a step before showing it', async () => {
		const { all, fake, navigate } = deps();
		await startTour(all);
		const tour = fake.created[0] as FakeTour;

		tour.config.onNextClick?.(undefined, {}, hook(tour));
		await settle();
		expect(tour.moveTo).toHaveBeenLastCalledWith(1);
		expect(navigate).not.toHaveBeenCalled();

		tour.config.onNextClick?.(undefined, {}, hook(tour));
		await settle();
		// The filter bar lives on "Aufgaben" ("/"), where the tour already is.
		expect(tour.moveTo).toHaveBeenLastCalledWith(2);
		expect(navigate).not.toHaveBeenCalled();

		tour.config.onNextClick?.(undefined, {}, hook(tour));
		await settle();
		expect(navigate).toHaveBeenCalledWith('/projekte');
		expect(tour.moveTo).toHaveBeenLastCalledWith(3);

		tour.config.onPrevClick?.(undefined, {}, hook(tour));
		await settle();
		expect(navigate).toHaveBeenLastCalledWith('/');
		expect(tour.moveTo).toHaveBeenLastCalledWith(2);
	});

	it('skips a step whose target does not appear and ends after the last one', async () => {
		const { all, fake } = deps({
			waitFor: async (selector) => (selector.includes('"inbox"') ? null : document.body)
		});
		await startTour(all);
		const tour = fake.created[0] as FakeTour;
		const next = () => tour.config.onNextClick?.(undefined, {}, hook(tour));

		next();
		await settle();
		expect(tour.moveTo).toHaveBeenLastCalledWith(2);

		tour.moveTo(4);
		next();
		await settle();
		expect(tour.destroy).toHaveBeenCalledOnce();
	});

	it('returns null and cleans up when no target appears', async () => {
		const { all, fake } = deps({ waitFor: async () => null });
		expect(await startTour(all)).toBeNull();
		expect(fake.created[0]?.drive).not.toHaveBeenCalled();
		// No key listener is left behind.
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.body.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it('names the close button in German and hides "Zurück" on the first step', async () => {
		const { all, fake } = deps();
		await startTour(all);
		const tour = fake.created[0] as FakeTour;
		const popover = {
			closeButton: document.createElement('button'),
			previousButton: document.createElement('button')
		} as unknown as PopoverDOM;

		tour.config.onPopoverRender?.(popover, hook(tour));
		expect(popover.closeButton.getAttribute('aria-label')).toBe('Einführung beenden');
		expect(popover.closeButton.getAttribute('title')).toBe('Einführung beenden');
		expect(popover.previousButton.style.display).toBe('none');

		tour.moveTo(1);
		const later = {
			closeButton: document.createElement('button'),
			previousButton: document.createElement('button')
		} as unknown as PopoverDOM;
		tour.config.onPopoverRender?.(later, hook(tour));
		expect(later.previousButton.style.display).toBe('');
	});

	it('ends on Escape before the page sees the key and returns the focus to the trigger', async () => {
		const trigger = document.createElement('button');
		document.body.append(trigger);
		const { all, fake } = deps({ trigger });
		await startTour(all);
		const tour = fake.created[0] as FakeTour;
		const below = vi.fn();
		window.addEventListener('keydown', below);

		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.body.dispatchEvent(event);
		await settle();

		expect(tour.destroy).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
		expect(below).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(trigger);
		window.removeEventListener('keydown', below);

		// After the end, Escape belongs to the page again.
		const later = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.body.dispatchEvent(later);
		expect(later.defaultPrevented).toBe(false);
	});

	it('returns the focus to the heading of the view when the trigger is gone', () => {
		const heading = document.createElement('h2');
		heading.tabIndex = -1;
		heading.setAttribute('data-view-heading', '');
		document.body.append(heading);
		const gone = document.createElement('button');

		returnFocus(gone);
		expect(document.activeElement).toBe(heading);
	});

	it('waits for a target that appears and gives up after the time', async () => {
		vi.useFakeTimers();
		try {
			const late = waitForTarget('[data-tour="late"]', 1000);
			const target = document.createElement('div');
			target.dataset.tour = 'late';
			document.body.append(target);
			await vi.advanceTimersByTimeAsync(0);
			expect(await late).toBe(target);

			const never = waitForTarget('[data-tour="never"]', 1000);
			await vi.advanceTimersByTimeAsync(1000);
			expect(await never).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});
