// ==UserScript==
// @name         Blissful Faraday — Instagram 浏览同步
// @namespace    blissful-faraday
// @version      1.3.2
// @description  正常浏览 Instagram 时，把看过的图片/视频自动同步到本地 blissful-faraday 画廊。多图贴文秒级全量提取 + 个人主页旁听接口 JSON 全量采集多图 + 帖子结构（shortcode/时间/caption）随媒体回传 + 网页端多图横向并排免点击预览。
// @updateURL    https://gallery.example.com:8443/userscripts/blissful-harvest.user.js
// @downloadURL  https://gallery.example.com:8443/userscripts/blissful-harvest.user.js
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
  const DEFAULT_GALLERY = 'https://gallery.example.com:8443/';
  const GALLERY = () => (GM_getValue('galleryUrl', DEFAULT_GALLERY) || '').replace(/\/+$/, '');
  // 「实际链接完整下载」会对 IG CDN 发起每视频一次的完整 GET（用你自己的
  // 浏览器会话）。量级等同正常看视频，但追求零额外请求可关闭，
  // 关闭后流式视频退回实时录制（零请求，画质=播放画面）。
  const FULL_DL_ENABLED = () => GM_getValue('fullDlEnabled', true) !== false;
  GM_registerMenuCommand((GM_getValue('fullDlEnabled', true) !== false ? '✅' : '⛔') + ' 切换：视频完整下载（每视频 1 次请求）', () => {
    const next = GM_getValue('fullDlEnabled', true) === false;
    GM_setValue('fullDlEnabled', next);
    alert(next ? '已开启：流式视频会用实际链接完整下载（原档画质，每视频 1 次请求）' : '已关闭：流式视频退回实时录制（零额外请求，画质=播放画面）');
  });

  // 「多图卡片横向并排预览」：时间线遇到多图帖子时，在卡片中横向平铺展示最多 4 张图片，免去翻页点击
  const CAROUSEL_PREVIEW_ENABLED = () => GM_getValue('carouselPreviewEnabled', true) !== false;
  GM_registerMenuCommand((GM_getValue('carouselPreviewEnabled', true) !== false ? '✅' : '⛔') + ' 切换：多图横向并排预览（最多 4 张）', () => {
    const next = GM_getValue('carouselPreviewEnabled', true) === false;
    GM_setValue('carouselPreviewEnabled', next);
    alert(next ? '已开启：多图帖子将直接横向并排展示最多 4 张，无需手动点翻页' : '已关闭：恢复 Instagram 默认单图轮播');
    if (!next) {
      document.querySelectorAll('.bf-carousel-preview').forEach(el => el.remove());
    }
  });

  // 「接口 JSON 旁听」：个人主页网格只渲染每个帖子的封面，多图帖的其余图片只存在于
  // IG 自己的接口响应 JSON 里（web_profile_info / feed/user 分页等，含全部轮播子项）。
  // 旁听这些页面本来就会发出的响应并从中提取，不产生任何额外对 IG 的请求。
  const JSON_LISTEN_ENABLED = () => GM_getValue('jsonListenEnabled', true) !== false;
  GM_registerMenuCommand((GM_getValue('jsonListenEnabled', true) !== false ? '✅' : '⛔') + ' 切换：个人主页多图全量采集（旁听接口 JSON）', () => {
    const next = GM_getValue('jsonListenEnabled', true) === false;
    GM_setValue('jsonListenEnabled', next);
    alert(next
      ? '已开启：旁听 Instagram 自己的接口响应，主页多图帖的全部图片无需点开即全量入库（零额外请求）'
      : '已关闭：仅采集页面上实际渲染出来的媒体');
  });
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
    } catch { }
    return cands;
  }

  // ─── 采集状态 ────────────────────────────────────────────────────────────
  const seenThisSession = new Set();       // fileKey -> 防止重复处理同一媒体
  const pendingByUser = new Map();         // username -> Map(fileKey -> item)
  const failedCount = new Map();           // fileKey -> 连续失败次数（3 次后放弃）
  const sendingUsers = new Set();          // 正在回传中的用户：服务端串行下载耗时较长，
                                           // 在途期间不得重发同一批，否则并发重复下载
                                           // 会互相踩踏临时文件并触发 IG CDN 限流
  const blobQueue = [];                    // 流式视频待中继队列 {username, videoEl}
  const SENT_CAP = 3000;
  const BATCH_MAX = 40;

  // ─── 视频封面去重 ────────────────────────────────────────────────────────
  // 视频入库后其封面图（同媒体 ID 前缀的图片变体）不再采集；已落盘的封面由
  // 服务端在视频入库时删除，避免"封面 + 视频"在画廊里重复出现。
  const videoPrefixes = (() => {
    try { return new Set(JSON.parse(GM_getValue('bf_videoPrefixes', '[]'))); }
    catch { return new Set(); }
  })();
  function mediaIdPrefix(urlString) {
    let s = String(urlString || '');
    try { s = decodeURIComponent(new URL(s).pathname.split('/').pop() || s); } catch { }
    const m = s.match(/^(\d{8,})_/);
    return m ? m[1] : null;
  }
  function registerVideoPrefix(urlString) {
    const pfx = mediaIdPrefix(urlString);
    if (!pfx || videoPrefixes.has(pfx)) return;
    videoPrefixes.add(pfx);
    const arr = [...videoPrefixes];
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    GM_setValue('bf_videoPrefixes', JSON.stringify(arr));
  }
  // 视频元素上与画面重叠的图片即封面（poster 属性缺失时的兜底）
  function findPosterImg(videoEl) {
    try {
      const container = videoEl.closest('article') || videoEl.closest('div[role="dialog"]')
        || videoEl.closest('li') || videoEl.parentElement;
      if (!container) return null;
      const vr = videoEl.getBoundingClientRect();
      let best = null, bestRatio = 0;
      container.querySelectorAll('img').forEach(img => {
        const r = img.getBoundingClientRect();
        const ox = Math.min(vr.right, r.right) - Math.max(vr.left, r.left);
        const oy = Math.min(vr.bottom, r.bottom) - Math.max(vr.top, r.top);
        if (ox <= 0 || oy <= 0 || !r.width || !r.height) return;
        const ratio = (ox * oy) / (r.width * r.height);
        if (ratio > 0.5 && ratio > bestRatio) { bestRatio = ratio; best = img; }
      });
      return best;
    } catch { return null; }
  }
  function posterUrlOf(videoEl) {
    if (videoEl.poster) return videoEl.poster;
    const img = findPosterImg(videoEl);
    return img ? bestFromSrcset(img) : '';
  }

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

  // 判断某个 img 元素是否属于视频的封面图/占位图
  function isPosterImage(img) {
    try {
      // 1. 如果同容器内有 video 元素
      const container = img.closest('article') || img.closest('div[role="dialog"]')
        || img.closest('li') || img.parentElement;
      if (container && container.querySelector('video')) return true;

      // 2. 检查是否有视频相关的图标/SVG 或 Play 标识
      if (container && (container.querySelector('svg[aria-label*="视频"], svg[aria-label*="Video"], svg[aria-label*="Reel"], svg[aria-label*="Clip"]') || container.querySelector('[aria-label*="播放"], [aria-label*="Play"]'))) {
        return true;
      }

      // 3. 检查自身或父级是否有 video/poster 相关的 class 或 testid
      let cur = img;
      for (let i = 0; i < 4 && cur; i++) {
        const testId = cur.getAttribute('data-testid') || '';
        const ariaLabel = cur.getAttribute('aria-label') || '';
        if (/video|reel|play/i.test(testId) || /video|reel|play/i.test(ariaLabel)) return true;
        cur = cur.parentElement;
      }
    } catch {}
    return false;
  }

  function harvestImg(img, pending) {
    if (img.closest('header')) return 0; // 头像排除
    if (isPosterImage(img)) return 0;   // 视频封面/预览图直接拦截不下载！
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 80) return 0; // 小图标排除
    const src = bestFromSrcset(img);
    if (!src || !/^https:/.test(src)) return 0;
    try { if (!IG_CDN.test(new URL(src).hostname)) return 0; } catch { return 0; }
    // 头像专用 CDN 路径段（t51.2885-19），与普通帖子图（t51.2885-15）区分
    if (/\/t51\.2885-19\//.test(src)) return 0;
    const key = fileKey(src);
    if (!key || seenThisSession.has(key) || pending.has(key)) return 0;
    const vpfx = mediaIdPrefix(src);
    if (vpfx && videoPrefixes.has(vpfx)) return 0; // 已入库视频的封面图
    seenThisSession.add(key);
    pending.set(key, { key, url: src, alt: fullResCandidates(src), type: 'image', post: postFromContainer(img) || undefined });
    return 1;
  }

  // ─── React Fiber/Props 官方多图与高清直链探查 ────────────────────────────
  // Instagram 前端渲染帖子时，已将该帖完整元数据（包含 carousel_media 多图列表、
  // 各图最高清原图直链、video_versions 高清 mp4）缓存在 React 组件的 Fiber / Props 树中。
  // 一次探查即可全量秒级提取多图的所有图片和视频，无需等待 DOM 渲染或手动翻页。
  // 通用媒体收集器：在任意对象树（React Fiber / 接口 JSON）中查找
  // carousel_media / edge_sidecar_to_children / image_versions2 / video_versions
  // 及常见视频直链字段，全量收集图片与视频。visited 集合防止循环引用。
  function createMediaCollector(maxDepth = 14, opts = {}) {
    const images = [];
    const videos = [];
    const carouselItems = []; // [ { type: 'image'|'video', url, poster, thumbUrl } ]
    const visited = new Set();
    const seenUrls = new Set();
    // 帖子归属：url -> { id, ts, caption }。探查命中帖子节点（code/shortcode）时
    // 压栈，其子媒体全部归属栈顶帖子；画廊据此按 帖子时间倒序 + 帖内顺序 放映
    const postStack = [];
    const postByUrl = new Map();
    // JSON 旁听路径才收集单图节点的 display_url / thumbnail_src；
    // Fiber 路径不收集（时间线 DOM 里的视频封面没有 DOM 上下文可拦截）
    const includeDisplayUrl = !!opts.includeDisplayUrl;

    // 帖子级元数据：REST 为 code/taken_at/caption.text，GraphQL 为 shortcode/taken_at_timestamp/edge_media_to_caption
    function postMetaOf(obj) {
      if (!obj || typeof obj !== 'object') return null;
      const id = (typeof obj.code === 'string' && obj.code) || (typeof obj.shortcode === 'string' && obj.shortcode) || null;
      if (!id) return null;
      let ts = typeof obj.taken_at === 'number' ? obj.taken_at : obj.taken_at_timestamp;
      if (typeof ts !== 'number') ts = null;
      let caption = null;
      if (obj.caption && typeof obj.caption.text === 'string') caption = obj.caption.text;
      else if (obj.edge_media_to_caption && Array.isArray(obj.edge_media_to_caption.edges)
        && obj.edge_media_to_caption.edges[0] && obj.edge_media_to_caption.edges[0].node
        && typeof obj.edge_media_to_caption.edges[0].node.text === 'string') {
        caption = obj.edge_media_to_caption.edges[0].node.text;
      }
      if (typeof caption === 'string') caption = caption.trim().slice(0, 200) || null;
      return { id, ts, caption };
    }

    function currentPost() {
      return postStack.length ? postStack[postStack.length - 1] : null;
    }

    function addImg(url, thumbUrl) {
      if (!url || typeof url !== 'string' || !/^https:/.test(url) || seenUrls.has(url)) return;
      try { if (!IG_CDN.test(new URL(url).hostname)) return; } catch { return; }
      if (/\/t51\.2885-19\//.test(url)) return; // 头像不入库
      seenUrls.add(url);
      const post = currentPost();
      if (post) postByUrl.set(url, { id: post.id, ts: post.ts, caption: post.caption });
      images.push(url);
      carouselItems.push({ type: 'image', url, thumbUrl: thumbUrl || url });
    }

    function addVid(url, poster, thumbUrl) {
      if (!url || typeof url !== 'string' || !/^https:/.test(url) || !isVideoEntryUrl(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      const post = currentPost();
      if (post) postByUrl.set(url, { id: post.id, ts: post.ts, caption: post.caption });
      videos.push({ url, poster: poster || undefined });
      carouselItems.push({ type: 'video', url, poster, thumbUrl: thumbUrl || poster || url });
    }

    function searchObj(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > maxDepth || visited.has(obj)) return;
      if (typeof Element !== 'undefined' && (obj instanceof Element || obj instanceof Node)) return;
      visited.add(obj);

      const meta = postMetaOf(obj);
      if (meta) postStack.push(meta);

      if (Array.isArray(obj)) {
        for (const item of obj) searchObj(item, depth + 1);
        return;
      }

      // 1. 命中标准 GraphQL / REST carousel_media 多图/多视频结构
      if (Array.isArray(obj.carousel_media) && obj.carousel_media.length > 0) {
        for (const item of obj.carousel_media) {
          if (!item || typeof item !== 'object') continue;
          let bestImg = null, thumb = null;
          if (item.image_versions2 && Array.isArray(item.image_versions2.candidates)) {
            const cands = item.image_versions2.candidates;
            bestImg = cands[0]?.url;
            thumb = cands[cands.length - 1]?.url || bestImg;
          }
          if (Array.isArray(item.video_versions) && item.video_versions.length > 0) {
            const bestV = item.video_versions[0];
            if (bestV && bestV.url) addVid(bestV.url, bestImg, thumb);
          } else if (bestImg) {
            addImg(bestImg, thumb);
          }
        }
      }

      // 2. 命中 GraphQL edge_sidecar_to_children 结构
      if (obj.edge_sidecar_to_children && Array.isArray(obj.edge_sidecar_to_children.edges)) {
        for (const edge of obj.edge_sidecar_to_children.edges) {
          const node = edge && edge.node;
          if (!node) continue;
          const bestImg = node.display_url || (Array.isArray(node.display_resources) && node.display_resources[node.display_resources.length - 1]?.src);
          const thumb = (Array.isArray(node.display_resources) && node.display_resources[0]?.src) || bestImg;
          if (node.is_video && node.video_url) {
            addVid(node.video_url, bestImg, thumb);
          } else if (bestImg) {
            addImg(bestImg, thumb);
          }
        }
      }

      // 3. 命中单图 image_versions2
      if (obj.image_versions2 && Array.isArray(obj.image_versions2.candidates)) {
        const cands = obj.image_versions2.candidates;
        const best = cands[0]?.url;
        const thumb = cands[cands.length - 1]?.url || best;
        if (best) addImg(best, thumb);
      }

      // 4. 命中单视频 video_versions
      if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
        for (const v of obj.video_versions) {
          if (v && v.url) addVid(v.url, null, null);
        }
      }

      // 5. 常见直链字段
      for (const key of ['video_url', 'videoUrl', 'playback_url', 'progressive_download_url']) {
        if (typeof obj[key] === 'string' && /^https:/.test(obj[key]) && isVideoEntryUrl(obj[key])) {
          addVid(obj[key], null, null);
        }
      }

      // 6. GraphQL 单图节点的 display_url / thumbnail_src（仅 JSON 旁听路径启用；
      //    视频节点跳过，避免封面图混入图片库）
      if (includeDisplayUrl && !obj.is_video) {
        if (typeof obj.display_url === 'string' && !obj.video_url) {
          const thumb = Array.isArray(obj.display_resources) && obj.display_resources[0]?.src;
          addImg(obj.display_url, thumb);
        } else if (typeof obj.thumbnail_src === 'string') {
          addImg(obj.thumbnail_src);
        }
      }

      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) {
          if (k.startsWith('__react') || k === 'stateNode' || k === 'child' || k === 'sibling' || k === 'memoizedProps' || k === 'memoizedState' || k === 'pendingProps' || k === 'return') {
            searchObj(obj[k], depth + 1);
          } else if (typeof obj[k] === 'object') {
            searchObj(obj[k], depth + 1);
          }
        }
      }

      if (meta) postStack.pop();
    }

    return { searchObj, images, videos, carouselItems, postByUrl };
  }

  function extractMediaFromFiber(rootEl) {
    const col = createMediaCollector();
    try {
      let cur = rootEl;
      let steps = 0;
      while (cur && steps < 8) {
        for (const key in cur) {
          if (key.startsWith('__reactFiber') || key.startsWith('__reactProps') || key.startsWith('__reactInternalInstance')) {
            col.searchObj(cur[key], 0);
          }
        }
        if (col.carouselItems.length > 0) break;
        cur = cur.parentElement;
        steps++;
      }
    } catch {}

    return { images: col.images, videos: col.videos, carouselItems: col.carouselItems, postByUrl: col.postByUrl };
  }

  // ─── 接口 JSON 旁听：个人主页网格多图全量采集 ────────────────────────────
  // 个人主页网格只为每个帖子渲染封面 <img>，多图帖其余图片只存在于 IG 自己的
  // 接口响应 JSON 里。旁听 fetch/XHR（页面本来就会发的请求）并提取，零额外请求。
  function isInstagramApiJsonUrl(urlStr) {
    try {
      const u = new URL(urlStr, location.href);
      if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return false;
      return /\/api\//.test(u.pathname) || /\/graphql\b/.test(u.pathname);
    } catch { return false; }
  }

  // 头像 URL 会以字段形式出现在用户对象里，先剔除避免头像入库
  function stripProfilePicFields(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 12) return obj;
    if (Array.isArray(obj)) { obj.forEach(o => stripProfilePicFields(o, depth + 1)); return obj; }
    for (const k of Object.keys(obj)) {
      if (/^profile_pic_url/.test(k)) delete obj[k];
      else if (typeof obj[k] === 'object' && obj[k]) stripProfilePicFields(obj[k], depth + 1);
    }
    return obj;
  }

  // 归属用户名：唯一 user.username / owner.username → 该用户；响应里完全无
  // 用户名（纯 owner.id 的主页内容响应）→ 回退当前浏览的主页；含多个用户名
  // （推荐流/时间线混排）→ 放弃采集。多用户回退会把别人的帖子错存进当前
  // 浏览的账号（2026-09-06 实测 zhizhibooty/cindy 目录混入他人媒体，已收紧）
  function jsonAttributionUsername(json) {
    const found = new Set();
    (function walk(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 10 || found.size > 3) return;
      if (Array.isArray(obj)) { for (const o of obj) walk(o, depth + 1); return; }
      const u = (obj.user && obj.user.username) || (obj.owner && obj.owner.username);
      if (typeof u === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(u)) found.add(u);
      for (const k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) walk(obj[k], depth + 1);
      }
    })(json, 0);
    if (found.size === 1) return [...found][0];
    if (found.size === 0) return profileFromPath();
    return null;
  }

  function harvestJsonMedia(jsonText) {
    if (!JSON_LISTEN_ENABLED()) return 0;
    let json;
    try { json = JSON.parse(jsonText); } catch { return 0; }
    const username = jsonAttributionUsername(json);
    if (!username) return 0;
    stripProfilePicFields(json);
    const col = createMediaCollector(14, { includeDisplayUrl: true });
    col.searchObj(json, 0);
    if (!col.images.length && !col.videos.length) return 0;
    if (!pendingByUser.has(username)) pendingByUser.set(username, new Map());
    const pending = pendingByUser.get(username);
    let added = 0;
    for (const imgUrl of col.images) {
      const key = fileKey(imgUrl);
      if (!key || seenThisSession.has(key) || pending.has(key)) continue;
      const vpfx = mediaIdPrefix(imgUrl);
      if (vpfx && videoPrefixes.has(vpfx)) continue;
      seenThisSession.add(key);
      pending.set(key, { key, url: imgUrl, alt: fullResCandidates(imgUrl), type: 'image', post: col.postByUrl.get(imgUrl) || undefined });
      added++;
    }
    for (const vid of col.videos) {
      const key = fileKey(vid.url);
      if (!key || seenThisSession.has(key) || pending.has(key)) continue;
      seenThisSession.add(key);
      pending.set(key, { key, url: vid.url, alt: [], type: 'video', poster: vid.poster, post: col.postByUrl.get(vid.url) || undefined });
      added++;
    }
    return added;
  }

  function extractDirectVideoUrls(videoEl) {
    const media = extractMediaFromFiber(videoEl);
    return { urls: media.videos.map(v => v.url), postByUrl: media.postByUrl };
  }

  // ─── 网页端 UI：多图卡片横向并排预览（免去翻页点击）──────────────────────
  function renderCarouselPreview(container, carouselItems) {
    if (!CAROUSEL_PREVIEW_ENABLED() || !carouselItems || carouselItems.length <= 1) return;
    if (container.querySelector('.bf-carousel-preview')) return;

    // 挂载在帖子操作栏（点赞/评论 section）上方，或容器内合适位置
    const target = container.querySelector('section') || container;
    const bar = document.createElement('div');
    bar.className = 'bf-carousel-preview';
    bar.style.cssText = [
      'display: grid',
      `grid-template-columns: repeat(${Math.min(carouselItems.length, 4)}, minmax(0, 1fr))`,
      'gap: 6px',
      'padding: 8px 12px 4px',
      'box-sizing: border-box',
      'width: 100%',
      'user-select: none',
    ].join(';');

    const maxDisplay = 4;
    const showCount = Math.min(carouselItems.length, maxDisplay);
    const hasMore = carouselItems.length > maxDisplay;

    for (let i = 0; i < showCount; i++) {
      const item = carouselItems[i];
      const isLast = (i === maxDisplay - 1) && hasMore;
      const card = document.createElement('div');
      card.style.cssText = [
        'position: relative',
        'aspect-ratio: 1 / 1',
        'border-radius: 8px',
        'overflow: hidden',
        'background: rgba(128,128,128,.15)',
        'cursor: pointer',
        'border: 1px solid rgba(255,255,255,.14)',
        'transition: transform .15s ease, border-color .15s ease',
      ].join(';');

      card.onmouseenter = () => { card.style.transform = 'scale(1.03)'; card.style.borderColor = 'rgba(255,255,255,.5)'; };
      card.onmouseleave = () => { card.style.transform = 'scale(1)'; card.style.borderColor = 'rgba(255,255,255,.14)'; };

      const img = document.createElement('img');
      img.src = item.thumbUrl || item.poster || item.url;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.loading = 'lazy';
      card.appendChild(img);

      if (item.type === 'video') {
        const vidBadge = document.createElement('div');
        vidBadge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,.68);border-radius:4px;padding:2px 5px;font-size:10px;color:#fff;line-height:1.2;font-family:sans-serif;';
        vidBadge.textContent = '▶ 视频';
        card.appendChild(vidBadge);
      }

      if (isLast) {
        const moreOverlay = document.createElement('div');
        moreOverlay.style.cssText = [
          'position: absolute', 'inset: 0',
          'background: rgba(0,0,0,.62)',
          'color: #fff',
          'display: flex', 'align-items: center', 'justify-content: center',
          'font-size: 14px', 'font-weight: bold', 'font-family: sans-serif',
          'backdrop-filter: blur(2px)',
        ].join(';');
        moreOverlay.textContent = `+${carouselItems.length - 3}`;
        card.appendChild(moreOverlay);
      }

      card.title = `第 ${i + 1}/${carouselItems.length} 张（点击新标签页打开高清原图）`;
      card.onclick = (e) => {
        e.stopPropagation();
        window.open(item.url, '_blank');
      };

      bar.appendChild(card);
    }

    if (target === container) {
      container.appendChild(bar);
    } else {
      target.parentNode.insertBefore(bar, target);
    }
  }

  function harvestFiberMedia(container, pending, username) {
    let added = 0;
    const media = extractMediaFromFiber(container);
    if (!media) return 0;

    // 1. 批量入库图片（多图及单图最高清直链）
    if (Array.isArray(media.images)) {
      for (const imgUrl of media.images) {
        const key = fileKey(imgUrl);
        if (!key || seenThisSession.has(key) || pending.has(key)) continue;
        const vpfx = mediaIdPrefix(imgUrl);
        if (vpfx && videoPrefixes.has(vpfx)) continue;
        seenThisSession.add(key);
        pending.set(key, { key, url: imgUrl, alt: fullResCandidates(imgUrl), type: 'image', post: media.postByUrl.get(imgUrl) || undefined });
        added++;
      }
    }

    // 2. 批量入库视频
    if (Array.isArray(media.videos)) {
      for (const vid of media.videos) {
        const key = fileKey(vid.url);
        if (!key || seenThisSession.has(key) || pending.has(key)) continue;
        seenThisSession.add(key);
        pending.set(key, { key, url: vid.url, alt: [], type: 'video', poster: vid.poster, post: media.postByUrl.get(vid.url) || undefined });
        added++;
      }
    }

    // 3. 挂载多图横向并排预览栏
    if (Array.isArray(media.carouselItems) && media.carouselItems.length > 1) {
      renderCarouselPreview(container, media.carouselItems);
    }

    return added;
  }

  // DOM 兜底路径的帖子归属：从帖子容器（article/浮层）里的 /p/{code}/ 或 /reel/{code}/ 链接还原 shortcode。
  // DOM 拿不到发帖时间，ts/caption 留空，服务端归并时若 Fiber 路径已补全会保留已有的值。
  function postFromContainer(el) {
    try {
      const c = el.closest('article') || el.closest('div[role="dialog"]') || el.closest('li');
      if (!c) return null;
      const a = c.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      const m = a && (a.getAttribute('href') || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      return m ? { id: m[1], ts: null, caption: null } : null;
    } catch { return null; }
  }

  function harvestVideo(v, pending, username) {
    const poster = posterUrlOf(v);

    // 1. 优先尝试从 React 内部状态提取官方 MP4 高清直链（秒存完整原档）
    const direct = extractDirectVideoUrls(v);
    const domPost = postFromContainer(v);
    if (direct.urls.length > 0) {
      let directAdded = 0;
      for (const dUrl of direct.urls) {
        const key = fileKey(dUrl);
        if (!key || seenThisSession.has(key) || pending.has(key)) continue;
        seenThisSession.add(key);
        pending.set(key, { key, url: dUrl, alt: [], type: 'video', poster, post: direct.postByUrl.get(dUrl) || domPost || undefined });
        directAdded++;
      }
      if (directAdded > 0) {
        v.dataset.bfHarvested = '1';
        return directAdded;
      }
    }

    // 2. 尝试从 <video> 标签读取 src 直链
    const src = v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src);
    if (!src) return 0;

    // 3. 流式播放源（blob:）若无直接 MP4，转后台中继与录制兜底队列
    if (src.startsWith('blob:')) {
      if (v.dataset.bfHarvested) return 0;
      v.dataset.bfHarvested = '1';
      blobQueue.push({ username, videoEl: v, post: domPost });
      return 0;
    }
    if (!/^https:/.test(src)) return 0;
    try { if (!IG_CDN.test(new URL(src).hostname)) return 0; } catch { return 0; }
    const key = fileKey(src);
    if (!key || seenThisSession.has(key) || pending.has(key)) return 0;
    seenThisSession.add(key);
    pending.set(key, { key, url: src, alt: [], type: 'video', poster, post: domPost || undefined });
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
      // 先通过 React Fiber 秒级全量提取（含多图所有图片/视频 + 挂载横向预览）
      added += harvestFiberMedia(article, pending, owner);
      // DOM 兜底扫描
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
      added += harvestFiberMedia(dialog, pending, owner);
      dialog.querySelectorAll('img[srcset], img[src]').forEach(img => { added += harvestImg(img, pending); });
      dialog.querySelectorAll('video').forEach(v => { added += harvestVideo(v, pending, owner); });
    });

    const totalPending = [...pendingByUser.values()].reduce((n, m) => n + m.size, 0);
    updateBadge(username, totalPending, added);
  }

  // ─── 上传 ────────────────────────────────────────────────────────────────
  function flush() {
    for (const [username, pending] of pendingByUser) {
      if (!pending.size || sendingUsers.has(username)) continue;
      const sent = loadSent(username);
      const items = [];
      for (const [key, item] of pending) {
        if (!sent.has(key) && (failedCount.get(key) || 0) < 3) items.push(item);
        if (items.length >= BATCH_MAX) break;
      }
      if (!items.length) continue;

      sendingUsers.add(username);
      GM_xmlhttpRequest({
        method: 'POST',
        url: GALLERY() + '/api/instagram/harvest',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ username, items }),
        timeout: 60000,
        onload: res => {
          sendingUsers.delete(username);
          let data = {};
          try { data = JSON.parse(res.responseText); } catch { }
          if (res.status === 200 && data.success) {
            // 服务端逐条下载，failedUrls 是本轮下载失败的媒体地址；
            // 这些条目留在 pending 里等下一轮重试（failedCount 封顶 3 次后放弃）
            const failedSet = new Set(Array.isArray(data.failedUrls) ? data.failedUrls : []);
            items.forEach(it => {
              if (failedSet.has(it.url)) {
                failedCount.set(it.key, (failedCount.get(it.key) || 0) + 1);
                return;
              }
              pending.delete(it.key);
              sent.add(it.key);
              failedCount.delete(it.key);
              if (it.type === 'video') { registerVideoPrefix(it.url); registerVideoPrefix(it.poster); }
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
          sendingUsers.delete(username);
          items.forEach(it => failedCount.set(it.key, (failedCount.get(it.key) || 0) + 1));
          flashBadge('画廊未连接（' + GALLERY() + '）');
        },
        ontimeout: () => {
          sendingUsers.delete(username);
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
        data: JSON.stringify({ username, data: reader.result, posterUrl: o.posterUrl || undefined, srcUrl: o.srcUrl || undefined, post: o.post || undefined, debug: o.debug || undefined }),
        timeout: 180000,
        onload: res => {
          let d = {}; try { d = JSON.parse(res.responseText); } catch { }
          if (res.status === 200 && d.success) {
            registerVideoPrefix(o.srcUrl || o.posterUrl);
            registerVideoPrefix(o.posterUrl);
            const pend = pendingByUser.get(username);
            const pfx = mediaIdPrefix(o.srcUrl || o.posterUrl);
            if (pend && pfx) for (const k of [...pend.keys()]) {
              if (mediaIdPrefix(k) === pfx) pend.delete(k); // 封面图不再上传
            }
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
    } catch { }
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
                  ).catch(() => { });
                } catch { }
              }).catch(() => { });
            }
            if (isInstagramApiJsonUrl(u)) {
              result.then(res => {
                try {
                  const ct = res.headers.get('content-type') || '';
                  if (!ct.includes('json')) return;
                  res.clone().text().then(t => { harvestJsonMedia(t); }).catch(() => { });
                } catch { }
              }).catch(() => { });
            }
          } catch { }
          return result;
        };
      }
    } catch { }
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
              if (isInstagramApiJsonUrl(u)) {
                const ct = xhr.getResponseHeader('content-type') || '';
                if (ct.includes('json')) {
                  let text = null;
                  if (xhr.responseType === 'json') { try { text = JSON.stringify(xhr.response); } catch { } }
                  else if (xhr.responseType === '' || xhr.responseType === 'text') text = xhr.responseText;
                  if (text) harvestJsonMedia(text);
                }
              }
            } catch { }
          });
          return origSend.apply(this, arguments);
        };
      }
    } catch { }
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
  function trySegFullCapture(username, onFail, posterUrl, post) {
    const debug = tapStats();
    const g = bestSegGroup();
    if (!g) { onFail(); return; }
    const assembled = assembleSegGroup(g);
    if (assembled && assembled.byteLength > 65536) {
      uploadVideoBlob(username, new Blob([assembled], { type: g.ct || 'video/mp4' }),
        msg => flashBadge(msg), { okPrefix: '🎬 分片拼装完整视频已存', debug, posterUrl, srcUrl: g.url, post });
      return;
    }
    const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
      ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
    pageFetch(g.url).then(r => r.blob()).then(b => {
      if (b && b.size > 65536) uploadVideoBlob(username, b, msg => flashBadge(msg),
        { okPrefix: '🎬 完整视频已存（缓存补全）', debug, posterUrl, srcUrl: g.url, post });
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
    } catch { }
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
  function tryActualLinkCapture(username, onFail, posterUrl, post) {
    if (!FULL_DL_ENABLED()) { onFail(); return; }
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
          { okPrefix: '🎬 实际链接完整下载已存', debug: { links: cands.length, tried: i, bytes: buf.byteLength }, posterUrl, srcUrl: cand.url, post });
      }).catch(tryNext);
    };
    tryNext();
  }

  let activeRec = null; // 单录制槽：新录制抢占旧录制
  function startRecording(username, videoEl, post) {
    if (videoEl.dataset.bfRecording || videoEl.ended) return;
    videoEl.dataset.bfRecording = '1';
    const recPost = post || postFromContainer(videoEl);
    try {
      const stream = videoEl.captureStream
        ? videoEl.captureStream()
        : (videoEl.mozCaptureStream ? videoEl.mozCaptureStream() : null);
      const mimes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = (typeof MediaRecorder !== 'undefined' && stream)
        ? mimes.find(m => MediaRecorder.isTypeSupported(m)) : null;
      if (!stream || !mime) { flashBadge('🎬 当前浏览器不支持录制流式视频'); return; }
      if (activeRec) { try { activeRec.rec.stop(); } catch { } }

      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      const chunks = [];
      let stopped = false;
      let pauseTimer = null;
      const stopOnce = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(maxTimer);
        clearTimeout(pauseTimer);
        try { if (rec.state !== 'inactive') rec.stop(); } catch { }
      };
      const maxTimer = setTimeout(stopOnce, 5 * 60 * 1000); // 单条上限 5 分钟

      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        activeRec = null;
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (blob.size < 65536) { flashBadge('🎬 录制内容过短，未入库'); return; }
        flashBadge('🎬 录制完成，视频入库中...');
        uploadVideoBlob(username, blob, msg => flashBadge(msg), { okPrefix: '🎬 录制视频已存', posterUrl: posterUrlOf(videoEl), post: recPost });
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
    const { username, videoEl, post } = blobQueue.shift();
    const finish = (msg) => { flashBadge(msg); blobBusy = false; };
    const src = videoEl.currentSrc || videoEl.src;
    if (!username || !src || !src.startsWith('blob:')) { blobBusy = false; return; }
    const posterUrl = posterUrlOf(videoEl);
    const pageFetch = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
      ? unsafeWindow.fetch.bind(unsafeWindow) : window.fetch.bind(window);
    pageFetch(src).then(r => r.blob()).then(blob => {
      if (!blob || blob.size < 65536) {
        blobBusy = false;
        trySegFullCapture(username, () => tryActualLinkCapture(username, () => startRecording(username, videoEl, post), posterUrl, post), posterUrl, post);
        return;
      }
      if (blob.size > 150 * 1024 * 1024) { finish('🎬 视频超过 150MB，已跳过'); return; }
      uploadVideoBlob(username, blob, msg => finish(msg), { posterUrl, post });
    }).catch(() => {
      blobBusy = false;
      trySegFullCapture(username, () => tryActualLinkCapture(username, () => startRecording(username, videoEl, post), posterUrl, post), posterUrl, post);
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
        try { host = new URL(GALLERY()).host; } catch { }
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
