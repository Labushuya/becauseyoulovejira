import { describe, expect, it } from 'vitest';
import { guardTarget, loginUrlFor, safeRedirect } from './guard';

const ORIGIN = 'http://127.0.0.1:8090';

function at(path: string): URL {
	return new URL(path, ORIGIN);
}

describe('safeRedirect', () => {
	it.each(['/', '/tickets', '/tickets/abc?status=open#comments', '/login'])(
		'keeps the internal path %s',
		(path) => {
			expect(safeRedirect(path, ORIGIN)).toBe(path);
		}
	);

	it.each([null, undefined, ''])('falls back to "/" for %s', (target) => {
		expect(safeRedirect(target, ORIGIN)).toBe('/');
	});

	it.each([
		'//evil.example',
		'/\\evil.example',
		'https://evil.example',
		'javascript:alert(1)',
		'tickets',
		'/\t/evil.example',
		'/\n/evil.example',
		'/..//evil.example',
		'/tickets/..//evil.example'
	])('rejects %j', (target) => {
		expect(safeRedirect(target, ORIGIN)).toBe('/');
	});

	it('normalizes dot segments of internal paths', () => {
		expect(safeRedirect('/tickets/../projects', ORIGIN)).toBe('/projects');
	});
});

describe('loginUrlFor', () => {
	it('adds the current path, query and hash as redirect parameter', () => {
		expect(loginUrlFor(at('/tickets/abc?status=open#comments'))).toBe(
			'/login?redirect=%2Ftickets%2Fabc%3Fstatus%3Dopen%23comments'
		);
	});

	it('omits the parameter for the start page', () => {
		expect(loginUrlFor(at('/'))).toBe('/login');
	});

	it('round-trips through the login page', () => {
		const login = at(loginUrlFor(at('/tickets/a b?x=1&y=2')));
		expect(safeRedirect(login.searchParams.get('redirect'), ORIGIN)).toBe('/tickets/a%20b?x=1&y=2');
	});
});

describe('guardTarget', () => {
	it('sends visitors without a session to the login page', () => {
		expect(guardTarget(at('/'), false)).toBe('/login');
		expect(guardTarget(at('/tickets/abc'), false)).toBe('/login?redirect=%2Ftickets%2Fabc');
	});

	it('shows the login page without a session', () => {
		expect(guardTarget(at('/login'), false)).toBeNull();
		expect(guardTarget(at('/login?redirect=%2Ftickets'), false)).toBeNull();
	});

	it('shows every other page with a session', () => {
		expect(guardTarget(at('/'), true)).toBeNull();
		expect(guardTarget(at('/tickets/abc'), true)).toBeNull();
	});

	it('forwards a logged-in user from the login page to "/"', () => {
		expect(guardTarget(at('/login'), true)).toBe('/');
	});

	it('forwards a logged-in user from the login page to a valid redirect only', () => {
		expect(guardTarget(at('/login?redirect=%2Ftickets'), true)).toBe('/tickets');
		expect(guardTarget(at('/login?redirect=%2F%2Fevil.example'), true)).toBe('/');
		expect(guardTarget(at('/login?redirect=https%3A%2F%2Fevil.example'), true)).toBe('/');
	});
});
