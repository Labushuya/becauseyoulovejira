// Texts of the sub-tasks (ADR-0033). The texts of the hook codes are compared with the hook in
// tests/unit/web-subtasks.test.mjs.

import { describe, expect, it } from 'vitest';
import { openChildrenMessage, subtaskCountText } from './subtasks';

describe('texts of the sub-tasks', () => {
	it('counts one and several sub-tasks', () => {
		expect(subtaskCountText(1)).toBe('1 Unteraufgabe');
		expect(subtaskCountText(3)).toBe('3 Unteraufgaben');
		expect(openChildrenMessage(1)).toBe('1 Unteraufgabe ist noch offen.');
		expect(openChildrenMessage(4)).toBe('4 Unteraufgaben sind noch offen.');
	});
});
