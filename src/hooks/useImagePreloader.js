import { useState, useRef, useEffect, useCallback } from 'react';
import { isVideoFile, getImageDimensions } from '../utils/imageHelpers';

const PRELOAD_COUNT = 5;
const OUTGOING_CLEAR_DELAY = 1500;

function setCacheLRU(map, cacheKey, value) {
  if (map.has(cacheKey)) map.delete(cacheKey);
  map.set(cacheKey, value);
  if (map.size > PRELOAD_COUNT) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

export default function useImagePreloader({
  currentCollName,
  setCurrentCollName,
  tileId,
  initialCollectionName,
  onCollectionChange,
  onAspectRatioChange,
  collections,
  imageSort = 'name',
  personFilter = '-',
  slideSwitchedRef,
}) {
  const [images, setImages] = useState([]);
  // images 数组当前归属的图集名。切集加载期间 currentCollName 已变而 images 还是
  // 旧集的，URL 必须用 imagesColl 才能让旧画面在加载期间继续无缝显示
  const [imagesColl, setImagesColl] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  // 同步 ref 版本：advanceSlide 等回调需要在事件发生瞬间读取，不能等 effect 同步
  const isLoadingRef = useRef(false);
  const applyLoadingState = (v) => { isLoadingRef.current = v; setIsLoadingImages(v); };
  const [loadError, setLoadError] = useState('');
  const [tileAspectRatio, setTileAspectRatio] = useState(null);
  // Instagram 帖子索引：filename -> { postNo, totalPosts, caption }；非 IG 图集为 null
  const [postIndex, setPostIndex] = useState(null);
  // 切集边界垫底层：换成新图集的那一帧 commit 里旧容器会整体卸载，若不垫一层
  // 旧集末帧，新 <img> 挂载解码的空档会露黑。holdFrame 以 z0 垫底，超时自清
  const [holdFrame, setHoldFrame] = useState(null);
  const holdTimerRef = useRef(null);
  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);
  const showHoldFrame = useCallback((coll, name) => {
    clearHoldTimer();
    setHoldFrame({ coll, name });
    holdTimerRef.current = setTimeout(() => setHoldFrame(null), 2500);
  }, [clearHoldTimer]);

  const preloadCacheRef = useRef(new Map());
  const activeIdxRef = useRef(activeIdx);
  const imagesRef = useRef(images);
  const shouldStartFromLastRef = useRef(false);
  // 播放历史回跳的落点：{ coll, name }。切集加载完成 applyImages 时消费，
  // 让画面精确落在历史帧上而不是新集首图
  const pendingStartRef = useRef(null);
  const imagesCollRef = useRef('');
  useEffect(() => { imagesCollRef.current = imagesColl; }, [imagesColl]);
  // C4: separate controllers — directory switch vs slide advance must not abort each other
  const abortImagesRef = useRef(null);   // /api/collection/images (directory switch)
  // 在途的下一张推进：{ key: `${coll}:${name}`, controller }。
  // 旧实现每次 tick 都 abort 上一 tick 的在途请求再重发——单次加载一旦超过滑动间隔
  // （多窗口+视频挤占连接池时常见），就永远差一点完成 → 窗口永久冻结。
  // 现在同 key 在途即等待，完成后的 tick 走缓存路径。
  const pendingAdvanceRef = useRef(null);
  // C3: unified cleanup for outgoingIdx timers (unmount-safe)
  const outgoingTimerRef = useRef(null);
  const clearOutgoingTimer = useCallback(() => {
    if (outgoingTimerRef.current) {
      clearTimeout(outgoingTimerRef.current);
      outgoingTimerRef.current = null;
    }
  }, []);
  const scheduleOutgoingClear = useCallback(() => {
    clearOutgoingTimer();
    outgoingTimerRef.current = setTimeout(() => setOutgoingIdx(null), OUTGOING_CLEAR_DELAY);
  }, [clearOutgoingTimer]);

  // C3: clear any pending timer on unmount / collection change
  useEffect(() => clearOutgoingTimer, [clearOutgoingTimer]);
  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  // Sync refs
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);
  useEffect(() => { imagesRef.current = images; }, [images]);

  // 实际切换通知：每个真实"画面已切到新帧"的点调用，供播放链重锚计时/重置进度条
  const notifySlideSwitched = useCallback(() => {
    if (slideSwitchedRef && slideSwitchedRef.current) slideSwitchedRef.current();
  }, [slideSwitchedRef]);

  // Notify parent of aspect ratio change
  useEffect(() => {
    if (tileAspectRatio && onAspectRatioChange) {
      onAspectRatioChange(tileId, tileAspectRatio);
    }
  }, [tileAspectRatio, tileId, onAspectRatioChange]);

  // Sync with initialCollectionName
  useEffect(() => {
    if (initialCollectionName) {
      setCurrentCollName(initialCollectionName);
    }
  }, [initialCollectionName, setCurrentCollName]);

  // Detect aspect ratio of images/videos
  useEffect(() => {
    if (images.length > 0 && activeIdx >= 0 && activeIdx < images.length) {
      // 加载期间 currentCollName 已指向新集，宽高比必须按 images 归属的集取
      const collForUrl = imagesColl || currentCollName;
      const fileName = images[activeIdx];
      const isVideo = isVideoFile(fileName);
      // P2: reuse cached aspectRatio from preloadCacheRef — skip the range fetch entirely
      const cacheKey = `${collForUrl}:${fileName}`;
      const cached = preloadCacheRef.current.get(cacheKey);
      if (cached && cached.aspectRatio) {
        setTileAspectRatio(cached.aspectRatio);
        return;
      }
      const imgUrl = `/api/image?collection=${encodeURIComponent(collForUrl)}&name=${encodeURIComponent(fileName)}`;

      if (isVideo) {
        // For videos: try header parse first, fall back to <video> element or 16:9
        fetch(imgUrl, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-65535' }
        })
          .then(response => {
            if (!response.ok) throw new Error('Fetch failed');
            return response.arrayBuffer();
          })
          .then(buffer => {
            const dimensions = getImageDimensions(buffer);
            if (dimensions) {
              setTileAspectRatio(dimensions.width / dimensions.height);
            } else {
              // Fallback: create a hidden video element to detect dimensions
              const video = document.createElement('video');
              video.muted = true;
              video.preload = 'metadata';
              video.onloadedmetadata = () => {
                const ratio = video.videoWidth / video.videoHeight;
                if (ratio > 0) setTileAspectRatio(ratio);
                video.remove();
              };
              video.onerror = () => { video.remove(); };
              video.src = imgUrl;
            }
          })
          .catch(() => {
            // Last resort: assume vertical (IG is mostly portrait)
            setTileAspectRatio(9 / 16);
          });
      } else {
        // Images: use existing logic
        fetch(imgUrl, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-65535' }
        })
          .then(response => {
            if (!response.ok) throw new Error('Fetch failed');
            return response.arrayBuffer();
          })
          .then(buffer => {
            const dimensions = getImageDimensions(buffer);
            if (dimensions) setTileAspectRatio(dimensions.width / dimensions.height);
          })
          .catch(() => {
            const img = new Image();
            img.onload = () => setTileAspectRatio(img.width / img.height);
            img.src = imgUrl;
          });
      }
    }
  }, [activeIdx, currentCollName, imagesColl, images.length]);

  // Fetch images when collection changes
  useEffect(() => {
    if (!currentCollName) {
      setImages([]);
      setImagesColl('');
      setHoldFrame(null);
      setTileAspectRatio(null);
      setPostIndex(null);
      applyLoadingState(false);
      return;
    }

    const fetchImages = async () => {
      // 15s 硬超时：连接挂死时目录请求永不返回会让 isLoadingRef 永远为 true，
      // 推进守卫会把窗口永久冻住
      let timedOut = false;
      let timeoutId = null;
      try {
        applyLoadingState(true);
        setLoadError('');
        if (abortImagesRef.current) abortImagesRef.current.abort();
        const controller = new AbortController();
        abortImagesRef.current = controller;
        timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
        const pParam = personFilter !== '-' ? `&person=${encodeURIComponent(personFilter)}` : '';
        const res = await fetch(`/api/collection/images?collection=${encodeURIComponent(currentCollName)}&sort=${imageSort}${pParam}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`加载目录失败: ${res.statusText}`);
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('图片服务不可用 (非 JSON 响应)');
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        let newImages = data.images || [];

        // Instagram 帖子结构：账号目录带 .posts.json 时按 帖子时间倒序 + 帖内
        // carousel 顺序 重排（覆盖 imageSort），无帖子归属的文件排在其后。
        // 普通图集没有 manifest，维持原排序。
        setPostIndex(null);
        try {
          const pres = await fetch(`/api/collection/posts?collection=${encodeURIComponent(currentCollName)}`, { signal: controller.signal });
          if (pres.ok) {
            const pdata = await pres.json();
            // 帖子图集（user::postId）只含本帖文件，但编号按整账号计（第 x/y 帖）
            const posts = Array.isArray(pdata.posts) ? pdata.posts : [];
            if (posts.length) {
              const present = new Set(newImages);
              const ordered = [];
              const pMap = new Map();
              posts.forEach((p, pi) => {
                (Array.isArray(p.media) ? p.media : []).forEach(f => {
                  if (!present.has(f) || pMap.has(f)) return;
                  pMap.set(f, { postNo: pi + 1, totalPosts: posts.length, caption: p.caption || '', postId: p.id });
                  ordered.push(f);
                });
              });
              if (pMap.size) {
                newImages.forEach(f => { if (!pMap.has(f)) ordered.push(f); });
                newImages = ordered;
                setPostIndex(pMap);
              }
            }
          }
        } catch (e) {
          if (e && e.name === 'AbortError') throw e; // 目录已切换，整体放弃
          // 帖子接口不可用：退回默认排序
        }

        // Preload first image before switching (prevents black flash)
        // Skip Image() preload for videos — they can't be preloaded via new Image()
        if (newImages.length > 0) {
          const firstIsVideo = isVideoFile(newImages[0]);

          const applyImages = () => {
            if (timeoutId) clearTimeout(timeoutId);
            // 换集瞬间旧容器整体卸载：先把旧集当前帧留作垫底，盖住新 img 挂载解码空档
            const prevName = imagesRef.current[activeIdxRef.current];
            const prevColl = imagesCollRef.current;
            if (prevName && prevColl && prevColl !== currentCollName && !isVideoFile(prevName)) {
              showHoldFrame(prevColl, prevName);
            } else {
              clearHoldTimer();
              setHoldFrame(null);
            }
            setImages(newImages);
            setImagesColl(currentCollName);
            let startIdx = 0;
            if (pendingStartRef.current && pendingStartRef.current.coll === currentCollName) {
              // 播放历史回跳：精确落在历史帧
              const i = newImages.indexOf(pendingStartRef.current.name);
              startIdx = i >= 0 ? i : 0;
              pendingStartRef.current = null;
            } else if (shouldStartFromLastRef.current && newImages.length > 0) {
              startIdx = newImages.length - 1;
              shouldStartFromLastRef.current = false;
            }
            setActiveIdx(startIdx);
            setOutgoingIdx(null);
            applyLoadingState(false);
            notifySlideSwitched();
            preloadImages(startIdx + 1, PRELOAD_COUNT);
          };

          if (firstIsVideo) {
            applyImages();
          } else {
            const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(newImages[0])}`;
            const preloadImg = new Image();
            // 首图 15s 仍未就绪就直接切换（宁可显示加载中的图也不冻结窗口）
            let settled = false;
            const applyOnce = () => { if (!settled) { settled = true; applyImages(); } };
            const imgFallback = setTimeout(() => applyOnce(), 15000);
            preloadImg.onload = () => { clearTimeout(imgFallback); applyOnce(); };
            preloadImg.onerror = () => { clearTimeout(imgFallback); applyOnce(); };
            preloadImg.src = imgUrl;
          }
        } else {
          if (timeoutId) clearTimeout(timeoutId);
          setImages([]);
          setImagesColl(currentCollName);
          setActiveIdx(0);
          setOutgoingIdx(null);
          applyLoadingState(false);
          pendingStartRef.current = null;
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // 超时导致的中断要走出错恢复（否则 isLoading 永远为 true 冻结窗口）；
          // 正常切集中断保持原样（新集流程已接管）
          if (timedOut) {
            setLoadError('加载超时');
            applyLoadingState(false);
          }
          return;
        }
        console.error(err);
        setLoadError(err.message);
        applyLoadingState(false);
      }
    };
    fetchImages();

    return () => {
      if (abortImagesRef.current) abortImagesRef.current.abort();
      // 在途推进的 nextIdx 属于旧集：换集即作废，防止其完成时把旧下标套到新集上
      if (pendingAdvanceRef.current) {
        try { pendingAdvanceRef.current.controller.abort(); } catch {}
        pendingAdvanceRef.current = null;
      }
    };
  }, [currentCollName, personFilter]);

  // Preload images ahead of time
  const preloadImages = useCallback((startIdx, count) => {
    const currentImages = imagesRef.current;
    if (currentImages.length <= 1) return;
    const cache = preloadCacheRef.current;
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % currentImages.length;
      const imgName = currentImages[idx];
      // Skip video files — they can't be preloaded via new Image()
      if (isVideoFile(imgName)) continue;
      const cacheKey = `${currentCollName}:${imgName}`;
      if (cache.has(cacheKey)) continue;
      const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;
      const img = new Image();
      img.onload = () => {
        cache.set(cacheKey, { img, aspectRatio: img.width / img.height });
        if (cache.size > 5) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
      };
      img.src = imgUrl;
    }
  }, [currentCollName]);

  // Pre-load and advance slide
  const preloadAndAdvance = useCallback((nextIdx, collName, outgoingIdx) => {
    const imgName = imagesRef.current[nextIdx];
    if (!imgName) return;

    // For video files: skip image preloading, just switch immediately
    if (isVideoFile(imgName)) {
      pendingAdvanceRef.current = null;
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      scheduleOutgoingClear();
      notifySlideSwitched();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);

    if (cached && cached.img && cached.img.complete) {
      pendingAdvanceRef.current = null;
      setTileAspectRatio(cached.aspectRatio || (cached.img.width / cached.img.height));
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      scheduleOutgoingClear();
      notifySlideSwitched();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    // 同一张已在途：不重发、不中断，等它落缓存后由下一个 tick 切换
    if (pendingAdvanceRef.current && pendingAdvanceRef.current.key === cacheKey) return;

    const imgUrl = `/api/image?collection=${encodeURIComponent(collName)}&name=${encodeURIComponent(imgName)}`;
    const controller = new AbortController();
    pendingAdvanceRef.current = { key: cacheKey, controller };
    const myKey = cacheKey;

    // 图片就绪后的切换动作。图片本体始终写入缓存（对后续总有价值），
    // 但状态更新只在本次推进仍是最新一次时执行（防旧集响应串号）
    const applySwitch = (img, ratio) => {
      const isLatest = pendingAdvanceRef.current && pendingAdvanceRef.current.key === myKey;
      if (isLatest) pendingAdvanceRef.current = null;
      setCacheLRU(preloadCacheRef.current, cacheKey, { img, aspectRatio: ratio });
      if (!isLatest) return;
      setTileAspectRatio(ratio);
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      scheduleOutgoingClear();
      notifySlideSwitched();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
    };
    const loadFull = () => {
      const img = new Image();
      img.onload = () => applySwitch(img, img.width / img.height);
      img.onerror = () => {
        if (pendingAdvanceRef.current && pendingAdvanceRef.current.key === myKey) {
          pendingAdvanceRef.current = null;
        }
      };
      img.src = imgUrl;
    };
    fetch(imgUrl, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-65535' },
      signal: controller.signal
    })
      .then(response => {
        if (!response.ok) throw new Error('Fetch failed');
        return response.arrayBuffer();
      })
      .then(buffer => {
        const dimensions = getImageDimensions(buffer);
        if (dimensions) setTileAspectRatio(dimensions.width / dimensions.height);
        loadFull();
      })
      .catch(() => {
        if (controller.signal.aborted) return; // 切集中断：新集的加载流程已接管
        loadFull();
      });
  }, [preloadImages, scheduleOutgoingClear]);

  // Remove a single image from preloader state & cache
  const removeImage = useCallback((imgNameToRemove) => {
    setImages(prev => prev.filter(img => img !== imgNameToRemove));
    preloadCacheRef.current.delete(`${currentCollName}:${imgNameToRemove}`);
  }, [currentCollName]);

  // Restore a single image back to preloader state
  const restoreImage = useCallback((imgNameToRestore, atIndex = 0) => {
    setImages(prev => {
      if (prev.includes(imgNameToRestore)) return prev;
      const next = [...prev];
      const insertAt = Math.min(Math.max(0, atIndex), next.length);
      next.splice(insertAt, 0, imgNameToRestore);
      return next;
    });
  }, []);

  // Build video file names set for the current collection
  const videoFileNames = new Set(images.filter(isVideoFile));

  return {
    images, setImages, imagesColl, removeImage, restoreImage, activeIdx, setActiveIdx, outgoingIdx, setOutgoingIdx,
    isLoadingImages, isLoadingRef, loadError, tileAspectRatio, postIndex, holdFrame,
    imagesRef, activeIdxRef, shouldStartFromLastRef, pendingStartRef,
    preloadAndAdvance, preloadImages, getImageDimensions, preloadCacheRef,
    videoFileNames, scheduleOutgoingClear,
  };
}
