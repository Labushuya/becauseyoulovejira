// The SPA and the project hook name the codes of sub projects with the same texts (ADR-0034).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { PROJECT_PARENT_MESSAGES } from '../../web/src/lib/domain/project-tree.ts';

const rules = loadHookLib('catalog-rules.js');

describe('texts of the sub project codes (web/src/lib/domain/project-tree.ts)', () => {
	it('equal those of catalog-rules.js', () => {
		expect({ ...PROJECT_PARENT_MESSAGES }).toEqual({ ...rules.PROJECT_PARENT_MESSAGES });
	});
});
