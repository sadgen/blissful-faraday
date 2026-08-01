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

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  // Detect if current slide is a video
  const isCurrentVideo = images.length > 0 && activeIdx >= 0 && activeIdx < images.length
    ? /\.(mp4|webm)$/i.test(images[activeIdx] || '')
    : false;

  // If current slide is a video, don't auto-advance (video onended drives it)
  // If it's a video and only one slide, allow loop playback
  const duration = globalSpeed / localSpeedMult;
  const isPlaying = globalIsPlaying && localIsPlaying && !isWheelPaused && images.length > 1 && !isCurrentVideo;

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
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;

    const currentIdx = activeIdxRef.current;

    const nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;

    // Reached end of collection -> cycle to next
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
      setActiveIdx(0);
      setOutgoingIdx(null);
      return;
    }

    // Reached start of collection (going backward) -> cycle to previous
    if (nextIdx < 0) {
      let nextCollName = onRequestNextCollection ? onRequestNextCollection() : null;
      if (nextCollName === null || nextCollName === undefined) {
        nextCollName = getNextUniqueCollection(-1);
      }
      if (shouldStartFromLastRef) shouldStartFromLastRef.current = true;
      setCurrentCollName(nextCollName);
      if (onCollectionChange) {
        onCollectionChange(tileId, nextCollName);
        if (displayedCollectionsRef.current) {
          displayedCollectionsRef.current = [...displayedCollectionsRef.current];
          displayedCollectionsRef.current[tileId] = nextCollName;
        }
      }
      setActiveIdx(0);
      setOutgoingIdx(null);
      return;
    }

    // Normal advance: use preloadAndAdvance from useImagePreloader
    preloadAndAdvance(nextIdx, currentCollNameVal, currentIdx);
  }, [activeIdx, imagesRef, currentCollNameRef, setOutgoingIdx,
      getNextUniqueCollection, setCurrentCollName, onCollectionChange,
      tileId, setActiveIdx, preloadAndAdvance, shouldStartFromLastRef,
      displayedCollectionsRef, onRequestNextCollection]);

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
        setActiveIdx(0);
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
    setActiveIdx(0);
    setOutgoingIdx(null);
  }, [getNextUniqueCollection, setCurrentCollName, onCollectionChange, tileId, setActiveIdx, setOutgoingIdx, displayedCollectionsRef, onRequestNextCollection]);

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

  // --- Staggered recursive setTimeout playback ---

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (staggerTimeoutRef.current) { clearTimeout(staggerTimeoutRef.current); staggerTimeoutRef.current = null; }

    // Sync mode: parent drives all tiles via syncTrigger
    if (isSyncMode) {
      const isSyncTick = syncTrigger !== prevSyncTriggerRef.current;
      prevSyncTriggerRef.current = syncTrigger;
      if (isSyncTick && isPlaying && activeIdx >= 0 && imagesRef.current.length > 0) {
        advanceSlideRef.current(1);
        resetProgressBarRef.current();
      } else if (isSyncTick && !isPlaying) {
        // Images not ready (or wheel-paused) — roll back the ref so the
        // pending tick isn't lost. When isPlaying flips true, this effect
        // re-runs and advances the tile (avoids permanently stuck tiles).
        prevSyncTriggerRef.current = syncTrigger - 1;
      }
      return;
    }

    // Async mode: original per-tile timer logic (unchanged)
    let targetTime = Date.now() + duration;

    if (isPlaying) {
      const scheduleNext = () => {
        advanceSlideRef.current(1);
        resetProgressBarRef.current();
        const elapsed = Date.now() - targetTime;
        const nextDelay = Math.max(0, duration - elapsed);
        targetTime += duration;
        timerRef.current = setTimeout(scheduleNext, nextDelay);
      };

      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        setBarDuration(staggerDelay);
        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlideRef.current(1);
          setBarDuration(duration);
          targetTime = Date.now() + duration;
          timerRef.current = setTimeout(scheduleNext, duration);
        }, staggerDelay);
      } else {
        setBarDuration(duration);
        targetTime = Date.now() + duration;
        timerRef.current = setTimeout(scheduleNext, duration);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [isSyncMode, syncTrigger, isPlaying, duration, totalTiles, tileId, globalSpeed]);

  // --- handleCollectionChange ---

  const handleCollectionChange = useCallback((e) => {
    const nextCollName = e.target.value;
    setCurrentCollName(nextCollName);
    if (onCollectionChange) onCollectionChange(tileId, nextCollName);
    setActiveIdx(0);
    setOutgoingIdx(null);
  }, [setCurrentCollName, onCollectionChange, tileId, setActiveIdx, setOutgoingIdx]);

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
