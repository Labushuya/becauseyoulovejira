// Encryption of a sealed backup (ADR-0046 §3): the age format with a passphrase (scrypt recipient)
// through age-encryption (typage by Filippo Valsorda, the reference implementation of age for
// JavaScript). Nothing here builds its own cryptography; this file only maps the errors of the
// library onto the reasons the control script shows.

import { Decrypter, Encrypter } from 'age-encryption';

export type AgeFailure = 'passphrase' | 'format';

export class AgeError extends Error {
	readonly reason: AgeFailure;

	constructor(reason: AgeFailure, message: string) {
		super(message);
		this.reason = reason;
	}
}

/** The first bytes of every binary age file. */
export const AGE_MAGIC = 'age-encryption.org/v1\n';

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * `plain` encrypted for `passphrase`. `workFactor` is the scrypt exponent (log2 N); without it the
 * default of the library (18), which the age command line accepts as well.
 */
export function encrypt(
	passphrase: string,
	plain: ReadableStream<Uint8Array>,
	workFactor?: number
): Promise<ReadableStream<Uint8Array>> {
	const encrypter = new Encrypter();
	encrypter.setPassphrase(passphrase);
	if (workFactor !== undefined) encrypter.setScryptWorkFactor(workFactor);
	return encrypter.encrypt(plain);
}

/**
 * `sealed` decrypted with `passphrase`. A wrong passphrase or a file that is not age fails here; a
 * damaged or cut body fails while the returned stream is read.
 */
export async function decrypt(
	passphrase: string,
	sealed: ReadableStream<Uint8Array>
): Promise<ReadableStream<Uint8Array>> {
	const decrypter = new Decrypter();
	decrypter.addPassphrase(passphrase);
	try {
		return await decrypter.decrypt(sealed);
	} catch (error) {
		const message = messageOf(error);
		if (/no identity matched/i.test(message)) {
			throw new AgeError('passphrase', 'the passphrase does not open this backup');
		}
		throw new AgeError('format', `not an age file: ${message}`);
	}
}
