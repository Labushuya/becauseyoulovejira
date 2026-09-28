// Operating system of the server (ADR-0028, plan plattformen S0-3): GET /api/byl/host for signed-in
// users. The answer only picks the guides, so it never fails: before the restart after an update
// (no route yet, 404), without a session or on any other error the guides stay those for Windows.

import type PocketBase from 'pocketbase';
import type { RequestOptions } from './options';
import {
	DEFAULT_HOST_PLATFORM,
	parseHostPlatform,
	type HostPlatform
} from '../domain/host-platform';

const HOST_ROUTE = '/api/byl/host';

export async function fetchHostPlatform(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<HostPlatform> {
	try {
		const answer: unknown = await pb.send(HOST_ROUTE, {
			method: 'GET',
			requestKey: null,
			signal: options.signal
		});
		return parseHostPlatform(answer);
	} catch {
		return DEFAULT_HOST_PLATFORM;
	}
}
