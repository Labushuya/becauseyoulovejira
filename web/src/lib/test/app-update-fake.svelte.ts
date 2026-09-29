// Reactive stand-in for the tests of AppUpdateNotice (ADR-0040): the version state of SvelteKit
// (`current`) and the signals of the app layout about unsaved input and running work.
export class FakeAppUpdate {
	current = $state(false);
	unsaved = $state(false);
	pending = $state(false);
}
