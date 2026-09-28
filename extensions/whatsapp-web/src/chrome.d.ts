// The few extension APIs of Chrome and Edge (Manifest V3) the extension uses, declared here
// instead of pulling in @types/chrome (ADR-0038: no dependency for a handful of calls).

declare namespace chrome {
	namespace runtime {
		const id: string;

		interface MessageSender {
			id?: string;
			url?: string;
		}

		interface InstalledDetails {
			reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update';
		}

		const onMessage: {
			addListener(
				callback: (
					message: unknown,
					sender: MessageSender,
					sendResponse: (response: unknown) => void
				) => boolean | void
			): void;
		};

		const onInstalled: {
			addListener(callback: (details: InstalledDetails) => void): void;
		};

		function sendMessage(message: unknown): Promise<unknown>;
		function openOptionsPage(): Promise<void>;
	}

	namespace storage {
		interface StorageChange {
			oldValue?: unknown;
			newValue?: unknown;
		}

		interface StorageArea {
			get(keys: string | string[]): Promise<Record<string, unknown>>;
			set(items: Record<string, unknown>): Promise<void>;
			remove(keys: string | string[]): Promise<void>;
		}

		const local: StorageArea;
		const session: StorageArea;

		const onChanged: {
			addListener(
				callback: (changes: Record<string, StorageChange>, areaName: string) => void
			): void;
		};
	}
}
