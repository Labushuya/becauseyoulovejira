// The lock of "Jetzt neu starten" without a connection (BW-2, ADR-0072 addendum BW-2): one rule for
// RestartAction and for the question after a change of access data (CredentialField). The outbox of
// the (app) layout (OF-2) knows the connection; without it (outside the layout, or at the PC while
// the outbox does not watch) a restart is never locked. Only the state of the connection is read;
// nothing goes into the outbox.

import { findOutbox } from '$lib/offline/outbox.svelte';

/** Call at the init of a component; the answer is reactive (true: the connection is missing). */
export function findRestartLock(): () => boolean {
	const outbox = findOutbox();
	return () => outbox?.offline === true;
}
