import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  Play, Pause, ChevronRight, ChevronLeft,
  Maximize2, Minimize2, Settings, Shuffle, HelpCircle,
  Undo2, Redo2, UserCheck, UserX
} from 'lucide-react';
import { isVideoFile, prettyCollectionName, accountOf } from '../utils/imageHelpers';
import useImagePreloader from '../hooks/useImagePreloader';
import useSlideshowPlayback from '../hooks/useSlideshowPlayback';
import useTileDrag from '../hooks/useTileDrag';

const SlideshowTile = forwardRef(function SlideshowTile({
  tileId,
  collections,
  displayedCollections,
  onCollectionChange,
  initialCollectionName,
  onTileReady,
  batchLoadIdx,
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
  intersections = [],
  isSyncMode,
  syncTrigger,
  videoSpeed,
  imageSort,
  fetchCollections,
  onRequestNextCollection,
  onQueueDelete,
  accountFilter = '',
  onSelectAccount,
  personFilter = '-',
}, ref) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [isMaximized, setIsMaximized] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Collection info (Instagram username + full_name)
  const [collectionInfo, setCollectionInfo] = useState(null);
  // 当前图集的人像元数据（文件名 -> { p: 0|1, s, manual }）
  const [personMeta, setPersonMeta] = useState({});
  const [isTogglingPerson, setIsTogglingPerson] = useState(false);

  useEffect(() => {
    if (!currentCollName) {
      setCollectionInfo(null);
      setPersonMeta({});
      return;
    }
    let cancelled = false;
    fetch(`/api/collection/info?collection=${encodeURIComponent(currentCollName)}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled) setCollectionInfo(data);
      })
      .catch(() => {
        if (!cancelled) setCollectionInfo(null);
      });
    fetch(`/api/person/meta?collection=${encodeURIComponent(currentCollName)}`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data && data.media) setPersonMeta(data.media);
      })
      .catch(() => {
        if (!cancelled) setPersonMeta({});
      });
    return () => { cancelled = true; };
  }, [currentCollName]);

  // Refs needed by both hooks
  const currentCollNameRef = useRef(currentCollName);
  const collectionsRef = useRef(collections);
  const displayedCollectionsRef = useRef(displayedCollections);
  const sortMethodRef = useRef(sortMethod);
  const hasReportedReadyRef = useRef(false);
  useEffect(() => { currentCollNameRef.current = currentCollName; }, [currentCollName]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);
  useEffect(() => { displayedCollectionsRef.current = displayedCollections; }, [displayedCollections]);
  useEffect(() => { sortMethodRef.current = sortMethod; }, [sortMethod]);

  // Reset ready flag when switching to a new collection
  useEffect(() => {
    hasReportedReadyRef.current = false;
  }, [currentCollName]);

  // --- Hook 1: Image Preloader ---
  const {
    images, setImages, imagesColl, removeImage, restoreImage, activeIdx, setActiveIdx, outgoingIdx, setOutgoingIdx,
    isLoadingImages, isLoadingRef, loadError, postIndex, holdFrame,
    imagesRef, activeIdxRef, shouldStartFromLastRef, pendingStartRef,
    preloadAndAdvance,
    videoFileNames,
  } = useImagePreloader({
    currentCollName,
    setCurrentCollName,
    tileId,
    initialCollectionName,
    onCollectionChange,
    onAspectRatioChange,
    collections,
    imageSort,
    personFilter,
  });

  // 播放历史回退的稳定代理（historyBack 在下方播放历史区才定义，
  // hook 调用顺序要求这里先传入稳定标识，实际实现经 ref 间接调用）
  const onStepBeforeStartRef = useRef(null);
  const onStepBeforeStart = useCallback(() => {
    const f = onStepBeforeStartRef.current;
    return f ? f() : false;
  }, []);

  // --- Hook 2: Playback ---
  const {
    localIsPlaying, setLocalIsPlaying,
    localSpeedMult, setLocalSpeedMult,
    localTransitionEffect, setLocalTransitionEffect,
    isPlaying,
    barDuration, progressBarReset,
    transitionEffect,
    advanceSlide, handleWheel,
    skipToNextCollection, selectRandomCollection,
    handleCollectionChange,
    isCurrentVideo,
  } = useSlideshowPlayback({
    tileId,
    collections,
    displayedCollections,
    images,
    activeIdx, setActiveIdx,
    outgoingIdx, setOutgoingIdx,
    globalSpeed,
    globalIsPlaying,
    globalTransitionEffect,
    sortMethod,
    totalTiles,
    initialCollectionName,
    currentCollName, setCurrentCollName,
    imagesRef,
    activeIdxRef,
    currentCollNameRef,
    collectionsRef,
    displayedCollectionsRef,
    sortMethodRef,
    onCollectionChange,
    preloadAndAdvance,
    shouldStartFromLastRef,
    isSyncMode,
    syncTrigger,
    onRequestNextCollection,
    onStepBeforeStart,
    isLoadingRef,
  });

  // 人像状态一键翻转：当前图片如果是人像转非人像，是非人像转人像（仅对该图生效）
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
            removeImage(currentMediaName);
            if (activeIdx >= images.length - 1) {
              setActiveIdx(Math.max(0, images.length - 2));
            }
            setOutgoingIdx(null);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to toggle person status:', err);
    } finally {
      setIsTogglingPerson(false);
    }
  };

  // --- Hook 3: Tile Drag ---
  const {
    isDragging,
    dragTransform,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
  } = useTileDrag({
    tileId,
    onDragPositionChange,
    globalRefreshTrigger,
    initialCollectionName,
    totalTiles,
  });

  // Report ready when loading finishes (success, error, or empty).
  // This must fire even when tile is behind batch loading threshold (showing placeholder)
  // because in that case onLoad / onLoadedMetadata callbacks never run.
  useEffect(() => {
    if (!isLoadingImages) {
      if (!hasReportedReadyRef.current && onTileReady) {
        hasReportedReadyRef.current = true;
        onTileReady(tileId);
      }
    }
  }, [isLoadingImages, onTileReady, tileId]);

  // --- ResizeObserver for parent size ---
  const tileRef = useRef(null);
  const [parentSize, setParentSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!tileRef.current) return;
    const parent = tileRef.current.parentNode;
    if (!parent) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setParentSize({ width, height });
      }
    });
    ro.observe(parent);
    const rect = parent.getBoundingClientRect();
    setParentSize({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, []);

  // --- Stagger delay for progress bar animation ---
  // We need to handle the stagger bar timing that useSlideshowPlayback manages.
  // The hook returns `barDuration` which already accounts for stagger.

  // Handle middle-click: skip to next collection
  const handleMouseDownWithMiddle = useCallback((e) => {
    if (e.button === 1) {
      e.preventDefault();
      skipToNextCollection();
      return;
    }
    handleMouseDown(e);
  }, [skipToNextCollection, handleMouseDown]);

  // --- Computed styles ---
  const maskStyle = !isMaximized && !isDragging && intersections.length > 0
    ? {
        maskImage: `url(#tile-mask-${tileId})`,
        WebkitMaskImage: `url(#tile-mask-${tileId})`,
      }
    : {};

  // URL 按 images 数组归属的图集构造：切集加载期间 currentCollName 已变，
  // 旧图仍需用旧集名加载才能无缝显示
  const getImageUrl = (imgName) =>
    `/api/image?collection=${encodeURIComponent(imagesColl || currentCollName)}&name=${encodeURIComponent(imgName)}`;

  // 当前媒体的帖子信息（IG 账号图集才有）：第 x/y 帖 + caption
  const activePostInfo = postIndex && images[activeIdx] ? postIndex.get(images[activeIdx]) : null;

  // ─── 播放历史（回退/前进）────────────────────────────────────────────────
  // 随机播放切换快、且切到新图集后"上一张"回不去：这里把每一帧实际显示过的
  // {图集, 文件} 压栈，回退时精确跳回前一帧（可跨图集），前进则重放回退掉的帧
  const historyRef = useRef([]);        // 已播放序列（栈顶 = 当前帧）
  const historyFwdRef = useRef([]);     // 回退掉待前进重放的帧
  const isHistJumpRef = useRef(false);  // 回跳落地的那帧不重复压栈

  // 记录当前实际显示帧（imagesColl+images[activeIdx] 才是真实画面归属）
  useEffect(() => {
    const coll = imagesColl;
    const name = images[activeIdx];
    if (!coll || !name) return;
    if (isHistJumpRef.current) { isHistJumpRef.current = false; return; }
    const h = historyRef.current;
    const top = h[h.length - 1];
    if (top && top.coll === coll && top.name === name) return;
    // 回退重放旧帧（如多图帖从第2张退回第1张）：栈里本来就有这一帧，
    // 弹出栈顶而不是压入——否则产生回声帧，下一次回退会立刻"弹回"刚离开的帧
    const prev = h[h.length - 2];
    if (prev && prev.coll === coll && prev.name === name) {
      h.pop();
      return;
    }
    h.push({ coll, name });
    if (h.length > 200) h.shift();
    historyFwdRef.current = [];
  }, [imagesColl, images, activeIdx]);

  // 跳到历史帧：同集直接推进下标；跨集设落点后切集，由 applyImages 精确落帧。
  // 文件已被删除（同集找不到）返回 false，调用方继续往更早找
  const histJumpTo = useCallback((entry) => {
    const curColl = imagesColl || currentCollName;
    if (entry.coll === curColl) {
      const idx = images.indexOf(entry.name);
      if (idx < 0) return false;
      isHistJumpRef.current = true;
      preloadAndAdvance(idx, entry.coll, activeIdxRef.current);
      return true;
    }
    isHistJumpRef.current = true;
    pendingStartRef.current = { coll: entry.coll, name: entry.name };
    setCurrentCollName(entry.coll);
    if (onCollectionChange) {
      onCollectionChange(tileId, entry.coll);
      if (displayedCollectionsRef.current) {
        displayedCollectionsRef.current = [...displayedCollectionsRef.current];
        displayedCollectionsRef.current[tileId] = entry.coll;
      }
    }
    setOutgoingIdx(null);
    return true;
  }, [imagesColl, currentCollName, images, preloadAndAdvance, activeIdxRef,
      setCurrentCollName, onCollectionChange, tileId, setOutgoingIdx, displayedCollectionsRef]);

  const historyBack = useCallback(() => {
    const h = historyRef.current;
    if (h.length < 2) return false;
    const cur = h.pop();
    historyFwdRef.current.push(cur);
    isHistJumpRef.current = true;
    if (!histJumpTo(h[h.length - 1])) {
      // 最近的上一帧已被删除：丢弃并继续往前找（cur 保留在前进栈里可忽略）
      h.pop();
      while (h.length) {
        const prev = h[h.length - 1];
        if (histJumpTo(prev)) return true;
        h.pop();
      }
      // 没有任何可回跳的帧：复位标记，别让下一次真实记录被误吞
      isHistJumpRef.current = false;
      return false;
    }
    return true;
  }, [histJumpTo]);

  // 向上滚到图集第一张时的回退实现（见 useSlideshowPlayback 的 advanceSlide）
  onStepBeforeStartRef.current = historyBack;

  const historyForward = useCallback(() => {
    const f = historyFwdRef.current;
    if (!f.length) return;
    const nxt = f.pop();
    const curColl = imagesColl || currentCollName;
    if (nxt.coll === curColl && !images.includes(nxt.name)) return; // 该帧文件已被删除
    isHistJumpRef.current = true;
    historyRef.current.push(nxt);
    histJumpTo(nxt);
  }, [histJumpTo, imagesColl, currentCollName, images]);

  // 向 DesktopLayout 暴露当前媒体动作句柄
  useImperativeHandle(ref, () => ({
    togglePerson: () => handleTogglePerson(),
    historyBack: () => historyBack(),
    historyForward: () => historyForward(),
  }));

  // --- Empty state ---
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

  // Batch loading: show placeholder while tile is waiting its turn to load images
  if (tileId >= batchLoadIdx) {
    return (
      <div className="slideshow-tile" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: '100%', gap: 10,
          background: 'radial-gradient(ellipse at center, rgba(139, 92, 246, 0.03) 0%, transparent 70%)'
        }}>
          <div style={{
            width: 20, height: 20,
            border: '2px solid rgba(139, 92, 246, 0.15)',
            borderTopColor: 'var(--accent-purple)',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>正在加载...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={tileRef}
      className={`slideshow-tile effect-${transitionEffect} ${isMaximized ? 'maximized' : ''} ${showConfig ? 'show-controls' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...dragTransform,
        ...maskStyle,
      }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDownWithMiddle}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* 1. Image Layers */}
      <div className="slide-image-wrapper" style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        width: '100%', height: '100%'
      }}>
        {/* 切集边界垫底帧：新集首图画出第一帧之前由旧集末帧兜底（z0，不可见成本） */}
        {holdFrame && (
          <div className="slide-image-container" style={{ opacity: 1, zIndex: 0 }}>
            <img
              src={`/api/image?collection=${encodeURIComponent(holdFrame.coll)}&name=${encodeURIComponent(holdFrame.name)}`}
              alt=""
              decoding="sync"
              draggable="false"
              className="slide-image-main"
            />
          </div>
        )}
        {isLoadingImages && images.length === 0 ? (
          <div style={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32,
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
            if (!isActive && !isOutgoing) return null;
            const isVideo = videoFileNames.has(imgName);

            return (
              <div
                key={imgName}
                className={`slide-image-container ${isActive ? 'active' : ''} ${isOutgoing ? 'outgoing' : ''}`}
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
                      onError={() => {
                        // 文件已被删除/不存在：剔除出播放队列，卡在末尾则换下一图集
                        removeImage(imgName);
                        if (activeIdx >= images.length - 1) {
                          if (images.length <= 1) skipToNextCollection(1);
                          else setActiveIdx(Math.max(0, images.length - 2));
                        }
                      }}
                      onEnded={() => advanceSlide(1)}
                      onLoadedMetadata={(e) => {
                        e.target.playbackRate = videoSpeed;
                        e.target.play().catch(() => {});
                        if (!hasReportedReadyRef.current && onTileReady) {
                          hasReportedReadyRef.current = true;
                          onTileReady(tileId);
                        }
                      }}
                      onCanPlay={(e) => {
                        e.target.play().catch(() => {});
                      }}
                      className="slide-image-main"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain'
                      }}
                    />
                  ) : null
                ) : (
                    <img
                      src={getImageUrl(imgName)}
                      alt={imgName}
                      decoding="sync"
                      draggable="false"
                      className="slide-image-main"
                      onError={() => {
                        // 文件已被删除/不存在：剔除出播放队列，卡在末尾则换下一图集
                        removeImage(imgName);
                        if (activeIdx >= images.length - 1) {
                          if (images.length <= 1) skipToNextCollection(1);
                          else setActiveIdx(Math.max(0, images.length - 2));
                        }
                      }}
                      onLoad={() => {
                        if (!hasReportedReadyRef.current && onTileReady) {
                          hasReportedReadyRef.current = true;
                          onTileReady(tileId);
                        }
                      }}
                    />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 2. Visual Playback Progress Bar */}
      {isPlaying && !progressBarReset && (
        <div
          className="tile-progress"
          style={{ width: '100%', transition: `width ${barDuration}ms linear` }}
        />
      )}

      {/* 3. Floating UI Overlay */}
      <div className="tile-overlay">
        {/* Header */}
        <div className="tile-header">
          <div className="tile-title" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: isPlaying ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
              {(() => {
                const igAccount = accountOf(currentCollName);
                const label = `@${collectionInfo?.username || (igAccount || currentCollName) || '选择图片集'}`;
                // 仅 IG 复合图集（user::postId）提供"只看该账号"点击入口；普通文件夹保持纯文本
                if (!igAccount || typeof onSelectAccount !== 'function') {
                  return (
                    <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </span>
                  );
                }
                const active = Array.isArray(accountFilter) ? accountFilter.includes(igAccount) : accountFilter === igAccount;
                return (
                  <span
                    onClick={(e) => { e.stopPropagation(); onSelectAccount(igAccount); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={active ? `取消勾选 @${igAccount}` : `勾选 @${igAccount}（可多选）`}
                    style={{
                      fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      cursor: 'pointer',
                      textDecoration: 'underline dotted',
                      textUnderlineOffset: 3,
                      textDecorationColor: active ? '#d8b4fe' : 'rgba(255,255,255,0.35)',
                      color: active ? '#d8b4fe' : 'inherit',
                    }}
                  >
                    {label}{active ? ' ✓' : ''}
                  </span>
                );
              })()}
              {activePostInfo ? (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  第 {activePostInfo.postNo}/{activePostInfo.totalPosts} 帖{activePostInfo.caption ? ` · ${activePostInfo.caption}` : ''}
                </span>
              ) : collectionInfo?.full_name && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {collectionInfo.full_name}
                </span>
              )}
            </div>
            <span style={{ opacity: 0.6, fontSize: '0.75rem', flexShrink: 0 }}>({activeIdx + 1}/{images.length})</span>
          </div>
          <div className="tile-controls-group">
            {/* 人像状态切换（取代原删除按钮）：点击一键翻转人像/非人像，仅对该图生效 */}
            {!isMaximized && images.length > 0 && (() => {
              const curFile = images[activeIdx];
              const m = curFile ? personMeta[curFile] : null;
              const isP = m ? m.p === 1 : null;
              return (
                <button
                  type="button"
                  className="tile-mini-btn"
                  onClick={handleTogglePerson}
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
                    background: isP === true ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                    border: isP === true ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                    borderRadius: 4,
                  }}
                >
                  {isP === true ? <UserCheck size={14} /> : <UserX size={14} />}
                </button>
              );
            })()}
            <button className="tile-mini-btn" onClick={() => setShowConfig(!showConfig)} title="本窗口设置">
              <Settings size={14} style={{ transform: showConfig ? 'rotate(45deg)' : 'none', transition: 'transform 0.3s' }} />
            </button>
            <button className="tile-mini-btn" onClick={() => setIsMaximized(!isMaximized)} title={isMaximized ? '还原网格' : '最大化展示'}>
              {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>

        {/* Configuration Panel */}
        {showConfig && (
          <div style={{
            position: 'absolute', top: '52px', right: '12px',
            background: 'rgba(10, 15, 26, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(12px)', borderRadius: '12px',
            padding: '12px', width: '220px', zIndex: 10,
            display: 'flex', flexDirection: 'column', gap: 10,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
          }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                更换图片集:
              </label>
              <select className="glass-select" value={currentCollName} onChange={handleCollectionChange} style={{ width: '100%', fontSize: '0.8rem' }}>
                {collections.map(name => (
                  <option key={name} value={name}>{prettyCollectionName(name)}</option>
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
                    onClick={() => setLocalSpeedMult(speed)}
                    style={{
                      flex: 1, background: localSpeedMult === speed ? 'var(--accent-purple)' : 'rgba(255,255,255,0.06)',
                      border: 'none', color: '#fff', fontSize: '0.75rem', padding: '4px',
                      borderRadius: '4px', cursor: 'pointer', transition: 'background 0.2s'
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
              <select className="glass-select" value={localTransitionEffect} onChange={(e) => setLocalTransitionEffect(e.target.value)} style={{ width: '100%', fontSize: '0.8rem' }}>
                <option value="">跟随全局</option>
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
                width: '100%', padding: '6px', fontSize: '0.75rem',
                justifyContent: 'center', background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)'
              }}
            >
              <Shuffle size={12} /> 随机换一组
            </button>
          </div>
        )}

        {/* Footer Controls */}
        <div className="tile-footer">
          <div className="tile-controls-group">
            <button className="tile-mini-btn" onClick={historyBack} title="回退到之前播放的画面（← 键，可跨图集）">
              <Undo2 size={14} />
            </button>
            <button className="tile-mini-btn" onClick={historyForward} title="前进到回退前的画面（→ 键）">
              <Redo2 size={14} />
            </button>
            <button className="tile-mini-btn" onClick={() => advanceSlide(-1)} title="上一张">
              <ChevronLeft size={16} />
            </button>
            <button className="tile-mini-btn" onClick={() => setLocalIsPlaying(!localIsPlaying)} title={localIsPlaying ? '暂停当前' : '播放当前'}>
              {localIsPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button className="tile-mini-btn" onClick={() => advanceSlide(1)} title="下一张">
              <ChevronRight size={16} />
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: 4 }}>
            {isCurrentVideo && <span>🎬</span>}
            <span>{localSpeedMult !== 1 ? `${localSpeedMult}x 速度` : '正常速度'}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

export default SlideshowTile;
