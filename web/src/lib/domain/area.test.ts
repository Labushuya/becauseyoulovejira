// Pure rules of the areas "Privat" and "Haushalt" (E7-3, ADR-0059).

import { describe, expect, it } from 'vitest';
import {
	PRIVATE_CHOICE,
	areaChoiceValue,
	areaStorageKey,
	areaSwitchTarget,
	householdOfScope,
	householdScope,
	isAreaScope,
	parseAreaChoice,
	privateScope,
	purgeAllowed,
	recordOfRoute,
	resolveChoice,
	scopeOfChoice
} from './area';

const ID = 'abcdefghijklmn1';

describe('scopes of the areas', () => {
	it('builds and reads the scopes like the hooks (u:<account>, h:<household>)', () => {
		expect(privateScope(ID)).toBe(`u:${ID}`);
		expect(householdScope(ID)).toBe(`h:${ID}`);
		expect(isAreaScope(`u:${ID}`)).toBe(true);
		expect(isAreaScope(`h:${ID}`)).toBe(true);
		for (const value of [
			'',
			'x:abcdefghijklmn1',
			'u:',
			'h:short',
			`u:${ID}x`,
			'u:ABCDEFGHIJKLMN1',
			null,
			5
		]) {
			expect(isAreaScope(value), String(value)).toBe(false);
		}
		expect(householdOfScope(`h:${ID}`)).toBe(ID);
		expect(householdOfScope(`u:${ID}`)).toBe('');
		expect(householdOfScope(undefined)).toBe('');
	});
});

describe('remembered choice', () => {
	it('is stored per account and read strictly', () => {
		expect(areaStorageKey(ID)).toBe(`byl-area:${ID}`);
		expect(areaChoiceValue(PRIVATE_CHOICE)).toBe('private');
		expect(areaChoiceValue({ kind: 'household', household: ID })).toBe(`household:${ID}`);
		expect(parseAreaChoice('private')).toEqual(PRIVATE_CHOICE);
		expect(parseAreaChoice(`household:${ID}`)).toEqual({ kind: 'household', household: ID });
		for (const raw of [null, '', 'household:', 'household:kurz', 'privat', `h:${ID}`]) {
			expect(parseAreaChoice(raw), String(raw)).toBeNull();
		}
	});

	it('applies a household only while the account is a member of it', () => {
		const chosen = { kind: 'household' as const, household: ID };
		expect(resolveChoice(chosen, ID)).toEqual(chosen);
		expect(resolveChoice(chosen, null)).toEqual(PRIVATE_CHOICE);
		expect(resolveChoice(chosen, 'zzzzzzzzzzzzzz9')).toEqual(PRIVATE_CHOICE);
		expect(resolveChoice(null, ID)).toEqual(PRIVATE_CHOICE);
		expect(scopeOfChoice(chosen, 'user00000000001')).toBe(`h:${ID}`);
		expect(scopeOfChoice(PRIVATE_CHOICE, 'user00000000001')).toBe('u:user00000000001');
	});
});

describe('deleting for good in the trash of an area', () => {
	it('is allowed in "Privat" and in a household only with the right "purge"', () => {
		expect(purgeAllowed('private', null)).toBe(true);
		expect(purgeAllowed('household', true)).toBe(true);
		expect(purgeAllowed('household', false)).toBe(false);
		expect(purgeAllowed('household', null)).toBe(false);
	});
});

