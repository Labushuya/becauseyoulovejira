// Vitest globalSetup for the "integration" project: one disposable PocketBase
// instance per test run. Connection data reaches the tests only in memory via
// provide/inject (key "pocketbase").

import { startPocketBase } from './pocketbase-harness.mjs';

/** @param {import('vitest/node').TestProject} project */
export default async function setup(project) {
	const instance = await startPocketBase();
	project.provide('pocketbase', {
		url: instance.url,
		superuserEmail: instance.email,
		superuserPassword: instance.password
	});
	return () => instance.stop();
}
