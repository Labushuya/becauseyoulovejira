import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const flows = loadHookLib('mail-flows.js');

const ENDPOINTS = [
	'request-password-reset',
	'request-verification',
	'request-email-change',
	'request-otp'
];
const COLLECTIONS = ['users', '_superusers', '_pb_users_auth_', 'pbc_3142635823'];

describe('mail-flows.js', () => {
	it.each(COLLECTIONS.flatMap((collection) => ENDPOINTS.map((endpoint) => [collection, endpoint])))(
		'matches POST /api/collections/%s/%s',
		(collection, endpoint) => {
			expect(flows.isMailFlowRequest('POST', `/api/collections/${collection}/${endpoint}`)).toBe(
				true
			);
		}
	);

	it.each([
		['GET', '/api/collections/users/request-password-reset'],
		['POST', '/api/collections/users/confirm-password-reset'],
		['POST', '/api/collections/users/confirm-verification'],
		['POST', '/api/collections/users/confirm-email-change'],
		['POST', '/api/collections/users/auth-with-password'],
		['POST', '/api/collections/users/auth-with-otp'],
		['POST', '/api/collections/users/auth-refresh'],
		['POST', '/api/collections/users/records'],
		['POST', '/api/collections/users/request-password-reset/extra'],
		['POST', '/api/collections//request-password-reset'],
		['POST', '/x/api/collections/users/request-otp'],
		['POST', undefined]
	])('leaves %s %s alone', (method, path) => {
		expect(flows.isMailFlowRequest(method, path)).toBe(false);
	});

	it('points to the README section and the reset script', () => {
		expect(flows.MAIL_FLOW_MESSAGE).toBe(
			'E-Mail-Versand ist nicht eingerichtet. Passwort zurücksetzen: siehe README, ' +
				'Abschnitt ‚Konten verwalten‘ bzw. app\\admin-zuruecksetzen.bat.'
		);
	});
});
