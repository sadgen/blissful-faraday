import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, ChevronRight, ChevronLeft, Maximize2, Minimize2, Settings, Shuffle, HelpCircle } from 'lucide-react';

export default function SlideshowTile({
  tileId,
  collections,
  initialCollectionName,
  globalSpeed,
  globalIsPlaying,
  globalRefreshTrigger,
  isSingle,
  globalTransitionEffect,
  onAspectRatioChange
}) {
  const [currentCollName, setCurrentCollName] = useState(initialCollectionName || '');
  const [activeIdx, setActiveIdx] = useState(0);
  const [outgoingIdx, setOutgoingIdx] = useState(null);
  const [localIsPlaying, setLocalIsPlaying] = useState(true);
  const [localSpeedMult, setLocalSpeedMult] = useState(1);
  const [localTransitionEffect, setLocalTransitionEffect] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [progressBarReset, setProgressBarReset] = useState(false);

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  const timerRef = useRef(null);

  const [images, setImages] = useState([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tileAspectRatio, setTileAspectRatio] = useState(null);

  // Sync with parent's initialCollectionName prop when it changes
  useEffect(() => {
    if (initialCollectionName) {
      setCurrentCollName(initialCollectionName);
    }
  }, [initialCollectionName]);

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
        const data = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setImages(data.images || []);
        setActiveIdx(0);
        setOutgoingIdx(null);
        resetProgressBar();
        
        // Detect aspect ratio of first image
        if (data.images && data.images.length > 0) {
          const imgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(data.images[0])}`;
          const img = new Image();
          img.onload = () => {
            const aspectRatio = img.width / img.height;
            setTileAspectRatio(aspectRatio);
            // Notify parent component about the aspect ratio change
            if (onAspectRatioChange) {
              onAspectRatioChange(currentCollName, aspectRatio);
            }
          };
          img.src = imgUrl;
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
    if (collections.length > 0) {
      selectRandomCollection();
    }
  }, [globalRefreshTrigger]);

  const selectRandomCollection = () => {
    if (collections.length === 0) return;
    const randomCollName = collections[Math.floor(Math.random() * collections.length)];
    setCurrentCollName(randomCollName);
  };

  // Speed calculation: duration in milliseconds per slide
  const duration = (globalSpeed / localSpeedMult);
  const isPlaying = globalIsPlaying && localIsPlaying && images.length > 1;

  // Reset progress bar CSS animation helper
  const resetProgressBar = () => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  };

  // 2. Playback logic: Slide advancing interval
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        advanceSlide(1);
      }, duration);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, duration, images.length, activeIdx]);

  const advanceSlide = (direction) => {
    if (images.length === 0) return;
    setOutgoingIdx(activeIdx);
    
    let nextIdx = activeIdx + direction;
    if (nextIdx >= images.length) {
      nextIdx = 0;
    } else if (nextIdx < 0) {
      nextIdx = images.length - 1;
    }
    
    setActiveIdx(nextIdx);
    resetProgressBar();

    // Clear outgoing image after transition completes (1500ms in CSS)
    setTimeout(() => {
      setOutgoingIdx(null);
    }, 1500);
  };

  // 3. Image Preloader (Preloads next/prev image in the collection)
  useEffect(() => {
    if (images.length <= 1) return;
    
    // Preload next image
    const nextIdx = (activeIdx + 1) % images.length;
    const nextImgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(images[nextIdx])}`;
    const imgNext = new Image();
    imgNext.src = nextImgUrl;

    // Preload previous image
    const prevIdx = (activeIdx - 1 + images.length) % images.length;
    const prevImgUrl = `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(images[prevIdx])}`;
    const imgPrev = new Image();
    imgPrev.src = prevImgUrl;
  }, [activeIdx, images, currentCollName]);

  // Detect aspect ratio when active image changes
  useEffect(() => {
    if (!currentCollName || !images[activeIdx]) return;
    
    const imgUrl = getImageUrl(images[activeIdx]);
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.width / img.height;
      setTileAspectRatio(aspectRatio);
      // Notify parent component about the aspect ratio change
      if (onAspectRatioChange) {
        onAspectRatioChange(currentCollName, aspectRatio);
      }
    };
    img.src = imgUrl;
  }, [activeIdx, currentCollName, images]);

  // Safe image path generation
  const getImageUrl = (imgName) => {
    return `/api/image?collection=${encodeURIComponent(currentCollName)}&name=${encodeURIComponent(imgName)}`;
  };

  const handleCollectionChange = (e) => {
    setCurrentCollName(e.target.value);
    setActiveIdx(0);
    setOutgoingIdx(null);
    resetProgressBar();
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
      className={`slideshow-tile effect-${transitionEffect} ${isMaximized ? 'maximized' : ''} ${showConfig ? 'show-controls' : ''}`}
      style={{
        width: '100%',
        height: '100%'
      }}
    >
      
      {/* 1. Image Layers */}
      <div className="slide-image-wrapper" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
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
            <style dangerouslySetInnerHTML={{__html: `
              @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}} />
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
                {/* Blurred background for premium aspect ratio fill */}
                <img
                  src={getImageUrl(imgName)}
                  alt=""
                  decoding="async"
                  className="slide-image-blur"
                />
                {/* Sharp contained foreground image */}
                <img
                  src={getImageUrl(imgName)}
                  alt={imgName}
                  decoding="async"
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
            transition: `width ${duration}ms linear`
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
