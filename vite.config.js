import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default scan directory is the 'resources' folder in the workspace
let activeResourcesDir = path.resolve(__dirname, 'resources');

// High-Performance In-Memory Cache to speed up repeat scans (for 10,000+ folders)
let collectionsCache = null;
let collectionsDirMtime = null; // Cached modification time of the active directory
const collectionImagesCache = new Map();

// Persistent Disk Cache Helpers (Blissful Faraday style)
function getCacheFilePath(dir) {
  return path.join(dir, '.collection-cache.json');
}

function loadPersistentCache(dir) {
  try {
    const cachePath = getCacheFilePath(dir);
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      
      // Restore collections cache
      if (cacheData.collections) {
        collectionsCache = cacheData.collections;
      }
      
      // Restore collection images cache
      if (cacheData.collectionImages) {
        Object.entries(cacheData.collectionImages).forEach(([key, value]) => {
          collectionImagesCache.set(key, value);
        });
      }

      // Restore directory mtime
      if (cacheData.dirMtime) {
        collectionsDirMtime = cacheData.dirMtime;
      }
      
      console.log(`[Cache] Loaded persistent cache from ${cachePath}`);
      return true;
    }
  } catch (err) {
    console.warn(`[Cache] Failed to load persistent cache: ${err.message}`);
  }
  return false;
}

function savePersistentCache(dir, collections, collectionImagesMap) {
  try {
    const cachePath = getCacheFilePath(dir);
    let dirMtime = null;
    try {
      dirMtime = fs.statSync(dir).mtimeMs;
    } catch (e) {
      dirMtime = Date.now();
    }

    const cacheData = {
      collections: collections,
      collectionImages: Object.fromEntries(collectionImagesMap),
      dirMtime: dirMtime,
      timestamp: Date.now()
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(`[Cache] Saved persistent cache to ${cachePath}`);
    return true;
  } catch (err) {
    console.warn(`[Cache] Failed to save persistent cache: ${err.message}`);
    return false;
  }
}

function clearPersistentCache(dir) {
  try {
    const cachePath = getCacheFilePath(dir);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      console.log(`[Cache] Cleared persistent cache at ${cachePath}`);
    }
  } catch (err) {
    console.warn(`[Cache] Failed to clear persistent cache: ${err.message}`);
  }
}

// Quick validation: Check parent directory modification time
function validateCache(dir) {
  try {
    if (!collectionsCache) return false;
    
    const stat = fs.statSync(dir);
    
    // Fast path: If directory modification time matches, bypass disk read entirely!
    if (collectionsDirMtime && stat.mtimeMs === collectionsDirMtime) {
      console.log(`[Cache] Fast validation passed: mtime matches perfectly (${stat.mtimeMs}).`);
      return true;
    }
    
    console.log(`[Cache] Fast validation failed (cached mtime=${collectionsDirMtime}, actual mtime=${stat.mtimeMs}). Running deep validation...`);
    
    // Deep validation: Get all actual directory names (excluding hidden)
    const actualFolders = new Set();
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.')) {
        actualFolders.add(item.name);
      }
    }
    
    // 1. Check if counts match
    if (actualFolders.size !== collectionsCache.length) {
      console.log(`[Cache] Deep validation failed: cached count=${collectionsCache.length}, actual count=${actualFolders.size}.`);
      return false;
    }
    
    // 2. Check if all cached folder names still exist on disk
    for (const coll of collectionsCache) {
      const folderName = typeof coll === 'string' ? coll : coll.name;
      if (!actualFolders.has(folderName)) {
        console.log(`[Cache] Deep validation failed: cached folder "${folderName}" no longer exists on disk.`);
        return false;
      }
    }
    
    // Deep validation passed, sync and save the new directory mtime
    collectionsDirMtime = stat.mtimeMs;
    savePersistentCache(dir, collectionsCache, collectionImagesCache);
    
    console.log(`[Cache] Deep validation passed: ${actualFolders.size} folders match perfectly.`);
    return true;
  } catch (err) {
    console.warn(`[Cache] Validation error: ${err.message}`);
    return false;
  }
}

// Helper to determine mime type by extension
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

