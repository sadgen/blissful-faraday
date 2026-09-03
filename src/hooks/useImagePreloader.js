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
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tileAspectRatio, setTileAspectRatio] = useState(null);

  const preloadCacheRef = useRef(new Map());
  const activeIdxRef = useRef(activeIdx);
  const imagesRef = useRef(images);
  const shouldStartFromLastRef = useRef(false);
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
      const fileName = images[activeIdx];
      const isVideo = isVideoFile(fileName);
      // P2: reuse cached aspectRatio from preloadCacheRef — skip the range fetch entirely
      const cacheKey = `${currentCollName}:${fileName}`;
      const cached = preloadCacheRef.current.get(cacheKey);
      if (cached && cached.aspectRatio) {
        setTileAspectRatio(cached.aspectRatio);
        return;
      }
      const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(fileName)}`;

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
  }, [activeIdx, currentCollName, images.length]);

  // Fetch images when collection changes
  useEffect(() => {
    if (!currentCollName) {
      setImages([]);
      setTileAspectRatio(null);
      return;
    }

    const fetchImages = async () => {
      try {
        setIsLoadingImages(true);
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
        const newImages = data.images || [];

        // Preload first image before switching (prevents black flash)
        // Skip Image() preload for videos — they can't be preloaded via new Image()
        if (newImages.length > 0) {
          const firstIsVideo = isVideoFile(newImages[0]);

          const applyImages = () => {
            setImages(newImages);
            let startIdx = 0;
            if (shouldStartFromLastRef.current && newImages.length > 0) {
              startIdx = newImages.length - 1;
              shouldStartFromLastRef.current = false;
            }
            setActiveIdx(startIdx);
            setOutgoingIdx(null);
            setIsLoadingImages(false);
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
          setActiveIdx(0);
          setOutgoingIdx(null);
          setIsLoadingImages(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // 正常中断，不污染 loadError
        console.error(err);
        setLoadError(err.message);
        setIsLoadingImages(false);
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
    images, setImages, removeImage, restoreImage, activeIdx, setActiveIdx, outgoingIdx, setOutgoingIdx,
    isLoadingImages, loadError, tileAspectRatio,
    imagesRef, activeIdxRef, shouldStartFromLastRef,
    preloadAndAdvance, preloadImages, getImageDimensions, preloadCacheRef,
    videoFileNames, scheduleOutgoingClear,
  };
}
