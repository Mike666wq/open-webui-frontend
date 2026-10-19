const DATABASE_NAME = 'owui-mist-appearance';
const DATABASE_VERSION = 1;
const STORE_NAME = 'wallpapers';

type StoredWallpaper = {
	id: string;
	blob: Blob;
	createdAt: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is unavailable'));
	}
	if (databasePromise) return databasePromise;
	databasePromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE_NAME)) {
				database.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Unable to open wallpaper storage'));
	});
	return databasePromise;
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error('Wallpaper storage failed'));
		transaction.onabort = () => reject(transaction.error ?? new Error('Wallpaper storage was aborted'));
	});
}

export async function saveWallpaperAsset(assetId: string, blob: Blob): Promise<void> {
	const database = await openDatabase();
	const transaction = database.transaction(STORE_NAME, 'readwrite');
	transaction.objectStore(STORE_NAME).put({
		id: assetId,
		blob,
		createdAt: Date.now()
	} satisfies StoredWallpaper);
	await transactionComplete(transaction);
}

export async function loadWallpaperAsset(assetId: string): Promise<Blob | null> {
	const database = await openDatabase();
	const transaction = database.transaction(STORE_NAME, 'readonly');
	const request = transaction.objectStore(STORE_NAME).get(assetId);
	const result = await new Promise<StoredWallpaper | undefined>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result as StoredWallpaper | undefined);
		request.onerror = () => reject(request.error ?? new Error('Unable to read wallpaper'));
	});
	await transactionComplete(transaction);
	return result?.blob instanceof Blob ? result.blob : null;
}

export async function deleteWallpaperAsset(assetId: string): Promise<void> {
	const database = await openDatabase();
	const transaction = database.transaction(STORE_NAME, 'readwrite');
	transaction.objectStore(STORE_NAME).delete(assetId);
	await transactionComplete(transaction);
}

export async function pruneWallpaperAssets(referencedIds: Iterable<string>): Promise<void> {
	const database = await openDatabase();
	const keep = new Set(referencedIds);
	const transaction = database.transaction(STORE_NAME, 'readwrite');
	const store = transaction.objectStore(STORE_NAME);
	const request = store.getAllKeys();
	request.onsuccess = () => {
		for (const key of request.result) {
			if (typeof key === 'string' && !keep.has(key)) store.delete(key);
		}
	};
	await transactionComplete(transaction);
}
