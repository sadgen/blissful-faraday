import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, ChevronRight, ChevronLeft,
  Maximize2, Minimize2, Settings, Shuffle, HelpCircle
} from 'lucide-react';
import useImagePreloader from '../hooks/useImagePreloader';
import useSlideshowPlayback from '../hooks/useSlideshowPlayback';
import useTileDrag from '../hooks/useTileDrag';

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
  intersections = [],
  isSyncMode,
  syncTrigger,
}) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [isMaximized, setIsMaximized] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Refs needed by both hooks
  const currentCollNameRef = useRef(currentCollName);
  const collectionsRef = useRef(collections);
  const displayedCollectionsRef = useRef(displayedCollections);
  const sortMethodRef = useRef(sortMethod);

  useEffect(() => { currentCollNameRef.current = currentCollName; }, [currentCollName]);
  useEffect(() => { collectionsRef.current = collections; }, [collections]);
  useEffect(() => { displayedCollectionsRef.current = displayedCollections; }, [displayedCollections]);
  useEffect(() => { sortMethodRef.current = sortMethod; }, [sortMethod]);

  // --- Hook 1: Image Preloader ---
  const {
    images, activeIdx, setActiveIdx, outgoingIdx, setOutgoingIdx,
    isLoadingImages, loadError,
    imagesRef, shouldStartFromLastRef,
    preloadAndAdvance,
  } = useImagePreloader({
    currentCollName,
    setCurrentCollName,
    tileId,
    initialCollectionName,
    onCollectionChange,
    onAspectRatioChange,
    collections,
  });

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
    currentCollNameRef,
    collectionsRef,
    displayedCollectionsRef,
    sortMethodRef,
    onCollectionChange,
    preloadAndAdvance,
    shouldStartFromLastRef,
    isSyncMode,
    syncTrigger,
  });

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

  const getImageUrl = (imgName) =>
    `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;

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
        {isLoadingImages ? (
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
          style={{ width: '100%', transition: `width ${barDuration}ms linear` }}
        />
      )}

      {/* 3. Floating UI Overlay */}
      <div className="tile-overlay">
        {/* Header */}
        <div className="tile-header">
          <div className="tile-title">
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: isPlaying ? '#10b981' : '#f59e0b' }} />
            <span>{currentCollName || '选择图片集'}</span>
            <span style={{ opacity: 0.6, fontSize: '0.75rem' }}>({activeIdx + 1}/{images.length})</span>
          </div>
          <div className="tile-controls-group">
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
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '10px' }}>
            {localSpeedMult !== 1 ? `${localSpeedMult}x 速度` : '正常速度'}
          </div>
        </div>
      </div>
    </div>
  );
}
