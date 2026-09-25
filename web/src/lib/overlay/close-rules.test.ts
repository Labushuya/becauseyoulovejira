// Closing rules of the modal (ADR-0025 section 3; plan UI-Konsistenz, package UI-3): every
// trigger in every state.

import { describe, expect, it } from 'vitest';
import { closeAction, type CloseAction, type CloseTrigger } from './close-rules';

const TRIGGERS: CloseTrigger[] = ['escape', 'close-button', 'cancel', 'blanket'];

describe('closeAction', () => {
	it.each<[string, { dirty: boolean; busy: boolean; asking: boolean }, CloseAction[]]>([
		['clean', { dirty: false, busy: false, asking: false }, ['close', 'close', 'close', 'close']],
		['dirty', { dirty: true, busy: false, asking: false }, ['ask', 'ask', 'ask', 'ignore']],
		['busy', { dirty: false, busy: true, asking: false }, ['ignore', 'ignore', 'ignore', 'ignore']],
		[
			'dirty and busy',
			{ dirty: true, busy: true, asking: false },
			['ignore', 'ignore', 'ignore', 'ignore']
		],
		['asking', { dirty: true, busy: false, asking: true }, ['resume', 'resume', 'resume', 'ignore']]
	])('%s: escape, ×, cancel, blanket', (_name, state, expected) => {
		expect(TRIGGERS.map((trigger) => closeAction(trigger, state))).toEqual(expected);
	});
});