describe('records of the routes (links into the other area)', () => {
	it('names the record a route shows', () => {
		expect(recordOfRoute('/(app)/(tickets)/tickets/[id]', ID)).toEqual({ kind: 'ticket', id: ID });
		expect(recordOfRoute('/(app)/kalender/tickets/[id]/voll', ID)).toEqual({
			kind: 'ticket',
			id: ID
		});
		expect(recordOfRoute('/(app)/projekte/[id]', ID)).toEqual({ kind: 'project', id: ID });
		expect(recordOfRoute('/(app)/kalender/eingang/[id]', ID)).toEqual({ kind: 'item', id: ID });
		expect(recordOfRoute('/(app)/wiederholungen/[id]', ID)).toEqual({ kind: 'rule', id: ID });
		expect(recordOfRoute('/(app)/papierkorb/[id]', ID)).toEqual({ kind: 'trash', id: ID });
		// A ticket next to "Erledigte" (ADR-0066).
		expect(recordOfRoute('/(app)/erledigt/tickets/[id]', ID)).toEqual({ kind: 'ticket', id: ID });
		expect(recordOfRoute('/(app)/erledigt/tickets/[id]/voll', ID)).toEqual({
			kind: 'ticket',
			id: ID
		});
	});

	it('names none for views, forms, the settings and malformed IDs', () => {
		expect(recordOfRoute('/(app)/(tickets)', undefined)).toBeNull();
		expect(recordOfRoute('/(app)/(tickets)/tickets/neu', undefined)).toBeNull();
		expect(recordOfRoute('/(app)/einstellungen/haushalt', undefined)).toBeNull();
		expect(recordOfRoute('/(app)/projekte/[id]', 'neu')).toBeNull();
		expect(recordOfRoute(null, ID)).toBeNull();
	});
});

describe('address after switching the area', () => {
	const at = (path: string) => new URL(path, 'http://127.0.0.1:8090');

	it('closes records and forms of the old area and keeps the view with its other parameters', () => {
		expect(
			areaSwitchTarget(at(`/tickets/${ID}?status=open`), '/(app)/(tickets)/tickets/[id]')
		).toEqual({ view: 'tasks', search: '?status=open' });
		expect(areaSwitchTarget(at('/tickets/neu'), '/(app)/(tickets)/tickets/neu')).toEqual({
			view: 'tasks',
			search: ''
		});
		expect(
			areaSwitchTarget(
				at(`/projekte/tickets/${ID}?q=Haus&von=${ID}`),
				'/(app)/projekte/tickets/[id]'
			)
		).toEqual({ view: 'projects', search: '?q=Haus' });
		expect(areaSwitchTarget(at(`/eingang/${ID}?zustand=alle`), '/(app)/eingang/[id]')).toEqual({
			view: 'inbox',
			search: '?zustand=alle'
		});
		expect(
			areaSwitchTarget(
				at(`/kalender/wiederholungen/${ID}?ansicht=woche`),
				'/(app)/kalender/wiederholungen/[id]'
			)
		).toEqual({ view: 'calendar', search: '?ansicht=woche' });
		expect(areaSwitchTarget(at(`/papierkorb/${ID}`), '/(app)/papierkorb/[id]')).toEqual({
			view: 'trash',
			search: ''
		});
		expect(areaSwitchTarget(at(`/wiederholungen/${ID}`), '/(app)/wiederholungen/[id]')).toEqual({
			view: 'recurrences',
			search: ''
		});
	});

	it('drops the filters that name a record of the old area', () => {
		expect(
			areaSwitchTarget(at(`/?projekt=${ID}&unterprojekte=1&prio=high`), '/(app)/(tickets)')
		).toEqual({ view: 'tasks', search: '?prio=high' });
		expect(areaSwitchTarget(at(`/eingang?zielprojekt=${ID}`), '/(app)/eingang')).toEqual({
			view: 'inbox',
			search: ''
		});
		// "Erledigte" (ADR-0066) keeps search and charm, the catalog of charms has no area.
		expect(
			areaSwitchTarget(
				at(`/erledigt?projekt=${ID}&tag=${ID}&q=Miete&charm=auto`),
				'/(app)/erledigt'
			)
		).toEqual({ view: 'done', search: '?q=Miete&charm=auto' });
		expect(
			areaSwitchTarget(at(`/erledigt/tickets/${ID}?q=Miete`), '/(app)/erledigt/tickets/[id]')
		).toEqual({ view: 'done', search: '?q=Miete' });
	});

	it('stays on a view without such filters and in the settings', () => {
		expect(areaSwitchTarget(at('/?status=open'), '/(app)/(tickets)')).toBeNull();
		expect(areaSwitchTarget(at('/kalender?ansicht=monat'), '/(app)/kalender')).toBeNull();
		expect(areaSwitchTarget(at('/einstellungen/tags'), '/(app)/einstellungen/tags')).toBeNull();
		expect(areaSwitchTarget(at('/'), null)).toBeNull();
	});
});
