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

// ─── Instagram 浏览同步（油猴脚本回调）────────────────────────────────────
// 油猴脚本在用户正常浏览 Instagram 时，把页面上已加载的 CDN 媒体地址回传到
// 这里，由服务端下载进 instagram-scraped/{username}/，画廊即可放映。
// 稳定文件名（CDN 路径中的媒体 ID）既是去重键，也是画廊扫描的文件名。

const INSTAGRAM_SCRAPE_DIR = path.join(os.homedir(), 'Pictures', 'instagram-scraped');
const HARVEST_MAX_BYTES = 500 * 1024 * 1024;
// 只允许从 Instagram CDN 下载，另放行 localhost 供本地测试
const HARVEST_ALLOWED_HOSTS = ['cdninstagram.com', 'fbcdn.net', 'localhost', '127.0.0.1'];

function isHarvestHostAllowed(urlString) {
  try {
    const h = new URL(urlString).hostname.toLowerCase();
    return HARVEST_ALLOWED_HOSTS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

// 按文件真实内容的魔数判断扩展名，避免 CDN 返回格式与 URL 后缀不符
function sniffExt(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  if (buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png';
  if (buffer.length > 4 && buffer.toString('ascii', 0, 4) === 'GIF8') return '.gif';
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (buffer.length > 8 && buffer.toString('ascii', 4, 8) === 'ftyp') return '.mp4';
  if (buffer.length > 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return '.webm';
  return null;
}

function harvestFilename(urlString, type) {
  try {
    const u = new URL(urlString);
    let base = decodeURIComponent(u.pathname.split('/').pop() || '');
    base = base.replace(/[^\w.\-]+/g, '_').slice(0, 120);
    if (!/\.(jpe?g|png|gif|webp|bmp|svg|mp4|webm)$/i.test(base)) {
      base += type === 'video' ? '.mp4' : '.jpg';
    }
    return base;
  } catch { return null; }
}

function mediaIdPrefix(urlString) {
  let s = String(urlString || '');
  try { s = decodeURIComponent(new URL(s).pathname.split('/').pop() || s); } catch {}
  const m = s.match(/^(\d{8,})_/);
  return m ? m[1] : null;
}

// 视频入库后删除其封面图（封面与视频共享媒体 ID 前缀，仅删图片扩展名）
function removeVideoPosters(dir, prefixes) {
  try {
    const set = prefixes instanceof Set
      ? prefixes
      : new Set((Array.isArray(prefixes) ? prefixes : [prefixes]).filter(Boolean));
    if (!set.size) return 0;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d{8,})_/);
      if (m && set.has(m[1]) && /\.(jpe?g|png|webp)$/i.test(f)) {
        try { fs.unlinkSync(path.join(dir, f)); removed++; } catch {}
      }
    }
    if (removed) console.log(`[Harvest] 已移除 ${removed} 张视频封面 @ ${dir}`);
    return removed;
  } catch { return 0; }
}

// 下载到 tmpPath（隐藏文件 + .part 后缀，画廊扫描会跳过点文件，半成品不会出现在图集里）
async function harvestDownload(urlString, tmpPath) {
  const res = await fetch(urlString, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Referer: 'https://www.instagram.com/',
    },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) return false;
  const out = fs.createWriteStream(tmpPath);
  try {
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > HARVEST_MAX_BYTES) throw new Error('文件超过大小上限');
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    }
  } catch (err) {
    try { res.body.cancel?.(); } catch {}
    try { out.destroy(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
  await new Promise(resolve => out.end(resolve));
  return true;
}

// ─── API middleware factory ───────────────────────────────────────────────

export function createApiHandler() {
  return (req, res, next) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const authConfig = loadAuthConfig();

    // ── Global auth interceptor ────────────────────────────────────────
    if (url.pathname.startsWith('/api/') &&
        !url.pathname.startsWith('/api/auth/') &&
        !url.pathname.startsWith('/api/userscript/')) {
      if (authConfig.enabled && !getSession(req, authConfig)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
        return;
      }
    }

    // ── Serve Userscripts (/userscripts/* or /api/userscript/*) ─────────
    if ((url.pathname.startsWith('/userscripts/') || url.pathname.startsWith('/api/userscript/')) &&
        (req.method === 'GET' || req.method === 'HEAD')) {
      const subPath = url.pathname.startsWith('/userscripts/')
        ? url.pathname.replace(/^\/userscripts\//, '')
        : url.pathname.replace(/^\/api\/userscript\//, '');
      const userscriptsDir = path.resolve(projectRoot, 'userscripts');
      const targetPath = path.resolve(userscriptsDir, subPath);

      if (isPathWithin(targetPath, userscriptsDir) && fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
        const ext = path.extname(targetPath).toLowerCase();
        const mime = ext === '.js' ? 'application/javascript; charset=utf-8' : (ext === '.md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8');
        res.writeHead(200, {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        // Substitute template domain with the real deployment URL so installed
        // userscripts keep auto-updating against the private reverse proxy
        let content = fs.readFileSync(targetPath, 'utf8');
        const publicUrl = process.env.GALLERY_PUBLIC_URL;
        if (publicUrl) {
          const origin = publicUrl.replace(/\/+$/, '');
          let hostname = origin;
          try { hostname = new URL(origin).hostname; } catch { /* keep raw */ }
          content = content.split('https://gallery.example.com:8443').join(origin)
                           .split('gallery.example.com').join(hostname);
        }
        res.end(content);
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

    // ── POST /api/collection/delete?collection=xxx[&name=yyy] ────────────
    if (url.pathname === '/api/collection/delete' && req.method === 'POST') {
      const collection = url.searchParams.get('collection');
      const filename = url.searchParams.get('name') || url.searchParams.get('file');
      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }
      try {
        const collectionPath = path.join(activeResourcesDir, collection);
        const resolvedPath = path.resolve(collectionPath);
        const resolvedBase = path.resolve(activeResourcesDir);
        if (!isPathWithin(resolvedPath, resolvedBase)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied: Path is outside the resources folder.' }));
          return;
        }

        const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);

        if (filename) {
          const filePath = path.join(resolvedPath, filename);
          const resolvedFilePath = path.resolve(filePath);
          if (!isPathWithin(resolvedFilePath, resolvedPath)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access Denied: File is outside the collection folder.' }));
            return;
          }

          if (fs.existsSync(resolvedFilePath)) {
            fs.unlinkSync(resolvedFilePath);
          }

          let remainingFiles = [];
          if (fs.existsSync(resolvedPath)) {
            remainingFiles = fs.readdirSync(resolvedPath).filter(
              f => !f.startsWith('.') && imageExtensions.has(path.extname(f).toLowerCase())
            );
          }

          let folderDeleted = false;
          if (remainingFiles.length === 0) {
            if (fs.existsSync(resolvedPath)) {
              fs.rmSync(resolvedPath, { recursive: true, force: true });
            }
            folderDeleted = true;
            dirCollectionsCache.delete(activeResourcesDir);
            dirMtimeCache.delete(activeResourcesDir);
            dirImagesCache.delete(activeResourcesDir);
            clearPersistentCache(activeResourcesDir);
          } else {
            const dirImages = dirImagesCache.get(activeResourcesDir);
            if (dirImages && dirImages.has(collection)) {
              dirImages.set(collection, remainingFiles);
            }
            const dirColl = dirCollectionsCache.get(activeResourcesDir);
            if (dirColl && dirImages) {
              savePersistentCache(activeResourcesDir, dirColl, dirImages);
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            folderDeleted,
            remainingCount: remainingFiles.length,
            deletedFile: filename
          }));
        } else {
          if (fs.existsSync(resolvedPath)) {
            fs.rmSync(resolvedPath, { recursive: true, force: true });
          }

          dirCollectionsCache.delete(activeResourcesDir);
          dirMtimeCache.delete(activeResourcesDir);
          dirImagesCache.delete(activeResourcesDir);
          clearPersistentCache(activeResourcesDir);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, folderDeleted: true, remainingCount: 0 }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/instagram/harvest ─────────────────────────────────────
    // Body: { username, items: [{ url, type?, alt? }] }
    // url 为页面上实际加载的地址；alt 为脚本按 IG CDN 规律还原的全尺寸候选地址，
    // 服务端按 alt → url 顺序尝试，全部失败才计 failed。
    if (url.pathname === '/api/instagram/harvest' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c.toString());
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const username = (data.username || '').trim();
          if (username === '.' || username === '..' || !/^[A-Za-z0-9._]{1,30}$/.test(username)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'username 格式非法' }));
            return;
          }
          const targetDir = path.join(INSTAGRAM_SCRAPE_DIR, username);
          if (!isPathWithin(path.resolve(targetDir), path.resolve(INSTAGRAM_SCRAPE_DIR))) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access Denied' }));
            return;
          }
          const rawItems = Array.isArray(data.items) ? data.items : [];
          const items = rawItems.slice(0, 60).filter(it => it && typeof it.url === 'string');
          if (!items.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'items 为空' }));
            return;
          }

          fs.mkdirSync(targetDir, { recursive: true });
          let downloaded = 0, skipped = 0, failed = 0;
          const videoPrefixSet = new Set();

          for (const item of items) {
            try {
              const candidates = [...(Array.isArray(item.alt) ? item.alt : []), item.url]
                .filter(u => typeof u === 'string' && isHarvestHostAllowed(u));
              if (!candidates.length) { failed++; continue; }

              const base = harvestFilename(item.url, item.type);
              if (!base) { failed++; continue; }
              const finalPath0 = path.join(targetDir, base);
              if (fs.existsSync(finalPath0)) { skipped++; continue; }

              const tmpPath = path.join(targetDir, '.' + base + '.part');
              let ok = false;
              for (const candidate of candidates) {
                try { ok = await harvestDownload(candidate, tmpPath); } catch { ok = false; }
                if (ok) break;
              }
              if (!ok) {
                console.warn(`[Harvest] 下载失败 @${username}: ${base} ← ${candidates[0]}`);
                try { fs.unlinkSync(tmpPath); } catch {}
                failed++;
                continue;
              }

              // 校正扩展名：CDN 常返回与 URL 后缀不符的格式（如 webp 冒充 jpg）
              let finalPath = finalPath0;
              try {
                const head = Buffer.alloc(16);
                const fd = fs.openSync(tmpPath, 'r');
                fs.readSync(fd, head, 0, 16, 0);
                fs.closeSync(fd);
                const real = sniffExt(head);
                const cur = path.extname(finalPath).toLowerCase();
                if (real && real !== cur && !(cur === '.jpeg' && real === '.jpg')) {
                  finalPath = path.join(targetDir, path.basename(finalPath, cur) + real);
                }
              } catch {}

              if (fs.existsSync(finalPath)) {
                fs.unlinkSync(tmpPath);
                skipped++;
                continue;
              }
              fs.renameSync(tmpPath, finalPath);
              downloaded++;
              if (item.type === 'video') {
                videoPrefixSet.add(mediaIdPrefix(item.url));
                videoPrefixSet.add(mediaIdPrefix(item.poster));
              }
            } catch { failed++; }
          }
          // 视频入库后删除其封面图，避免"封面 + 视频"重复展示
          removeVideoPosters(targetDir, videoPrefixSet);

          // 图集元数据，/api/collection/info 会读取并在 UI 显示 full_name
          try {
            const infoPath = path.join(targetDir, '.collection-info.json');
            if (!fs.existsSync(infoPath)) {
              fs.writeFileSync(infoPath, JSON.stringify({
                username, full_name: null, source: 'browser-harvest', updatedAt: Date.now(),
              }, null, 2), 'utf8');
            }
          } catch {}

          console.log(`[Harvest] @${username}: 成功 ${downloaded} · 跳过 ${skipped} · 失败 ${failed} / 共 ${items.length}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, username, downloaded, skipped, failed, total: items.length }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── POST /api/instagram/harvest-blob ────────────────────────────────
    // 流式视频（blob: 播放源）没有可直连的 mp4 地址，由油猴脚本把浏览器
    // 已加载的视频内容以 base64 中继到这里。按内容 sha1 去重。
    // Body: { username, data: 'data:video/mp4;base64,...' }
    if (url.pathname === '/api/instagram/harvest-blob' && req.method === 'POST') {
      let body = '';
      let bodySize = 0;
      req.on('data', c => {
        bodySize += c.length;
        if (bodySize > 220 * 1024 * 1024) { req.destroy(); return; }
        body += c.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const username = (data.username || '').trim();
          if (username === '.' || username === '..' || !/^[A-Za-z0-9._]{1,30}$/.test(username)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'username 格式非法' }));
            return;
          }
          const targetDir = path.join(INSTAGRAM_SCRAPE_DIR, username);
          if (!isPathWithin(path.resolve(targetDir), path.resolve(INSTAGRAM_SCRAPE_DIR))) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access Denied' }));
            return;
          }
          const m = typeof data.data === 'string' ? data.data.match(/^data:[^;]+;base64,(.+)$/) : null;
          if (!m) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'data 为空或格式非法' }));
            return;
          }
          const buf = Buffer.from(m[1], 'base64');
          if (buf.length < 64 * 1024) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '视频内容过小，可能是 MSE 流不可读' }));
            return;
          }
          if (buf.length > HARVEST_MAX_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '视频超过大小上限' }));
            return;
          }
          fs.mkdirSync(targetDir, { recursive: true });
          const ext = sniffExt(buf.subarray(0, 16));
          if (ext !== '.mp4' && ext !== '.webm') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '内容不是视频（magic number 校验失败）' }));
            return;
          }
          const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
          const finalPath = path.join(targetDir, `${hash}${ext}`);
          if (fs.existsSync(finalPath)) {
            console.log(`[Harvest-Blob] @${username}: 内容已存在，跳过 (${hash})`);
            removeVideoPosters(targetDir, [mediaIdPrefix(data.posterUrl), mediaIdPrefix(data.srcUrl)]);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, username, downloaded: 0, skipped: 1 }));
            return;
          }
          const tmpPath = path.join(targetDir, `.${hash}.part`);
          fs.writeFileSync(tmpPath, buf);
          fs.renameSync(tmpPath, finalPath);
          removeVideoPosters(targetDir, [mediaIdPrefix(data.posterUrl), mediaIdPrefix(data.srcUrl)]);
          try {
            const infoPath = path.join(targetDir, '.collection-info.json');
            if (!fs.existsSync(infoPath)) {
              fs.writeFileSync(infoPath, JSON.stringify({
                username, full_name: null, source: 'browser-harvest', updatedAt: Date.now(),
              }, null, 2), 'utf8');
            }
          } catch {}
          const sizeMB = (buf.length / 1024 / 1024).toFixed(1);
          const dbg = data.debug && typeof data.debug === 'object'
            ? ` [taps=${data.debug.groups || 0} 组/${(data.debug.bytes || 0) / 1024 / 1024 > 0.01 ? ((data.debug.bytes || 0) / 1024 / 1024).toFixed(1) + 'MB' : (data.debug.bytes || 0) + 'B'}]` : '';
          console.log(`[Harvest-Blob] @${username}: ${path.basename(finalPath)} (${sizeMB} MB)${dbg}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, username, downloaded: 1, skipped: 0, sizeMB }));
        } catch (err) {
          console.warn(`[Harvest-Blob] 失败: ${err.message}`);
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

    // Not an API route → pass through
    next();
  };
}

// Export helpers so server/index.js can access them
// Re-export the active directory as a getter so it stays live
export function getActiveDir() { return activeResourcesDir; }
export { clearPersistentCache, dirCollectionsCache, dirMtimeCache, dirImagesCache };
