// One source for the keyboard shortcuts (plan EH-9): the list is complete per context, and its global
// entries agree with the handlers in keyboard.ts and with aria-keyshortcuts of the header and the
// help menu, so the help never promises a key the app does not take.

import { describe, expect, it } from 'vitest';
import appHeader from '$lib/components/AppHeader.svelte?raw';
import helpMenu from '$lib/components/help/HelpMenu.svelte?raw';
import { isMenuKey } from '$lib/overlay/context-menu';
import { CALENDAR_MOVE_KEY, gridMove } from './calendar';
import { isHelpKey, isQuickCaptureKey } from './keyboard';
import {
	HELP_KEYSHORTCUTS,
	QUICK_CAPTURE_KEYSHORTCUTS,
	SHORTCUTS,
	SHORTCUT_CONTEXTS,
	ariaKeyShortcuts,
	keysText,
	shortcutById,
	shortcutsOf
} from './shortcuts';

const MODIFIERS: Record<string, 'ctrlKey' | 'altKey' | 'shiftKey'> = {
	Strg: 'ctrlKey',
	Alt: 'altKey',
	Umschalt: 'shiftKey'
};

/** A key event for one combination as the help prints it; `?` needs Shift on real keyboards. */
function eventOf(combination: readonly string[]) {
	const event = {
		key: '',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		isComposing: false
	};
	for (const name of combination) {
		const modifier = MODIFIERS[name];
		if (modifier) event[modifier] = true;
		else event.key = name.length === 1 ? name.toLowerCase() : name;
	}
	if (event.key === '?') event.shiftKey = true;
	return event;
}

/** aria-keyshortcuts for the combinations (WAI-ARIA names: Control, letters upper case). */
function ariaOf(keys: readonly (readonly string[])[]): string {
	return keys
		.map((combination) =>
			combination.map((name) => (name === 'Strg' ? 'Control' : name.toUpperCase())).join('+')
		)
		.join(' ');
}

describe('shortcuts', () => {
	it('has unique ids, keys and an action without full stop for every entry', () => {
		const ids = SHORTCUTS.map((shortcut) => shortcut.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const shortcut of SHORTCUTS) {
			expect(shortcut.keys.length).toBeGreaterThan(0);
			for (const combination of shortcut.keys) expect(combination.length).toBeGreaterThan(0);
			expect(shortcut.action).not.toBe('');
			expect(shortcut.action.endsWith('.')).toBe(false);
		}
	});

	it('fills every context in the order of the help', () => {
		expect(SHORTCUT_CONTEXTS.map((context) => context.label)).toEqual([
			'Überall',
			'Liste',
			'Kalender',
			'Panel',
			'Dialoge',
			'Editor'
		]);
		for (const context of SHORTCUT_CONTEXTS) {
			expect(shortcutsOf(context.id).length).toBeGreaterThan(0);
		}
		expect(SHORTCUT_CONTEXTS.flatMap((context) => shortcutsOf(context.id))).toHaveLength(
			SHORTCUTS.length
		);
	});

	it('lists exactly the keys the quick entry handler takes', () => {
		const quick = shortcutById('quick-capture');
		expect(quick.context).toBe('everywhere');
		for (const combination of quick.keys)
			expect(isQuickCaptureKey(eventOf(combination))).toBe(true);
		expect(keysText(quick)).toBe('c oder Strg+K');
		expect(ariaOf(quick.keys)).toBe(QUICK_CAPTURE_KEYSHORTCUTS);
	});

	it('lists the keys that open the menu of a row (plan aktionsmenues, AM-3)', () => {
		const rowMenu = shortcutById('row-menu');
		expect(rowMenu.context).toBe('list');
		for (const combination of rowMenu.keys) {
			const names = combination.map((name) => (name === 'Kontextmenü' ? 'ContextMenu' : name));
			expect(isMenuKey(eventOf(names))).toBe(true);
		}
		expect(keysText(rowMenu)).toBe('Umschalt+F10 oder Kontextmenü');
	});

	it('lists the keys the grid of the calendar takes (ADR-0053)', () => {
		const KEYS: Record<string, string[]> = {
			Pfeiltasten: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
			Pos1: ['Home'],
			Ende: ['End'],
			'Bild auf': ['PageUp'],
			'Bild ab': ['PageDown']
		};
		const moves = ['calendar-days', 'calendar-week-ends', 'calendar-period'].map(shortcutById);
		for (const shortcut of moves) {
			expect(shortcut.context).toBe('calendar');
			for (const [name] of shortcut.keys) {
				for (const key of KEYS[name ?? ''] ?? []) {
					expect(gridMove('month', '2026-10-14', key), `${name}: ${key}`).not.toBeNull();
				}
			}
		}
		expect(keysText(shortcutById('calendar-enter'))).toBe('Enter oder F2');
	});

	it('lists the key that moves a due date in the grid (ADR-0053 §12)', () => {
		const move = shortcutById('calendar-move');
		expect(move.context).toBe('calendar');
		expect(move.keys).toEqual([[CALENDAR_MOVE_KEY]]);
		expect(keysText(move)).toBe('m');
	});

	it('lists the key the help handler takes', () => {
		const help = shortcutById('help');
		expect(help.context).toBe('everywhere');
		for (const combination of help.keys) expect(isHelpKey(eventOf(combination))).toBe(true);
		expect(ariaOf(help.keys)).toBe(HELP_KEYSHORTCUTS);
	});

	it('is the source of aria-keyshortcuts in the header and the help menu', () => {
		expect(appHeader).toContain('aria-keyshortcuts={QUICK_CAPTURE_KEYSHORTCUTS}');
		expect(helpMenu).toContain('aria-keyshortcuts={HELP_KEYSHORTCUTS}');
		expect(appHeader).not.toMatch(/aria-keyshortcuts="/);
	});

	it('gives the editor entries WAI-ARIA names for aria-keyshortcuts', () => {
		for (const shortcut of shortcutsOf('editor')) {
			expect(ariaKeyShortcuts(shortcut)).toBe(
				shortcut.keys
					.map((combination) =>
						combination
							.map((name) =>
								name === 'Strg'
									? 'Control'
									: name === 'Umschalt'
										? 'Shift'
										: name.length === 1
											? name.toUpperCase()
											: name
							)
							.join('+')
					)
					.join(' ')
			);
		}
		expect(ariaKeyShortcuts(shortcutById('editor-strike'))).toBe('Control+Shift+S');
		expect(ariaKeyShortcuts(shortcutById('editor-toolbar'))).toBe('Alt+F10');
		expect(ariaKeyShortcuts(shortcutById('quick-capture'))).toBe(QUICK_CAPTURE_KEYSHORTCUTS);
	});

	it('throws for an unknown id', () => {
		expect(() => shortcutById('nope')).toThrow('Unknown shortcut: nope');
	});
});
