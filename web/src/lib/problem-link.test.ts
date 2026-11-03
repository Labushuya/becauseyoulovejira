// The address of an entry of the error log of the server (FP-2, ADR-0077): `?fehler=<id>` on the
// current page, and the way back without it.

import { describe, expect, it } from 'vitest';
import { withServerProblem, withoutServerProblem } from './problem-link';

describe('problem-link', () => {
	it('puts the entry into the address of the current page, other parameters and the hash stay', () => {
		const url = new URL(
			'http://127.0.0.1:8090/einstellungen/kanaele?einrichten=telegram#verbindung-x'
		);
		expect(withServerProblem(url, 'abc123def456ghi')).toBe(
			'/einstellungen/kanaele?einrichten=telegram&fehler=abc123def456ghi#verbindung-x'
		);
		expect(withServerProblem(new URL('http://127.0.0.1:8090/'), 'abc123def456ghi')).toBe(
			'/?fehler=abc123def456ghi'
		);
	});

	it('takes only the entry out of the address', () => {
		expect(
			withoutServerProblem(
				new URL(
					'http://127.0.0.1:8090/einstellungen/kanaele?fehler=abc123def456ghi&einrichten=telegram'
				)
			)
		).toBe('/einstellungen/kanaele?einrichten=telegram');
		expect(
			withoutServerProblem(new URL('http://127.0.0.1:8090/tickets?fehler=abc123def456ghi#x'))
		).toBe('/tickets#x');
	});
});
