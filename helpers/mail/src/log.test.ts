// Log of the mail helper: no access data, one line per event (E4 plan, package 11).

import { describe, expect, it } from 'vitest';
import { createLogger, errorText, redact } from './log';

describe('log', () => {
	it('replaces secrets, also URL-encoded, and cuts long texts', () => {
		expect(redact('pw=ge+heim/1 und ge%2Bheim%2F1', ['ge+heim/1'])).toBe('pw=*** und ***');
		expect(redact('abc', ['ab'])).toBe('abc');
		expect(redact('x'.repeat(1200), [])).toHaveLength(1000);
	});

	it('writes one line with time and level, never the secrets', () => {
		const lines: string[] = [];
		const log = createLogger(
			(line) => lines.push(line),
			() => ['s3cret-token'],
			() => new Date(Date.UTC(2026, 8, 25, 10, 0, 0))
		);
		log.info('Token s3cret-token\nzweite Zeile');
		log.warn('Warnung');
		log.error('Fehler');
		expect(lines).toEqual([
			'2026-09-25T10:00:00.000Z INFO Token *** zweite Zeile\n',
			'2026-09-25T10:00:00.000Z WARN Warnung\n',
			'2026-09-25T10:00:00.000Z ERROR Fehler\n'
		]);
	});

	it('names the code of a network error once', () => {
		const error = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
		expect(errorText(error)).toBe('connect refused (ECONNREFUSED)');
		expect(errorText(Object.assign(new Error('ECONNRESET happened'), { code: 'ECONNRESET' }))).toBe(
			'ECONNRESET happened'
		);
		expect(errorText('text')).toBe('text');
	});
});
