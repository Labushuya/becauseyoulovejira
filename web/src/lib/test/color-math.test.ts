// Color math of the token tests (ADR-0027): contrast after WCAG 2.x, CIELAB and CIEDE2000 against
// published reference values, so the contrast and distance checks in tokens.test.ts can be trusted.

import { describe, expect, it } from 'vitest';
import { contrast, deltaE2000, deltaE2000Lab, hexToLab, hslHue, type Lab } from './color-math';

describe('color math', () => {
	it('computes the WCAG contrast ratios', () => {
		expect(contrast('#000000', '#ffffff')).toBe(21);
		expect(contrast('#ffffff', '#ffffff')).toBe(1);
		expect(contrast('#a13a40', '#ffffff')).toBeCloseTo(6.57, 2);
		expect(contrast('#eaa0a0', '#0e1517')).toBeCloseTo(8.82, 2);
		expect(contrast('#ffffff', '#a13a40')).toBe(contrast('#a13a40', '#ffffff'));
	});

	it('rejects values that are not #rrggbb', () => {
		expect(() => contrast('#fff', '#000000')).toThrow('Not a #rrggbb color');
		expect(() => hexToLab('rgb(0 0 0)')).toThrow('Not a #rrggbb color');
	});

	it('converts sRGB to CIELAB (D65)', () => {
		const [l, a, b] = hexToLab('#ffffff');
		expect(l).toBeCloseTo(100, 2);
		expect(a).toBeCloseTo(0, 2);
		expect(b).toBeCloseTo(0, 2);
		const red = hexToLab('#ff0000');
		expect(red[0]).toBeCloseTo(53.24, 1);
		expect(red[1]).toBeCloseTo(80.09, 1);
		expect(red[2]).toBeCloseTo(67.2, 1);
	});

	// Reference pairs of Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference formula".
	it.each<[Lab, Lab, number]>([
		[[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
		[[50, 0, 0], [50, -1, 2], 2.3669],
		[[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
		[[50, 2.5, 0], [73, 25, -18], 27.1492],
		[[50, 2.5, 0], [56, -27, -3], 31.903],
		[[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
		[[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
		[[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381]
	])('computes CIEDE2000 of %j and %j as %d', (first, second, expected) => {
		expect(deltaE2000Lab(first, second)).toBeCloseTo(expected, 4);
		expect(deltaE2000Lab(second, first)).toBeCloseTo(expected, 4);
	});

	it('gives no difference for the same color and a large one for black and white', () => {
		expect(deltaE2000('#07838f', '#07838f')).toBe(0);
		expect(deltaE2000('#000000', '#ffffff')).toBeCloseTo(100, 0);
	});

	it('reads the HSL hue', () => {
		expect(hslHue('#ff0000')).toBe(0);
		expect(hslHue('#00ff00')).toBe(120);
		expect(hslHue('#0000ff')).toBe(240);
		expect(hslHue('#808080')).toBe(0);
		expect(hslHue('#07838f')).toBeCloseTo(185.3, 1);
	});
});
