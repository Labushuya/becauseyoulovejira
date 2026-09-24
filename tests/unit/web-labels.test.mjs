// The frontend has a German label for every field the history hook records (E2 plan, T-10).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { HISTORY_FIELD_LABELS } from '../../web/src/lib/domain/labels.ts';

const history = loadHookLib('history.js');

describe('history field labels (web/src/lib/domain/labels.ts)', () => {
	it('cover exactly the creation entry and the tracked fields of history.js', () => {
		expect(Object.keys(HISTORY_FIELD_LABELS).sort()).toEqual(
			['created', ...history.TRACKED_FIELDS].sort()
		);
	});
});
