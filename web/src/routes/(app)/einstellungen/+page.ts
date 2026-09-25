// /einstellungen forwards to its first page (ADR-0026 section 1). In the SPA the redirect runs in
// the client.

import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export function load(): never {
	redirect(307, resolve('/einstellungen/kanaele'));
}
