import { useState, useRef, useEffect, useCallback } from 'react';

export default function useSlideshowPlayback({
  tileId,
  collections,
  displayedCollections,
  images,
  activeIdx,
  setActiveIdx,
  outgoingIdx,
  setOutgoingIdx,
  globalSpeed,
  globalIsPlaying,
  globalTransitionEffect,
  sortMethod,
  totalTiles,
  initialCollectionName,
  currentCollName,
  setCurrentCollName,
  imagesRef,
  activeIdxRef,
  currentCollNameRef,
  collectionsRef,
  displayedCollectionsRef,
  sortMethodRef,
  onCollectionChange,
  // Cross-hook dependencies
  preloadAndAdvance,
  shouldStartFromLastRef,
  isSyncMode,
  syncTrigger,
  onRequestNextCollection,
  onStepBeforeStart,
  isLoadingRef,
  slideSwitchedRef,
}) {
  const [localIsPlaying, setLocalIsPlaying] = useState(true);
  const [localSpeedMult, setLocalSpeedMult] = useState(1);
  const [localTransitionEffect, setLocalTransitionEffect] = useState('');
  const [isWheelPaused, setIsWheelPaused] = useState(false);
  const [barDuration, setBarDuration] = useState(globalSpeed);
  const [progressBarReset, setProgressBarReset] = useState(false);

  const timerRef = useRef(null);
  const staggerTimeoutRef = useRef(null);
  const staggerAppliedRef = useRef(false);
  const lastWheelTimeRef = useRef(0);
  const wheelPauseTimeoutRef = useRef(null);
  const prevSyncTriggerRef = useRef(syncTrigger);
  // 切换锚定：自动轮播的间隔从"上一次实际切换"起算，而不是固定心跳。
  // 旧实现定时器按固定周期空转、图片却在"加载完成事件"里随机时刻切换，
  // 迟到的切换会被很快到来的下一个 tick 立刻切走（1~2 秒间隔下图片只显示
  // 零点几秒）。现在每次实际切换都重启计时链，结构上保证每张至少显示
  // 完整设定时长；网络慢时宁长勿闪，预载跟得上时节奏精准。
  const switchCountRef = useRef(0);
  const durationRef = useRef(globalSpeed / 1);
  durationRef.current = globalSpeed / Math.max(0.1, localSpeedMult);
  const isPlayingRef = useRef(false);
  isPlayingRef.current = globalIsPlaying && localIsPlaying && !isWheelPaused;
  const isSyncModeRef = useRef(isSyncMode);
  isSyncModeRef.current = isSyncMode;
  const tickRef = useRef(null);

  // 重锚自动推进链：清掉现有定时，从现在起算一个完整间隔后推进
  const scheduleChain = useCallback((delay) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { tickRef.current && tickRef.current(); }, delay);
  }, []);

  // 实际切换完成回调（由 useImagePreloader 在每个真实切换点调用）
  const handleSlideSwitched = useCallback(() => {
    switchCountRef.current++;
    resetProgressBarRef.current();
    // 同步模式由父级 tick 统一驱动，不单独重锚；暂停时不排程
    if (!isSyncModeRef.current && isPlayingRef.current) {
      scheduleChain(durationRef.current);
    }
  }, [scheduleChain]);
  if (slideSwitchedRef) slideSwitchedRef.current = handleSlideSwitched;

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  // Detect if current slide is a video
  const isCurrentVideo = images.length > 0 && activeIdx >= 0 && activeIdx < images.length
    ? /\.(mp4|webm)$/i.test(images[activeIdx] || '')
    : false;

  // If current slide is a video, don't auto-advance (video onended drives it,
  // including the only video of a collection — playback end advances the tile)
  // Single-image collections still auto-advance as long as another collection exists to rotate into
  const duration = globalSpeed / localSpeedMult;
  const hasNextTarget = images.length > 1 || collections.length > 1;
  const isPlaying = globalIsPlaying && localIsPlaying && !isWheelPaused && images.length > 0 && hasNextTarget && !isCurrentVideo;

  const resetProgressBar = useCallback(() => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  }, []);

  const resetProgressBarRef = useRef(resetProgressBar);
  resetProgressBarRef.current = resetProgressBar;

  // Cleanup wheel pause timeout on unmount
  useEffect(() => {
    return () => {
      if (wheelPauseTimeoutRef.current) clearTimeout(wheelPauseTimeoutRef.current);
    };
  }, []);

  // Sync barDuration — in sync mode, always match globalSpeed regardless of localSpeedMult
  useEffect(() => {
    if (isSyncMode) {
      setBarDuration(globalSpeed);
    } else if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(duration);
    }
  }, [isSyncMode, globalSpeed, duration, totalTiles]);

  // Reset stagger flag when play state / duration / totalTiles changes
  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, duration, totalTiles, syncTrigger]);

  // --- Collection navigation ---

  const getNextUniqueCollection = useCallback((direction) => {
    const allColls = collectionsRef.current;
    if (allColls.length <= 1) return currentCollNameRef.current;

    const currentCollNameVal = currentCollNameRef.current;
    const otherDisplayedColls = (displayedCollectionsRef.current || [])
      .filter((_, idx) => idx !== tileId);

    // Random mode
    if (sortMethodRef.current === 'random') {
      const candidates = allColls.filter(c => !otherDisplayedColls.includes(c) && c !== currentCollNameVal);
      if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
      const fb = allColls.filter(c => !otherDisplayedColls.includes(c));
      if (fb.length > 0) return fb[Math.floor(Math.random() * fb.length)];
      const others = allColls.filter(c => c !== currentCollNameVal);
      const pool = others.length > 0 ? others : allColls;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // Sequential modes (name / date)
    const currentIdx = allColls.indexOf(currentCollNameVal);
    if (currentIdx !== -1) {
      for (let i = 1; i <= allColls.length; i++) {
        const nextIdx = (currentIdx + i * direction + allColls.length * i) % allColls.length;
        const candidate = allColls[nextIdx];
        if (!otherDisplayedColls.includes(candidate) && candidate !== currentCollNameVal) {
          return candidate;
        }
      }
      return allColls[(currentIdx + direction + allColls.length) % allColls.length];
    }
    return allColls[0];
  }, [tileId]);

  // --- advanceSlide ---

  const advanceSlide = useCallback((direction) => {
    // 下一图集还在加载中：不推进（避免 timer/滚轮/视频 onEnded 在加载期间
    // 重复消耗图集队列）；旧画面此刻仍显示在瓦片上
    if (isLoadingRef && isLoadingRef.current) return;
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;

    const currentIdx = activeIdxRef.current;

    const nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;

    // Reached end of collection -> cycle to next
    // 注意：不重置 activeIdx —— 加载期间旧 images 数组仍显示，保持当前帧无缝过渡，
    // 新集首图就绪后由 applyImages 设置真正的起始下标
    if (nextIdx >= currentImages.length) {
      // Try session-level remaining queue first
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
      setOutgoingIdx(null);
      return;
    }

    // Reached start of collection (going backward) -> replay playback history
    // 向上滚到第一张时回退到"上一个播放过的画面"（可跨图集，由瓦片接播放历史）。
    // 不再走"随机换一个图集"的旧逻辑——那会被误认为"向前滚却跳出随机新帖"。
    // 没有可回退的历史时停在原地
    if (nextIdx < 0) {
      if (onStepBeforeStart && onStepBeforeStart()) return;
      return;
    }

    // Normal advance: use preloadAndAdvance from useImagePreloader
    preloadAndAdvance(nextIdx, currentCollNameVal, currentIdx);
  }, [activeIdx, imagesRef, currentCollNameRef, setOutgoingIdx,
      getNextUniqueCollection, setCurrentCollName, onCollectionChange,
      tileId, setActiveIdx, preloadAndAdvance,
      displayedCollectionsRef, onRequestNextCollection, onStepBeforeStart]);

  const advanceSlideRef = useRef(advanceSlide);
  advanceSlideRef.current = advanceSlide;

  // --- Wheel handler ---

  const handleWheel = useCallback((e) => {
    if (Math.abs(e.deltaY) < 10) return;

    const now = Date.now();
    if (now - lastWheelTimeRef.current < 150) return;

    if (localIsPlaying && globalIsPlaying) {
      setIsWheelPaused(true);
      if (wheelPauseTimeoutRef.current) clearTimeout(wheelPauseTimeoutRef.current);
      wheelPauseTimeoutRef.current = setTimeout(() => setIsWheelPaused(false), 3000);
    }

    lastWheelTimeRef.current = now;
    advanceSlide(e.deltaY > 0 ? 1 : -1);
  }, [localIsPlaying, globalIsPlaying, advanceSlide]);

  // --- skipToNextCollection ---

  const skipToNextCollection = useCallback(() => {
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
        return;
      }
    }
    const nextCollName = getNextUniqueCollection(1);
    setCurrentCollName(nextCollName);
    if (onCollectionChange) {
      onCollectionChange(tileId, nextCollName);
      // Immediately update ref so rapid consecutive clicks see the change
      if (displayedCollectionsRef.current) {
        displayedCollectionsRef.current = [...displayedCollectionsRef.current];
        displayedCollectionsRef.current[tileId] = nextCollName;
      }
    }
    setOutgoingIdx(null);
  }, [getNextUniqueCollection, setCurrentCollName, onCollectionChange, tileId, setOutgoingIdx, displayedCollectionsRef, onRequestNextCollection]);

  // --- selectRandomCollection ---

  const selectRandomCollection = useCallback(() => {
    const allColls = collectionsRef.current;
    if (allColls.length === 0) return;
    const others = (displayedCollectionsRef.current || []).filter((_, idx) => idx !== tileId);
    const candidates = allColls.filter(c => !others.includes(c));
    let chosen;
    if (candidates.length > 0) {
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      const nonCurrent = allColls.filter(c => c !== currentCollNameRef.current);
      chosen = (nonCurrent.length > 0 ? nonCurrent : allColls)[Math.floor(Math.random() * (nonCurrent.length || allColls.length))];
    }
    setCurrentCollName(chosen);
    if (onCollectionChange) {
      onCollectionChange(tileId, chosen);
      if (displayedCollectionsRef.current) {
        displayedCollectionsRef.current = [...displayedCollectionsRef.current];
        displayedCollectionsRef.current[tileId] = chosen;
      }
    }
  }, [tileId, setCurrentCollName, onCollectionChange, displayedCollectionsRef]);

  // --- Initial collection selection ---

  useEffect(() => {
    if (collections.length > 0 && !currentCollName && !initialCollectionName) {
      selectRandomCollection();
    }
  }, [collections, currentCollName, initialCollectionName, selectRandomCollection]);

  // --- Staggered playback chain (re-anchored on every actual switch) ---

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (staggerTimeoutRef.current) { clearTimeout(staggerTimeoutRef.current); staggerTimeoutRef.current = null; }

    // Sync mode: parent drives all tiles via syncTrigger
    if (isSyncMode) {
      const isSyncTick = syncTrigger !== prevSyncTriggerRef.current;
      prevSyncTriggerRef.current = syncTrigger;
      if (isSyncTick && isPlaying && activeIdx >= 0 && imagesRef.current.length > 0) {
        if (isLoadingRef && isLoadingRef.current) {
          // 下一图集加载中：回滚 ref，本 tick 不丢失，加载完成后的下一个 tick 照常推进
          prevSyncTriggerRef.current = syncTrigger - 1;
        } else {
          advanceSlideRef.current(1);
        }
      } else if (isSyncTick && !isPlaying) {
        // Images not ready (or wheel-paused) — roll back the ref so the
        // pending tick isn't lost. When isPlaying flips true, this effect
        // re-runs and advances the tile (avoids permanently stuck tiles).
        prevSyncTriggerRef.current = syncTrigger - 1;
      }
      return;
    }

    // Async mode：tick 推进一次；实际切换发生时 handleSlideSwitched 已把链
    // 重锚到"切换时刻+完整间隔"。没切换（加载在途/目录加载中）时短轮询等
    // 待，真正的切换完成后自然回到满间隔节奏。
    const tick = () => {
      if (!isPlayingRef.current) return;
      const before = switchCountRef.current;
      advanceSlideRef.current(1);
      if (switchCountRef.current === before) {
        scheduleChain(300);
      }
      // 发生了切换：handleSlideSwitched 已经 scheduleChain(duration)
    };

    tickRef.current = tick;

    if (isPlaying) {
      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        setBarDuration(staggerDelay);
        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlideRef.current(1);
          setBarDuration(duration);
          scheduleChain(duration);
        }, staggerDelay);
      } else {
        setBarDuration(duration);
        scheduleChain(duration);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [isSyncMode, syncTrigger, isPlaying, duration, totalTiles, tileId, globalSpeed, scheduleChain]);

  // --- handleCollectionChange ---

  const handleCollectionChange = useCallback((e) => {
    const nextCollName = e.target.value;
    setCurrentCollName(nextCollName);
    if (onCollectionChange) onCollectionChange(tileId, nextCollName);
    // 不重置 activeIdx：加载期间旧画面继续显示，避免闪黑
    setOutgoingIdx(null);
  }, [setCurrentCollName, onCollectionChange, tileId, setOutgoingIdx]);

  return {
    localIsPlaying, setLocalIsPlaying,
    localSpeedMult, setLocalSpeedMult,
    localTransitionEffect, setLocalTransitionEffect,
    isWheelPaused, isPlaying,
    barDuration, progressBarReset, resetProgressBar,
    transitionEffect,
    advanceSlide, handleWheel,
    skipToNextCollection, selectRandomCollection,
    handleCollectionChange,
    isCurrentVideo,
  };
}
