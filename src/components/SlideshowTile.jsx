import { useState, useEffect, useRef } from 'react';
import { Play, Pause, ChevronRight, ChevronLeft, Maximize2, Minimize2, Settings, Shuffle, HelpCircle } from 'lucide-react';

export default function SlideshowTile({
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
  onDragPositionChange,
  isOverlapping,
  intersections = []
}) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [images, setImages] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [localIsPlaying, setLocalIsPlaying] = useState(true);
  const [localSpeedMult, setLocalSpeedMult] = useState(1);
  const [localTransitionEffect, setLocalTransitionEffect] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [progressBarReset, setProgressBarReset] = useState(false);
  const [isWheelPaused, setIsWheelPaused] = useState(false);

  // Drag functionality state
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  const timerRef = useRef(null);
  const staggerTimeoutRef = useRef(null);
  const staggerAppliedRef = useRef(false);
  const lastWheelTimeRef = useRef(0);
  const shouldStartFromLastRef = useRef(false);
  const wheelPauseTimeoutRef = useRef(null);

  // Drag refs
  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });

  // Preload cache for faster image switching (LRU eviction)
  const preloadCacheRef = useRef(new Map());
  const PRELOAD_COUNT = 5; // Preload up to 5 images with LRU eviction

  // LRU-aware cache setter: deletes and re-sets to maintain access order
  const setCacheLRU = (cacheKey, value) => {
    const map = preloadCacheRef.current;
    if (map.has(cacheKey)) map.delete(cacheKey);
    map.set(cacheKey, value);
    if (map.size > PRELOAD_COUNT) {
      const oldest = map.keys().next().value;
      if (oldest) map.delete(oldest);
    }
  };

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

  // Reset drag position when layout refreshes/shuffles
  useEffect(() => {
    setDragPosition({ x: 0, y: 0 });
    positionRef.current = { x: 0, y: 0 };
    if (onDragPositionChange) {
      onDragPositionChange(tileId, { x: 0, y: 0 });
    }
  }, [globalRefreshTrigger, initialCollectionName, totalTiles, tileId]);

  // Sync refs with state values
  useEffect(() => {
    activeIdxRef.current = activeIdx;
  }, [activeIdx]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    currentCollNameRef.current = currentCollName;
  }, [currentCollName]);

  useEffect(() => {
    collectionsRef.current = collections;
  }, [collections]);

  useEffect(() => {
    displayedCollectionsRef.current = displayedCollections;
  }, [displayedCollections]);

  useEffect(() => {
    sortMethodRef.current = sortMethod;
  }, [sortMethod]);
  
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadError, setLoadError] = useState('');

  const tileRef = useRef(null);
  const [parentSize, setParentSize] = useState({ width: 0, height: 0 });

  // Cleanup temporary wheel pause timeout on unmount
  useEffect(() => {
    return () => {
      if (wheelPauseTimeoutRef.current) {
        clearTimeout(wheelPauseTimeoutRef.current);
      }
    };
  }, []);

  // Setup ResizeObserver to observe the parent element (.grid-cell)
  useEffect(() => {
    if (!tileRef.current) return;
    const parent = tileRef.current.parentNode;
    if (!parent) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setParentSize({ width, height });
      }
    });

    resizeObserver.observe(parent);
    
    // Initial size trigger
    const rect = parent.getBoundingClientRect();
    setParentSize({ width: rect.width, height: rect.height });

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Sync with parent's initialCollectionName prop when it changes
  useEffect(() => {
    if (initialCollectionName) {
      setCurrentCollName(initialCollectionName);
    }
  }, [initialCollectionName]);

  // Optimized: fetch headers first, then load full image
  const detectAspectRatio = (collName, imgName) => {
    const imgUrl = `/api/image?collection=${encodeURIComponent(collName)}&name=${encodeURIComponent(imgName)}`;
    
    // Step 1: Quick fetch for dimensions
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
      // Fallback to full image load
      const img = new Image();
      img.onload = () => {
        setTileAspectRatio(img.width / img.height);
      };
      img.src = imgUrl;
    });
  };

  // Detect aspect ratio of initial/first image
  useEffect(() => {
    if (images.length > 0 && activeIdx >= 0 && activeIdx < images.length) {
      detectAspectRatio(currentCollName, images[activeIdx]);
    }
  }, [activeIdx, currentCollName, images.length]);

  // Fetch images dynamically (lazy loading) when the active collection name changes
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
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('图片服务不可用 (非 JSON 响应)');
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
        
        // Detect aspect ratio of first image
        if (data.images && data.images.length > 0) {
          detectAspectRatio(currentCollName, data.images[0]);
          // Delay preloading the next image by 1.5 seconds to let the initial grid load instantly without network congestion
          setTimeout(() => preloadImages(startIdx + 1, PRELOAD_COUNT), 1500);
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

  // 1. Default/Random initial collection assignment (only if no prop is provided)
  useEffect(() => {
    if (collections.length > 0 && !currentCollName && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [collections, currentCollName, initialCollectionName]);

  // Handle global shuffle/refresh trigger
  useEffect(() => {
    // Only randomize if no initialCollectionName prop is passed
    if (collections.length > 0 && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [globalRefreshTrigger, initialCollectionName]);

  const getNextUniqueCollection = (direction) => {
    const allColls = collectionsRef.current;
    if (allColls.length <= 1) return currentCollNameRef.current;

    const currentCollNameVal = currentCollNameRef.current;

    // Get folders shown in OTHER tiles to avoid conflict
    const otherDisplayedColls = (displayedCollectionsRef.current || [])
      .filter((_, idx) => idx !== tileId);

    // 1. Pure random mode: pick a dynamic random unique folder every time
    if (sortMethodRef.current === 'random') {
      const candidates = allColls.filter(c => !otherDisplayedColls.includes(c) && c !== currentCollNameVal);
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
      const fallbackCandidates = allColls.filter(c => !otherDisplayedColls.includes(c));
      if (fallbackCandidates.length > 0) {
        return fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
      }
      const otherColls = allColls.filter(c => c !== currentCollNameVal);
      const listToPick = otherColls.length > 0 ? otherColls : allColls;
      return listToPick[Math.floor(Math.random() * listToPick.length)];
    }

    // 2. Sequential modes (name / date):
    const currentIdxInCollections = allColls.indexOf(currentCollNameVal);
    if (currentIdxInCollections !== -1) {
      for (let i = 1; i <= allColls.length; i++) {
        const nextIdx = (currentIdxInCollections + i * direction + allColls.length * i) % allColls.length;
        const candidate = allColls[nextIdx];
        if (!otherDisplayedColls.includes(candidate)) {
          return candidate;
        }
      }
      // Fallback: standard next folder
      const fallbackIdx = (currentIdxInCollections + direction + allColls.length) % allColls.length;
      return allColls[fallbackIdx];
    }
    return allColls[0];
  };

  const selectRandomCollection = () => {
    const allColls = collectionsRef.current;
    if (allColls.length === 0) return;

    // Get folders shown in OTHER tiles to avoid conflict
    const otherDisplayedColls = (displayedCollectionsRef.current || [])
      .filter((_, idx) => idx !== tileId);

    const candidates = allColls.filter(c => !otherDisplayedColls.includes(c));

    let chosenColl;
    if (candidates.length > 0) {
      chosenColl = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // Fallback: pick any random collection other than the current one if possible
      const otherColls = allColls.filter(c => c !== currentCollNameRef.current);
      const listToPick = otherColls.length > 0 ? otherColls : allColls;
      chosenColl = listToPick[Math.floor(Math.random() * listToPick.length)];
    }

    setCurrentCollName(chosenColl);
    if (onCollectionChange) {
      onCollectionChange(tileId, chosenColl);
    }
  };

  // Speed calculation: duration in milliseconds per slide
  // Global speed is the total cycle time for all windows to refresh once
  // Each window's interval = globalSpeed / totalTiles (staggered refresh)
  const duration = (globalSpeed / localSpeedMult);
  const isPlaying = globalIsPlaying && localIsPlaying && !isWheelPaused && images.length > 1;

  // Reset progress bar CSS animation helper
  const resetProgressBar = () => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  };

  // Sync barDuration with duration changes unless in stagger phase
  useEffect(() => {
    if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(duration);
    }
  }, [duration, totalTiles]);

  // Reset stagger applied ref when play state or duration or totalTiles changes
  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, duration, totalTiles]);

  // 2. Playback logic: Slide advancing with recursive setTimeout to avoid drift
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (staggerTimeoutRef.current) {
      clearTimeout(staggerTimeoutRef.current);
      staggerTimeoutRef.current = null;
    }

    let targetTime = Date.now() + duration;

    if (isPlaying) {
      const scheduleNext = () => {
        advanceSlide(1);
        resetProgressBar();
        const elapsed = Date.now() - targetTime;
        const nextDelay = Math.max(0, duration - elapsed);
        targetTime += duration;
        timerRef.current = setTimeout(scheduleNext, nextDelay);
      };

      // Stagger delay: distribute windows evenly across the global speed cycle
      // Each window starts at a different time so they refresh sequentially
      // All windows will refresh once within globalSpeed milliseconds
      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        // Set progress bar duration to the stagger delay for the first tick
        setBarDuration(staggerDelay);
        resetProgressBar();

        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlide(1);
          setBarDuration(duration);
          resetProgressBar();

          targetTime = Date.now() + duration;
          timerRef.current = setTimeout(scheduleNext, duration);
        }, staggerDelay);
      } else {
        // No stagger or stagger already applied
        setBarDuration(duration);
        targetTime = Date.now() + duration;
        timerRef.current = setTimeout(scheduleNext, duration);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [isPlaying, duration, totalTiles, tileId]);

  // Preload images ahead of time for faster switching
  // Optimized: Load directly via Image without redundant Range headers, saving massive bandwidth
  const preloadImages = (startIdx, count) => {
    const currentImages = imagesRef.current;
    if (currentImages.length <= 1) return;
    
    const cache = preloadCacheRef.current;
    
    for (let i = 0; i < count; i++) {
      const idx = (startIdx + i) % currentImages.length;
      const imgName = currentImages[idx];
      const cacheKey = `${currentCollName}:${imgName}`;
      
      // Skip if already cached
      if (cache.has(cacheKey)) continue;
      
      const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;
      
      const img = new Image();
      img.onload = () => {
        // Store in cache with its aspect ratio
        cache.set(cacheKey, { img, aspectRatio: img.width / img.height });
        
        // Keep cache size manageable
        if (cache.size > 5) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
      };
      img.src = imgUrl;
    }
  };

  // Pre-load image and get aspect ratio, then advance slide
  // Optimized: check cache first, then fetch if needed
  const preloadAndAdvance = (nextIdx, collName) => {
    const imgName = imagesRef.current[nextIdx];
    if (!imgName) return;

    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);
    
    // If cached, use immediately (both img and aspectRatio) — also bump LRU order
    if (cached && cached.img && cached.img.complete) {
      preloadCacheRef.current.delete(cacheKey);
      preloadCacheRef.current.set(cacheKey, cached);
      setTileAspectRatio(cached.aspectRatio || (cached.img.width / cached.img.height));
      setActiveIdx(nextIdx);
      resetProgressBar();
      setTimeout(() => setOutgoingIdx(null), 600);
      
      // Trigger preload for next images
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    // Not cached, fetch headers first for aspect ratio
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
      if (aspectRatio) {
        setTileAspectRatio(aspectRatio);
      }
      // Now load full image
      const img = new Image();
      img.onload = () => {
        const finalAspectRatio = img.width / img.height;
        setCacheLRU(cacheKey, { img, aspectRatio: finalAspectRatio });
        setTileAspectRatio(finalAspectRatio);
        setActiveIdx(nextIdx);
        resetProgressBar();
        setTimeout(() => setOutgoingIdx(null), 600);
        
        // Trigger preload for next images
        preloadImages(nextIdx + 1, PRELOAD_COUNT);
      };
      img.src = imgUrl;
    })
    .catch(() => {
      // Fallback: load full image directly
      const img = new Image();
      img.onload = () => {
        const finalAspectRatio = img.width / img.height;
        setCacheLRU(cacheKey, { img, aspectRatio: finalAspectRatio });
        setTileAspectRatio(finalAspectRatio);
        setActiveIdx(nextIdx);
        resetProgressBar();
        setTimeout(() => setOutgoingIdx(null), 600);
        
        preloadImages(nextIdx + 1, PRELOAD_COUNT);
      };
      img.src = imgUrl;
    });
  };

  // Parse image dimensions from buffer without full decode
  const getImageDimensions = (buffer) => {
    const bytes = new Uint8Array(buffer);
    
    // Check for JPEG (FF D8)
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xFF) break;
        const marker = bytes[offset + 1];
        // SOF markers contain dimensions
        if ((marker >= 0xC0 && marker <= 0xC3) || 
            (marker >= 0xC5 && marker <= 0xC7) ||
            (marker >= 0xC9 && marker <= 0xCB) ||
            (marker >= 0xCD && marker <= 0xCF)) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
          if (width > 0 && height > 0) {
            return { width, height };
          }
        }
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + length;
        if (length < 2 || offset >= bytes.length) break;
      }
    }
    
    // Check for PNG (89 50 4E 47)
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    
    // Check for GIF (47 49 46 38)
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      const width = bytes[6] | (bytes[7] << 8);
      const height = bytes[8] | (bytes[9] << 8);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }
    
    // Check for WebP (52 49 46 46 ... 57 42 50)
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      // Check for VP8 chunk
      if (bytes[11] === 0x57 && bytes[12] === 0x42 && bytes[13] === 0x50) {
        // Simple format
        const width = bytes[26] | (bytes[27] << 8) | ((bytes[28] & 0x7F) << 16);
        const height = bytes[28] | (bytes[29] << 8) | ((bytes[30] & 0x7F) << 16);
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    }
    
    return null;
  };

  // Skip to next collection directly (for middle-click)
  const skipToNextCollection = () => {
    const nextCollName = getNextUniqueCollection(1);
    setCurrentCollName(nextCollName);
    if (onCollectionChange) {
      onCollectionChange(tileId, nextCollName);
    }
    setActiveIdx(0);
    setOutgoingIdx(null);
  };

  // Middle-click handler to skip to next folder
  const handleMouseDown = (e) => {
    // Middle mouse button = 1
    if (e.button === 1) {
      e.preventDefault();
      skipToNextCollection();
      return;
    }
    
    // Left mouse button for drag
    if (e.button === 0) {
      // Ignore drag if clicking on interactive controls
      if (e.target.closest('button, select, option, input, svg, path')) {
        return;
      }
      e.preventDefault(); // Prevents browser text selection/ghost drag
      // Start drag from mouse down position
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      positionRef.current = { x: dragPosition.x, y: dragPosition.y };
      setIsDragging(true);
    }
  };

  // Mouse move handler for drag
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    
    const newX = positionRef.current.x + deltaX;
    const newY = positionRef.current.y + deltaY;
    
    setDragPosition({ x: newX, y: newY });
  };

  // Mouse up handler to end drag - keep the dragged position
  const handleMouseUp = (e) => {
    if (e.button === 0 && isDragging) {
      setIsDragging(false);
      // Update positionRef to keep the new position
      positionRef.current = { x: dragPosition.x, y: dragPosition.y };
      // Reset dragStartRef for next drag
      dragStartRef.current = { x: 0, y: 0 };
      
      if (onDragPositionChange) {
        onDragPositionChange(tileId, dragPosition);
      }
    }
  };

  // Mouse leave handler
  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
    }
    if (wheelPauseTimeoutRef.current) {
      clearTimeout(wheelPauseTimeoutRef.current);
      wheelPauseTimeoutRef.current = null;
    }
    setIsWheelPaused(false);
  };

  const advanceSlide = (direction) => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;
    
    const currentIdx = activeIdxRef.current;
    setOutgoingIdx(currentIdx);
    
    let nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;
    
    if (nextIdx >= currentImages.length) {
      // Finished the current folder, cycle to the next collection!
      const nextCollName = getNextUniqueCollection(1);
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
      }
      // Reset to first image - will load and get aspect ratio in useEffect
      setActiveIdx(0);
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    } else if (nextIdx < 0) {
      // Going backwards past 0: cycle to previous collection's last image!
      const nextCollName = getNextUniqueCollection(-1);
      shouldStartFromLastRef.current = true;
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
      }
      // Will be set to last image in fetchImages useEffect
      setActiveIdx(0);
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    }
    
    // Pre-load image first, then update aspect ratio and display
    preloadAndAdvance(nextIdx, currentCollNameVal);
  };

  // 2.5. Wheel scroll handler to navigate images (with throttle and autoplay pause)
  const handleWheel = (e) => {
    // Skip wheel if currently dragging
    if (isDragging) return;
    
    const now = Date.now();
    // Throttle to 1 slide per 150ms to prevent fast skipping
    if (now - lastWheelTimeRef.current < 150) {
      return;
    }
    
    // Ignore micro scrolls
    if (Math.abs(e.deltaY) < 10) {
      return;
    }

    // Temporarily pause autoplay if it's currently running
    if (localIsPlaying && globalIsPlaying) {
      setIsWheelPaused(true);
      if (wheelPauseTimeoutRef.current) {
        clearTimeout(wheelPauseTimeoutRef.current);
      }
      wheelPauseTimeoutRef.current = setTimeout(() => {
        setIsWheelPaused(false);
      }, 3000); // Resume autoplay after 3 seconds of scroll inactivity
    }

    lastWheelTimeRef.current = now;

    if (e.deltaY > 0) {
      advanceSlide(1); // Scroll down -> next
    } else {
      advanceSlide(-1); // Scroll up -> prev
    }
  };

  // Calculate aspect-ratio adapted width and height
  // Note: Parent container size is already calculated in App.jsx with proper overlap
  // So we just use 100% to fill the parent container
  const tileStyle = {
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  };

  // Drag transform style - always apply position to keep dragged position
  const dragTransform = dragPosition.x !== 0 || dragPosition.y !== 0
    ? { transform: `translate(${dragPosition.x}px, ${dragPosition.y}px)`, zIndex: 1000, cursor: isDragging ? 'grabbing' : 'grab' }
    : {};

  // Apply 50% opacity when dragging
  dragTransform.opacity = isDragging ? 0.5 : 1;
  dragTransform.mixBlendMode = 'lighten';

  // Apply overlap mask when not maximized, not dragging, and there are intersections
  const maskStyle = !isMaximized && !isDragging && intersections && intersections.length > 0
    ? {
        maskImage: `url(#tile-mask-${tileId})`,
        WebkitMaskImage: `url(#tile-mask-${tileId})`
      }
    : {};

  // Helper function for image URL
  const getImageUrl = (imgName) => {
    return `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;
  };

  const handleCollectionChange = (e) => {
    const nextCollName = e.target.value;
    setCurrentCollName(nextCollName);
    if (onCollectionChange) {
      onCollectionChange(tileId, nextCollName);
    }
    setActiveIdx(0);
    setOutgoingIdx(null);
  };

  if (collections.length === 0) {
    return (
      <div className="slideshow-tile" style={{ border: '1px dashed rgba(255,255,255,0.1)' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '16px' }}>
          <HelpCircle size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div>暂无图片集</div>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={tileRef}
      className={`slideshow-tile effect-${transitionEffect} ${isMaximized ? 'maximized' : ''} ${showConfig ? 'show-controls' : ''}`}
      style={{ ...tileStyle, ...dragTransform, ...maskStyle }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      
      {/* 1. Image Layers */}
      <div className="slide-image-wrapper" style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        width: '100%',
        height: '100%'
      }}>
        {isLoadingImages ? (
          <div style={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32,
              height: 32,
              border: '3px solid rgba(139, 92, 246, 0.1)',
              borderTopColor: 'var(--accent-purple)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>正在扫描图片...</span>

          </div>
        ) : loadError ? (
          <div style={{ zIndex: 3, color: '#ef4444', fontSize: '0.75rem', padding: '10px', textAlign: 'center' }}>
            <p>加载失败: {loadError}</p>
          </div>
        ) : images.length === 0 ? (
          <div style={{ zIndex: 3, color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
            <p>该文件夹中没有发现图片</p>
          </div>
        ) : (
          images.map((imgName, index) => {
            const isActive = index === activeIdx;
            const isOutgoing = index === outgoingIdx;
            const isVisible = isActive || isOutgoing;

            if (!isVisible) return null;

            return (
              <div
                key={imgName}
                className={`slide-image-container ${isActive ? 'active' : ''} ${isOutgoing ? 'outgoing' : ''}`}
              >
                <img
                  src={getImageUrl(imgName)}
                  alt={imgName}
                  loading="lazy"
                  decoding="async"
                  draggable="false"
                  className="slide-image-main"
                />
              </div>
            );
          })
        )}
      </div>

      {/* 2. Visual Playback Progress Bar */}
      {isPlaying && !progressBarReset && (
        <div
          className="tile-progress"
          style={{
            width: '100%',
            transition: `width ${barDuration}ms linear`
          }}
        />
      )}

      {/* 3. Floating UI Overlay */}
      <div className="tile-overlay">
        {/* Header: Title & Window Controls */}
        <div className="tile-header">
          <div className="tile-title">
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: isPlaying ? '#10b981' : '#f59e0b' }} />
            <span>{currentCollName || '选择图片集'}</span>
            <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>({activeIdx + 1}/{images.length})</span>
          </div>

          <div className="tile-controls-group">
            <button
              className="tile-mini-btn"
              onClick={() => setShowConfig(!showConfig)}
              title="本窗口设置"
            >
              <Settings size={14} style={{ transform: showConfig ? 'rotate(45deg)' : 'none', transition: 'transform 0.3s' }} />
            </button>
            <button
              className="tile-mini-btn"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "还原网格" : "最大化展示"}
            >
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>

        {/* Configuration Panel (Reveals overlay settings on button toggle) */}
        {showConfig && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '12px',
            background: 'rgba(10, 15, 26, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)',
            borderRadius: '12px',
            padding: '12px',
            width: '220px',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
          }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                更换图片集:
              </label>
              <select
                className="glass-select"
                value={currentCollName}
                onChange={handleCollectionChange}
                style={{ width: '100%', fontSize: '0.8rem' }}
              >
                {collections.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                播放速度倍率:
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0.5, 1, 1.5, 2].map(speed => (
                  <button
                    key={speed}
                    onClick={() => { setLocalSpeedMult(speed); resetProgressBar(); }}
                    style={{
                      flex: 1,
                      background: localSpeedMult === speed ? 'var(--accent-purple)' : 'rgba(255,255,255,0.06)',
                      border: 'none',
                      color: '#fff',
                      fontSize: '0.75rem',
                      padding: '4px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                过渡动画效果:
              </label>
              <select
                className="glass-select"
                value={localTransitionEffect}
                onChange={(e) => setLocalTransitionEffect(e.target.value)}
                style={{ width: '100%', fontSize: '0.8rem' }}
              >
                <option value="">跟随全局 ({globalTransitionEffect === 'ken-burns' ? '温和缩放' : globalTransitionEffect === 'fade' ? '平滑渐变' : globalTransitionEffect === 'slide' ? '滑入' : '关闭动画'})</option>
                <option value="ken-burns">温和缩放</option>
                <option value="fade">平滑渐变</option>
                <option value="slide">滑入</option>
                <option value="none">关闭动画 (立即切换)</option>
              </select>
            </div>

            <button
              onClick={() => { selectRandomCollection(); setShowConfig(false); }}
              className="glass-button"
              style={{
                width: '100%',
                padding: '6px',
                fontSize: '0.75rem',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}
            >
              <Shuffle size={12} /> 随机换一组
            </button>
          </div>
        )}

        {/* Footer: Slide Controls */}
        <div className="tile-footer">
          <div className="tile-controls-group">
            <button
              className="tile-mini-btn"
              onClick={() => advanceSlide(-1)}
              title="上一张"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="tile-mini-btn"
              onClick={() => setLocalIsPlaying(!localIsPlaying)}
              title={localIsPlaying ? "暂停当前" : "播放当前"}
            >
              {localIsPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button
              className="tile-mini-btn"
              onClick={() => advanceSlide(1)}
              title="下一张"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '10px' }}>
            {localSpeedMult !== 1 ? `${localSpeedMult}x 速度` : '正常速度'}
          </div>
        </div>
      </div>
    </div>
  );
}
