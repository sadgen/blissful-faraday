import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, X, ChevronRight, ChevronLeft, Maximize2, Minimize2, Settings, Shuffle, UserCheck, UserX } from 'lucide-react';
import { isVideoFile, getImageDimensions, prettyCollectionName, accountOf } from '../utils/imageHelpers';

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
  intersections = [],
  isSyncMode,
  syncTrigger,
  videoSpeed,
  imageSort = 'name',
  fetchCollections,
  onRequestNextCollection,
  onQueueDelete,
  accountFilter = [],
  onSelectAccount,
  personFilter = '-',
}) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [images, setImages] = useState([]);
  // images 数组归属的图集名：切集加载期间旧图继续显示，URL 须用旧集名
  const [imagesColl, setImagesColl] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [localIsPlaying, setLocalIsPlaying] = useState(true);
  const [localSpeedMult, setLocalSpeedMult] = useState(1);
  const [localTransitionEffect, setLocalTransitionEffect] = useState('');
  const [progressBarReset, setProgressBarReset] = useState(false);
  // Overlay controls
  const [collectionInfo, setCollectionInfo] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  // Instagram 帖子索引：filename -> { postNo, totalPosts, caption }；非 IG 图集为 null
  const [postIndex, setPostIndex] = useState(null);
  const [personMeta, setPersonMeta] = useState({});
  const [isTogglingPerson, setIsTogglingPerson] = useState(false);
  const videoFileNamesRef = useRef(new Set());
  const videoFileNames = videoFileNamesRef.current;
  
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

  // Fetch collection info (username + full_name) & person meta
  useEffect(() => {
    if (!currentCollName) {
      setCollectionInfo(null);
      setPersonMeta({});
      return;
    }
    let cancelled = false;
    fetch(`/api/collection/info?collection=${encodeURIComponent(currentCollName)}`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setCollectionInfo(data); })
      .catch(() => { if (!cancelled) setCollectionInfo(null); });
    fetch(`/api/person/meta?collection=${encodeURIComponent(currentCollName)}`)
      .then(res => res.json())
      .then(data => { if (!cancelled && data && data.media) setPersonMeta(data.media); })
      .catch(() => { if (!cancelled) setPersonMeta({}); });
    return () => { cancelled = true; };
  }, [currentCollName]);

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  const timerRef = useRef(null);
  const staggerTimeoutRef = useRef(null);
  const staggerAppliedRef = useRef(false);
  const shouldStartFromLastRef = useRef(false);
  const prevSyncTriggerRef = useRef(syncTrigger);
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
    outgoingTimerRef.current = setTimeout(() => setOutgoingIdx(null), 400);
  }, [clearOutgoingTimer]);

  // Preload cache for faster image switching
  const preloadCacheRef = useRef(new Map());
  const PRELOAD_COUNT = 3;

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
  useEffect(() => { imagesCollRef.current = imagesColl; }, [imagesColl]);
  useEffect(() => { currentCollNameRef.current = currentCollName; }, [currentCollName]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);
  useEffect(() => { displayedCollectionsRef.current = displayedCollections; }, [displayedCollections]);
  useEffect(() => { sortMethodRef.current = sortMethod; }, [sortMethod]);
  
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  // 同步 ref：advanceSlide 需要在事件瞬间读取加载状态
  const isLoadingRef = useRef(false);
  const applyLoadingState = (v) => { isLoadingRef.current = v; setIsLoadingImages(v); };
  // 切集边界垫底层：换集那一帧旧容器整体卸载，垫住新图挂载解码空档防闪黑
  const [holdFrame, setHoldFrame] = useState(null);
  const holdTimerRef = useRef(null);
  const showHoldFrame = (coll, name) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    setHoldFrame({ coll, name });
    holdTimerRef.current = setTimeout(() => setHoldFrame(null), 2500);
  };
  // 在途的下一张推进：同 key 在途即等待，不重复发请求（多窗口挤占连接池时
  // 重复发+完成乱序会把窗口卡在旧帧上）
  const pendingAdvanceRef = useRef(null);
  const imagesCollRef = useRef('');
  const [loadError, setLoadError] = useState('');

  // Sync with parent's initialCollectionName prop when it changes
  useEffect(() => {
    if (initialCollectionName) {
      setCurrentCollName(initialCollectionName);
    }
  }, [initialCollectionName]);

  // Detect aspect ratio of image
  const detectAspectRatio = (collName, imgName) => {
    // P2: reuse cached aspectRatio from preloadCacheRef — skip the range fetch entirely
    const cacheKey = `${collName}:${imgName}`;
    const cached = preloadCacheRef.current.get(cacheKey);
    if (cached && cached.aspectRatio) {
      setTileAspectRatio(cached.aspectRatio);
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
      detectAspectRatio(imagesColl || currentCollName, images[activeIdx]);
    }
  }, [activeIdx, currentCollName, imagesColl, images.length]);

  // Fetch images when directory changes
  useEffect(() => {
    if (!currentCollName) {
      setImages([]);
      setImagesColl('');
      setHoldFrame(null);
      setTileAspectRatio(null);
      return;
    }

    const fetchImages = async () => {
      // 15s 硬超时：目录请求挂死会让 isLoadingRef 永远为 true，推进守卫冻结窗口
      let timedOut = false;
      let timeoutId = null;
      try {
        applyLoadingState(true);
        setLoadError('');
        const controller = new AbortController();
        timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
        const pParam = personFilter !== '-' ? `&person=${encodeURIComponent(personFilter)}` : '';
        const res = await fetch(`/api/collection/images?collection=${encodeURIComponent(currentCollName)}&sort=${imageSort}${pParam}`, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`加载目录失败: ${res.statusText}`);
        }
        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        let newImages = data.images || [];

        // Instagram 帖子结构：按 帖子时间倒序 + 帖内 carousel 顺序 重排，普通图集不变
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
        } catch { /* 帖子接口不可用：退回默认排序 */ }

        // Detect video files
        const videoExts = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv']);
        videoFileNames.clear();
        newImages.forEach(name => {
          const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
          if (videoExts.has(ext)) videoFileNames.add(name);
        });

        // Preload first image before switching (prevents black flash)
        const applyImages = () => {
          if (timeoutId) clearTimeout(timeoutId);
          // 换集瞬间旧容器整体卸载：先把旧集当前帧留作垫底，盖住新 img 挂载解码空档
          const prevName = imagesRef.current[activeIdxRef.current];
          const prevColl = imagesCollRef.current;
          if (prevName && prevColl && prevColl !== currentCollName && !isVideoFile(prevName)) {
            showHoldFrame(prevColl, prevName);
          } else {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
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
          restartAutoChain();
          if (newImages.length > 0) {
            detectAspectRatio(currentCollName, newImages[0]);
            setTimeout(() => preloadImages(startIdx + 1, PRELOAD_COUNT), 1000);
          }
        };

        if (newImages.length > 0) {
          const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(newImages[0])}`;
          const preloadImg = new Image();
          // 首图 15s 仍未就绪就直接切换（宁可显示加载中的图也不冻结窗口）
          let settled = false;
          const applyOnce = () => { if (!settled) { settled = true; applyImages(); } };
          const imgFallback = setTimeout(() => applyOnce(), 15000);
          preloadImg.onload = () => { clearTimeout(imgFallback); applyOnce(); };
          preloadImg.onerror = () => { clearTimeout(imgFallback); applyOnce(); };
          preloadImg.src = imgUrl;
        } else {
          applyImages();
        }
      } catch (err) {
        if (err && err.name === 'AbortError') {
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
      // 在途推进的 nextIdx 属于旧集：换集即作废，防止其完成时把旧下标套到新集上
      if (pendingAdvanceRef.current) {
        try { pendingAdvanceRef.current.controller.abort(); } catch {}
        pendingAdvanceRef.current = null;
      }
    };
  }, [currentCollName, imageSort, personFilter]);

  // C1: stable callback — read latest values via refs, no stale closure
  // NOTE: must be declared BEFORE the useEffect hooks below that reference it
  // in their dependency arrays (TDZ: dep arrays are evaluated at render time).
  const selectRandomCollection = useCallback(() => {
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
  }, [tileId, onCollectionChange]);

  // Initial assignment
  useEffect(() => {
    if (collections.length > 0 && !currentCollName && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [collections, currentCollName, initialCollectionName, selectRandomCollection]);

  // Handle global refresh trigger
  useEffect(() => {
    if (collections.length > 0 && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [globalRefreshTrigger, initialCollectionName, selectRandomCollection]);

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
        if (!otherDisplayedColls.includes(candidate) && candidate !== currentCollNameVal) {
          return candidate;
        }
      }
      const fallbackIdx = (currentIdxInCollections + direction + allColls.length) % allColls.length;
      return allColls[fallbackIdx];
    }
    return allColls[0];
  };

  const duration = globalSpeed / localSpeedMult;
  // Single-image collections still auto-advance as long as another collection exists to rotate into
  const hasNextTarget = images.length > 1 || collections.length > 1;
  // 当前是视频时暂停计时切换，由视频 onEnded 播完再推进（与桌面一致，长视频不被掐断）
  const activeName = images[activeIdx];
  const isCurrentVideo = !!activeName && (isVideoFile(activeName) || videoFileNames.has(activeName));
  const isPlaying = globalIsPlaying && localIsPlaying && images.length > 0 && hasNextTarget && !isCurrentVideo;

  const resetProgressBar = () => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  };

  // 切换重锚：自动轮播间隔从"上一次实际切换"起算。旧实现固定 interval 心跳
  // 与"加载完成即切换"双驱动脱节，迟到的切换会被紧跟的 tick 立刻切走
  // （1~2 秒间隔下图片只显示零点几秒）。每次实际切换后重启 interval，
  // 结构上保证每张至少显示完整设定时长，网络慢时宁长勿闪。
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const isPlayingRef = useRef(false);
  isPlayingRef.current = globalIsPlaying && localIsPlaying;
  const isSyncModeRef = useRef(isSyncMode);
  isSyncModeRef.current = isSyncMode;
  const advanceSlideRef = useRef(null);
  const restartAutoChain = () => {
    if (isSyncModeRef.current || !isPlayingRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;
      if (advanceSlideRef.current) advanceSlideRef.current(1);
    }, durationRef.current);
  };

  useEffect(() => {
    if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(duration);
    }
  }, [duration, totalTiles]);

  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, duration, totalTiles, syncTrigger]);

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

    // Sync mode: parent drives all tiles via syncTrigger
    if (isSyncMode) {
      const isSyncTick = syncTrigger !== prevSyncTriggerRef.current;
      prevSyncTriggerRef.current = syncTrigger;
      if (isSyncTick && isPlaying && activeIdx >= 0 && imagesRef.current.length > 0) {
        advanceSlide(1);
      }
      return;
    }

    // Async mode：固定间隔 tick 推进；实际切换发生时 restartAutoChain 已把
    // 间隔重锚到切换时刻。没切换（加载在途/目录加载中）时本次 tick 为空转，
    // 下个 tick 继续——不会提前切走任何画面。
    if (isPlaying) {
      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        setBarDuration(staggerDelay);
        resetProgressBar();

        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlide(1);
          setBarDuration(duration);

          timerRef.current = setInterval(() => {
            if (!isPlayingRef.current) return;
            advanceSlide(1);
          }, duration);
        }, staggerDelay);
      } else {
        setBarDuration(duration);
        timerRef.current = setInterval(() => {
          if (!isPlayingRef.current) return;
          advanceSlide(1);
        }, duration);
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [isSyncMode, syncTrigger, isPlaying, duration, totalTiles, tileId, globalSpeed]);

  // C3: clear pending outgoingIdx timer on unmount
  useEffect(() => clearOutgoingTimer, [clearOutgoingTimer]);

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

  const preloadAndAdvance = (nextIdx, collName, outgoingIdx) => {
    const imgName = imagesRef.current[nextIdx];
    if (!imgName) return;

    // 视频没法用 Image() 预加载：直接切换（缺失此分支会让"切到视频"永远完不成而卡住）
    if (isVideoFile(imgName) || videoFileNames.has(imgName)) {
      pendingAdvanceRef.current = null;
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      resetProgressBar();
      restartAutoChain();
      scheduleOutgoingClear();
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
      resetProgressBar();
      restartAutoChain();
      scheduleOutgoingClear();
      preloadImages(nextIdx + 1, PRELOAD_COUNT);
      return;
    }

    // 同一张已在途：不重发（多窗口挤占连接池时重复发只会堆积 + 完成乱序串号）
    if (pendingAdvanceRef.current && pendingAdvanceRef.current.key === cacheKey) return;

    const imgUrl = `/api/image?collection=${encodeURIComponent(collName)}&name=${encodeURIComponent(imgName)}`;
    const controller = new AbortController();
    pendingAdvanceRef.current = { key: cacheKey, controller };
    const myKey = cacheKey;

    // 图片就绪后的切换动作。图片本体始终写入缓存；状态更新只在本次推进
    // 仍是最新一次时执行（防旧响应把旧下标套到已切换的画面上）
    const applySwitch = (img, ratio) => {
      const isLatest = pendingAdvanceRef.current && pendingAdvanceRef.current.key === myKey;
      if (isLatest) pendingAdvanceRef.current = null;
      preloadCacheRef.current.set(cacheKey, { img, aspectRatio: ratio });
      if (!isLatest) return;
      setTileAspectRatio(ratio);
      if (outgoingIdx !== undefined) setOutgoingIdx(outgoingIdx);
      setActiveIdx(nextIdx);
      resetProgressBar();
      restartAutoChain();
      scheduleOutgoingClear();
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
      const aspectRatio = dimensions ? dimensions.width / dimensions.height : null;
      if (aspectRatio && pendingAdvanceRef.current && pendingAdvanceRef.current.key === myKey) {
        setTileAspectRatio(aspectRatio);
      }
      loadFull();
    })
    .catch(() => {
      if (controller.signal.aborted) return; // 切集中断：新集的加载流程已接管
      loadFull();
    });
  };

  const advanceSlide = (direction) => {
    // 下一图集还在加载中：不推进，旧画面继续显示
    if (isLoadingRef.current) return;
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;

    const currentIdx = activeIdxRef.current;

    let nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;

    if (nextIdx >= currentImages.length) {
      let nextCollName = onRequestNextCollection ? onRequestNextCollection() : null;
      if (nextCollName === null || nextCollName === undefined) {
        nextCollName = getNextUniqueCollection(1);
      }
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
        if (displayedCollectionsRef.current) {
          displayedCollectionsRef.current = [...displayedCollectionsRef.current];
          displayedCollectionsRef.current[tileId] = nextCollName;
        }
      }
      // 不重置 activeIdx：加载期间旧画面继续显示，避免闪黑
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    } else if (nextIdx < 0) {
      let nextCollName = onRequestNextCollection ? onRequestNextCollection() : null;
      if (nextCollName === null || nextCollName === undefined) {
        nextCollName = getNextUniqueCollection(-1);
      }
      shouldStartFromLastRef.current = true;
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
        if (displayedCollectionsRef.current) {
          displayedCollectionsRef.current = [...displayedCollectionsRef.current];
          displayedCollectionsRef.current[tileId] = nextCollName;
        }
      }
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    }

    preloadAndAdvance(nextIdx, currentCollNameVal, currentIdx);
  };
  // 切换重锚链需要经 ref 调用 advanceSlide（restartAutoChain 定义在其之前）
  advanceSlideRef.current = advanceSlide;

  const skipToNextCollection = (direction = 1) => {
    // Try the session-level remaining queue first (never-repeats)
    if (onRequestNextCollection) {
      const next = onRequestNextCollection();
      if (next) {
        setCurrentCollName(next);
        if (onCollectionChange) {
          onCollectionChange(tileId, next);
          if (displayedCollectionsRef.current) {
            displayedCollectionsRef.current = [...displayedCollectionsRef.current];
            displayedCollectionsRef.current[tileId] = next;
          }
        }
        // 不重置 activeIdx：加载期间旧画面继续显示，避免闪黑
        setOutgoingIdx(null);
        resetProgressBar();
        return;
      }
    }
    const nextCollName = getNextUniqueCollection(direction);
    setCurrentCollName(nextCollName);
    if (onCollectionChange) {
      onCollectionChange(tileId, nextCollName);
      if (displayedCollectionsRef.current) {
        displayedCollectionsRef.current = [...displayedCollectionsRef.current];
        displayedCollectionsRef.current[tileId] = nextCollName;
      }
    }
    setOutgoingIdx(null);
    resetProgressBar();
  };

  // 人像状态一键翻转（手机端）：是人像转非人像，非人像转人像（仅对该图生效）
  const handleTogglePerson = async (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (images.length === 0 || activeIdx < 0 || activeIdx >= images.length) return;
    const currentMediaName = images[activeIdx];
    const currentColl = currentCollName;
    if (!currentMediaName || !currentColl || isTogglingPerson) return;
    setIsTogglingPerson(true);
    try {
      const res = await fetch(`/api/person/toggle?collection=${encodeURIComponent(currentColl)}&name=${encodeURIComponent(currentMediaName)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data && data.success) {
        setPersonMeta(prev => ({
          ...prev,
          [currentMediaName]: { p: data.p, s: data.s, manual: true },
        }));
        // 联动：如果当前处于"是/否"过滤模式，翻转导致该图不符模式，立即移出播放并步进下一张
        const shouldEject = (personFilter === '1' && data.p === 0) || (personFilter === '0' && data.p === 1);
        if (shouldEject) {
          if (images.length <= 1) {
            skipToNextCollection(1);
          } else {
            preloadCacheRef.current.delete(`${currentColl}:${currentMediaName}`);
            setImages(prev => prev.filter(img => img !== currentMediaName));
            if (activeIdx >= images.length - 1) {
              setActiveIdx(Math.max(0, images.length - 2));
            }
            setOutgoingIdx(null);
            resetProgressBar();
          }
        }
      }
    } catch (err) {
      console.warn('Failed to toggle person status:', err);
    } finally {
      setIsTogglingPerson(false);
    }
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
    // 切集加载期间 currentCollName 已变，旧图必须按 imagesColl（旧集名）取
    return `/api/image?collection=${encodeURIComponent(imagesColl || currentCollName)}&name=${encodeURIComponent(imgName)}`;
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
          {(() => {
            const igAccount = accountOf(currentCollName);
            // IG 内容：账号名可点击 → 勾选/取消该账号（多选）；其余部分保持原 onTitleClick 行为
            if (igAccount && typeof onSelectAccount === 'function') {
              const active = Array.isArray(accountFilter) ? accountFilter.includes(igAccount) : accountFilter === igAccount;
              const rest = prettyCollectionName(currentCollName).replace(`@${igAccount}`, '');
              return (
                <>
                  📂{' '}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAccount(igAccount);
                    }}
                    title={active ? `取消勾选 @${igAccount}` : `勾选 @${igAccount}（可多选）`}
                    style={{
                      cursor: 'pointer',
                      textDecoration: 'underline dotted',
                      textUnderlineOffset: 2,
                      textDecorationColor: active ? '#d8b4fe' : 'rgba(255,255,255,0.4)',
                      color: active ? '#d8b4fe' : 'inherit',
                      fontWeight: active ? 'bold' : 'inherit',
                    }}
                  >
                    @{igAccount}{active ? ' ✓' : ''}
                  </span>
                  {rest}
                </>
              );
            }
            return <>📁 {prettyCollectionName(currentCollName)}</>;
          })()}
        </div>

        {/* ---- Overlay Controls (visible when showOverlay is true) ---- */}
        {showOverlay && (
          <>
            {/* Top action bar */}
            <div 
              className="mobile-overlay-top"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                zIndex: 20, padding: '6px 8px',
                background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
                display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: isPlaying ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                <div style={{ minWidth: 0, lineHeight: 1.1 }}>
                  {(() => {
                    const igAccount = accountOf(currentCollName);
                    const full = prettyCollectionName(currentCollName);
                    if (!(igAccount && typeof onSelectAccount === 'function')) {
                      return (
                        <div style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>
                          {full}
                        </div>
                      );
                    }
                    const active = Array.isArray(accountFilter) ? accountFilter.includes(igAccount) : accountFilter === igAccount;
                    const rest = full.replace(`@${igAccount}`, '');
                    return (
                      <div style={{ fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectAccount(igAccount);
                          }}
                          title={active ? `取消勾选 @${igAccount}` : `勾选 @${igAccount}（可多选）`}
                          style={{
                            cursor: 'pointer',
                            textDecoration: 'underline dotted',
                            textUnderlineOffset: 2,
                            textDecorationColor: active ? '#d8b4fe' : 'rgba(255,255,255,0.4)',
                            color: active ? '#d8b4fe' : '#fff',
                            fontWeight: active ? 'bold' : 'inherit',
                          }}
                        >
                          @{igAccount}{active ? ' ✓' : ''}
                        </span>
                        {rest}
                      </div>
                    );
                  })()}
                  {(() => {
                    const pinfo = postIndex && images[activeIdx] ? postIndex.get(images[activeIdx]) : null;
                    const secondLine = pinfo
                      ? `第 ${pinfo.postNo}/${pinfo.totalPosts} 帖${pinfo.caption ? ` · ${pinfo.caption}` : ''}`
                      : (collectionInfo?.full_name || '');
                    return secondLine && (
                      <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {secondLine}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.6)', marginRight: 4, flexShrink: 0 }}>
                {activeIdx + 1}/{images.length}
              </span>
              {/* 人像状态切换按钮（取代原删除按钮，仅对该图生效） */}
              {images.length > 0 && (() => {
                const curFile = images[activeIdx];
                const m = curFile ? personMeta[curFile] : null;
                const isP = m ? m.p === 1 : null;
                return (
                  <button
                    type="button"
                    className="tile-mini-btn"
                    onClick={handleTogglePerson}
                    onTouchStart={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    disabled={isTogglingPerson}
                    title={
                      isP === true
                        ? `当前已识别为人像${m?.manual ? '（已手动纠偏）' : ''}（点击转为非人像）`
                        : (isP === false
                            ? `当前为非人像${m?.manual ? '（已手动纠偏）' : ''}（点击转为人像）`
                            : '人像未识别（点击强制标记为人像）')
                    }
                    style={{
                      color: isP === true ? '#c084fc' : (isP === false ? '#94a3b8' : 'rgba(255,255,255,0.4)'),
                      background: isP === true ? 'rgba(168, 85, 247, 0.18)' : 'transparent',
                      border: isP === true ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  >
                    {isP === true ? <UserCheck size={13} /> : <UserX size={13} />}
                  </button>
                );
              })()}
              <button
                className="tile-mini-btn"
                onClick={() => setShowConfig(!showConfig)}
                title="本窗口设置"
                style={{ flexShrink: 0 }}
              >
                <Settings size={13} style={{ transform: showConfig ? 'rotate(45deg)' : 'none', transition: 'transform 0.3s' }} />
              </button>
            </div>

            {/* Config Panel */}
            {showConfig && (
              <div
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 44, right: 8, zIndex: 30,
                  background: 'rgba(10, 15, 26, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(12px)', borderRadius: 12,
                  padding: 12, width: 200, display: 'flex', flexDirection: 'column', gap: 10,
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
                }}
              >
                <div>
                  <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    更换图片集:
                  </label>
                  <select
                    className="glass-select"
                    value={currentCollName}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setCurrentCollName(newName);
                      if (onCollectionChange) onCollectionChange(tileId, newName);
                    }}
                    style={{ width: '100%', fontSize: '0.75rem' }}
                  >
                    {collections.map(name => (
                      <option key={name} value={name}>{prettyCollectionName(name)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    播放速度倍率:
                  </label>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {[0.5, 1, 1.5, 2].map(speed => (
                      <button
                        key={speed}
                        onClick={() => setLocalSpeedMult(speed)}
                        style={{
                          flex: 1, background: localSpeedMult === speed ? 'var(--accent-purple)' : 'rgba(255,255,255,0.06)',
                          border: 'none', color: '#fff', fontSize: '0.7rem', padding: '3px',
                          borderRadius: 4, cursor: 'pointer', transition: 'background 0.2s'
                        }}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                    过渡动画:
                  </label>
                  <select
                    className="glass-select"
                    value={localTransitionEffect}
                    onChange={(e) => setLocalTransitionEffect(e.target.value)}
                    style={{ width: '100%', fontSize: '0.75rem' }}
                  >
                    <option value="">跟随全局</option>
                    <option value="ken-burns">温和缩放</option>
                    <option value="fade">平滑渐变</option>
                    <option value="slide">滑入</option>
                    <option value="none">关闭动画</option>
                  </select>
                </div>
                <button
                  onClick={() => { setShowConfig(false); selectRandomCollection(); }}
                  className="glass-button"
                  style={{
                    width: '100%', padding: '5px', fontSize: '0.7rem',
                    justifyContent: 'center', background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }}
                >
                  <Shuffle size={11} /> 随机换一组
                </button>
              </div>
            )}

            {/* Bottom nav bar */}
            <div
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
                padding: '6px 12px',
                background: 'linear-gradient(0deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button className="tile-mini-btn" onClick={() => advanceSlide(-1)} title="上一张" style={{ padding: 4 }}>
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="tile-mini-btn"
                  onClick={() => setLocalIsPlaying(!localIsPlaying)}
                  title={localIsPlaying ? '暂停当前' : '播放当前'}
                  style={{ padding: 4 }}
                >
                  {localIsPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button className="tile-mini-btn" onClick={() => advanceSlide(1)} title="下一张" style={{ padding: 4 }}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div style={{
                fontSize: '0.6rem', color: 'rgba(255,255,255,0.5)',
                background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 4
              }}>
                {videoFileNames.has(images[activeIdx]) && <span>🎬</span>}
                <span>{localSpeedMult !== 1 ? `${localSpeedMult}x` : ''}</span>
              </div>
            </div>
          </>
        )}

        {/* Image Display */}
        <div className="mobile-card-media-wrapper">
          {/* 切集边界垫底帧：新集首图画出第一帧之前由旧集末帧兜底（z0，不可见成本） */}
          {holdFrame && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 1, zIndex: 0 }}>
              <img
                src={`/api/image?collection=${encodeURIComponent(holdFrame.coll)}&name=${encodeURIComponent(holdFrame.name)}`}
                alt=""
                decoding="sync"
                className="mobile-card-blur-bg"
              />
              <img
                src={`/api/image?collection=${encodeURIComponent(holdFrame.coll)}&name=${encodeURIComponent(holdFrame.name)}`}
                alt=""
                decoding="sync"
                className="mobile-card-image"
              />
            </div>
          )}
          {images.length === 0 ? (
            isLoadingImages ? (
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
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textAlign: 'center' }}>
                <p>暂无图片</p>
              </div>
            )
          ) : (
            images.map((imgName, index) => {
              const isActive = index === activeIdx;
              const isOutgoing = index === outgoingIdx;
              if (!isActive && !isOutgoing) return null;
              const isVideo = isVideoFile(imgName) || videoFileNames.has(imgName);

              return (
                <div
                  key={imgName}
                  className={`mobile-slide-wrap fx-${transitionEffect}${isActive ? ' is-active' : ''}${isOutgoing ? ' is-outgoing' : ''}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    // outgoing 保持可见并垫在 active 之下：新图/视频画出第一帧前由旧图兜底，不闪黑
                    opacity: 1,
                    zIndex: isActive ? 2 : 1
                  }}
                >
                  {isVideo ? (
                    isActive ? (
                      <video
                        ref={el => {
                          if (el) {
                            el.playbackRate = videoSpeed;
                            el.play().catch(() => {});
                          }
                        }}
                        src={getImageUrl(imgName)}
                        muted
                        autoPlay
                        playsInline
                        preload="auto"
                        onEnded={() => advanceSlide(1)}
                        onLoadedMetadata={(e) => {
                          e.target.playbackRate = videoSpeed;
                          e.target.play().catch(() => {});
                        }}
                        onCanPlay={(e) => {
                          e.target.play().catch(() => {});
                        }}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain'
                        }}
                      />
                    ) : null
                  ) : (
                    <>
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
                        decoding="sync"
                        className="mobile-card-image"
                        onError={() => {
                          // 文件已被删除/不存在：剔除出播放队列，卡在末尾则换下一图集
                          preloadCacheRef.current.delete(`${imagesColl || currentCollName}:${imgName}`);
                          setImages(prev => prev.filter(x => x !== imgName));
                          if (activeIdx >= images.length - 1) {
                            if (images.length <= 1) skipToNextCollection(1);
                            else setActiveIdx(Math.max(0, images.length - 2));
                          }
                        }}
                        style={{
                          transform: isSwiping
                            ? `translateX(${touchDelta.x * 0.4}px)`
                            : 'translateX(0px)',
                          transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                        }}
                      />
                    </>
                  )}
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


    </>
  );
}
