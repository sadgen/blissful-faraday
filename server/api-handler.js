/**
 * Blissful Faraday — Shared API handler
 *
 * Used by:
 *   - server/index.js  (production standalone server)
 *   - vite.config.js   (development Vite dev server)
 *
 * Exports createApiHandler() which returns (req, res, next) middleware.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ─── Persistent scan-dir and auth config ──────────────────────────────────

const SCAN_DIR_CONFIG_PATH = path.join(projectRoot, '.scan-directory.json');
const AUTH_CONFIG_PATH     = path.join(projectRoot, '.auth-config.json');

function loadScanDir() {
  try {
    if (fs.existsSync(SCAN_DIR_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(SCAN_DIR_CONFIG_PATH, 'utf8'));
      if (data.scanDirectory && fs.existsSync(data.scanDirectory)) {
        console.log(`[ScanDir] Loaded persisted scan directory: ${data.scanDirectory}`);
        return data.scanDirectory;
      }
    }
  } catch (err) {
    console.warn(`[ScanDir] Failed to load persisted scan directory: ${err.message}`);
  }
  return null;
}

function saveScanDir(dir) {
  try {
    fs.writeFileSync(SCAN_DIR_CONFIG_PATH, JSON.stringify({ scanDirectory: dir }, null, 2), 'utf8');
    console.log(`[ScanDir] Saved scan directory: ${dir}`);
  } catch (err) {
    console.warn(`[ScanDir] Failed to save scan directory: ${err.message}`);
  }
}

// ─── In-memory & persistent cache ─────────────────────────────────────────

let activeResourcesDir = loadScanDir() || path.resolve(projectRoot, 'resources');

const dirCollectionsCache = new Map();   // dir -> collection[]
const dirMtimeCache       = new Map();   // dir -> mtimeMs
const dirImagesCache      = new Map();   // dir -> Map(collection -> images[])

function getCacheFilePath(dir) {
  return path.join(dir, '.collection-cache.json');
}

function loadPersistentCache(dir) {
  try {
    const cachePath = getCacheFilePath(dir);
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cacheData.collections) dirCollectionsCache.set(dir, cacheData.collections);
      if (cacheData.collectionImages) {
        dirImagesCache.set(dir, new Map(Object.entries(cacheData.collectionImages)));
      }
      if (cacheData.dirMtime) dirMtimeCache.set(dir, cacheData.dirMtime);
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
    try { dirMtime = fs.statSync(dir).mtimeMs; } catch { dirMtime = Date.now(); }
    fs.writeFileSync(cachePath, JSON.stringify({
      collections,
      collectionImages: Object.fromEntries(collectionImagesMap),
      dirMtime,
      timestamp: Date.now(),
    }, null, 2), 'utf8');
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

function validateCache(dir) {
  try {
    const cCollections = dirCollectionsCache.get(dir);
    if (!cCollections) return false;

    const cMtime = dirMtimeCache.get(dir) || null;
    const cImages = dirImagesCache.get(dir) || new Map();
    const stat = fs.statSync(dir);

    // Fast mtime check
    if (cMtime && stat.mtimeMs === cMtime) {
      console.log(`[Cache] Fast validation passed: mtime matches perfectly (${stat.mtimeMs}).`);
      return true;
    }

    console.log(`[Cache] Fast validation failed (cached mtime=${cMtime}, actual mtime=${stat.mtimeMs}). Running deep validation...`);

    // Deep validation
    const actualFolders = new Set();
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory() && !item.name.startsWith('.')) {
        actualFolders.add(item.name);
      }
    }

    if (actualFolders.size !== cCollections.length) {
      console.log(`[Cache] Deep validation failed: cached count=${cCollections.length}, actual count=${actualFolders.size}.`);
      return false;
    }

    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);
    for (const coll of cCollections) {
      const folderName = typeof coll === 'string' ? coll : coll.name;
      if (!actualFolders.has(folderName)) {
        console.log(`[Cache] Deep validation failed: cached folder "${folderName}" no longer exists.`);
        return false;
      }
      try {
        const folderPath = path.join(dir, folderName);
        const files = fs.readdirSync(folderPath);
        const hasImages = files.some(f => !f.startsWith('.') && imageExtensions.has(path.extname(f).toLowerCase()));
        if (!hasImages) {
          console.log(`[Cache] Deep validation failed: cached folder "${folderName}" is now empty.`);
          return false;
        }
      } catch (e) {
        console.log(`[Cache] Deep validation failed: cannot read folder "${folderName}": ${e.message}`);
        return false;
      }
    }

    dirMtimeCache.set(dir, stat.mtimeMs);
    savePersistentCache(dir, cCollections, cImages);
    console.log(`[Cache] Deep validation passed: ${actualFolders.size} folders match.`);
    return true;
  } catch (err) {
    console.warn(`[Cache] Validation error: ${err.message}`);
    return false;
  }
}

// ─── Mime helper ─────────────────────────────────────────────────────────

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}

// ─── Path traversal guard ────────────────────────────────────────────────
// resolvedPath must be exactly base or strictly inside it. Rejects sibling
// prefix bypass (/a/b vs /a/b2) and '..' traversal after path.resolve.
function isPathWithin(resolvedPath, resolvedBase) {
  if (resolvedPath === resolvedBase) return true;
  if (!resolvedPath.startsWith(resolvedBase + path.sep)) return false;
  const rel = path.relative(resolvedBase, resolvedPath);
  // path.relative normalizes '..' — if it escapes the base, reject
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────

const loginRateLimitMap = new Map();
const LOGIN_RATE_LIMIT = { maxAttempts: 5, windowMs: 60000 };

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginRateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    loginRateLimitMap.set(ip, { count: 1, resetTime: now + LOGIN_RATE_LIMIT.windowMs });
    return true;
  }
  if (entry.count >= LOGIN_RATE_LIMIT.maxAttempts) return false;
  entry.count++;
  return true;
}

function loadAuthConfig() {
  try {
    if (fs.existsSync(AUTH_CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(AUTH_CONFIG_PATH, 'utf8'));
      if (!data.sessions) data.sessions = [];
      if (!data.accessLogs) data.accessLogs = [];
      if (data.enabled === undefined) data.enabled = false;
      if (data.sessionMaxAge === undefined) data.sessionMaxAge = 86400000;
      return data;
    }
  } catch (err) {
    console.warn('[Auth] Failed to load auth config:', err.message);
  }
  return {
    enabled: false, passwordHash: '',
    sessionMaxAge: 86400000, sessions: [], accessLogs: [],
  };
}

function saveAuthConfig(config) {
  try {
    const now = Date.now();
    config.sessions = config.sessions.filter(s => s.expiresAt > now);
    if (config.accessLogs.length > 50) config.accessLogs = config.accessLogs.slice(0, 50);
    fs.writeFileSync(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('[Auth] Failed to save auth config:', err.message);
    return false;
  }
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function logEvent(config, event, ip, details = '') {
  config.accessLogs.unshift({ timestamp: Date.now(), event, ip, details });
  saveAuthConfig(config);
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });
  return list;
}

function getSession(req, config) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['bf_session'];
  if (!token) return null;
  const now = Date.now();
  return config.sessions.find(s => s.token === token && s.expiresAt > now) || null;
}

function requireAuth(req, res, config) {
  if (!config.enabled) return true;
  const session = getSession(req, config);
  if (session) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
  return false;
}

// ─── Download list (favorites → daily download) ──────────────────────────

const DOWNLOAD_LIST_PATH = path.join(os.homedir(), '.blissful-faraday-daily-download.json');

function loadDownloadList() {
  try {
    if (fs.existsSync(DOWNLOAD_LIST_PATH)) {
      return JSON.parse(fs.readFileSync(DOWNLOAD_LIST_PATH, 'utf8'));
    }
  } catch (err) {
    console.warn(`[DownloadList] Failed to load: ${err.message}`);
  }
  return [];
}

function saveDownloadList(list) {
  try {
    fs.writeFileSync(DOWNLOAD_LIST_PATH, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[DownloadList] Failed to save: ${err.message}`);
  }
}

// ─── API middleware factory ───────────────────────────────────────────────

export function createApiHandler() {
  return (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const authConfig = loadAuthConfig();

    // ── Global auth interceptor ────────────────────────────────────────
    // GET /api/download-list is whitelisted (frontend loads it pre-login),
    // but the mutating POST endpoints (add/remove) require auth.
    if (url.pathname.startsWith('/api/') &&
        !url.pathname.startsWith('/api/auth/') &&
        url.pathname !== '/api/cache/clear' &&
        url.pathname !== '/api/collection/info' &&
        !(url.pathname.startsWith('/api/download-list') && req.method === 'GET')) {
      if (authConfig.enabled && !getSession(req, authConfig)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
        return;
      }
    }

    // ── /api/auth/status ────────────────────────────────────────────────
    if (url.pathname === '/api/auth/status') {
      const session = getSession(req, authConfig);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ enabled: authConfig.enabled, authenticated: session !== null }));
      return;
    }

    // ── POST /api/auth/login ────────────────────────────────────────────
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const clientIp = req.socket.remoteAddress || '127.0.0.1';
          const ip = req.headers['x-forwarded-for'] || clientIp;
          if (!checkLoginRateLimit(ip)) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '登录尝试过于频繁，请稍后再试。' }));
            return;
          }
          const userAgent = req.headers['user-agent'] || 'Unknown';
          if (!authConfig.enabled) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Password protection is disabled.' }));
            return;
          }
          if (authConfig.passwordHash && bcrypt.compareSync(data.password || '', authConfig.passwordHash)) {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = Date.now() + authConfig.sessionMaxAge;
            authConfig.sessions.push({ token, ip, userAgent, expiresAt, loginTime: Date.now() });
            logEvent(authConfig, '登录成功', ip, userAgent);
            const maxAgeSec = Math.floor(authConfig.sessionMaxAge / 1000);
            res.writeHead(200, {
              'Set-Cookie': `bf_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSec}`,
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ success: true }));
          } else {
            logEvent(authConfig, '登录失败 (密码错误)', ip, userAgent);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '密码错误' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/auth/logout ───────────────────────────────────────────
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const session = getSession(req, authConfig);
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      if (session) {
        authConfig.sessions = authConfig.sessions.filter(s => s.token !== session.token);
        logEvent(authConfig, '用户登出', ip, session.userAgent);
      }
      res.writeHead(200, {
        'Set-Cookie': 'bf_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ── GET /api/auth/admin/config ──────────────────────────────────────
    if (url.pathname === '/api/auth/admin/config') {
      try {
        if (!requireAuth(req, res, authConfig)) return;
        const currentSession = getSession(req, authConfig);
        const safeSessions = (authConfig.sessions || []).map(s => ({
          ip: s.ip, userAgent: s.userAgent, loginTime: s.loginTime,
          isCurrent: currentSession && s.token === currentSession.token,
          id: crypto.createHash('sha256').update(s.token || '').digest('hex'),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          enabled: authConfig.enabled, sessionMaxAge: authConfig.sessionMaxAge,
          sessions: safeSessions, accessLogs: authConfig.accessLogs || [],
          hasPassword: !!authConfig.passwordHash,
        }));
      } catch (err) {
        console.error('[Auth API Config Error]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/auth/admin/update ─────────────────────────────────────
    if (url.pathname === '/api/auth/admin/update' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
          if (authConfig.enabled && !requireAuth(req, res, authConfig)) return;

          if (data.newPassword) {
            if (authConfig.enabled && authConfig.passwordHash) {
              if (!bcrypt.compareSync(data.oldPassword || '', authConfig.passwordHash)) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '旧密码输入错误' }));
                return;
              }
            }
            authConfig.passwordHash = hashPassword(data.newPassword);
            const currentSession = getSession(req, authConfig);
            authConfig.sessions = currentSession
              ? authConfig.sessions.filter(s => s.token === currentSession.token)
              : [];
            logEvent(authConfig, '修改了管理员密码', ip);
          }

          if (data.enabled !== undefined) {
            if (data.enabled && !authConfig.passwordHash && !data.newPassword) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: '开启验证前必须先设置密码' }));
              return;
            }
            authConfig.enabled = !!data.enabled;
            logEvent(authConfig, authConfig.enabled ? '启用了密码访问保护' : '禁用了密码访问保护', ip);
          }

          if (data.sessionMaxAge !== undefined && typeof data.sessionMaxAge === 'number') {
            authConfig.sessionMaxAge = data.sessionMaxAge;
            logEvent(authConfig, `修改会话保持时长为 ${Math.round(data.sessionMaxAge / 3600000)} 小时`, ip);
          }

          saveAuthConfig(authConfig);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/auth/admin/revoke-session ─────────────────────────────
    if (url.pathname === '/api/auth/admin/revoke-session' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!requireAuth(req, res, authConfig)) return;
          const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
          const sessionId = data.id;
          const sessionToRevoke = authConfig.sessions.find(
            s => crypto.createHash('sha256').update(s.token).digest('hex') === sessionId
          );
          if (sessionToRevoke) {
            authConfig.sessions = authConfig.sessions.filter(s => s.token !== sessionToRevoke.token);
            logEvent(authConfig, '强制踢除了一个客户端设备', ip, `设备IP: ${sessionToRevoke.ip}`);
            saveAuthConfig(authConfig);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '未找到该在线设备' }));
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/auth/admin/clear-logs ─────────────────────────────────
    if (url.pathname === '/api/auth/admin/clear-logs' && req.method === 'POST') {
      if (!requireAuth(req, res, authConfig)) return;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      authConfig.accessLogs = [];
      logEvent(authConfig, '清空了审计日志', ip);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ── GET /api/lan-ip ─────────────────────────────────────────────────
    if (url.pathname === '/api/lan-ip') {
      try {
        const interfaces = os.networkInterfaces();
        let ip = '127.0.0.1';
        for (const ifName in interfaces) {
          const addrs = interfaces[ifName];
          for (const addr of addrs) {
            if (addr.family === 'IPv4' && !addr.internal) { ip = addr.address; break; }
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

    // ── GET /api/collections ────────────────────────────────────────────
    if (url.pathname === '/api/collections') {
      try {
        if (!fs.existsSync(activeResourcesDir)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Directory not found: ${activeResourcesDir}` }));
          return;
        }

        if (!dirCollectionsCache.has(activeResourcesDir)) {
          loadPersistentCache(activeResourcesDir);
        }

        if (dirCollectionsCache.has(activeResourcesDir)) {
          if (validateCache(activeResourcesDir)) {
            const cached = dirCollectionsCache.get(activeResourcesDir);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT-VALIDATED' });
            res.end(JSON.stringify({ scanDirectory: activeResourcesDir, collections: cached }));
            return;
          }
          dirCollectionsCache.delete(activeResourcesDir);
          dirMtimeCache.delete(activeResourcesDir);
          dirImagesCache.delete(activeResourcesDir);
          clearPersistentCache(activeResourcesDir);
        }

        // Full scan
        const collections = [];
        const items = fs.readdirSync(activeResourcesDir, { withFileTypes: true });
        const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);

        for (const item of items) {
          if (!item.isDirectory() || item.name.startsWith('.')) continue;
          try {
            const itemPath = path.join(activeResourcesDir, item.name);
            const files = fs.readdirSync(itemPath);
            if (!files.some(f => !f.startsWith('.') && imageExtensions.has(path.extname(f).toLowerCase()))) continue;
          } catch { continue; }

          let mtime = 0;
          try {
            const itemPath = path.join(activeResourcesDir, item.name);
            const files = fs.readdirSync(itemPath).filter(
              f => !f.startsWith('.') && imageExtensions.has(path.extname(f).toLowerCase())
            );
            if (files.length > 0) {
              const times = files.map(f => { try { return fs.statSync(path.join(itemPath, f)).mtimeMs; } catch { return 0; } });
              mtime = Math.max(...times, 0);
            } else {
              mtime = fs.statSync(itemPath).mtimeMs;
            }
          } catch { mtime = 0; }

          collections.push({ name: item.name, mtime });
        }

        dirCollectionsCache.set(activeResourcesDir, collections);
        try { dirMtimeCache.set(activeResourcesDir, fs.statSync(activeResourcesDir).mtimeMs); }
        catch { dirMtimeCache.set(activeResourcesDir, Date.now()); }

        const dirImgs = dirImagesCache.get(activeResourcesDir) || new Map();
        savePersistentCache(activeResourcesDir, collections, dirImgs);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'REBUILT' });
        res.end(JSON.stringify({ scanDirectory: activeResourcesDir, collections }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/collection/images?collection=xxx ────────────────────────
    if (url.pathname === '/api/collection/images') {
      const collection = url.searchParams.get('collection');
      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }

      const dirImages = dirImagesCache.get(activeResourcesDir) || new Map();
      if (dirImages.has(collection)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT-MEMORY' });
        res.end(JSON.stringify({ name: collection, images: dirImages.get(collection) }));
        return;
      }

      try {
        const requestedPath = path.join(activeResourcesDir, collection);
        const resolvedPath = path.resolve(requestedPath);
        const resolvedBase = path.resolve(activeResourcesDir);
        if (!isPathWithin(resolvedPath, resolvedBase)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path is outside the resource folder.' }));
          return;
        }
        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Collection not found: ${collection}` }));
          return;
        }

        const sortParam = url.searchParams.get('sort') || 'name';
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm'];
        let images = fs.readdirSync(resolvedPath).filter(
          f => !f.startsWith('.') && imageExts.includes(path.extname(f).toLowerCase())
        );

        if (sortParam === 'date') {
          images = images
            .map(f => ({ name: f, mtime: fs.statSync(path.join(resolvedPath, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)
            .map(f => f.name);
        }

        dirImages.set(collection, images);
        dirImagesCache.set(activeResourcesDir, dirImages);
        const dirColl = dirCollectionsCache.get(activeResourcesDir);
        savePersistentCache(activeResourcesDir, dirColl, dirImages);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' });
        res.end(JSON.stringify({ name: collection, images }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/image?collection=xxx&name=yyy ──────────────────────────
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
        if (!isPathWithin(resolvedPath, resolvedBase)) {
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
        const rangeHeader = req.headers.range;

        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          const chunksize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          fs.createReadStream(resolvedPath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          fs.createReadStream(resolvedPath).pipe(res);
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/settings ──────────────────────────────────────────────
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.scanDirectory) {
            if (data.scanDirectory === 'RESET_TO_DEFAULT') {
              activeResourcesDir = path.resolve(projectRoot, 'resources');
              saveScanDir(activeResourcesDir);
              loadPersistentCache(activeResourcesDir);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, scanDirectory: activeResourcesDir }));
            } else {
              const targetDir = path.resolve(data.scanDirectory);
              const allowedBases = [
                path.resolve(projectRoot),
                path.resolve(os.homedir()),
                '/mnt/nfs',
              ];
              const isAllowed = allowedBases.some(base => targetDir.startsWith(base));
              if (!isAllowed) {
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Access Denied: Path is outside allowed directories.' }));
                return;
              }
              if (fs.existsSync(targetDir)) {
                activeResourcesDir = targetDir;
                saveScanDir(activeResourcesDir);
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

    // ── GET /api/cache/info ─────────────────────────────────────────────
    if (url.pathname === '/api/cache/info') {
      try {
        const cachePath = getCacheFilePath(activeResourcesDir);
        const cacheExists = fs.existsSync(cachePath);
        const cCols = dirCollectionsCache.get(activeResourcesDir);
        const cImgs = dirImagesCache.get(activeResourcesDir);
        const info = {
          cachePath, cacheExists, scanDirectory: activeResourcesDir,
          hasMemoryCache: !!cCols,
          memoryCollectionsCount: cCols ? cCols.length : 0,
          memoryImagesCacheCount: cImgs ? cImgs.size : 0,
        };

        if (cacheExists) {
          try {
            const st = fs.statSync(cachePath);
            info.cacheSize = st.size;
            info.cacheModified = st.mtimeMs;
            const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            info.cachedCollectionsCount = cacheData.collections ? cacheData.collections.length : 0;
            info.cachedImagesCount = cacheData.collectionImages ? Object.keys(cacheData.collectionImages).length : 0;
            info.cacheTimestamp = cacheData.timestamp || 0;
          } catch (e) { info.cacheError = e.message; }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        });
        res.end(JSON.stringify(info));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/collection/info?collection=xxx ─────────────────────────
    if (url.pathname === '/api/collection/info') {
      const collection = url.searchParams.get('collection');
      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }
      try {
        const infoPath = path.join(os.homedir(), 'Pictures', 'instagram-scraped', collection, '.collection-info.json');
        if (fs.existsSync(infoPath)) {
          const infoData = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ username: infoData.username || collection, full_name: infoData.full_name || null }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ username: collection, full_name: null }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/collection/delete?collection=xxx ──────────────────────
    if (url.pathname === '/api/collection/delete' && req.method === 'POST') {
      const collection = url.searchParams.get('collection');
      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }
      try {
        const instagramDir = path.join(os.homedir(), 'Pictures', 'instagram-scraped');
        const collectionPath = path.join(instagramDir, collection);
        const resolvedPath = path.resolve(collectionPath);
        const resolvedBase = path.resolve(instagramDir);
        if (!resolvedPath.startsWith(resolvedBase)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path is outside the instagram-scraped folder.' }));
          return;
        }
        if (fs.existsSync(resolvedPath)) fs.rmSync(resolvedPath, { recursive: true, force: true });

        // Remove from accounts.json
        const accountsPath = path.join(os.homedir(), 'Projects', 'instagram-scraper', 'accounts.json');
        if (fs.existsSync(accountsPath)) {
          try {
            const accData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
            if (Array.isArray(accData)) {
              fs.writeFileSync(accountsPath, JSON.stringify({
                accounts: accData.filter(e => (typeof e === 'string' ? e : e.username) !== collection),
                deleted: [collection],
              }, null, 2), 'utf8');
            } else {
              if (!accData.deleted) accData.deleted = [];
              accData.accounts = (accData.accounts || []).filter(
                e => (typeof e === 'string' ? e : e.username) !== collection
              );
              if (!accData.deleted.includes(collection)) accData.deleted.push(collection);
              fs.writeFileSync(accountsPath, JSON.stringify(accData, null, 2), 'utf8');
            }
          } catch (e) { console.warn(`[Delete] Failed to update accounts.json: ${e.message}`); }
        }

        dirCollectionsCache.delete(activeResourcesDir);
        dirMtimeCache.delete(activeResourcesDir);
        dirImagesCache.delete(activeResourcesDir);
        clearPersistentCache(activeResourcesDir);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/collection/deleted ─────────────────────────────────────
    if (url.pathname === '/api/collection/deleted' && req.method === 'GET') {
      try {
        const accountsPath = path.join(os.homedir(), 'Projects', 'instagram-scraper', 'accounts.json');
        if (!fs.existsSync(accountsPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ usernames: [] }));
          return;
        }
        const accData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ usernames: accData.deleted || [] }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/collection/restore ────────────────────────────────────
    if (url.pathname === '/api/collection/restore' && req.method === 'POST') {
      if (!requireAuth(req, res, authConfig)) return;
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const { username } = JSON.parse(body);
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'username is required' }));
            return;
          }
          const accountsPath = path.join(os.homedir(), 'Projects', 'instagram-scraper', 'accounts.json');
          if (!fs.existsSync(accountsPath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            return;
          }
          const accData = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
          if (!accData.deleted) accData.deleted = [];
          if (!accData.accounts) accData.accounts = [];
          accData.deleted = accData.deleted.filter(u => u !== username);
          if (!accData.accounts.some(e => (typeof e === 'string' ? e : e.username) === username)) {
            accData.accounts.push(username);
          }
          fs.writeFileSync(accountsPath, JSON.stringify(accData, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/cache/clear ───────────────────────────────────────────
    if (url.pathname === '/api/cache/clear' && req.method === 'POST') {
      try {
        clearPersistentCache(activeResourcesDir);
        dirCollectionsCache.delete(activeResourcesDir);
        dirMtimeCache.delete(activeResourcesDir);
        dirImagesCache.delete(activeResourcesDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Cache cleared successfully', scanDirectory: activeResourcesDir }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/download-list ──────────────────────────────────────────
    if (url.pathname === '/api/download-list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ list: loadDownloadList() }));
      return;
    }

    // ── POST /api/download-list/add ─────────────────────────────────────
    if (url.pathname === '/api/download-list/add' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const username = (data.username || '').trim();
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'username is required' }));
            return;
          }
          const list = loadDownloadList();
          if (!list.includes(username)) {
            list.push(username);
            saveDownloadList(list);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/download-list/remove ──────────────────────────────────
    if (url.pathname === '/api/download-list/remove' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const username = (data.username || '').trim();
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'username is required' }));
            return;
          }
          const list = loadDownloadList().filter(u => u !== username);
          saveDownloadList(list);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, list }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // Not an API route → pass through
    next();
  };
}

// Export helpers so server/index.js can access them
// Re-export the active directory as a getter so it stays live
export function getActiveDir() { return activeResourcesDir; }
export { clearPersistentCache, dirCollectionsCache, dirMtimeCache, dirImagesCache };
