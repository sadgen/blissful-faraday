import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, X, ChevronRight, ChevronLeft, Maximize2, Minimize2 } from 'lucide-react';

export default function MobileSlideshowCard({
  tileId,
  collections,
  displayedCollections,
  onCollectionChange,
  initialCollectionName,
  globalSpeed,
  globalIsPlaying,
  globalRefreshTrigger,
  isSingle,
  globalTransitionEffect,
  onAspectRatioChange,
  totalTiles,
  sortMethod,
  zoomScale = 1,
  onTitleClick = null,
  intersections = []
}) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [images, setImages] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [localIsPlaying, setLocalIsPlaying] = useState(true);
  const [localSpeedMult, setLocalSpeedMult] = useState(1);
  const [progressBarReset, setProgressBarReset] = useState(false);
  
  // Touch Gestures State
  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });
  const [touchDelta, setTouchDelta] = useState({ x: 0, y: 0 });
  const [isSwiping, setIsSwiping] = useState(false);
  const lastTapRef = useRef(0);
  const longPressTimeoutRef = useRef(null);
  const isLongPressTriggeredRef = useRef(false);

  const [showOverlay, setShowOverlay] = useState(false);
  const overlayTimerRef = useRef(null);

  const triggerOverlayBriefly = useCallback((duration = 2500) => {
    setShowOverlay(true);
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
    }
    overlayTimerRef.current = setTimeout(() => {
      setShowOverlay(false);
    }, duration);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
      }
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  const transitionEffect = globalTransitionEffect || 'none';

  const timerRef = useRef(null);
  const staggerTimeoutRef = useRef(null);
  const staggerAppliedRef = useRef(false);
  const shouldStartFromLastRef = useRef(false);

  // Preload cache for faster image switching
  const preloadCacheRef = useRef(new Map());
  const PRELOAD_COUNT = 1;

  const activeIdxRef = useRef(activeIdx);
  const imagesRef = useRef(images);
  const currentCollNameRef = useRef(currentCollName);
  const collectionsRef = useRef(collections);
  const displayedCollectionsRef = useRef(displayedCollections);
  const sortMethodRef = useRef(sortMethod);
  
  const [barDuration, setBarDuration] = useState(globalSpeed);
  const [tileAspectRatio, setTileAspectRatio] = useState(null);
  
  // Notify parent of aspect ratio change
  useEffect(() => {
    if (tileAspectRatio && onAspectRatioChange) {
      onAspectRatioChange(tileId, tileAspectRatio);
    }
  }, [tileAspectRatio, tileId, onAspectRatioChange]);

  // Sync refs with state values
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { currentCollNameRef.current = currentCollName; }, [currentCollName]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);
  useEffect(() => { displayedCollectionsRef.current = displayedCollections; }, [displayedCollections]);
  useEffect(() => { sortMethodRef.current = sortMethod; }, [sortMethod]);
  
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadError, setLoadError] = useState('');

  // Sync with parent's initialCollectionName prop when it changes
  useEffect(() => {
    if (initialCollectionName) {
      setCurrentCollName(initialCollectionName);
    }
  }, [initialCollectionName]);

  // Parse image dimensions from buffer (JPEG, PNG, GIF, WebP) without full decoding
  const getImageDimensions = (buffer) => {
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
    
    // PNG
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width > 0 && height > 0) return { width, height };
    }
    
    // GIF
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      const width = bytes[6] | (bytes[7] << 8);
      const height = bytes[8] | (bytes[9] << 8);
      if (width > 0 && height > 0) return { width, height };
    }
    
    // WebP
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      if (bytes[11] === 0x57 && bytes[12] === 0x42 && bytes[13] === 0x50) {
        const width = bytes[26] | (bytes[27] << 8) | ((bytes[28] & 0x7F) << 16);
        const height = bytes[28] | (bytes[29] << 8) | ((bytes[30] & 0x7F) << 16);
        if (width > 0 && height > 0) return { width, height };
      }
    }
    
    return null;
  };

  // Detect aspect ratio of image
  const detectAspectRatio = (collName, imgName) => {
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
      if (dimensions) {
        setTileAspectRatio(dimensions.width / dimensions.height);
      }
    })
    .catch(() => {
      const img = new Image();
      img.onload = () => {
        setTileAspectRatio(img.width / img.height);
      };
      img.src = imgUrl;
    });
  };

  // Detect aspect ratio when active image index changes
  useEffect(() => {
    if (images.length > 0 && activeIdx >= 0 && activeIdx < images.length) {
      detectAspectRatio(currentCollName, images[activeIdx]);
    }
  }, [activeIdx, currentCollName, images.length > 0 ? images : []]);

  // Fetch images when directory changes
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
        if (!res.ok) {
          throw new Error(`加载目录失败: ${res.statusText}`);
        }
        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setImages(data.images || []);
        
        let startIdx = 0;
        if (shouldStartFromLastRef.current && data.images && data.images.length > 0) {
          startIdx = data.images.length - 1;
          shouldStartFromLastRef.current = false;
        }
        
        setActiveIdx(startIdx);
        setOutgoingIdx(null);
        
        if (data.images && data.images.length > 0) {
          detectAspectRatio(currentCollName, data.images[0]);
          setTimeout(() => preloadImages(startIdx + 1, PRELOAD_COUNT), 1000);
        }
      } catch (err) {
        console.error(err);
        setLoadError(err.message);
      } finally {
        setIsLoadingImages(false);
      }
    };

    fetchImages();
  }, [currentCollName]);

  // Initial assignment
  useEffect(() => {
    if (collections.length > 0 && !currentCollName && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [collections, currentCollName, initialCollectionName]);

  // Handle global refresh trigger
  useEffect(() => {
    if (collections.length > 0 && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [globalRefreshTrigger, initialCollectionName]);

  const getNextUniqueCollection = (direction) => {
    const allColls = collectionsRef.current;
    if (allColls.length <= 1) return currentCollNameRef.current;

    const currentCollNameVal = currentCollNameRef.current;
    const otherDisplayedColls = (displayedCollectionsRef.current || []).filter((_, idx) => idx !== tileId);

    if (sortMethodRef.current === 'random') {
      const candidates = allColls.filter(c => !otherDisplayedColls.includes(c) && c !== currentCollNameVal);
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
      const fallbackCandidates = allColls.filter(c => !otherDisplayedColls.includes(c));
      if (fallbackCandidates.length > 0) {
        return fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
      }
      return allColls[Math.floor(Math.random() * allColls.length)];
    }

    const currentIdxInCollections = allColls.indexOf(currentCollNameVal);
    if (currentIdxInCollections !== -1) {
      for (let i = 1; i <= allColls.length; i++) {
        const nextIdx = (currentIdxInCollections + i * direction + allColls.length * i) % allColls.length;
        const candidate = allColls[nextIdx];
        if (!otherDisplayedColls.includes(candidate)) {
          return candidate;
        }
      }
      const fallbackIdx = (currentIdxInCollections + direction + allColls.length) % allColls.length;
      return allColls[fallbackIdx];
    }
    return allColls[0];
  };

  const selectRandomCollection = () => {
    const allColls = collectionsRef.current;
    if (allColls.length === 0) return;

    const otherDisplayedColls = (displayedCollectionsRef.current || []).filter((_, idx) => idx !== tileId);
    const candidates = allColls.filter(c => !otherDisplayedColls.includes(c));

    let chosenColl;
    if (candidates.length > 0) {
      chosenColl = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      const otherColls = allColls.filter(c => c !== currentCollNameRef.current);
      chosenColl = otherColls.length > 0 ? otherColls[Math.floor(Math.random() * otherColls.length)] : allColls[0];
    }

    setCurrentCollName(chosenColl);
    if (onCollectionChange) {
      onCollectionChange(tileId, chosenColl);
    }
  };

  const duration = globalSpeed / localSpeedMult;
  const isPlaying = globalIsPlaying && localIsPlaying && images.length > 1;

  const resetProgressBar = () => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  };

  useEffect(() => {
    if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(duration);
    }
  }, [duration, totalTiles]);

  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, duration, totalTiles]);

  // Synchronized stagger and playback logic
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (staggerTimeoutRef.current) {
      clearTimeout(staggerTimeoutRef.current);
      staggerTimeoutRef.current = null;
    }

    if (isPlaying) {
      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        setBarDuration(staggerDelay);
        resetProgressBar();

        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlide(1);
          setBarDuration(duration);
          resetProgressBar();
          
          timerRef.current = setInterval(() => {
            advanceSlide(1);
            resetProgressBar();
          }, duration);
        }, staggerDelay);
      } else {
        setBarDuration(duration);
        timerRef.current = setInterval(() => {
          advanceSlide(1);
          resetProgressBar();
        }, duration);
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [isPlaying, duration, totalTiles, tileId]);

  const preloadImages = (startIdx, count) => {
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
  };

  const preloadAndAdvance = (nextIdx, collName) => {
    const imgName = imagesRef.current[nextIdx];
    if (!imgName) return;

    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);
    
    if (cached && cached.img && cached.img.complete) {
      setTileAspectRatio(cached.aspectRatio || (cached.img.width / cached.img.height));
      setActiveIdx(nextIdx);
      resetProgressBar();
      setTimeout(() => setOutgoingIdx(null), 400);
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
        preloadCacheRef.current.set(cacheKey, { img, aspectRatio: finalAspectRatio });
        setTileAspectRatio(finalAspectRatio);
        setActiveIdx(nextIdx);
        resetProgressBar();
        setTimeout(() => setOutgoingIdx(null), 400);
        preloadImages(nextIdx + 1, PRELOAD_COUNT);
      };
      img.src = imgUrl;
    })
    .catch(() => {
      const img = new Image();
      img.onload = () => {
        const finalAspectRatio = img.width / img.height;
        preloadCacheRef.current.set(cacheKey, { img, aspectRatio: finalAspectRatio });
        setTileAspectRatio(finalAspectRatio);
        setActiveIdx(nextIdx);
        resetProgressBar();
        setTimeout(() => setOutgoingIdx(null), 400);
        preloadImages(nextIdx + 1, PRELOAD_COUNT);
      };
      img.src = imgUrl;
    });
  };

  const advanceSlide = (direction) => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;
    
    const currentIdx = activeIdxRef.current;
    setOutgoingIdx(currentIdx);
    
    let nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;
    
    if (nextIdx >= currentImages.length) {
      const nextCollName = getNextUniqueCollection(1);
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
      }
      setActiveIdx(0);
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    } else if (nextIdx < 0) {
      const nextCollName = getNextUniqueCollection(-1);
      shouldStartFromLastRef.current = true;
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
      }
      setActiveIdx(0);
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    }
    
    preloadAndAdvance(nextIdx, currentCollNameVal);
  };

  const skipToNextCollection = (direction = 1) => {
    const nextCollName = getNextUniqueCollection(direction);
    setCurrentCollName(nextCollName);
    if (onCollectionChange) {
      onCollectionChange(tileId, nextCollName);
    }
    setActiveIdx(0);
    setOutgoingIdx(null);
    resetProgressBar();
  };

  // TOUCH GESTURE HANDLERS
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    setTouchStart({ x: t.clientX, y: t.clientY });
    setTouchDelta({ x: 0, y: 0 });
    setIsSwiping(true);
    setShowOverlay(true);
    if (overlayTimerRef.current) {
      clearTimeout(overlayTimerRef.current);
    }

    isLongPressTriggeredRef.current = false;
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
    
    longPressTimeoutRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if ("vibrate" in navigator) {
        try { navigator.vibrate(50); } catch (err) {}
      }
      skipToNextCollection(1); // 更换文件夹 (similar to PC middle-click)
      triggerOverlayBriefly(2500);
    }, 600); // 600ms long press threshold
  };

  const handleTouchMove = (e) => {
    if (!isSwiping || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    setTouchDelta({ x: dx, y: dy });
    setShowOverlay(true);

    // Cancel long-press if the user drags significantly
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (!isSwiping) return;
    setIsSwiping(false);
    triggerOverlayBriefly(2500);

    // Clean up long-press timer
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    // If long-press was triggered, exit early to avoid triggering taps or swipes
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }

    const thresholdX = 50; // swipe left/right trigger
    const thresholdY = 60; // swipe up/down trigger

    const adx = Math.abs(touchDelta.x);
    const ady = Math.abs(touchDelta.y);

    if (adx > thresholdX && adx > ady) {
      // Horizontal swipe: change image
      if (touchDelta.x > 0) {
        advanceSlide(-1); // swipe right -> prev
      } else {
        advanceSlide(1); // swipe left -> next
      }
    } else if (ady > thresholdY && ady > adx) {
      // Vertical swipe: change folder
      if (touchDelta.y > 0) {
        skipToNextCollection(-1); // swipe down -> prev folder
      } else {
        skipToNextCollection(1); // swipe up -> next folder
      }
    } else {
      // Tap (movement within bounds)
      const now = Date.now();
      const delay = now - lastTapRef.current;
      
      if (delay < 300) {
        // DOUBLE TAP -> local toggle play/pause
        setLocalIsPlaying(prev => !prev);
      }
      lastTapRef.current = now;
    }
  };

  const getImageUrl = (imgName) => {
    return `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;
  };

  // Precise grid layout parsing for mobile to ensure perfectly aligned centering shifts without boundary overflow
  let cols = 2;
  let rows = 1;
  let col = 0;
  let row = 0;

  if (totalTiles === 1) {
    cols = 1;
    rows = 1;
    col = 0;
    row = 0;
  } else if (totalTiles === 2) {
    cols = 1;
    rows = 2;
    col = 0;
    row = tileId;
  } else if (totalTiles === 3) {
    cols = 1;
    rows = 3;
    col = 0;
    row = tileId;
  } else if (totalTiles === 4) {
    cols = 2;
    rows = 2;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else if (totalTiles === 5) {
    // 5 tiles: Row 0 has 2, Row 1 has 2, Row 2 has 1 (spanning both columns)
    rows = 3;
    if (tileId < 4) {
      cols = 2;
      col = tileId % 2;
      row = Math.floor(tileId / 2);
    } else {
      cols = 1; // Treated as 1 column for horizontal centering (no shift)
      col = 0;
      row = 2;
    }
  } else if (totalTiles === 6) {
    cols = 2;
    rows = 3;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else if (totalTiles === 12) {
    cols = 2;
    rows = 6;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else {
    // Fallback logic
    cols = totalTiles === 2 ? 1 : 2;
    col = tileId % cols;
    row = Math.floor(tileId / cols);
    rows = Math.ceil(totalTiles / cols);
  }

  const shiftPercent = Math.abs(zoomScale - 1) * 50;

  // Mathematically precise linear shift interpolation to prevent outer boundary overflow
  const translateX = cols > 1 
    ? ((cols - 1 - 2 * col) / (cols - 1)) * shiftPercent 
    : 0;

  const translateY = rows > 1 
    ? ((rows - 1 - 2 * row) / (rows - 1)) * shiftPercent 
    : 0;

  if (collections.length === 0) {
    return (
      <div 
        className="mobile-card-container" 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          transform: `translate3d(${translateX}%, ${translateY}%, 0) scale(${zoomScale})`,
          width: '100%',
          height: '100%'
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>无图片集</span>
      </div>
    );
  }

  const activeImgName = images[activeIdx];
  const progressPercent = isPlaying ? 100 : 0;

  const maskStyle = intersections && intersections.length > 0
    ? {
        maskImage: `url(#mobile-tile-mask-${tileId})`,
        WebkitMaskImage: `url(#mobile-tile-mask-${tileId})`
      }
    : {};

  return (
    <>
      <div 
        className={`mobile-card-container ${isSingle ? 'single-tile' : ''} ${showOverlay ? 'show-overlay' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          // Apply centering offset to prevent screen overflow, while supporting smooth physical swipe dragging
          transform: isSwiping 
            ? `translate3d(${translateX}%, ${translateY}%, 0) scale(${0.99 * zoomScale}) translate3d(${touchDelta.x * 0.15}px, ${touchDelta.y * 0.15}px, 0)` 
            : `translate3d(${translateX}%, ${translateY}%, 0) scale(${zoomScale})`,
          zIndex: showOverlay ? 10 : 1,
          width: '100%',
          height: '100%',
          transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          ...maskStyle
        }}
      >
        {/* Swipe instruction overlay for user education */}
        <div className="mobile-swipe-badge">
          {images.length > 0 ? `${activeIdx + 1} / ${images.length}` : '0 / 0'} 
          {!localIsPlaying && ' ⏸'}
        </div>

        {/* Collection Name badge */}
        <div 
          className="mobile-card-folder-badge"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (onTitleClick) {
              onTitleClick(currentCollName);
            }
          }}
        >
          📁 {currentCollName}
        </div>

        {/* Image Display */}
        <div className="mobile-card-media-wrapper">
          {isLoadingImages ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 24,
                height: 24,
                border: '2px solid rgba(139, 92, 246, 0.1)',
                borderTopColor: 'var(--accent-purple)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>正在扫描...</span>
            </div>
          ) : loadError ? (
            <div style={{ color: '#ef4444', fontSize: '0.65rem', padding: 8, textAlign: 'center' }}>
              <p>{loadError}</p>
            </div>
          ) : images.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textAlign: 'center' }}>
              <p>暂无图片</p>
            </div>
          ) : (
            images.map((imgName, index) => {
              const isActive = index === activeIdx;
              const isOutgoing = index === outgoingIdx;
              if (!isActive && !isOutgoing) return null;

              return (
                <div
                  key={imgName}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isActive ? 1 : 0,
                    transition: transitionEffect === 'fade' ? 'opacity 0.4s ease-in-out' : 'none',
                    zIndex: isActive ? 2 : 1
                  }}
                >
                  {/* Aspect Ratio Blurred Background */}
                  <img
                    src={getImageUrl(imgName)}
                    alt=""
                    className="mobile-card-blur-bg"
                  />
                  {/* Sharp Foreground Image */}
                  <img
                    src={getImageUrl(imgName)}
                    alt={imgName}
                    loading="lazy"
                    className="mobile-card-image"
                    style={{
                      transform: isSwiping 
                        ? `translateX(${touchDelta.x * 0.4}px)` 
                        : 'translateX(0px)',
                      transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Progress Bar indicator (Top-edge glowing lines) */}
        {isPlaying && !progressBarReset && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: '3px',
            background: 'var(--accent-gradient)',
            boxShadow: 'var(--accent-glow)',
            width: '100%',
            transformOrigin: 'left',
            animation: `mobileProgress ${barDuration}ms linear forwards`,
            zIndex: 10
          }} />
        )}
      </div>

      {/* Inject custom animation styles for progress indicator */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes mobileProgress {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </>
  );
}
