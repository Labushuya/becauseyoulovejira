// The disposable instance of the smoke test of the phone frame (MO-1a, ADR-0073), as the global setup
// hands it to the tests: address and invented account in the environment of the runner, in memory
// only. The names are no BYL_* names, which hold the access data of the Windows account (ADR-0018).

export const MOBILE_ENV = {
	url: 'BECAUSEYOULOVEJIRA_MOBILE_URL',
	email: 'BECAUSEYOULOVEJIRA_MOBILE_EMAIL',
	password: 'BECAUSEYOULOVEJIRA_MOBILE_PASSWORD'
};

/** Address and account of the instance; throws outside a run with the global setup. */
export function mobileInstance() {
	const url = process.env[MOBILE_ENV.url];
	const email = process.env[MOBILE_ENV.email];
	const password = process.env[MOBILE_ENV.password];
	if (!url || !email || !password) {
		throw new Error('No instance of the smoke test: run it with npm run test:mobile.');
	}
	return { url, email, password };
}
