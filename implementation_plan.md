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

## Proposed Changes

### 1. Viewport Grid System (`src/App.jsx` and `src/index.css`)

We will replace the absolute positioning logic in `src/App.jsx` with a CSS Grid layout that adapts to the number of active windows.

- **Disable Pagination**: Clean up `currentPage`, `pageSize`, `isPaginated`, and `totalPages` state and calculations.
- **Simplified Active Collections**:
  - In folder split mode (`isAutoTiling === true`): Render all scanned collections.
  - In custom grid mode (`isAutoTiling === false`): Render the first `tileCount` collections.
- **CSS Grid Container**: Set `viewport-grid` as a CSS Grid using inline `gridTemplateColumns` and `gridTemplateRows` styled dynamically by the calculated `gridCols` and `gridRows`.
- **Automatic Layout calculation**: Keep `autoCalculateGridLayout` but trigger it whenever the number of active collections changes or on window resize.

---

## Verification Plan

### Automated & Manual Verification
- **Cache Creation**: Verify that `.collection-cache.json` is successfully created inside `resources/` on initial page load.
- **Server Restart Resiliency**: Start the development server, load the page, shut down the server, restart the server, and verify that `/api/collections` loads instantly with `X-Cache: HIT-DISK` in headers.
- **Hidden File Filtering**: Confirm that `.collection-cache.json` does NOT appear as an empty folder in the slideshow tiling layout.
- **Manual Rescan**: Change a collection, click the "Rescan" folder button in settings, and verify that the `.collection-cache.json` is updated with correct statistics.
- **Error Graceful Fallback**: Test behavior when pointing to a read-only directory to verify that the app operates smoothly using only in-memory caching.
