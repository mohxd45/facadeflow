import { INDEXED_DB_NAME, INDEXED_DB_STORE } from "@/lib/constants";

/**
 * IndexedDB store for drawing file blobs (files ≤ 250 MB).
 * Avoids loading large files into memory via localStorage.
 *
 * Future: remove once blobs live in Supabase Storage / S3.
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEXED_DB_STORE)) {
        db.createObjectStore(INDEXED_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveFileBlob(
  drawingId: string,
  file: Blob
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB_STORE, "readwrite");
    tx.objectStore(INDEXED_DB_STORE).put(file, drawingId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function getFileBlob(drawingId: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB_STORE, "readonly");
    const request = tx.objectStore(INDEXED_DB_STORE).get(drawingId);
    request.onsuccess = () => {
      db.close();
      resolve((request.result as Blob) ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function deleteFileBlob(drawingId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB_STORE, "readwrite");
    tx.objectStore(INDEXED_DB_STORE).delete(drawingId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
