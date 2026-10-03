// Failed sign-ins that need attention (ADR-0055 §8, ADR-0035): when the app opens and when it is
// opened again, one quiet info flag with "Ansehen", only after 10 or more within 24 hours, and only
// once for the same newest failure (remembered per device). Any failure of the question, also a
// refusal for an account that is not the owner, means no flag.

import { NOTICE_TEXTS, type SecurityNotice } from '$lib/domain/security';
import type { FlagSink } from './flags.svelte';

/** localStorage: the time of the newest failure the flag already named. */
export const SEEN_KEY = 'byl-security-seen';

export interface SecurityAttentionDeps {
	/** The notice of the server, or null (fetchSecurityNotice). */
	check(): Promise<SecurityNotice | null>;
	flags: FlagSink;
	/** Opens the protocol on the page "Einstellungen → Sicherheit". */
	open(): void;
	storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

function storageOf(deps: SecurityAttentionDeps): Pick<Storage, 'getItem' | 'setItem'> | null {
	if (deps.storage !== undefined) return deps.storage;
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

export class SecurityAttention {
	readonly #deps: SecurityAttentionDeps;
	#flag: string | null = null;

	constructor(deps: SecurityAttentionDeps) {
		this.#deps = deps;
	}

	/** Asks the server and shows the flag (one at a time) for new failures that need attention. */
	async announce(): Promise<void> {
		const notice = await this.#deps.check();
		if (notice === null || !notice.attention || notice.last === null) return;
		const storage = storageOf(this.#deps);
		let seen: string | null;
		try {
			seen = storage?.getItem(SEEN_KEY) ?? null;
		} catch {
			seen = null;
		}
		if (seen !== null && seen >= notice.last) return;
		try {
			storage?.setItem(SEEN_KEY, notice.last);
		} catch {
			// Without storage the flag may come again at the next start; nothing else breaks.
		}
		const { flags } = this.#deps;
		if (this.#flag !== null) flags.dismiss(this.#flag);
		const id = flags.show({
			tone: 'info',
			title: NOTICE_TEXTS.title(notice.count),
			action: { label: NOTICE_TEXTS.action, run: () => this.#deps.open() },
			onclose: () => {
				if (this.#flag === id) this.#flag = null;
			}
		});
		this.#flag = id;
	}
}
