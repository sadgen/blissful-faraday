// ==UserScript==
// @name         Blissful Faraday — Instagram 浏览同步
// @namespace    blissful-faraday
// @version      0.7.0
// @description  正常浏览 Instagram 时，把看过的图片/视频自动同步到本地 blissful-faraday 画廊。只收集页面上已加载的媒体地址，不产生额外对 IG 的请求。
// @match        https://www.instagram.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      localhost
// @connect      127.0.0.1
// @connect      gallery.example.com
// ==/UserScript==

(function () {
  'use strict';

  // ─── 配置 ────────────────────────────────────────────────────────────────
  // 同步目标是画廊服务器，与浏览用的电脑无关：在任何设备上刷到的图，
  // 都会汇入同一台服务器。跨机器使用时把地址填成服务器的局域网地址。
  const DEFAULT_GALLERY = 'http://localhost:3000';
  const GALLERY = () => (GM_getValue('galleryUrl', DEFAULT_GALLERY) || '').replace(/\/+$/, '');
  const ADDRESS_PROMPT = 'blissful-faraday 画廊地址（填好后需在该浏览器登录一次画廊）\n'
    + '· 推荐：https://gallery.example.com:8443 （地址固定，任何网络可用）\n'
    + '· 服务器本机浏览：http://localhost:3000\n'
    + '· 仅局域网：http://192.168.1.100:3000';
  GM_registerMenuCommand('设置画廊地址', () => {
    const v = prompt(ADDRESS_PROMPT, GM_getValue('galleryUrl', DEFAULT_GALLERY));
    if (v && v.trim()) GM_setValue('galleryUrl', v.trim().replace(/\/+$/, ''));
  });
  // 首次运行引导：新机器安装后主动询问目标地址，避免默默发往 localhost
  if (!GM_getValue('galleryUrl', '')) {
    const v = prompt(ADDRESS_PROMPT, DEFAULT_GALLERY);
    if (v && v.trim()) GM_setValue('galleryUrl', v.trim().replace(/\/+$/, ''));
  }
  GM_registerMenuCommand('清空当前图集的同步历史', () => {
    const username = profileFromPath();
    if (username) { GM_setValue(sentKey(username), '[]'); flashBadge(`已清空 @${username} 的同步历史`); }
    else flashBadge('请先进入某个图集主页');
  });

  // ─── 媒体地址识别 ────────────────────────────────────────────────────────
  const RESERVED = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct',
    'tv', 'about', 'developer', 'legal', 'privacy', 'language', 'checkout', 'your_activity', 'archive']);
  const IG_CDN = /cdninstagram\.com$|fbcdn\.net$/i;

  // 仅在个人主页（含 /{user}/p/... 帖子浮层）时返回用户名，其余页面（首页/探索/故事）不采集
  function profileFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const name = parts[0];
    if (RESERVED.has(name.toLowerCase())) return null;
    if (parts[1] && !['p', 'reel', 'reels'].includes(parts[1])) return null;
    return /^[A-Za-z0-9._]{1,30}$/.test(name) ? name : null;
  }

  // 媒体的稳定标识：CDN 路径里的文件名（含媒体 ID）。
  // 签名参数和尺寸变体（/p640x640/、stp=...）每次会话都变，不能用 URL 整体去重。
  function fileKey(urlString) {
    try { return decodeURIComponent(new URL(urlString).pathname.split('/').pop()); }
    catch { return null; }
  }

  function bestFromSrcset(img) {
    if (!img.srcset) return img.src || null;
    let best = null, bestW = -1;
    for (const part of img.srcset.split(',')) {
      const seg = part.trim().split(/\s+/);
      if (!seg[0]) continue;
      const d = seg[1] || '';
      const w = d.endsWith('w') ? parseInt(d, 10) : (d.endsWith('x') ? parseFloat(d) * 1000 : 0);
      if (w > bestW) { bestW = w; best = seg[0]; }
    }
    return best || img.src;
  }

  // IG 网格/时间线常给缩小版 URL。按已知规律还原全尺寸候选：
  // 1) 删除路径中的 /pNNNxNNN/、/sNNNxNNN/ 段；2) 删除 stp 参数中的尺寸后缀；3) 删除整个 stp 参数。
  // 签名不覆盖尺寸段，多数情况可还原；失败时服务端会回退到原始 URL。
  function fullResCandidates(urlString) {
    const cands = [];
    try {
      const url = new URL(urlString);
      const seg = url.pathname.match(/\/[ps]\d+x\d+\//);
      if (seg) cands.push(new URL(urlString.replace(seg[0], '/')).href);
      const stp = url.searchParams.get('stp');
      if (stp) {
        if (/_[ps]\d+x\d+/i.test(stp)) {
          const u2 = new URL(urlString);
          u2.searchParams.set('stp', stp.replace(/_[ps]\d+x\d+/gi, ''));
          cands.push(u2.href);
        }
        const u3 = new URL(urlString);
        u3.searchParams.delete('stp');
        cands.push(u3.href);
      }
    } catch {}
    return cands;
  }

  // ─── 采集状态 ────────────────────────────────────────────────────────────
  const seenThisSession = new Set();       // fileKey -> 防止重复处理同一媒体
  const pendingByUser = new Map();         // username -> Map(fileKey -> item)
  const failedCount = new Map();           // fileKey -> 连续失败次数（3 次后放弃）
  const blobQueue = [];                    // 流式视频待中继队列 {username, videoEl}
  const SENT_CAP = 3000;
  const BATCH_MAX = 40;

  const sentKey = u => 'bf_sent_' + u;
  function loadSent(username) {
    try { return new Set(JSON.parse(GM_getValue(sentKey(username), '[]'))); }
    catch { return new Set(); }
  }
  function saveSent(username, set) {
    const arr = [...set];
    if (arr.length > SENT_CAP) arr.splice(0, arr.length - SENT_CAP);
    GM_setValue(sentKey(username), JSON.stringify(arr));
  }

  // ─── 页面扫描 ────────────────────────────────────────────────────────────
  // 从容器内第一个站内链接归属用户名（帖子卡片/浮层头部的作者链接）
  function usernameFromContainer(container) {
    const a = container.querySelector('a[href^="/"]');
    if (!a) return null;
    const parts = (a.getAttribute('href') || '').split('?')[0].split('#')[0].split('/').filter(Boolean);
    const name = parts[0];
    if (!name || RESERVED.has(name.toLowerCase())) return null;
    return /^[A-Za-z0-9._]{1,30}$/.test(name) ? name : null;
  }

  function harvestImg(img, pending) {
    if (img.closest('header')) return 0; // 头像排除
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 80) return 0; // 小图标排除
    const src = bestFromSrcset(img);
    if (!src || !/^https:/.test(src)) return 0;
    try { if (!IG_CDN.test(new URL(src).hostname)) return 0; } catch { return 0; }
    const key = fileKey(src);
    if (!key || seenThisSession.has(key) || pending.has(key)) return 0;
    seenThisSession.add(key);
    pending.set(key, { key, url: src, alt: fullResCandidates(src), type: 'image' });
    return 1;
  }

  function harvestVideo(v, pending, username) {
    const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src);
    if (!src) return 0;
    // 流式播放源（blob:）拿不到 mp4 直链，转浏览器中继队列；按内容哈希在服务端去重
    if (src.startsWith('blob:')) {
      if (v.dataset.bfHarvested) return 0;
      v.dataset.bfHarvested = '1';
      blobQueue.push({ username, videoEl: v });
      return 0;
    }
    if (!/^https:/.test(src)) return 0;
    try { if (!IG_CDN.test(new URL(src).hostname)) return 0; } catch { return 0; }
    const key = fileKey(src);
    if (!key || seenThisSession.has(key) || pending.has(key)) return 0;
    seenThisSession.add(key);
    pending.set(key, { key, url: src, alt: [], type: 'video' });
    return 1;
  }

  function scan() {
    let added = 0;

    // 1) 个人主页：整页媒体都归属当前用户
    const username = profileFromPath();
    if (username) {
      if (!pendingByUser.has(username)) pendingByUser.set(username, new Map());
      const pending = pendingByUser.get(username);
      document.querySelectorAll('img[srcset], img[src]').forEach(img => { added += harvestImg(img, pending); });
      document.querySelectorAll('video').forEach(v => { added += harvestVideo(v, pending, username); });
    }

    // 2) 时间线等任何页面的帖子卡片：按卡片头部作者链接归属
    document.querySelectorAll('article').forEach(article => {
      const owner = usernameFromContainer(article);
      if (!owner) return;
      if (!pendingByUser.has(owner)) pendingByUser.set(owner, new Map());
      const pending = pendingByUser.get(owner);
      article.querySelectorAll('img[srcset], img[src]').forEach(img => { added += harvestImg(img, pending); });
      article.querySelectorAll('video').forEach(v => { added += harvestVideo(v, pending, owner); });
    });

    // 3) 从时间线点开的帖子浮层（URL 无用户名）：按浮层头部作者链接归属。
    //    卡片先于浮层处理，浮层内嵌的推荐帖子已被卡片归属，不会错记到浮层作者名下。
    document.querySelectorAll('div[role="dialog"]').forEach(dialog => {
      const owner = usernameFromContainer(dialog);
      if (!owner) return;
      if (!pendingByUser.has(owner)) pendingByUser.set(owner, new Map());
      const pending = pendingByUser.get(owner);
      dialog.querySelectorAll('img[srcset], img[src]').forEach(img => { added += harvestImg(img, pending); });
      dialog.querySelectorAll('video').forEach(v => { added += harvestVideo(v, pending, owner); });
    });

    const totalPending = [...pendingByUser.values()].reduce((n, m) => n + m.size, 0);
    updateBadge(username, totalPending, added);
  }

  // ─── 上传 ────────────────────────────────────────────────────────────────
  function flush() {
    for (const [username, pending] of pendingByUser) {
      if (!pending.size) continue;
      const sent = loadSent(username);
      const items = [];
      for (const [key, item] of pending) {
        if (!sent.has(key) && (failedCount.get(key) || 0) < 3) items.push(item);
        if (items.length >= BATCH_MAX) break;
      }
      if (!items.length) continue;

      GM_xmlhttpRequest({
        method: 'POST',
        url: GALLERY() + '/api/instagram/harvest',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ username, items }),
        timeout: 30000,
        onload: res => {
          let data = {};
          try { data = JSON.parse(res.responseText); } catch {}
          if (res.status === 200 && data.success) {
            items.forEach(it => {
              pending.delete(it.key);
              sent.add(it.key);
              failedCount.delete(it.key);
            });
            saveSent(username, sent);
            flashBadge(`@${username} 新存 ${data.downloaded} · 已有 ${data.skipped}` +
              (data.failed ? ` · 失败 ${data.failed}` : ''));
          } else if (res.status === 401) {
            items.forEach(it => failedCount.set(it.key, 3)); // 未登录：本会话不再重试
            flashBadge('请先在浏览器登录画廊，再刷新 Instagram');
          } else {
            items.forEach(it => failedCount.set(it.key, (failedCount.get(it.key) || 0) + 1));
            flashBadge(`画廊返回 ${res.status}：${data.error || '未知错误'}`);
          }
          updateBadge(username, [...pendingByUser.values()].reduce((n, m) => n + m.size, 0));
        },
        onerror: () => {
          items.forEach(it => failedCount.set(it.key, (failedCount.get(it.key) || 0) + 1));
          flashBadge('画廊未连接（' + GALLERY() + '）');
        },
        ontimeout: () => {
          items.forEach(it => failedCount.set(it.key, (failedCount.get(it.key) || 0) + 1));
          flashBadge('画廊响应超时');
        },
      });
    }
  }

  // ─── 流式视频中继 / 实时录制 ─────────────────────────────────────────────
  // blob: 播放源先尝试浏览器直读（部分视频是整段 Blob，可命中缓存零请求）；
  // 若是 MSE 分段流（不可读），退级为 MediaRecorder 实时录制——播多久录多久，
  // 播完（或切走 30 秒后）自动入库为 webm，画质等同播放画面。
  let blobBusy = false;

  function uploadVideoBlob(username, blob, onDone, opts) {
    const o = opts || {};
    const reader = new FileReader();
    reader.onerror = () => onDone('🎬 视频读取失败');
    reader.onload = () => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: GALLERY() + '/api/instagram/harvest-blob',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ username, data: reader.result, debug: o.debug || undefined }),
        timeout: 180000,
        onload: res => {
          let d = {}; try { d = JSON.parse(res.responseText); } catch {}
          if (res.status === 200 && d.success) {
            if (d.downloaded) onDone(`${o.okPrefix || '🎬 视频已存'} @${username}（${d.sizeMB} MB）`);
            else onDone('🎬 视频内容已存在，跳过');
          } else if (res.status === 401) onDone('请先登录画廊，视频才能入库');
          else onDone(`🎬 视频入库失败 ${res.status}：${d.error || '未知错误'}`);
        },
        onerror: () => onDone('画廊未连接，视频未入库'),
        ontimeout: () => onDone('🎬 视频传输超时'),
      });
    };
    reader.readAsDataURL(blob);
  }

  // ─── 视频分片旁听（零请求拼装完整文件的前提）──────────────────────────
  // 播放器自己发的视频分片请求，旁听其响应并按 URL 分组记录字节区间。
  // 不产生任何新请求；若分片覆盖全文件即可零请求拼装出完整 mp4。
  const segGroups = new Map(); // origin+pathname → {url, chunks, total, lastSeen, ct}
  const VIDEO_HOST = /cdninstagram\.com|fbcdn\.net/i;

  function noteSegResponse(urlStr, status, getHeader, body) {
    try {
      const u = new URL(urlStr, location.href);
      if (!VIDEO_HOST.test(u.hostname) || (status !== 200 && status !== 206)) return;
      const ct = getHeader('content-type') || '';
      if (!ct.startsWith('video/') && !ct.includes('octet-stream')) return;
      const key = u.origin + u.pathname;
      let g = segGroups.get(key);
      if (!g) {
        if (segGroups.size > 40) { // 防长会话无限增长
          let oldest = null;
          for (const [k, v] of segGroups) if (!oldest || v.lastSeen < oldest[1].lastSeen) oldest = [k, v];
          if (oldest) segGroups.delete(oldest[0]);
        }
        g = { url: u.origin + u.pathname + u.search, chunks: new Map(), total: 0, lastSeen: 0, ct };
        segGroups.set(key, g);
      }
      g.lastSeen = Date.now();
      if (!body || !body.byteLength) return;
      const cr = getHeader('content-range');
      let start = 0, end = body.byteLength - 1, total = body.byteLength;
      const m = cr && cr.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/);
      if (m) { start = +m[1]; end = +m[2]; total = m[3] === '*' ? 0 : +m[3]; }
      else { const cl = getHeader('content-length'); if (cl) total = +cl; }
      if (total > g.total) g.total = total;
      g.chunks.set(start, { end, data: body });
    } catch {}
  }

  function hookNetwork() {
    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    try {
      if (uw.fetch && !uw.__bfFetchHooked) {
        uw.__bfFetchHooked = true;
        const origFetch = uw.fetch;
        uw.fetch = function (...args) {
          const result = origFetch.apply(this, args);
          try {
            const raw = args[0];
            const u = typeof raw === 'string' ? raw : (raw && raw.url) || '';
            if (VIDEO_HOST.test(u)) {
              result.then(res => {
                try {
                  const ct = res.headers.get('content-type') || '';
                  if (!ct.startsWith('video/') && !ct.includes('octet-stream')) return;
                  res.clone().arrayBuffer().then(buf =>
                    noteSegResponse(res.url || u, res.status, n => res.headers.get(n), buf)
                  ).catch(() => {});
                } catch {}
              }).catch(() => {});
            }
          } catch {}
          return result;
        };
      }
    } catch {}
    try {
      const xp = uw.XMLHttpRequest && uw.XMLHttpRequest.prototype;
      if (xp && !xp.__bfXhrHooked) {
        xp.__bfXhrHooked = true;
        const origOpen = xp.open, origSend = xp.send;
        xp.open = function (method, url) { this.__bfUrl = url; return origOpen.apply(this, arguments); };
        xp.send = function () {
          const xhr = this;
          xhr.addEventListener('load', () => {
            try {
              const u = xhr.__bfUrl || '';
              if (VIDEO_HOST.test(u) && xhr.responseType === 'arraybuffer') {
                const ct = xhr.getResponseHeader('content-type') || '';
                if (ct.startsWith('video/') || ct.includes('octet-stream')) {
                  noteSegResponse(new URL(u, location.href).href, xhr.status, n => xhr.getResponseHeader(n), xhr.response);
                }
              }
            } catch {}
          });
          return origSend.apply(this, arguments);
        };
      }
    } catch {}
  }

  function assembleSegGroup(g) {
    try {
      if (!g.total || !g.chunks.size) return null;
      const starts = [...g.chunks.keys()].sort((a, b) => a - b);
      let cursor = 0;
      const parts = [];
      for (const s of starts) {
        const c = g.chunks.get(s);
        if (s > cursor) return null; // 有空洞，未缓冲全
        if (c.end + 1 > cursor) {
          parts.push(c.data.slice(cursor - s));
          cursor = c.end + 1;
        }
      }
      if (cursor < g.total) return null; // 未覆盖全文件
      const out = new Uint8Array(cursor);
      let off = 0;
      for (const p of parts) { out.set(new Uint8Array(p), off); off += p.byteLength; }
      return out;
    } catch { return null; }
  }

  function bestSegGroup() {
    const now = Date.now();
    let best = null;
    for (const g of segGroups.values()) {
      if (now - g.lastSeen > 120000) continue; // 只看最近 2 分钟的分片
      if (!best || g.lastSeen > best.lastSeen) best = g;
    }
    return best;
  }

  function tapStats() {
    const now = Date.now();
    let groups = 0, bytes = 0;
    for (const g of segGroups.values()) {
      if (now - g.lastSeen > 120000) continue;
      groups++;
      for (const c of g.chunks.values()) bytes += c.data.byteLength;
    }
    return { groups, bytes };
  }

  // MSE 分片拼装优先；拼不全则用记录到的 URL 做一次缓存优先的完整 GET；
  // 仍失败才退级实时录制（onFail）。
  function trySegFullCapture(username, onFail) {
    const debug = tapStats();
    const g = bestSegGroup();
    if (!g) { onFail(); return; }
    const assembled = assembleSegGroup(g);
    if (assembled && assembled.byteLength > 65536) {
      uploadVideoBlob(username, new Blob([assembled], { type: g.ct || 'video/mp4' }),
        msg => flashBadge(msg), { okPrefix: '🎬 分片拼装完整视频已存', debug });
      return;
    }
    const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
      ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
    pageFetch(g.url).then(r => r.blob()).then(b => {
      if (b && b.size > 65536) uploadVideoBlob(username, b, msg => flashBadge(msg),
        { okPrefix: '🎬 完整视频已存（缓存补全）', debug });
      else onFail();
    }).catch(onFail);
  }

  // ─── 实际链接捕获（PerformanceObserver）────────────────────────────────
  // 播放器获取视频的每一个网络请求都会进 Performance 资源时间线（支持缓冲
  // 回放），从这里拿"实际链接"，再做一次完整 GET 下载原档。
  // VIDEO_HOST 复用分片旁听区块中的声明。
  const actualLinks = new Map(); // url → {size, lastSeen}

  function isVideoEntryUrl(urlStr) {
    try {
      const u = new URL(urlStr, location.href);
      if (!VIDEO_HOST.test(u.hostname)) return false;
      return /\.(mp4|webm|m4s)(\?|$)/i.test(u.pathname) || /\/o1\//i.test(u.pathname) ||
             /t50\.2886/i.test(u.pathname) || /^video\./i.test(u.hostname);
    } catch { return false; }
  }

  function noteActualLink(urlStr, size) {
    if (!isVideoEntryUrl(urlStr)) return;
    const prev = actualLinks.get(urlStr);
    actualLinks.set(urlStr, { size: Math.max(prev ? prev.size : 0, size || 0), lastSeen: Date.now() });
    if (actualLinks.size > 60) {
      let oldest = null;
      for (const [k, v] of actualLinks) if (!oldest || v.lastSeen < oldest[1].lastSeen) oldest = [k, v];
      if (oldest) actualLinks.delete(oldest[0]);
    }
  }

  function initPerfObserver() {
    try {
      const po = new PerformanceObserver(list => {
        for (const e of list.getEntries()) noteActualLink(e.name, e.decodedBodySize || e.transferSize || 0);
      });
      po.observe({ type: 'resource', buffered: true });
    } catch {}
  }

  function actualLinkCandidates() {
    const now = Date.now();
    const cands = [];
    for (const [url, v] of actualLinks) {
      if (now - v.lastSeen > 180000) continue; // 最近 3 分钟
      cands.push({ url, size: v.size, lastSeen: v.lastSeen });
    }
    cands.sort((a, b) => b.size - a.size || b.lastSeen - a.lastSeen);
    return cands;
  }

  // 按体积从大到小尝试最多 3 个实际链接，完整 GET 后校验视频魔数再入库
  function tryActualLinkCapture(username, onFail) {
    const cands = actualLinkCandidates();
    if (!cands.length) { onFail(); return; }
    const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
      ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
    let i = 0;
    const tryNext = () => {
      if (i >= cands.length || i >= 3) { onFail(); return; }
      const cand = cands[i++];
      pageFetch(cand.url).then(r => r.arrayBuffer()).then(buf => {
        const head = new Uint8Array(buf.slice(0, 12));
        const isMp4 = buf.byteLength > 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // ftyp
        const isWebm = head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3; // EBML
        if (!(isMp4 || isWebm) || buf.byteLength < 300 * 1024) { tryNext(); return; }
        uploadVideoBlob(username, new Blob([buf], { type: isMp4 ? 'video/mp4' : 'video/webm' }),
          msg => flashBadge(msg),
          { okPrefix: '🎬 实际链接完整下载已存', debug: { links: cands.length, tried: i, bytes: buf.byteLength } });
      }).catch(tryNext);
    };
    tryNext();
  }

  let activeRec = null; // 单录制槽：新录制抢占旧录制
  function startRecording(username, videoEl) {
    if (videoEl.dataset.bfRecording || videoEl.ended) return;
    videoEl.dataset.bfRecording = '1';
    try {
      const stream = videoEl.captureStream
        ? videoEl.captureStream()
        : (videoEl.mozCaptureStream ? videoEl.mozCaptureStream() : null);
      const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = (typeof MediaRecorder !== 'undefined' && stream)
        ? mimes.find(m => MediaRecorder.isTypeSupported(m)) : null;
      if (!stream || !mime) { flashBadge('🎬 当前浏览器不支持录制流式视频'); return; }
      if (activeRec) { try { activeRec.rec.stop(); } catch {} }

      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      const chunks = [];
      let stopped = false;
      let pauseTimer = null;
      const stopOnce = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(maxTimer);
        clearTimeout(pauseTimer);
        try { if (rec.state !== 'inactive') rec.stop(); } catch {}
      };
      const maxTimer = setTimeout(stopOnce, 5 * 60 * 1000); // 单条上限 5 分钟

      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        activeRec = null;
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (blob.size < 65536) { flashBadge('🎬 录制内容过短，未入库'); return; }
        flashBadge('🎬 录制完成，视频入库中...');
        uploadVideoBlob(username, blob, msg => flashBadge(msg), { okPrefix: '🎬 录制视频已存' });
      };
      videoEl.addEventListener('ended', stopOnce, { once: true });
      // 暂停（含缓冲）超过 30 秒视为看完，落库已录部分
      videoEl.addEventListener('pause', () => { pauseTimer = setTimeout(stopOnce, 30000); });
      videoEl.addEventListener('play', () => clearTimeout(pauseTimer));

      rec.start(2000);
      activeRec = { rec };
      flashBadge(`🎬 流式视频开始实时录制 @${username}（播完自动入库）`);
    } catch (err) {
      flashBadge('🎬 录制启动失败：' + err.message);
    }
  }

  function processBlobQueue() {
    if (blobBusy || !blobQueue.length) return;
    blobBusy = true;
    const { username, videoEl } = blobQueue.shift();
    const finish = (msg) => { flashBadge(msg); blobBusy = false; };
    const src = videoEl.currentSrc || videoEl.src;
    if (!username || !src || !src.startsWith('blob:')) { blobBusy = false; return; }
    const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
      ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
    pageFetch(src).then(r => r.blob()).then(blob => {
      if (!blob || blob.size < 65536) {
        blobBusy = false;
        trySegFullCapture(username, () => tryActualLinkCapture(username, () => startRecording(username, videoEl)));
        return;
      }
      if (blob.size > 150 * 1024 * 1024) { finish('🎬 视频超过 150MB，已跳过'); return; }
      uploadVideoBlob(username, blob, msg => finish(msg));
    }).catch(() => {
      blobBusy = false;
      trySegFullCapture(username, () => tryActualLinkCapture(username, () => startRecording(username, videoEl)));
    });
  }

  // ─── 状态徽章 ────────────────────────────────────────────────────────────
  const badge = document.createElement('div');
  badge.style.cssText = [
    'position:fixed', 'bottom:14px', 'left:14px', 'z-index:2147483647',
    'padding:6px 12px', 'border-radius:20px', 'background:rgba(20,20,28,.82)',
    'color:#e8e6f0', 'font-size:12px', 'font-family:system-ui,sans-serif',
    'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'cursor:default', 'user-select:none',
    'backdrop-filter:blur(6px)', 'transition:opacity .4s',
  ].join(';');
  document.documentElement.appendChild(badge);

  let flashTimer = null;
  function updateBadge(username, pendingCount, added) {
    if (flashTimer) return; // 闪现消息优先
    if (!username) {
      if (pendingCount > 0) {
        badge.textContent = `📥 时间线 · 待同步 ${pendingCount}`;
      } else {
        let host = GALLERY();
        try { host = new URL(GALLERY()).host; } catch {}
        badge.textContent = `📥 待机 → ${host}（刷时间线或进主页自动采集）`;
      }
      return;
    }
    badge.textContent = `📥 @${username}` +
      (pendingCount ? ` 待同步 ${pendingCount}` : ' 已全部同步') +
      (added ? ` (+${added})` : '');
  }
  function flashBadge(text) {
    badge.textContent = '📥 ' + text;
    badge.style.opacity = '1';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashTimer = null; }, 4000);
  }

  // ─── 定时器 ──────────────────────────────────────────────────────────────
  hookNetwork();       // 旁听播放器的视频分片请求（用于零请求拼装）
  initPerfObserver();  // 记录播放器的实际视频链接（用于完整 GET 下载）
  setInterval(scan, 1500);
  setInterval(() => { flush(); processBlobQueue(); }, 5000);
  scan();
})();
