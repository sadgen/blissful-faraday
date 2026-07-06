import { useState, useRef, useEffect, useCallback } from 'react';

const PRELOAD_COUNT = 5;

function setCacheLRU(map, cacheKey, value) {
  if (map.has(cacheKey)) map.delete(cacheKey);
  map.set(cacheKey, value);
  if (map.size > PRELOAD_COUNT) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

// Parse image dimensions from buffer without full decode
function getImageDimensions(buffer) {
  const bytes = new Uint8Array(buffer);

  // JPEG (FF D8)
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];
      if ((marker >= 0xC0 && marker <= 0xC3) ||
          (marker >= 0xC5 && marker <= 0xC7) ||
          (marker >= 0xC9 && marker <= 0xCB) ||
          (marker >= 0xCD && marker <= 0xCF)) {
        const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
        const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
        if (width > 0 && height > 0) return { width, height };
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 2 + length;
      if (length < 2 || offset >= bytes.length) break;
    }
  }

  // PNG (89 50 4E 47)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width, height };
  }

  // GIF (47 49 46 38)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    if (width > 0 && height > 0) return { width, height };
  }

  // WebP (52 49 46 46 ... 57 42 50)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    if (bytes[11] === 0x57 && bytes[12] === 0x42 && bytes[13] === 0x50) {
      const width = bytes[26] | (bytes[27] << 8) | ((bytes[28] & 0x7F) << 16);
      const height = bytes[28] | (bytes[29] << 8) | ((bytes[30] & 0x7F) << 16);
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return null;
}

export default function useImagePreloader({
  currentCollName,
  setCurrentCollName,
  tileId,
  initialCollectionName,
  onCollectionChange,
  onAspectRatioChange,
  collections,
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

  // Detect aspect ratio of first image
  useEffect(() => {
    if (images.length > 0 && activeIdx >= 0 && activeIdx < images.length) {
      const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(images[activeIdx])}`;
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
        const res = await fetch(`/api/collection/images?collection=${encodeURIComponent(currentCollName)}`);
        if (!res.ok) throw new Error(`加载目录失败: ${res.statusText}`);
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('图片服务不可用 (非 JSON 响应)');
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const newImages = data.images || [];

        // Preload first image before switching (prevents black flash)
        if (newImages.length > 0) {
          const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(newImages[0])}`;
          const preloadImg = new Image();
          preloadImg.onload = () => {
            setImages(newImages);
            let startIdx = 0;
            if (shouldStartFromLastRef.current && newImages.length > 0) {
              startIdx = newImages.length - 1;
              shouldStartFromLastRef.current = false;
            }
            setActiveIdx(startIdx);
            setOutgoingIdx(null);
            setIsLoadingImages(false);
            setTimeout(() => preloadImages(startIdx + 1, PRELOAD_COUNT), 1500);
          };
          preloadImg.onerror = () => {
            // Fallback: switch anyway even if preload fails
            setImages(newImages);
            let startIdx = 0;
            if (shouldStartFromLastRef.current && newImages.length > 0) {
              startIdx = newImages.length - 1;
              shouldStartFromLastRef.current = false;
            }
            setActiveIdx(startIdx);
            setOutgoingIdx(null);
            setIsLoadingImages(false);
            setTimeout(() => preloadImages(startIdx + 1, PRELOAD_COUNT), 1500);
          };
          preloadImg.src = imgUrl;
        } else {
          setImages([]);
          setActiveIdx(0);
          setOutgoingIdx(null);
          setIsLoadingImages(false);
        }
      } catch (err) {
        console.error(err);
        setLoadError(err.message);
        setIsLoadingImages(false);
      }
    };
    fetchImages();
  }, [currentCollName]);

  // Preload images ahead of time
  const preloadImages = useCallback((startIdx, count) => {
    const currentImages = imagesRef.current;
    if (currentImages.length <= 1) return;
    const cache = preloadCacheRef.current;
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % currentImages.length;
      const imgName = currentImages[idx];
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
    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);

    if (cached && cached.img && cached.img.complete) {
      preloadCacheRef.current.delete(cacheKey);
      preloadCacheRef.current.set(cacheKey, cached);
      setTileAspectRatio(cached.aspectRatio || (cached.img.width / cached.img.height));
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      setTimeout(() => setOutgoingIdx(null), 1500);
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    const imgUrl = `/api/image?collection=${encodeURIComponent(collName)}&name=${encodeURIComponent(imgName)}`;
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
        const aspectRatio = dimensions ? dimensions.width / dimensions.height : null;
        if (aspectRatio) setTileAspectRatio(aspectRatio);
        const img = new Image();
        img.onload = () => {
          const finalAspectRatio = img.width / img.height;
          setCacheLRU(preloadCacheRef.current, cacheKey, { img, aspectRatio: finalAspectRatio });
          setTileAspectRatio(finalAspectRatio);
          if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
          setActiveIdx(nextIdx);
          setTimeout(() => setOutgoingIdx(null), 1500);
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
          setTimeout(() => setOutgoingIdx(null), 1500);
          preloadImages(nextIdx + 1, PRELOAD_COUNT);
        };
        img.src = imgUrl;
      });
  }, [preloadImages]);

  return {
    images, activeIdx, setActiveIdx, outgoingIdx, setOutgoingIdx,
    isLoadingImages, loadError, tileAspectRatio,
    imagesRef, activeIdxRef, shouldStartFromLastRef,
    preloadAndAdvance, preloadImages, getImageDimensions, preloadCacheRef,
  };
}
