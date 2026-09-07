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
  const imagesCollRef = useRef('');
  useEffect(() => { imagesCollRef.current = imagesColl; }, [imagesColl]);
  // C4: separate controllers — directory switch vs slide advance must not abort each other
  const abortImagesRef = useRef(null);   // /api/collection/images (directory switch)
  const abortPreloadRef = useRef(null);  // /api/image range fetch (slide advance)
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
      try {
        applyLoadingState(true);
        setLoadError('');
        if (abortImagesRef.current) abortImagesRef.current.abort();
        const controller = new AbortController();
        abortImagesRef.current = controller;
        const res = await fetch(`/api/collection/images?collection=${encodeURIComponent(currentCollName)}&sort=${imageSort}`, { signal: controller.signal });
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
            if (shouldStartFromLastRef.current && newImages.length > 0) {
              startIdx = newImages.length - 1;
              shouldStartFromLastRef.current = false;
            }
            setActiveIdx(startIdx);
            setOutgoingIdx(null);
            applyLoadingState(false);
            preloadImages(startIdx + 1, PRELOAD_COUNT);
          };

          if (firstIsVideo) {
            applyImages();
          } else {
            const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(newImages[0])}`;
            const preloadImg = new Image();
            preloadImg.onload = applyImages;
            preloadImg.onerror = applyImages;
            preloadImg.src = imgUrl;
          }
        } else {
          setImages([]);
          setImagesColl(currentCollName);
          setActiveIdx(0);
          setOutgoingIdx(null);
          applyLoadingState(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // 正常中断，不污染 loadError
        console.error(err);
        setLoadError(err.message);
        applyLoadingState(false);
      }
    };
    fetchImages();

    return () => {
      if (abortImagesRef.current) abortImagesRef.current.abort();
    };
  }, [currentCollName]);

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
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      scheduleOutgoingClear();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);

    if (cached && cached.img && cached.img.complete) {
      preloadCacheRef.current.delete(cacheKey);
      preloadCacheRef.current.set(cacheKey, cached);
      setTileAspectRatio(cached.aspectRatio || (cached.img.width / cached.img.height));
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      scheduleOutgoingClear();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    const imgUrl = `/api/image?collection=${encodeURIComponent(collName)}&name=${encodeURIComponent(imgName)}`;
    if (abortPreloadRef.current) abortPreloadRef.current.abort();
    const controller = new AbortController();
    abortPreloadRef.current = controller;
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
        const aspectRatio = dimensions ? dimensions.width / dimensions.height : null;
        if (aspectRatio) setTileAspectRatio(aspectRatio);
        const img = new Image();
        img.onload = () => {
          const finalAspectRatio = img.width / img.height;
          setCacheLRU(preloadCacheRef.current, cacheKey, { img, aspectRatio: finalAspectRatio });
          setTileAspectRatio(finalAspectRatio);
          if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
          setActiveIdx(nextIdx);
          scheduleOutgoingClear();
          preloadImages(nextIdx + 1, PRELOAD_COUNT);
        };
        img.src = imgUrl;
      })
      .catch(() => {
        const img = new Image();
        img.onload = () => {
          const finalAspectRatio = img.width / img.height;
          setCacheLRU(preloadCacheRef.current, cacheKey, { img, aspectRatio: finalAspectRatio });
          setTileAspectRatio(finalAspectRatio);
          if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
          setActiveIdx(nextIdx);
          scheduleOutgoingClear();
          preloadImages(nextIdx + 1, PRELOAD_COUNT);
        };
        img.src = imgUrl;
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
    imagesRef, activeIdxRef, shouldStartFromLastRef,
    preloadAndAdvance, preloadImages, getImageDimensions, preloadCacheRef,
    videoFileNames, scheduleOutgoingClear,
  };
}
