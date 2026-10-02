import { describe, expect, it } from 'vitest';
import {
	COLOR_LABELS,
	PROJECT_COLORS,
	colorOf,
	colorText,
	colorVar,
	inheritLabel,
	isProjectColor,
	projectColorOf,
	ticketColorOf
} from './colors';

describe('palette (ADR-0052)', () => {
	it('has ten named colors without red, orange or pink, in the order of the choice', () => {
		expect(PROJECT_COLORS).toEqual([
			'violett',
			'indigo',
			'blau',
			'himmel',
			'tuerkis',
			'gruen',
			'oliv',
			'senf',
			'braun',
			'grau'
		]);
		expect(PROJECT_COLORS.map((color) => COLOR_LABELS[color])).toEqual([
			'Violett',
			'Indigo',
			'Blau',
			'Himmelblau',
			'Türkis',
			'Grün',
			'Oliv',
			'Senf',
			'Braun',
			'Grau'
		]);
		const names = PROJECT_COLORS.join(' ') + Object.values(COLOR_LABELS).join(' ');
		expect(names).not.toMatch(/rot|red|orange|pink|rosa|magenta/i);
	});

	it('reads stored values strictly: empty and unknown are no color', () => {
		expect(colorOf('blau')).toBe('blau');
		expect(colorOf('')).toBeNull();
		expect(colorOf('rot')).toBeNull();
		expect(colorOf('Blau')).toBeNull();
		expect(colorOf(undefined)).toBeNull();
		expect(isProjectColor('grau')).toBe(true);
		expect(isProjectColor(3)).toBe(false);
	});

	it('names the token of a color', () => {
		expect(colorVar('tuerkis')).toBe('var(--project-color-tuerkis)');
	});
});

describe('effective color', () => {
	const haus = { name: 'Haus', color: 'blau' as const, parent: null };
	const garten = { name: 'Garten', color: null, parent: { name: 'Haus', color: 'blau' as const } };
	const keller = {
		name: 'Keller',
		color: 'braun' as const,
		parent: { name: 'Haus', color: 'blau' as const }
	};
	const ohne = { name: 'Ohne', color: null, parent: null };

	it('gives a project its own color, else the one of its parent, else none', () => {
		expect(projectColorOf(haus)).toEqual({ color: 'blau', origin: 'own', from: null });
		expect(projectColorOf(garten)).toEqual({ color: 'blau', origin: 'parent', from: 'Haus' });
		expect(projectColorOf(keller)).toEqual({ color: 'braun', origin: 'own', from: null });
		expect(projectColorOf(ohne)).toBeNull();
		expect(projectColorOf({ name: 'Alt' })).toBeNull();
		expect(projectColorOf(null)).toBeNull();
	});

	it('goes ticket, project, parent project, none', () => {
		expect(ticketColorOf({ color: 'gruen' }, haus)).toEqual({
			color: 'gruen',
			origin: 'own',
			from: null
		});
		expect(ticketColorOf({ color: null }, haus)).toEqual({
			color: 'blau',
			origin: 'project',
			from: 'Haus'
		});
		expect(ticketColorOf({}, garten)).toEqual({ color: 'blau', origin: 'parent', from: 'Haus' });
		expect(ticketColorOf({ color: null }, keller)).toEqual({
			color: 'braun',
			origin: 'project',
			from: 'Keller'
		});
		expect(ticketColorOf({ color: null }, ohne)).toBeNull();
		expect(ticketColorOf({ color: null }, null)).toBeNull();
		expect(ticketColorOf({ color: 'senf' }, null)).toEqual({
			color: 'senf',
			origin: 'own',
			from: null
		});
	});

	it('says the name of the color and where it comes from', () => {
		expect(colorText({ color: 'gruen', origin: 'own', from: null })).toBe('Farbe Grün');
		expect(colorText({ color: 'blau', origin: 'project', from: 'Haus' })).toBe(
			'Farbe Blau, vom Projekt „Haus“'
		);
		expect(colorText({ color: 'blau', origin: 'parent', from: 'Haus' })).toBe(
			'Farbe Blau, vom Oberprojekt „Haus“'
		);
	});

	it('names the choice without an own color with the color it then shows', () => {
		expect(inheritLabel('project', null)).toBe('Keine');
		expect(inheritLabel('sub-project', 'blau')).toBe('Wie Oberprojekt (Blau)');
		expect(inheritLabel('sub-project', null)).toBe('Wie Oberprojekt (keine)');
		expect(inheritLabel('ticket', 'himmel')).toBe('Wie Projekt (Himmelblau)');
		expect(inheritLabel('ticket', null)).toBe('Wie Projekt (keine)');
	});
});
