// Pure rule of the area of a record (ADR-0058, addendum "Bereich eines Eintrags"): an update of a
// client keeps owner, household and scope; the hook file guards every collection with an area.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('scope-rules.js');
const HOOK_FILE = new URL('../../app/pb_hooks/scope-guard.pb.js', import.meta.url);

const STORED = { owner: 'owner0000000001', household: 'house0000000001', scope: 'h:house0000000001' };

describe('the area of a record', () => {
	it('lets an update through that keeps owner, household and scope', () => {
		expect(rules.updateViolation(STORED, { ...STORED })).toBeNull();
		const own = { owner: 'owner0000000001', household: '', scope: 'u:owner0000000001' };
		expect(rules.updateViolation(own, { ...own })).toBeNull();
	});

	it('names the first changed field with its code and text', () => {
		expect(rules.updateViolation(STORED, { ...STORED, household: '' })).toEqual({
			field: 'household',
			code: 'validation_scope_locked',
			message: 'Der Bereich eines Eintrags kann nicht direkt geändert werden.'
		});
		expect(rules.updateViolation(STORED, { ...STORED, scope: 'u:owner0000000001' })).toMatchObject({
			field: 'scope',
			code: 'validation_scope_locked'
		});
		expect(rules.updateViolation(STORED, { ...STORED, owner: 'owner0000000002', household: '' })).toEqual({
			field: 'owner',
			code: 'validation_scope_owner_locked',
			message: 'Der Besitzer eines Eintrags kann nicht geändert werden.'
		});
		const own = { owner: 'owner0000000001', household: '', scope: 'u:owner0000000001' };
		expect(rules.updateViolation(own, { ...own, household: 'house0000000001' })).toMatchObject({ field: 'household' });
	});

	it('guards every collection with an area, the same in the hook file', () => {
		expect(rules.COLLECTIONS).toEqual([
			'projects',
			'tags',
			'recurrence_rules',
			'tickets',
			'inbox_items',
			'connections',
			'dependencies'
		]);
		const source = readFileSync(HOOK_FILE, 'utf8');
		const registration = /onRecordUpdateRequest\(([\s\S]*?)\);\s*$/.exec(source);
		expect(registration).not.toBeNull();
		const tags = [...registration[1].matchAll(/^\s*'([a-z_]+)',?\s*$/gm)].map((match) => match[1]);
		expect(tags).toEqual(rules.COLLECTIONS);
		expect(source).not.toMatch(/onRecordCreateRequest/);
	});
});
