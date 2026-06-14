'use client';

/**
 * Client-side draft store for the admin editor.
 *
 * Edits are autosaved to IndexedDB as you type and overlay the published file
 * until you publish. Publishing is done by the server (which holds the GitHub
 * token in an env var), so no secrets ever live in the browser.
 */

const DB_NAME = 'docsdev-admin';
const DB_VERSION = 3;
const DRAFTS = 'drafts';
const ASSETS = 'assets';
const INLINE = 'inlineEdits';

export type Draft = { slug: string; content: string; updatedAt: number };
/** An uploaded image/asset, stored locally until published. `path` is the URL
 *  it's referenced by (e.g. "/uploads/1700-logo.png"); `dataUrl` is the
 *  base64 data URL used both for instant draft display and for committing. */
export type Asset = { path: string; contentType: string; dataUrl: string };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'slug' });
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(INLINE)) db.createObjectStore(INLINE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function getDraft(slug: string): Promise<Draft | undefined> {
  return tx<Draft | undefined>(DRAFTS, 'readonly', (s) => s.get(slug) as IDBRequest<Draft | undefined>);
}

export function putDraft(slug: string, content: string): Promise<unknown> {
  return tx(DRAFTS, 'readwrite', (s) => s.put({ slug, content, updatedAt: Date.now() }));
}

export function deleteDraft(slug: string): Promise<unknown> {
  return tx(DRAFTS, 'readwrite', (s) => s.delete(slug));
}

export function putAsset(asset: Asset): Promise<unknown> {
  return tx(ASSETS, 'readwrite', (s) => s.put(asset));
}

export function getAsset(path: string): Promise<Asset | undefined> {
  return tx<Asset | undefined>(ASSETS, 'readonly', (s) => s.get(path) as IDBRequest<Asset | undefined>);
}

/** Per-page inline edits, keyed by the block's original (published) text. This
 *  lets inline edits re-apply to the page on a later visit, since the rendered
 *  DOM always starts from the published baseline. */
export type EditsMap = Record<string, string>;

export function getInlineEdits(slug: string): Promise<EditsMap> {
  return tx<EditsMap | undefined>(INLINE, 'readonly', (s) => s.get(slug) as IDBRequest<EditsMap | undefined>).then(
    (m) => m ?? {},
  );
}

export function setInlineEdits(slug: string, map: EditsMap): Promise<unknown> {
  return tx(INLINE, 'readwrite', (s) => s.put(map, slug));
}

export function deleteInlineEdits(slug: string): Promise<unknown> {
  return tx(INLINE, 'readwrite', (s) => s.delete(slug));
}
