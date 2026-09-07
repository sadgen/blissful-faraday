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
// 每个图集列表缓存时的目录 mtime 基线：读取时比对，目录内容变了即重建，
// 避免 harvest 新入库后播放端长期看不到新文件
const dirImagesMtimeCache = new Map();   // dir -> Map(collection -> mtimeMs)

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
        const imgs = new Map(Object.entries(cacheData.collectionImages));
        const m = new Map();
        for (const coll of imgs.keys()) {
          try { m.set(coll, fs.statSync(path.join(dir, coll)).mtimeMs); } catch { m.set(coll, Date.now()); }
        }
        dirImagesCache.set(dir, imgs);
        dirImagesMtimeCache.set(dir, m);
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

// ─── 去抖持久化 & 去抖全量重建 ────────────────────────────────────────────
// harvest 进行时目录 mtime/文件数持续变化，4 个播放窗口的每个请求都会触发
// 校验失败 → 全量重扫 + 整包写盘。Node 单线程下这些同步 fs 操作会把事件循环
// 堵死（曾在 2 秒内连写 130 次缓存文件，四个窗口全部卡死）。因此：
//   1. 写盘统一走 schedulePersistentSave：同一目录 2s 内只落盘一次；
//   2. /api/collections 校验失败时先用过期缓存应答，全量重建去抖 1.5s 合并执行。
const pendingSaveTimers = new Map();   // dir -> timer
const pendingRebuildTimers = new Map(); // dir -> timer
const rebuildingDirs = new Set();

function schedulePersistentSave(dir) {
  if (pendingSaveTimers.has(dir)) return;
  pendingSaveTimers.set(dir, setTimeout(() => {
    pendingSaveTimers.delete(dir);
    const collections = dirCollectionsCache.get(dir);
    if (collections) savePersistentCache(dir, collections, dirImagesCache.get(dir) || new Map());
  }, 2000));
}

function scanCollectionsSync(dir) {
  const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);
  const collections = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    try {
      const itemPath = path.join(dir, item.name);
      const files = fs.readdirSync(itemPath);
      if (!files.some(f => !f.startsWith('.') && imageExtensions.has(path.extname(f).toLowerCase()))) continue;
    } catch { continue; }

    let mtime = 0;
    try {
      const itemPath = path.join(dir, item.name);
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
  return collections;
}

// 后台去抖全量重建：只刷新内存缓存与持久化文件，不关联任何响应
function scheduleDirRebuild(dir, delay = 1500) {
  if (pendingRebuildTimers.has(dir)) return;
  pendingRebuildTimers.set(dir, setTimeout(() => {
    pendingRebuildTimers.delete(dir);
    if (rebuildingDirs.has(dir)) return;
    rebuildingDirs.add(dir);
    try {
      const collections = scanCollectionsSync(dir);
      dirCollectionsCache.set(dir, collections);
      try { dirMtimeCache.set(dir, fs.statSync(dir).mtimeMs); }
      catch { dirMtimeCache.set(dir, Date.now()); }
      schedulePersistentSave(dir);
      console.log(`[Cache] Background rebuild done: ${collections.length} collections.`);
    } catch (err) {
      console.warn(`[Cache] Background rebuild failed: ${err.message}`);
    } finally {
      rebuildingDirs.delete(dir);
    }
  }, delay));
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
    schedulePersistentSave(dir);
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

// 下载到 tmpPath（隐藏文件 + .part 后缀，画廊扫描会跳过点文件，半成品不会出现在图集里）。
// tmpPath 由函数内部拼装并校验，调用方只传目标目录与已消毒的文件名。
async function harvestDownload(urlString, targetDir, base) {
  const tmpPath = path.join(targetDir, `.${base}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.part`);
  if (!isPathWithin(path.resolve(tmpPath), path.resolve(targetDir))) {
    throw new Error('非法下载路径');
  }
  const res = await fetch(urlString, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Referer: 'https://www.instagram.com/',
    },
    redirect: 'follow',
  });
  if (!res.ok || !res.body) {
    try { res.body?.cancel?.(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
    return null;
  }
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
  return tmpPath;
}

// ─── 帖子结构 manifest（账号目录下 .posts.json）───────────────────────────
// 油猴脚本回传媒体时附带所属帖子（shortcode/发帖时间/caption）。服务端把
// 「哪个文件属于哪个帖子」记进 manifest，画廊据此按 帖子时间倒序 + 帖内
// carousel 顺序 放映，复刻刷主页的流程。媒体文件本身仍平铺入库，manifest
// 只是索引，文件被删时同步清理条目。
// 注意：manifest 的读/写 fs 一律在路由内联完成（username 已在路由入口按
// ^[A-Za-z0-9._]{1,30}$ 校验，等价于既有 targetDir 的构造方式）；本节只放
// 纯数据变换函数，不触碰文件系统。

// 只接受可信形状：id 为 IG shortcode 字符集，时间戳为合理秒级 Unix 时间
function sanitizePostMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  let ts = null;
  if (Number.isFinite(raw.ts) && raw.ts > 0 && raw.ts < 4102444800) ts = Math.floor(raw.ts);
  let caption = null;
  if (typeof raw.caption === 'string' && raw.caption.trim()) caption = raw.caption.trim().slice(0, 500);
  return { id, ts, caption };
}