// Custom API Plugin for local image collections scanning and safe retrieval
function imageScannerApiPlugin() {
  const middleware = (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    // 0. GET /api/lan-ip
    // Returns the server's local LAN IP address
    if (url.pathname === '/api/lan-ip') {
      try {
        const interfaces = os.networkInterfaces();
        let ip = '127.0.0.1';
        for (const interfaceName in interfaces) {
          const addresses = interfaces[interfaceName];
          for (const address of addresses) {
            if (address.family === 'IPv4' && !address.internal) {
              ip = address.address;
              break;
            }
          }
          if (ip !== '127.0.0.1') break;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ip }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 1. GET /api/collections
    // High-Performance: Returns a JSON list of collection names & mod times (subdirectories). Scalable to 10,000+ folders!
    if (url.pathname === '/api/collections') {
      try {
        if (!fs.existsSync(activeResourcesDir)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Directory not found: ${activeResourcesDir}` }));
          return;
        }

        // Try to load persistent cache on first access
        if (!collectionsCache) {
          loadPersistentCache(activeResourcesDir);
        }

        // Validate cache if available in memory
        if (collectionsCache) {
          const isValid = validateCache(activeResourcesDir);
          
          if (!isValid) {
            // Cache is invalid, clear and rebuild
            console.log('[Cache] Rebuilding cache due to validation failure...');
            collectionsCache = null;
            collectionsDirMtime = null;
            collectionImagesCache.clear();
            clearPersistentCache(activeResourcesDir);
          } else {
            // Cache is valid, return it
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT-VALIDATED' });
            res.end(JSON.stringify({
              scanDirectory: activeResourcesDir,
              collections: collectionsCache
            }));
            return;
          }
        }

        // No cache or invalid cache - scan directory
        const collections = [];
        const items = fs.readdirSync(activeResourcesDir, { withFileTypes: true });

        for (const item of items) {
          // Filter out hidden files/folders (starting with dot)
          if (item.isDirectory() && !item.name.startsWith('.')) {
            let mtime = 0;
            try {
              const itemPath = path.join(activeResourcesDir, item.name);
              const stat = fs.statSync(itemPath);
              mtime = stat.mtimeMs;
            } catch (e) {
              // Fallback for folders with locked permissions or transient deletions
              mtime = 0;
            }
            collections.push({
              name: item.name,
              mtime: mtime
            });
          }
        }

        // Cache the result in memory
        collectionsCache = collections;
        try {
          collectionsDirMtime = fs.statSync(activeResourcesDir).mtimeMs;
        } catch (e) {
          collectionsDirMtime = Date.now();
        }
        
        // Save to persistent cache
        savePersistentCache(activeResourcesDir, collections, collectionImagesCache);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'REBUILT' });
        res.end(JSON.stringify({
          scanDirectory: activeResourcesDir,
          collections: collections
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 2. GET /api/collection/images?collection=xxx
    // High-Performance: Lazy-scans a single specific subdirectory on demand for its image list.
    if (url.pathname === '/api/collection/images') {
      const collection = url.searchParams.get('collection');

      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }

      // Return cached image list if available in memory
      if (collectionImagesCache.has(collection)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT-MEMORY' });
        res.end(JSON.stringify({
          name: collection,
          images: collectionImagesCache.get(collection)
        }));
        return;
      }

      try {
        const requestedPath = path.join(activeResourcesDir, collection);
        const resolvedPath = path.resolve(requestedPath);
        const resolvedBase = path.resolve(activeResourcesDir);

        // Directory traversal security check
        if (!resolvedPath.startsWith(resolvedBase)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path is outside the resource folder.' }));
          return;
        }

        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Collection not found: ${collection}` }));
          return;
        }

        const files = fs.readdirSync(resolvedPath);
        // Filter for image files and exclude hidden files
        const images = files.filter(file => {
          const ext = path.extname(file).toLowerCase();
          return !file.startsWith('.') && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext);
        });

        // Cache the result in memory
        collectionImagesCache.set(collection, images);
        
        // Save updated cache to persistent storage
        savePersistentCache(activeResourcesDir, collectionsCache, collectionImagesCache);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' });
        res.end(JSON.stringify({
          name: collection,
          images: images
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 2. GET /api/image?collection=xxx&name=yyy
    // Safely resolves and serves the requested image file, supporting HTTP Range requests for instant dimension probing.
    if (url.pathname === '/api/image') {
      const collection = url.searchParams.get('collection');
      const name = url.searchParams.get('name');

      if (!collection || !name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameters: collection and name are required.' }));
        return;
      }

      try {
        const requestedPath = path.join(activeResourcesDir, collection, name);
        const resolvedPath = path.resolve(requestedPath);
        const resolvedBase = path.resolve(activeResourcesDir);

        // Directory traversal security check
        if (!resolvedPath.startsWith(resolvedBase)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path is outside the resource folder.' }));
          return;
        }

        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Image not found: ${collection}/${name}` }));
          return;
        }

        const stat = fs.statSync(resolvedPath);
        const mimeType = getMimeType(resolvedPath);
        
        // Handle HTTP Range header to support fast size/dimension querying without downloading whole massive images
        const rangeHeader = req.headers.range;
        
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, "").split("-");
          const partialstart = parts[0];
          const partialend = parts[1];
          
          const start = parseInt(partialstart, 10);
          const end = partialend ? parseInt(partialend, 10) : stat.size - 1;
          
          const chunksize = (end - start) + 1;
          
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable'
          });
          
          const stream = fs.createReadStream(resolvedPath, { start, end });
          stream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable' // Leverage browser cache for massive images
          });
          
          const stream = fs.createReadStream(resolvedPath);
          stream.pipe(res);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. POST /api/settings
    // Allows setting a custom resource path from the web page interface.
     if (url.pathname === '/api/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.scanDirectory) {
            // Clear high-performance caches on rescan/change
            collectionsCache = null;
            collectionsDirMtime = null;
            collectionImagesCache.clear();
            
            // Clear persistent cache in old directory
            clearPersistentCache(activeResourcesDir);
            
            if (data.scanDirectory === 'RESET_TO_DEFAULT') {
              activeResourcesDir = path.resolve(__dirname, 'resources');
              
              // Try to load persistent cache for new directory
              loadPersistentCache(activeResourcesDir);
              
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, scanDirectory: activeResourcesDir }));
            } else {
              const targetDir = path.resolve(data.scanDirectory);
              if (fs.existsSync(targetDir)) {
                activeResourcesDir = targetDir;
                
                // Try to load persistent cache for new directory
                loadPersistentCache(activeResourcesDir);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, scanDirectory: activeResourcesDir }));
              } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Directory does not exist on your machine.' }));
              }
            }
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing scanDirectory parameter.' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 4. GET /api/cache/info
    // Returns cache file path and status information
    if (url.pathname === '/api/cache/info') {
      try {
        const cachePath = getCacheFilePath(activeResourcesDir);
        const cacheExists = fs.existsSync(cachePath);
        
        let cacheInfo = {
          cachePath: cachePath,
          cacheExists: cacheExists,
          scanDirectory: activeResourcesDir,
          hasMemoryCache: collectionsCache !== null,
          memoryCollectionsCount: collectionsCache ? collectionsCache.length : 0,
          memoryImagesCacheCount: collectionImagesCache.size
        };
        
        if (cacheExists) {
          try {
            const stat = fs.statSync(cachePath);
            cacheInfo.cacheSize = stat.size;
            cacheInfo.cacheModified = stat.mtimeMs;
            
            // Read cache content to get more info
            const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            cacheInfo.cachedCollectionsCount = cacheData.collections ? cacheData.collections.length : 0;
            cacheInfo.cachedImagesCount = cacheData.collectionImages ? Object.keys(cacheData.collectionImages).length : 0;
            cacheInfo.cacheTimestamp = cacheData.timestamp || 0;
          } catch (err) {
            cacheInfo.cacheError = err.message;
          }
        }
        
        res.writeHead(200, { 
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
        });
        res.end(JSON.stringify(cacheInfo));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 5. POST /api/cache/clear
    // Clears the persistent cache file for the current directory
    if (url.pathname === '/api/cache/clear' && req.method === 'POST') {
      try {
        clearPersistentCache(activeResourcesDir);
        
        // Also clear in-memory caches
        collectionsCache = null;
        collectionsDirMtime = null;
        collectionImagesCache.clear();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Cache cleared successfully',
          scanDirectory: activeResourcesDir
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    next();
  };

  return {
    name: 'vite-image-scanner-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

export default defineConfig({
  plugins: [react(), imageScannerApiPlugin()],
  server: {
    host: '0.0.0.0', // Allow LAN access in dev mode
    port: 3000,
    open: true
  },
  preview: {
    host: '0.0.0.0', // Allow LAN access in preview/production mode
    port: 3000,
    open: true
  }
});
