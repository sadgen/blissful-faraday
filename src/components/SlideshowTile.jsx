import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, ChevronRight, ChevronLeft, Maximize2, Minimize2, Settings, Shuffle, HelpCircle } from 'lucide-react';
import { useSlideshow } from '../context/SlideshowContext';

export default function SlideshowTile({
  tileId,
  collections,
  initialCollectionName,
  globalSpeed,
  globalIsPlaying,
  globalRefreshTrigger,
  isSingle,
  globalTransitionEffect,
  onAspectRatioChange,
  totalTiles,
  onRegisterSwitchCallback,
  isCoordinated,
  sortMethod
}) {
  // 使用 Slideshow Context（如果可用）
  const slideshowCtx = useSlideshow();
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

  const transitionEffect = localTransitionEffect || globalTransitionEffect || 'none';

  const timerRef = useRef(null);
  const staggerTimeoutRef = useRef(null);
  const staggerAppliedRef = useRef(false);
  const lastWheelTimeRef = useRef(0);
  const shouldStartFromLastRef = useRef(false);
  const wheelPauseTimeoutRef = useRef(null);
  const isImageLoadedRef = useRef(false);
  
  // 播放历史追踪 - 记录该窗口已播放过的文件夹
  const playedCollectionsRef = useRef(new Set());
  
  // 根据排序方式获取下一个未播放过的文件夹
  const getNextUnplayedCollection = (currentCollName) => {
    const allColls = collectionsRef.current;
    const playedSet = playedCollectionsRef.current;
    
    if (allColls.length <= 1) return currentCollName;
    
    // 找出未播放过的文件夹
    const unplayedColls = allColls.filter(name => !playedSet.has(name) && name !== currentCollName);
    
    if (unplayedColls.length > 0) {
      // 有未播放过的文件夹，按排序方式选择
      if (sortMethod === 'name') {
        // 按名称排序选择
        return [...unplayedColls].sort((a, b) => a.localeCompare(b, 'zh-CN'))[0];
      } else if (sortMethod === 'date') {
        // 按日期排序 - 需要获取 mtime
        // 简化处理：按名称排序（因为我们只有名称，没有 mtime）
        return [...unplayedColls].sort((a, b) => a.localeCompare(b, 'zh-CN'))[0];
      } else {
        // 随机选择
        return unplayedColls[Math.floor(Math.random() * unplayedColls.length)];
      }
    }
    
    // 所有文件夹都播放过了，重置历史并选择下一个（按顺序）
    playedCollectionsRef.current.clear();
    const currentIdx = allColls.indexOf(currentCollName);
    const nextIdx = (currentIdx + 1) % allColls.length;
    return allColls[nextIdx];
  };

  const activeIdxRef = useRef(activeIdx);
  const imagesRef = useRef(images);
  const currentCollNameRef = useRef(currentCollName);
  const collectionsRef = useRef(collections);
  
  const [barDuration, setBarDuration] = useState(globalSpeed);
  
  // 注册切换回调到父组件
  useEffect(() => {
    if (onRegisterSwitchCallback) {
      onRegisterSwitchCallback(tileId, () => {
        advanceSlide(1);
        resetProgressBar();
      });
    }
  }, [tileId, onRegisterSwitchCallback]);

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
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [tileAspectRatio, setTileAspectRatio] = useState(null);

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

  // Fetch images dynamically (lazy loading) when the active collection name changes
  useEffect(() => {
    if (!currentCollName) {
      setImages([]);
      setTileAspectRatio(null);
      return;
    }

    const fetchImages = async () => {
      try {
        isImageLoadedRef.current = false;
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
        // 加载失败，通知 Context
        if (slideshowCtx?.registerWindow && !isCoordinated) {
          slideshowCtx.registerWindow(tileId, false);
        }
      } finally {
        setIsLoadingImages(false);
        const loadSuccess = !loadError;
        isImageLoadedRef.current = loadSuccess;
        // 通知 Context 加载状态
        if (slideshowCtx?.registerWindow) {
          slideshowCtx.registerWindow(tileId, loadSuccess && images.length > 0);
        }
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
  // Global speed is the total cycle time for all windows to refresh once
  // Each window's interval = globalSpeed / totalTiles (staggered refresh)
  const duration = (globalSpeed / localSpeedMult);
  const isPlaying = globalIsPlaying && localIsPlaying && !isWheelPaused && images.length > 1;

  // Reset progress bar CSS animation helper
  const resetProgressBar = () => {
    setProgressBarReset(true);
    setTimeout(() => setProgressBarReset(false), 20);
  };

  // Sync barDuration with globalSpeed changes unless in stagger phase
  useEffect(() => {
    const switchInterval = totalTiles > 0 ? globalSpeed / totalTiles : globalSpeed;
    if (staggerAppliedRef.current || totalTiles <= 1) {
      setBarDuration(switchInterval);
    }
  }, [globalSpeed, totalTiles]);

  // Reset stagger applied ref when play state or globalSpeed or totalTiles changes
  useEffect(() => {
    staggerAppliedRef.current = false;
  }, [isPlaying, globalSpeed, totalTiles]);

  // 2. Playback logic: Slide advancing interval with sequential stagger delay
  useEffect(() => {
    // 在协调模式下，由父组件的协调器控制切换，本地不启动定时器
    if (isCoordinated) {
      return;
    }
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (staggerTimeoutRef.current) {
      clearTimeout(staggerTimeoutRef.current);
      staggerTimeoutRef.current = null;
    }

    // 只有当播放开启、图片已加载、且有多张图片时才启动定时器
    if (globalIsPlaying && localIsPlaying && !isWheelPaused && isImageLoadedRef.current && images.length > 1) {
      // 每个窗口的切换间隔 = 总时间 / 窗口数
      const switchInterval = totalTiles > 0 ? globalSpeed / totalTiles : globalSpeed;
      
      // 调试日志
      console.log(`[Tile ${tileId}] switchInterval: ${switchInterval}ms, globalSpeed: ${globalSpeed}ms, totalTiles: ${totalTiles}`);
      
      // 每个窗口的启动延迟 = 窗口索引 * 切换间隔
      const staggerDelay = tileId * switchInterval;
      
      // 设置进度条初始 duration（用于 stagger 阶段的显示）
      setBarDuration(staggerDelay > 0 ? staggerDelay : switchInterval);
      resetProgressBar();

      // 等待 stagger 延迟后切换
      staggerTimeoutRef.current = setTimeout(() => {
        advanceSlide(1);
        resetProgressBar();
        
        // 之后每个切换间隔循环
        timerRef.current = setInterval(() => {
          advanceSlide(1);
          resetProgressBar();
        }, switchInterval);
      }, staggerDelay);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (staggerTimeoutRef.current) clearTimeout(staggerTimeoutRef.current);
    };
  }, [globalIsPlaying, localIsPlaying, globalSpeed, totalTiles, tileId, isWheelPaused, images.length]);

  const advanceSlide = (direction) => {
    const currentImages = imagesRef.current;
    if (currentImages.length === 0) return;
    
    const currentIdx = activeIdxRef.current;
    setOutgoingIdx(currentIdx);
    
    let nextIdx = currentIdx + direction;
    if (nextIdx >= currentImages.length) {
      // Finished the current folder, select next unplayed collection!
      const currentCollNameVal = currentCollNameRef.current;
      
      // 记录当前文件夹已播放过
      playedCollectionsRef.current.add(currentCollNameVal);
      
      // 按排序方式获取下一个未播放的文件夹
      const nextCollName = getNextUnplayedCollection(currentCollNameVal);
      console.log(`[Tile ${tileId}] Finished folder "${currentCollNameVal}", next: "${nextCollName}"`);
      
      setCurrentCollName(nextCollName);
      setActiveIdx(0);
      setOutgoingIdx(null);
      resetProgressBar();
      return;
    } else if (nextIdx < 0) {
      // Going backwards past 0: cycle to previous collection's last image!
      const currentCollNameVal = currentCollNameRef.current;
      const allColls = collectionsRef.current;
      const currentIdxInCollections = allColls.indexOf(currentCollNameVal);
      
      if (currentIdxInCollections !== -1 && allColls.length > 1) {
        const prevCollIdx = (currentIdxInCollections - 1 + allColls.length) % allColls.length;
        const prevCollName = allColls[prevCollIdx];
        
        shouldStartFromLastRef.current = true;
        setCurrentCollName(prevCollName);
        setActiveIdx(0);
        setOutgoingIdx(null);
        resetProgressBar();
        return;
      } else {
        // Fallback to loop if 1 collection
        nextIdx = currentImages.length - 1;
      }
    }
    
    setActiveIdx(nextIdx);
    resetProgressBar();

    // Clear outgoing image after transition completes (600ms in CSS)
    setTimeout(() => {
      setOutgoingIdx(null);
    }, 600);
  };

  // 2.5. Wheel scroll handler to navigate images (with throttle and autoplay pause)
  const handleWheel = (e) => {
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

  // Immediate resume on mouse leave
  const handleMouseLeave = () => {
    if (wheelPauseTimeoutRef.current) {
      clearTimeout(wheelPauseTimeoutRef.current);
      wheelPauseTimeoutRef.current = null;
    }
    setIsWheelPaused(false);
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

  // Calculate aspect-ratio adapted width and height
  // Note: Parent container size is already calculated in App.jsx with proper overlap
  // So we just use 100% to fill the parent container
  const tileStyle = {
    width: '100%',
    height: '100%'
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
      style={tileStyle}
      onWheel={handleWheel}
      onMouseLeave={handleMouseLeave}
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