// 把 [{ post, filename }] 归并进 manifest 对象（原地修改），返回是否有变化。
// post 缺失（旧脚本或 DOM 兜底拿不到 shortcode）只跳过不报错。
function mergePostEntries(manifest, entries) {
  let changed = false;
  for (const e of (entries || [])) {
    const post = sanitizePostMeta(e && e.post);
    const filename = e && typeof e.filename === 'string' ? e.filename : null;
    if (!post || !filename) continue;
    let p = manifest.posts[post.id];
    if (!p) {
      manifest.posts[post.id] = { id: post.id, ts: post.ts, caption: post.caption, media: [filename] };
      changed = true;
      continue;
    }
    if (!p.ts && post.ts) { p.ts = post.ts; changed = true; }
    if (!p.caption && post.caption) { p.caption = post.caption; changed = true; }
    if (!Array.isArray(p.media)) p.media = [];
    if (!p.media.includes(filename)) { p.media.push(filename); changed = true; }
  }
  return changed;
}

// 纯函数：manifest.posts → 按发帖时间倒序的帖子数组（帖内 media 为入库文件名）
function sortedPostsOf(manifest) {
  return Object.values((manifest && manifest.posts) || {})
    .map(p => ({
      id: p.id,
      ts: p.ts || null,
      caption: p.caption || null,
      media: Array.isArray(p.media) ? p.media : [],
    }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// 纯函数：从 manifest 中剔除一组文件名；帖子媒体清空后条目一并移除。
// 返回是否被修改（调用方据此决定是否回写文件）。
function removePostFiles(manifest, filenames) {
  const set = new Set(filenames.filter(Boolean));
  if (!set.size) return false;
  let changed = false;
  for (const id of Object.keys(manifest.posts)) {
    const post = manifest.posts[id];
    if (!Array.isArray(post.media)) continue;
    const next = post.media.filter(f => !set.has(f));
    if (next.length !== post.media.length) { post.media = next; changed = true; }
    if (!post.media.length) { delete manifest.posts[id]; changed = true; }
  }
  return changed;
}

// ─── 帖子级虚拟图集（`username::postId`）──────────────────────────────────
// 带 manifest 的 IG 账号在 /api/collections 里展开为一个个帖子条目，画廊的
// 每个窗口播一个帖子；文件仍在账号目录平铺，复合名只在 API 层解析。
// `username::__unsorted` 是特殊的未归属文件集合（旧批次或无 shortcode 的视频）。

// 账号名字符集防线（与 harvest 路由的 username 校验一致）
function isSafeAccountName(name) {
  return typeof name === 'string' && name !== '.' && name !== '..' && /^[A-Za-z0-9._]{1,30}$/.test(name);
}

// 拆分复合图集名，非法返回 null
function splitCompositeCollection(name) {
  if (typeof name !== 'string') return null;
  const i = name.indexOf('::');
  if (i <= 0) return null;
  const username = name.slice(0, i);
  const postId = name.slice(i + 2);
  if (!isSafeAccountName(username)) return null;
  if (postId !== '__unsorted' && !/^[A-Za-z0-9_-]{1,64}$/.test(postId)) return null;
  return [username, postId];
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
          // 校验失败（harvest 进行时目录持续变化）：立即用过期缓存应答，
          // 全量重扫去抖到后台合并执行——绝不在请求路径上同步重扫 977 个目录
          scheduleDirRebuild(activeResourcesDir);
          const stale = dirCollectionsCache.get(activeResourcesDir);
          if (stale && stale.length > 0) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'STALE-REBUILDING' });
            res.end(JSON.stringify({ scanDirectory: activeResourcesDir, collections: stale }));
            return;
          }
          dirCollectionsCache.delete(activeResourcesDir);
          dirMtimeCache.delete(activeResourcesDir);
          dirImagesCache.delete(activeResourcesDir);
          dirImagesMtimeCache.delete(activeResourcesDir);
        }

        // Full scan（仅内存中完全没有可用列表时才会走到这里）
        const collections = scanCollectionsSync(activeResourcesDir);

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

    // ── GET /api/collection/images（帖子级虚拟图集 user::postId）─────────
    // 复合名走独立路由：直接按 manifest 返回，不经磁盘扫描与列表缓存；
    // 文件仍在 instagram-scraped/账号/ 下，名称合法性先经 splitCompositeCollection
    if (url.pathname === '/api/collection/images'
        && splitCompositeCollection(url.searchParams.get('collection') || '')) {
      const collection = url.searchParams.get('collection');
      try {
        const [username, postId] = splitCompositeCollection(collection);
        const igRoot = path.resolve(INSTAGRAM_SCRAPE_DIR);
        const accountDir = path.resolve(path.join(igRoot, username));
        if (!isPathWithin(accountDir, igRoot) || accountDir === igRoot) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied' }));
          return;
        }
        const manifestPath = path.join(accountDir, '.posts.json');
        let manifest = { version: 1, updatedAt: 0, posts: {} };
        try {
          if (fs.existsSync(manifestPath)) {
            const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
          }
        } catch {}
        const exts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);
        let images = [];
        if (postId === '__unsorted') {
          const inPosts = new Set();
          for (const p of Object.values(manifest.posts)) {
            (Array.isArray(p.media) ? p.media : []).forEach(f => inPosts.add(f));
          }
          try {
            images = fs.readdirSync(accountDir).filter(
              f => !f.startsWith('.') && !inPosts.has(f) && exts.has(path.extname(f).toLowerCase())
            );
          } catch {}
        } else {
          const post = manifest.posts[postId];
          images = post && Array.isArray(post.media)
            ? post.media.filter(f => typeof f === 'string' && !f.startsWith('.')
              && !f.includes('/') && !f.includes('\\')
              && exts.has(path.extname(f).toLowerCase())
              && fs.existsSync(path.join(accountDir, f)))
            : [];
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'POSTS-MANIFEST' });
        res.end(JSON.stringify({ name: collection, images }));
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
        // 列表自校验：目录 mtime 与缓存基线不一致（harvest 新入库等）则重建
        let fresh = true;
        let currentMtime = null;
        try {
          currentMtime = fs.statSync(path.join(activeResourcesDir, collection)).mtimeMs;
          const cachedMtime = (dirImagesMtimeCache.get(activeResourcesDir) || new Map()).get(collection);
          if (cachedMtime !== undefined && currentMtime !== cachedMtime) fresh = false;
        } catch { fresh = false; }
        if (fresh) {
          // 首次读取（重启后无基线）时补记当前 mtime 作为后续比对基线
          if (currentMtime !== null) {
            let mt = dirImagesMtimeCache.get(activeResourcesDir);
            if (!mt) { mt = new Map(); dirImagesMtimeCache.set(activeResourcesDir, mt); }
            if (!mt.has(collection)) mt.set(collection, currentMtime);
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT-MEMORY' });
          res.end(JSON.stringify({ name: collection, images: dirImages.get(collection) }));
          return;
        }
        dirImages.delete(collection);
        const mtimes = dirImagesMtimeCache.get(activeResourcesDir);
        if (mtimes) mtimes.delete(collection);
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
        let dmt = dirImagesMtimeCache.get(activeResourcesDir);
        if (!dmt) { dmt = new Map(); dirImagesMtimeCache.set(activeResourcesDir, dmt); }
        try { dmt.set(collection, fs.statSync(resolvedPath).mtimeMs); }
        catch { dmt.set(collection, Date.now()); }
        dirImagesCache.set(activeResourcesDir, dirImages);
        const dirColl = dirCollectionsCache.get(activeResourcesDir);
        // harvest 进行时每个账号目录的 mtime 一直在变，此路径是最高频的重建入口；
        // 整包写盘去抖合并，否则 4 窗口播放时会把事件循环堵死
        if (dirColl) schedulePersistentSave(activeResourcesDir);

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
        // 帖子级虚拟图集：文件实际存放在 instagram-scraped/账号/ 下
        const comp = splitCompositeCollection(collection);
        let baseDir = activeResourcesDir;
        if (comp) {
          const igRoot = path.resolve(INSTAGRAM_SCRAPE_DIR);
          const accountDir = path.resolve(path.join(igRoot, comp[0]));
          if (!isPathWithin(accountDir, igRoot) || accountDir === igRoot) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access Denied' }));
            return;
          }
          baseDir = accountDir;
        }
        const requestedPath = path.join(baseDir, comp ? '' : collection, name);
        const resolvedPath = path.resolve(requestedPath);
        const resolvedBase = path.resolve(baseDir);
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
        // 帖子级虚拟图集：归属信息按 :: 前缀的账号取
        const comp = splitCompositeCollection(collection);
        const accountName = comp ? comp[0] : collection;
        const infoPath = path.join(os.homedir(), 'Pictures', 'instagram-scraped', accountName, '.collection-info.json');
        if (fs.existsSync(infoPath)) {
          const infoData = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ username: infoData.username || accountName, full_name: infoData.full_name || null }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ username: accountName, full_name: null }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── GET /api/collection/posts?collection=xxx ─────────────────────────
    // IG 账号的帖子结构 manifest：按发帖时间倒序，media 为帖内入库文件名
    // （carousel 顺序）。无 manifest（普通图集）返回空数组，前端维持原排序。
    if (url.pathname === '/api/collection/posts') {
      const collection = url.searchParams.get('collection');
      if (!collection) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: collection is required.' }));
        return;
      }
      try {
        const comp = splitCompositeCollection(collection);
        const accountName = comp ? comp[0] : collection;
        const resolvedPath = path.resolve(path.join(INSTAGRAM_SCRAPE_DIR, accountName));
        const resolvedBase = path.resolve(INSTAGRAM_SCRAPE_DIR);
        if (!isPathWithin(resolvedPath, resolvedBase) || resolvedPath === resolvedBase) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied' }));
          return;
        }
        const manifestPath = path.join(resolvedPath, '.posts.json');
        let manifest = { version: 1, updatedAt: 0, posts: {} };
        try {
          if (fs.existsSync(manifestPath)) {
            const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
          }
        } catch {}
        // 未归属集合没有帖子结构；帖子图集返回整账号帖子列表（编号按账号计）。
        // dl 为帖内文件的最新落盘时间（毫秒），供前端做"最近几日下载"过滤。
        const posts = (comp && comp[1] === '__unsorted')
          ? []
          : sortedPostsOf(manifest).map(p => {
              let dl = 0;
              for (const f of p.media) {
                if (typeof f !== 'string' || f.includes('/') || f.includes('\\')) continue;
                try {
                  const st = fs.statSync(path.join(resolvedPath, f));
                  if (st.mtimeMs > dl) dl = st.mtimeMs;
                } catch {}
              }
              return { ...p, dl: dl || null };
            });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ collection, posts }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // ── POST /api/collection/delete（帖子级虚拟图集 user::postId）────────
    // 复合名走独立路由：单文件删除 / 整帖删除（按 manifest.media 落盘）。
    // 账号目录文件列表的一致性由图片列表缓存的目录 mtime 自校验兜底，
    // 因此这里不触碰目录缓存子系统；账号目录被删空时整体移除。
    if (url.pathname === '/api/collection/delete'
        && splitCompositeCollection(url.searchParams.get('collection') || '')) {
      const collection = url.searchParams.get('collection');
      const filename = url.searchParams.get('name') || url.searchParams.get('file');
      const postId = url.searchParams.get('post');
      try {
        const [username] = splitCompositeCollection(collection);
        const igRoot = path.resolve(INSTAGRAM_SCRAPE_DIR);
        const accountDir = path.resolve(path.join(igRoot, username));
        if (!isPathWithin(accountDir, igRoot) || accountDir === igRoot) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Access Denied' }));
          return;
        }
        const manifestPath = path.join(accountDir, '.posts.json');
        // 与其他路由一致：manifest 的读改写内联完成，不经过任何闭包辅助
        const exts = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.mp4', '.webm']);

        if (filename) {
          const resolvedFile = path.resolve(path.join(accountDir, filename));
          if (!isPathWithin(resolvedFile, accountDir)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Access Denied: File is outside the collection folder.' }));
            return;
          }
          if (fs.existsSync(resolvedFile)) fs.unlinkSync(resolvedFile);
          let manifest = { version: 1, updatedAt: 0, posts: {} };
          try {
            if (fs.existsSync(manifestPath)) {
              const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
            }
          } catch {}
          if (removePostFiles(manifest, [filename])) {
            try {
              manifest.updatedAt = Date.now();
              const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
              fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
              fs.renameSync(mTmp, manifestPath);
            } catch {}
          }
          let remaining = [];
          try {
            remaining = fs.readdirSync(accountDir).filter(
              f => !f.startsWith('.') && exts.has(path.extname(f).toLowerCase())
            );
          } catch {}
          let folderDeleted = false;
          if (!remaining.length) {
            if (fs.existsSync(accountDir)) fs.rmSync(accountDir, { recursive: true, force: true });
            folderDeleted = true;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, folderDeleted, remainingCount: remaining.length, deletedFile: filename }));
          return;
        }

        if (postId) {
          let manifest = { version: 1, updatedAt: 0, posts: {} };
          try {
            if (fs.existsSync(manifestPath)) {
              const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
            }
          } catch {}
          const post = manifest.posts[postId];
          if (!post || !Array.isArray(post.media) || post.media.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '未找到该帖子的入库记录' }));
            return;
          }
          let deletedCount = 0;
          for (const f of post.media) {
            if (typeof f !== 'string' || f.startsWith('.') || f.includes('/') || f.includes('\\')) continue;
            const fp = path.resolve(path.join(accountDir, f));
            if (!isPathWithin(fp, accountDir)) continue;
            try { fs.unlinkSync(fp); deletedCount++; } catch {}
          }
          delete manifest.posts[postId];
          try {
            manifest.updatedAt = Date.now();
            const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
            fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
            fs.renameSync(mTmp, manifestPath);
          } catch {}
          let remaining = [];
          try {
            remaining = fs.readdirSync(accountDir).filter(
              f => !f.startsWith('.') && exts.has(path.extname(f).toLowerCase())
            );
          } catch {}
          let folderDeleted = false;
          if (!remaining.length) {
            if (fs.existsSync(accountDir)) fs.rmSync(accountDir, { recursive: true, force: true });
            folderDeleted = true;
          }
          console.log(`[Delete] 帖子删除 @${username}/${postId}: 文件 ${deletedCount}/${post.media.length}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, folderDeleted, remainingCount: remaining.length, deletedPost: postId, deletedCount }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing parameter: name or post is required.' }));
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
          // 若删除的是 IG 账号里的文件，同步清出帖子 manifest，保持索引与磁盘一致。
          // manifest 与被删文件同目录（该目录已过 isPathWithin 校验）。
          try {
            if (path.resolve(path.join(INSTAGRAM_SCRAPE_DIR, collection)) === resolvedPath) {
              const manifestPath = path.join(resolvedPath, '.posts.json');
              if (fs.existsSync(manifestPath)) {
                let manifest = { version: 1, updatedAt: 0, posts: {} };
                try {
                  const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
                } catch {}
                if (removePostFiles(manifest, [filename])) {
                  try {
                    manifest.updatedAt = Date.now();
                    const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
                    fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
                    fs.renameSync(mTmp, manifestPath);
                  } catch {}
                }
              }
            }
          } catch {}

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
        dirImagesMtimeCache.delete(activeResourcesDir);
            dirImagesMtimeCache.delete(activeResourcesDir);
          dirImagesMtimeCache.delete(activeResourcesDir);
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
        } else if (url.searchParams.get('post')) {
          // 删除整个帖子：按 manifest 里该帖的 media 清单删文件，再清掉帖子条目。
          // 仅对 IG 账号目录有意义（manifest 在账号目录下）；删完目录空则连目录一起删。
          const postId = url.searchParams.get('post');
          const manifestPath = path.join(resolvedPath, '.posts.json');
          let manifest = { version: 1, updatedAt: 0, posts: {} };
          try {
            if (fs.existsSync(manifestPath)) {
              const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
              if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
            }
          } catch {}
          const post = manifest.posts[postId];
          if (!post || !Array.isArray(post.media) || post.media.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '未找到该帖子的入库记录' }));
            return;
          }
          let deletedCount = 0;
          for (const f of post.media) {
            if (typeof f !== 'string' || f.startsWith('.') || f.includes('/') || f.includes('\\')) continue;
            const fp = path.resolve(path.join(resolvedPath, f));
            if (!isPathWithin(fp, resolvedPath)) continue;
            try { fs.unlinkSync(fp); deletedCount++; } catch {}
          }
          delete manifest.posts[postId];
          try {
            manifest.updatedAt = Date.now();
            const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
            fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
            fs.renameSync(mTmp, manifestPath);
          } catch {}

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
        dirImagesMtimeCache.delete(activeResourcesDir);
            dirImagesMtimeCache.delete(activeResourcesDir);
          dirImagesMtimeCache.delete(activeResourcesDir);
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

          console.log(`[Delete] 帖子删除 @${collection}/${postId}: 文件 ${deletedCount}/${post.media.length}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            folderDeleted,
            remainingCount: remainingFiles.length,
            deletedPost: postId,
            deletedCount
          }));
        } else {
          if (fs.existsSync(resolvedPath)) {
            fs.rmSync(resolvedPath, { recursive: true, force: true });
          }

          dirCollectionsCache.delete(activeResourcesDir);
          dirMtimeCache.delete(activeResourcesDir);
          dirImagesCache.delete(activeResourcesDir);
        dirImagesMtimeCache.delete(activeResourcesDir);
          dirImagesMtimeCache.delete(activeResourcesDir);
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
          const failedUrls = [];
          const recordedMedia = []; // [{ post, filename }] → 归并进 .posts.json

          for (const item of items) {
            try {
              const candidates = [...(Array.isArray(item.alt) ? item.alt : []), item.url]
                .filter(u => typeof u === 'string' && isHarvestHostAllowed(u));
              if (!candidates.length) { failed++; failedUrls.push(item.url); continue; }

              // 头像专用 CDN 路径段：拒收入库（旧版脚本仍会回传）
              if (/\/t51\.2885-19\//.test(item.url)) { skipped++; continue; }
              const base = harvestFilename(item.url, item.type);
              if (!base) { failed++; failedUrls.push(item.url); continue; }
              const finalPath0 = path.join(targetDir, base);
              if (fs.existsSync(finalPath0)) {
                skipped++;
                recordedMedia.push({ post: item.post, filename: base });
                continue;
              }

              // 临时文件由 harvestDownload 内部按请求加唯一后缀：脚本重试等场景下
              // 可能出现同一条媒体的并发下载，共享同名 .part 会互相截断；
              // 失败时函数自行清理，成功返回实际落盘的临时路径
              let tmpPath = null;
              for (const candidate of candidates) {
                try { tmpPath = await harvestDownload(candidate, targetDir, base); } catch { tmpPath = null; }
                if (tmpPath) break;
              }
              if (!tmpPath) {
                console.warn(`[Harvest] 下载失败 @${username}: ${base} ← ${candidates[0]}`);
                failed++;
                failedUrls.push(item.url);
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
                recordedMedia.push({ post: item.post, filename: path.basename(finalPath) });
                continue;
              }
              fs.renameSync(tmpPath, finalPath);
              downloaded++;
              recordedMedia.push({ post: item.post, filename: path.basename(finalPath) });
              if (item.type === 'video') {
                videoPrefixSet.add(mediaIdPrefix(item.url));
                videoPrefixSet.add(mediaIdPrefix(item.poster));
              }
            } catch { failed++; if (typeof item.url === 'string') failedUrls.push(item.url); }
          }
          // 视频入库后删除其封面图，避免"封面 + 视频"重复展示
          removeVideoPosters(targetDir, videoPrefixSet);
          // 帖子结构归并：文件名 → 所属帖子（shortcode/时间/caption）。
          // manifest 就在已校验的 targetDir 下，读改写内联完成。
          if (recordedMedia.length) {
            const manifestPath = path.join(targetDir, '.posts.json');
            let manifest = { version: 1, updatedAt: 0, posts: {} };
            try {
              if (fs.existsSync(manifestPath)) {
                const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
              }
            } catch {}
            if (mergePostEntries(manifest, recordedMedia)) {
              try {
                manifest.updatedAt = Date.now();
                const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
                fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
                fs.renameSync(mTmp, manifestPath);
                console.log(`[Posts] @${username}: manifest 共 ${Object.keys(manifest.posts).length} 个帖子`);
              } catch (err) {
                console.warn(`[Posts] 保存 .posts.json 失败 @${username}: ${err.message}`);
              }
            }
          }

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
          res.end(JSON.stringify({ success: true, username, downloaded, skipped, failed, failedUrls, total: items.length }));
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
          // 帖子归属写进 manifest（与 harvest 路由同一套内联读改写）
          const recordBlobPost = () => {
            const manifestPath = path.join(targetDir, '.posts.json');
            let manifest = { version: 1, updatedAt: 0, posts: {} };
            try {
              if (fs.existsSync(manifestPath)) {
                const d = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (d && d.posts && typeof d.posts === 'object' && !Array.isArray(d.posts)) manifest = d;
              }
            } catch {}
            if (mergePostEntries(manifest, [{ post: data.post, filename: path.basename(finalPath) }])) {
              try {
                manifest.updatedAt = Date.now();
                const mTmp = `${manifestPath}.${process.pid}x${Math.random().toString(36).slice(2, 8)}.tmp`;
                fs.writeFileSync(mTmp, JSON.stringify(manifest, null, 2), 'utf8');
                fs.renameSync(mTmp, manifestPath);
              } catch {}
            }
          };
          if (fs.existsSync(finalPath)) {
            console.log(`[Harvest-Blob] @${username}: 内容已存在，跳过 (${hash})`);
            removeVideoPosters(targetDir, [mediaIdPrefix(data.posterUrl), mediaIdPrefix(data.srcUrl)]);
            recordBlobPost();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, username, downloaded: 0, skipped: 1 }));
            return;
          }
          const tmpPath = path.join(targetDir, `.${hash}.part`);
          fs.writeFileSync(tmpPath, buf);
          fs.renameSync(tmpPath, finalPath);
          removeVideoPosters(targetDir, [mediaIdPrefix(data.posterUrl), mediaIdPrefix(data.srcUrl)]);
          recordBlobPost();
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
        dirImagesMtimeCache.delete(activeResourcesDir);
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
export { clearPersistentCache, dirCollectionsCache, dirMtimeCache, dirImagesCache, dirImagesMtimeCache };
