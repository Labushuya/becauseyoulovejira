// Where the flags render (ADR-0025 section 8, addendum 18, package FL-1): the stack of open modals
// mirrors the top layer, the topmost modal with the flags of a store hosts them, without one the
// app layout (null). Modal.svelte enters and leaves; FlagGroup asks hostOf.

import { describe, expect, it } from 'vitest';
import { FlagOutlets } from './flag-outlets.svelte';

describe('flag outlets', () => {
	it('leaves the flags to the layout while no modal holds them', () => {
		const outlets = new FlagOutlets();
		expect(outlets.hostOf({})).toBeNull();
	});

	it('gives them to the topmost open modal and back down as modals close', () => {
		const outlets = new FlagOutlets();
		const flags = {};
		const full = Symbol('full view');
		const question = Symbol('question');
		outlets.enter(full, flags);
		expect(outlets.hostOf(flags)).toBe(full);
		outlets.enter(question, flags);
		expect(outlets.hostOf(flags)).toBe(question);
		outlets.leave(question);
		expect(outlets.hostOf(flags)).toBe(full);
		outlets.leave(full);
		expect(outlets.hostOf(flags)).toBeNull();
	});

	it('moves a modal that is shown again to the top and ignores one it does not know', () => {
		const outlets = new FlagOutlets();
		const flags = {};
		const first = Symbol('first');
		const second = Symbol('second');
		outlets.enter(first, flags);
		outlets.enter(second, flags);
		outlets.enter(first, flags);
		expect(outlets.hostOf(flags)).toBe(first);
		outlets.leave(Symbol('unknown'));
		outlets.leave(first);
		expect(outlets.hostOf(flags)).toBe(second);
	});

	it('keeps the flags of each store apart', () => {
		const outlets = new FlagOutlets();
		const app = {};
		const other = {};
		const modal = Symbol('modal');
		outlets.enter(modal, app);
		expect(outlets.hostOf(app)).toBe(modal);
		expect(outlets.hostOf(other)).toBeNull();
	});
});
