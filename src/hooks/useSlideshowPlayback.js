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
  currentCollNameRef,
  collectionsRef,
  displayedCollectionsRef,
  sortMethodRef,
  onCollectionChange,
  // Cross-hook dependencies
  preloadAndAdvance,
  shouldStartFromLastRef,
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

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  const duration = globalSpeed / localSpeedMult;
  const isPlaying = globalIsPlaying && localIsPlaying && !isWheelPaused && images.length > 1;

  const resetProgressBar = useCallback(() => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  }, []);

  // Cleanup wheel pause timeout on unmount
  useEffect(() => {
    return () => {
      if (wheelPauseTimeoutRef.current) clearTimeout(wheelPauseTimeoutRef.current);
    };
  }, []);

  // Sync barDuration with duration changes (skip during initial stagger phase)
  useEffect(() => {
    if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(duration);
    }
  }, [duration, totalTiles]);

  // Reset stagger flag when play state / duration / totalTiles changes
  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, duration, totalTiles]);

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
        if (!otherDisplayedColls.includes(candidate)) return candidate;
      }
      return allColls[(currentIdx + direction + allColls.length) % allColls.length];
    }
    return allColls[0];
  }, [tileId]);

  // --- advanceSlide ---

  const advanceSlide = useCallback((direction) => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;

    const currentIdx = activeIdx;
    setOutgoingIdx(currentIdx);

    const nextIdx = currentIdx + direction;
    const currentCollNameVal = currentCollNameRef.current;

    // Reached end of collection -> cycle to next
    if (nextIdx >= currentImages.length) {
      const nextCollName = getNextUniqueCollection(1);
      setCurrentCollName(nextCollName);
      if (onCollectionChange) onCollectionChange(tileId, nextCollName);
      setActiveIdx(0);
      setOutgoingIdx(null);
      return;
    }

    // Reached start of collection (going backward) -> cycle to previous
    if (nextIdx < 0) {
      const nextCollName = getNextUniqueCollection(-1);
      if (shouldStartFromLastRef) shouldStartFromLastRef.current = true;
      setCurrentCollName(nextCollName);
      if (onCollectionChange) onCollectionChange(tileId, nextCollName);
      setActiveIdx(0);
      setOutgoingIdx(null);
      return;
    }

    // Normal advance: use preloadAndAdvance from useImagePreloader
    preloadAndAdvance(nextIdx, currentCollNameVal);
  }, [activeIdx, imagesRef, currentCollNameRef, setOutgoingIdx,
      getNextUniqueCollection, setCurrentCollName, onCollectionChange,
      tileId, setActiveIdx, preloadAndAdvance, shouldStartFromLastRef]);

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
    const nextCollName = getNextUniqueCollection(1);
    setCurrentCollName(nextCollName);
    if (onCollectionChange) onCollectionChange(tileId, nextCollName);
    setActiveIdx(0);
    setOutgoingIdx(null);
  }, [getNextUniqueCollection, setCurrentCollName, onCollectionChange, tileId, setActiveIdx, setOutgoingIdx]);

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
    if (onCollectionChange) onCollectionChange(tileId, chosen);
  }, [tileId, setCurrentCollName, onCollectionChange]);

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

      const staggerDelay = tileId * (globalSpeed / totalTiles);
      if (!staggerAppliedRef.current && totalTiles > 1 && staggerDelay > 0) {
        setBarDuration(staggerDelay);
        staggerTimeoutRef.current = setTimeout(() => {
          staggerAppliedRef.current = true;
          advanceSlide(1);
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
  }, [isPlaying, duration, totalTiles, tileId, globalSpeed, advanceSlide, resetProgressBar]);

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
  };
}
