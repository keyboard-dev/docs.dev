'use client';

/**
 * Client-side draft store for the admin editor.
 *
 * Edits are autosaved to IndexedDB as you type and overlay the published file
 * until you publish. Publishing is done by the server (which holds the GitHub
 * token in an env var), so no secrets ever live in the browser.
 */

const DB_NAME = 'docsdev-admin';
const DB_VERSION = 1;
const DRAFTS = 'drafts';

export type Draft = { slug: string; content: string; updatedAt: number };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'slug' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(DRAFTS, mode).objectStore(DRAFTS));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export function getDraft(slug: string): Promise<Draft | undefined> {
  return tx<Draft | undefined>('readonly', (s) => s.get(slug) as IDBRequest<Draft | undefined>);
}

export function putDraft(slug: string, content: string): Promise<unknown> {
  return tx('readwrite', (s) => s.put({ slug, content, updatedAt: Date.now() }));
}

export function deleteDraft(slug: string): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(slug));
}
