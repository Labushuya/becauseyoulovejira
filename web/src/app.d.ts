// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		/**
		 * Errors of the client (src/hooks.client.ts). `kind` "module-load": a part of the app could
		 * not be loaded, usually because a new build replaced it (ADR-0040); the error page then
		 * loads the address once more by itself.
		 */
		interface Error {
			message: string;
			kind?: 'module-load';
		}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
