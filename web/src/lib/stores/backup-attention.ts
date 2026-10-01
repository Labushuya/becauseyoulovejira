// Backups that need attention (ADR-0046 §5, ADR-0035): when the app opens and when it is opened
// again, one quiet info flag with "Ansehen", only for a real warning (an old backup, a target
// folder that lags, a failed backup or copy; a missing passphrase alone is shown on the page only).
// The server answers the question without the control script; any failure, also on a server that
// is not on Windows, means no flag.

import { ATTENTION_TEXTS } from '$lib/domain/backup';
import type { FlagSink } from './flags.svelte';

export interface BackupAttentionDeps {
	/** Whether the backups need attention now (fetchBackupAttention). */
	check(): Promise<boolean>;
	flags: FlagSink;
	/** Opens the page "Einstellungen → Sicherung". */
	open(): void;
}

export class BackupAttention {
	readonly #deps: BackupAttentionDeps;
	#flag: string | null = null;

	constructor(deps: BackupAttentionDeps) {
		this.#deps = deps;
	}

	/** Asks the server and shows the flag (one at a time) if the backups need attention. */
	async announce(): Promise<void> {
		if (!(await this.#deps.check())) return;
		const { flags } = this.#deps;
		if (this.#flag !== null) flags.dismiss(this.#flag);
		const id = flags.show({
			tone: 'info',
			title: ATTENTION_TEXTS.title,
			action: { label: ATTENTION_TEXTS.action, run: () => this.#deps.open() },
			onclose: () => {
				if (this.#flag === id) this.#flag = null;
			}
		});
		this.#flag = id;
	}
}
