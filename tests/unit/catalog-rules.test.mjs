// Pure decisions of the project hook about sub projects (ADR-0034, package UP-1).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('catalog-rules.js');

/** A valid sub project of an active top-level parent; each case changes one part. */
function input(overrides = {}) {
	return {
		id: 'garten000000001',
		parent: 'haus00000000001',
		parentFound: true,
		parentParent: '',
		parentArchived: false,
		archived: false,
		hasChildren: false,
		...overrides
	};
}

describe('projectParentViolation', () => {
	it('allows a top-level project and a sub project of an active top-level project', () => {
		expect(rules.projectParentViolation(input({ parent: '' }))).toBe('');
		expect(rules.projectParentViolation(input())).toBe('');
		// A new project has no id yet.
		expect(rules.projectParentViolation(input({ id: '' }))).toBe('');
	});

	it('ignores everything else without a parent', () => {
		expect(
			rules.projectParentViolation(
				input({ parent: '', parentFound: false, parentArchived: true, hasChildren: true })
			)
		).toBe('');
	});

	it('refuses the project itself as parent', () => {
		expect(rules.projectParentViolation(input({ parent: 'garten000000001' }))).toBe(
			'validation_project_parent_self'
		);
	});

	it('gives a missing parent and one of another scope the same code', () => {
		expect(rules.projectParentViolation(input({ parentFound: false }))).toBe(
			'validation_project_parent_missing'
		);
	});

	it('allows only one level: the parent has no parent, a parent gets none', () => {
		expect(rules.projectParentViolation(input({ parentParent: 'dach00000000001' }))).toBe(
			'validation_project_parent_nested'
		);
		expect(rules.projectParentViolation(input({ hasChildren: true }))).toBe(
			'validation_project_parent_has_children'
		);
	});

	it('keeps sub projects of an archived parent archived', () => {
		expect(rules.projectParentViolation(input({ parentArchived: true }))).toBe(
			'validation_project_parent_archived'
		);
		// Archived under an archived parent is the state after the cascade.
		expect(rules.projectParentViolation(input({ parentArchived: true, archived: true }))).toBe('');
	});

	it('checks in a fixed order: self, missing, nested, children, archived', () => {
		expect(
			rules.projectParentViolation(
				input({ parent: 'garten000000001', parentFound: false, hasChildren: true })
			)
		).toBe('validation_project_parent_self');
		expect(
			rules.projectParentViolation(
				input({ parentFound: false, parentParent: 'x', parentArchived: true })
			)
		).toBe('validation_project_parent_missing');
		expect(
			rules.projectParentViolation(
				input({ parentParent: 'x', hasChildren: true, parentArchived: true })
			)
		).toBe('validation_project_parent_nested');
		expect(rules.projectParentViolation(input({ hasChildren: true, parentArchived: true }))).toBe(
			'validation_project_parent_has_children'
		);
	});

	it('has a German message for every code it returns and for the delete and scope guards', () => {
		const codes = [
			'validation_project_parent_self',
			'validation_project_parent_missing',
			'validation_project_parent_nested',
			'validation_project_parent_has_children',
			'validation_project_parent_archived',
			'validation_project_has_children',
			'validation_project_scope_children'
		];
		expect(Object.keys(rules.PROJECT_PARENT_MESSAGES).sort()).toEqual([...codes].sort());
		for (const code of codes) {
			expect(rules.PROJECT_PARENT_MESSAGES[code], code).toMatch(/^[A-ZÄÖÜ].*\.$/);
		}
		expect(rules.PROJECT_PARENT_MESSAGES.validation_project_has_children).toContain(
			'Erst die Unterprojekte löschen oder einem anderen Projekt zuordnen.'
		);
	});
});

describe('archivesProject', () => {
	it('cascades only when an active project becomes archived', () => {
		expect(rules.archivesProject(false, true)).toBe(true);
		expect(rules.archivesProject(true, true)).toBe(false);
		expect(rules.archivesProject(true, false)).toBe(false);
		expect(rules.archivesProject(false, false)).toBe(false);
	});
});
