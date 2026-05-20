# Implementation Plan - Persistent Local Directory Caching (Blissful Faraday style)

To make the image viewer incredibly fast and resilient to server restarts when handling **10,000+ folders**, we are adding a persistent disk-based JSON indexing cache directly inside the active scanned folder.

## User Review Required

> [!NOTE]
> **Cache File Location**: The cache file `.collection-cache.json` will be written directly inside the active scanned photo directory (e.g. `./resources/` by default). This makes the cache fully portable.
> If the directory is write-protected (e.g. read-only permissions), the system will automatically log a warning and fall back to high-performance in-memory caching.

> [!IMPORTANT]
> **Hidden File Exclusion**: To prevent the cache file `.collection-cache.json` or other system/git files (e.g. `.git`, `.DS_Store`) from showing up as empty image folders in the UI, all files and folders starting with a dot `.` are strictly ignored during subdirectory scanning.

---

## Proposed Changes

### 1. Backend Server Config (`vite.config.js`)
We will upgrade `vite.config.js` to implement the persistent disk cache system:

- **Cache Helpers**:
  - `getCacheFilePath(dir)`: Resolves the cache file path to `path.join(dir, '.collection-cache.json')`.
  - `loadPersistentCache(dir)`: Attempts to read and parse the cache file. If found, populates the in-memory `collectionsCache` and `collectionImagesCache` keys.
  - `savePersistentCache(dir, collections, collectionImages)`: Safely writes the current scanned dataset into `.collection-cache.json`.
  - `clearPersistentCache(dir)`: Deletes the cache file on directory changes or manual rescan requests.
- **Hidden File Filtering**:
  - Modify `/api/collections` to ignore any subdirectory where `name.startsWith('.')`.
- **Cache Hits Flow**:
  - **`/api/collections`**: Checks in-memory cache -> checks `.collection-cache.json` -> performs disk scan on miss -> saves to memory and disk cache.
  - **`/api/collection/images`**: Checks in-memory cache -> checks loaded persistent cache -> performs folder scan on miss -> updates memory and writes updated cache to disk.
  - **`/api/settings`**: Clears persistent cache file in the old directory and triggers loading/creation in the new directory.

---

## Verification Plan

### Automated & Manual Verification
- **Cache Creation**: Verify that `.collection-cache.json` is successfully created inside `resources/` on initial page load.
- **Server Restart Resiliency**: Start the development server, load the page, shut down the server, restart the server, and verify that `/api/collections` loads instantly with `X-Cache: HIT-DISK` in headers.
- **Hidden File Filtering**: Confirm that `.collection-cache.json` does NOT appear as an empty folder in the slideshow tiling layout.
- **Manual Rescan**: Change a collection, click the "Rescan" folder button in settings, and verify that the `.collection-cache.json` is updated with correct statistics.
- **Error Graceful Fallback**: Test behavior when pointing to a read-only directory to verify that the app operates smoothly using only in-memory caching.
