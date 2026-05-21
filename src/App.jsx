import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, FolderOpen, Save, X, Settings, Image, Play, Pause, AlertTriangle, ChevronLeft, ChevronRight, Database, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import SlideshowTile from './components/SlideshowTile';
import ControlHUD from './components/ControlHUD';

// Preset grid configurations for each tile count
const GRID_PRESETS = {
  1: { cols: 1, rows: 1 },
  3: { cols: 3, rows: 1 },
  5: { cols: 5, rows: 1 },
  12: { cols: 6, rows: 2 }
};

// Allowed tile counts
const ALLOWED_TILE_COUNTS = [1, 3, 5, 12];

// Zoom slider constants
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.05;

export default function App() {
  // Load saved configuration from localStorage
  const loadSavedConfig = () => {
    try {
      const saved = localStorage.getItem('blissfulFaradayConfig');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn('Failed to load saved config:', err);
    }
    return null;
  };

  const savedConfig = loadSavedConfig();

  const [rawCollections, setRawCollections] = useState([]);
  const [scanDirectory, setScanDirectory] = useState('');
  const [isAutoTiling, setIsAutoTiling] = useState(true);
  const [tileCount, setTileCount] = useState(savedConfig?.tileCount || 1);
  const [globalSpeed, setGlobalSpeed] = useState(savedConfig?.globalSpeed || 5000);
  const [globalIsPlaying, setGlobalIsPlaying] = useState(savedConfig?.globalIsPlaying !== undefined ? savedConfig.globalIsPlaying : true);
  const [globalRefreshTrigger, setGlobalRefreshTrigger] = useState(0);
  const [globalTransitionEffect, setGlobalTransitionEffect] = useState(savedConfig?.globalTransitionEffect || 'none');
  
  // Settings drawer state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [inputScanDir, setInputScanDir] = useState('');
  const [isSubmittingDir, setIsSubmittingDir] = useState(false);
  const [dirError, setDirError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  
  // Cache management state
  const [cacheInfo, setCacheInfo] = useState(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');

  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 12;

  const [sortMethod, setSortMethod] = useState('name');
  const [randomTrigger, setRandomTrigger] = useState(0);
  
  // Tile positioning state
  const [tilePositions, setTilePositions] = useState({});
  
  // Zoom state for the scale slider
  const [zoomScale, setZoomScale] = useState(1);
  
  // Ref for zoom slider container to capture wheel events
  const zoomSliderRef = useRef(null);

  // 1. Process, sort and map collections
  const collections = React.useMemo(() => {
    if (!rawCollections || rawCollections.length === 0) return [];
    
    const items = [...rawCollections];
    
    let result;
    if (sortMethod === 'name') {
      result = items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortMethod === 'date') {
      result = items.sort((a, b) => b.mtime - a.mtime);
    } else if (sortMethod === 'random') {
      let currentIndex = items.length, randomIndex;
      while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [items[currentIndex], items[randomIndex]] = [items[randomIndex], items[currentIndex]];
      }
      result = items;
    } else {
      result = items;
    }
    
    const seen = new Set();
    const unique = result.filter(item => {
      if (seen.has(item.name)) {
        console.warn(`[App] Duplicate collection found: ${item.name}`);
        return false;
      }
      seen.add(item.name);
      return true;
    });
    
    return unique.map(item => item.name);
  }, [rawCollections, sortMethod, randomTrigger]);

  useEffect(() => {
    setCurrentPage(0);
  }, [rawCollections, sortMethod, tileCount]);

  // Fetch collections from API
  const fetchCollections = async () => {
    try {
      setIsLoading(true);
      setFetchError('');
      const res = await fetch('/api/collections');
      if (!res.ok) {
        throw new Error(`API error: ${res.statusText}`);
      }
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setRawCollections(data.collections || []);
      setScanDirectory(data.scanDirectory || '');
      setInputScanDir(data.scanDirectory || '');
    } catch (err) {
      console.error(err);
      setFetchError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCollections();
  }, []);

  // Save configuration to localStorage
  useEffect(() => {
    const config = {
      tileCount,
      globalSpeed,
      globalIsPlaying,
      globalTransitionEffect
    };
    try {
      localStorage.setItem('blissfulFaradayConfig', JSON.stringify(config));
    } catch (err) {
      console.warn('Failed to save config:', err);
    }
  }, [tileCount, globalSpeed, globalIsPlaying, globalTransitionEffect]);

  // Get current grid config
  const gridConfig = GRID_PRESETS[tileCount] || GRID_PRESETS[1];

  // Calculate tile positions - NO OVERLAP initial layout, tiles fill the screen
  const calculateTilePositions = React.useCallback((count, containerWidth, containerHeight) => {
    const positions = {};
    
    if (count === 0) return positions;
    
    const { cols, rows } = gridConfig;
    
    // Calculate tile dimensions to fill the container exactly without overlap
    const windowWidth = containerWidth / cols;
    const windowHeight = containerHeight / rows;
    
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      positions[i] = {
        left: col * windowWidth,
        top: row * windowHeight,
        width: windowWidth,
        height: windowHeight,
        // Store center position for zoom calculations
        centerX: col * windowWidth + windowWidth / 2,
        centerY: row * windowHeight + windowHeight / 2
      };
    }
    
    return positions;
  }, [gridConfig]);

  // Calculate scaled positions based on zoom scale (keeping center positions fixed)
  const getScaledPositions = useCallback(() => {
    const scaledPositions = {};
    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;
    
    Object.entries(tilePositions).forEach(([index, pos]) => {
      const scaledWidth = pos.width * zoomScale;
      const scaledHeight = pos.height * zoomScale;
      
      // Keep the center position fixed while scaling
      scaledPositions[index] = {
        left: pos.centerX - scaledWidth / 2,
        top: pos.centerY - scaledHeight / 2,
        width: scaledWidth,
        height: scaledHeight
      };
    });
    
    return scaledPositions;
  }, [tilePositions, zoomScale]);

  // Calculate tile positions when collections change or window resizes
  useEffect(() => {
    if (collections.length > 0) {
      let resizeTimeout;
      
      const updatePositions = () => {
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;
        
        const positions = calculateTilePositions(activeCollections.length, containerWidth, containerHeight);
        setTilePositions(positions);
      };
      
      const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(updatePositions, 100);
      };
      
      updatePositions();
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(resizeTimeout);
      };
    }
  }, [collections, tileCount, calculateTilePositions]);

  // Handle wheel events on zoom slider
  const handleZoomWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoomScale(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
  }, []);

  // Handle zoom slider mouse enter to capture wheel
  useEffect(() => {
    const slider = zoomSliderRef.current;
    if (!slider) return;

    const wheelHandler = (e) => handleZoomWheel(e);
    
    slider.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      slider.removeEventListener('wheel', wheelHandler);
    };
  }, [handleZoomWheel]);

  // Zoom slider handlers
  const handleZoomSliderChange = (e) => {
    setZoomScale(parseFloat(e.target.value));
  };

  const zoomIn = () => {
    setZoomScale(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP * 2));
  };

  const zoomOut = () => {
    setZoomScale(prev => Math.max(MIN_ZOOM, prev - ZOOM_STEP * 2));
  };

  // Save new scanned directory
  const handleSaveDirectory = async (e) => {
    e.preventDefault();
    if (!inputScanDir.trim()) return;

    try {
      setIsSubmittingDir(true);
      setDirError('');
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanDirectory: inputScanDir.trim() })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '无法更改扫描文件夹');
      }

      setScanDirectory(data.scanDirectory);
      setRawCollections([]);
      setIsSettingsOpen(false);
      
      await fetchCollections();
      shuffleAllTiles();
    } catch (err) {
      setDirError(err.message);
    } finally {
      setIsSubmittingDir(false);
    }
  };

  const shuffleAllTiles = () => {
    setRandomTrigger(prev => prev + 1);
    setGlobalRefreshTrigger(prev => prev + 1);
  };

  // Cache management
  const fetchCacheInfo = async () => {
    try {
      const res = await fetch('/api/cache/info');
      if (!res.ok) {
        throw new Error(`API error: ${res.statusText}`);
      }
      const data = await res.json();
      setCacheInfo(data);
    } catch (err) {
      console.error('Failed to fetch cache info:', err);
    }
  };

  const handleClearCache = async () => {
    try {
      setIsClearingCache(true);
      setCacheMessage('');
      const res = await fetch('/api/cache/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '无法清除缓存');
      }
      
      setCacheMessage('✅ 缓存已成功清除');
      setCacheInfo(null);
      await fetchCollections();
    } catch (err) {
      setCacheMessage(`❌ 错误: ${err.message}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  const isPaginated = !isAutoTiling && collections.length > pageSize;
  const totalPages = isPaginated ? Math.ceil(collections.length / pageSize) : 1;

  // Active collections for display
  const activeCollections = isAutoTiling
    ? collections.slice(0, tileCount || collections.length)
    : (isPaginated 
        ? collections.slice(currentPage * pageSize, (currentPage + 1) * pageSize) 
        : collections);

  const activeTileCount = isAutoTiling ? (activeCollections.length || 1) : tileCount;

  // Get scaled positions for rendering
  const scaledPositions = zoomScale !== 1 ? getScaledPositions() : tilePositions;

  // Render loading screen
  if (isLoading && collections.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: '#06080d',
        gap: 16
      }}>
        <RefreshCw size={32} className="animate-spin text-purple-400" style={{ animation: 'spin 2s linear infinite' }} />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
          正在扫描本地图片集...
        </span>
        <style dangerouslySetInnerHTML={{__html: `
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}} />
      </div>
    );
  }

  return (
    <div className="app-container">
      
      {/* Viewport Tiled Grid */}
      {collections.length > 0 ? (
        <div className="viewport-grid" style={{ position: 'relative' }}>
          {activeCollections.map((collName, index) => {
            const position = scaledPositions[index] || tilePositions[index] || { left: 20, top: 20, width: 350, height: 467 };
            
            return (
              <div
                key={collName}
                style={{
                  position: 'absolute',
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: `${position.width}px`,
                  height: `${position.height}px`
                }}
              >
                <SlideshowTile
                  tileId={index}
                  collections={activeCollections}
                  initialCollectionName={collName}
                  globalSpeed={globalSpeed}
                  globalIsPlaying={globalIsPlaying}
                  globalRefreshTrigger={globalRefreshTrigger}
                  isSingle={activeTileCount === 1}
                  globalTransitionEffect={globalTransitionEffect}
                  totalTiles={activeTileCount}
                />
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty/Error State */
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          padding: 24,
          background: 'radial-gradient(circle at 50% 50%, #111827 0%, #030712 100%)'
        }}>
          <div className="glass-panel empty-state">
            <AlertTriangle size={48} style={{ color: '#f59e0b', filter: 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.4))' }} />
            <h2 className="empty-state-title">未检测到有效图片集</h2>
            
            {fetchError ? (
              <p className="empty-state-desc" style={{ color: '#ef4444' }}>
                系统遇到错误: {fetchError}
              </p>
            ) : (
              <p className="empty-state-desc">
                我们扫描了本地目录，但未发现包含有效图片（JPG, PNG, WEBP等）的子文件夹。<br />
                默认扫描目录：<code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8rem', display: 'inline-block', marginTop: 6 }}>{scanDirectory || './resources'}</code>
              </p>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 10, width: '100%' }}>
              <button 
                onClick={fetchCollections} 
                className="glass-button active"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <RefreshCw size={14} /> 重新加载
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)} 
                className="glass-button"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                <Settings size={14} /> 打开设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Slider - Positioned at the bottom */}
      {collections.length > 0 && (
        <div 
          ref={zoomSliderRef}
          className="zoom-slider-container"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            background: 'rgba(13, 18, 31, 0.85)',
            backdropFilter: 'blur(12px)',
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            cursor: 'ns-resize',
            userSelect: 'none'
          }}
        >
          <ZoomOut size={16} style={{ color: 'var(--text-secondary)' }} />
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2
          }}>
            <span style={{ 
              fontSize: '0.6rem', 
              color: 'var(--text-muted)',
              fontWeight: 600,
              letterSpacing: '0.05em'
            }}>
              缩放
            </span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoomScale}
              onChange={handleZoomSliderChange}
              className="zoom-slider"
              style={{
                width: 200,
                cursor: 'pointer'
              }}
            />
            <span style={{ 
              fontSize: '0.65rem', 
              color: 'var(--accent-purple)',
              fontWeight: 600
            }}>
              {Math.round(zoomScale * 100)}%
            </span>
          </div>
          
          <ZoomIn size={16} style={{ color: 'var(--text-secondary)' }} />
          
          <div style={{
            width: 1,
            height: 30,
            background: 'rgba(255, 255, 255, 0.1)',
            margin: '0 4px'
          }} />
          
          <button
            onClick={() => setZoomScale(1)}
            className="glass-button"
            style={{
              padding: '4px 10px',
              fontSize: '0.7rem',
              background: zoomScale === 1 ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)'
            }}
            title="重置缩放"
          >
            重置
          </button>
        </div>
      )}

      {/* Pagination Pill */}
      {isPaginated && (
        <div className="glass-panel pagination-deck">
          <button 
            type="button"
            onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
            disabled={currentPage === 0}
            className="glass-button"
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            <ChevronLeft size={14} /> 上一批
          </button>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            第 {currentPage + 1} / {totalPages} 批 (每批 {pageSize} 个 / 共 {collections.length} 个)
          </span>
          <button 
            type="button"
            onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
            disabled={currentPage === totalPages - 1}
            className="glass-button"
            style={{ padding: '6px 12px', fontSize: '0.75rem' }}
          >
            下一批 <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Control HUD */}
      {collections.length > 0 && (
        <ControlHUD
          tileCount={tileCount}
          setTileCount={setTileCount}
          isAutoTiling={isAutoTiling}
          setIsAutoTiling={setIsAutoTiling}
          globalSpeed={globalSpeed}
          setGlobalSpeed={setGlobalSpeed}
          globalIsPlaying={globalIsPlaying}
          setGlobalIsPlaying={setGlobalIsPlaying}
          onShuffleAll={shuffleAllTiles}
          onOpenSettings={() => setIsSettingsOpen(true)}
          collectionsCount={collections.length}
          scanDirectory={scanDirectory}
          globalTransitionEffect={globalTransitionEffect}
          setGlobalTransitionEffect={setGlobalTransitionEffect}
          sortMethod={sortMethod}
          setSortMethod={setSortMethod}
        />
      )}

      {/* Settings Drawer Backdrop */}
      <div 
        className={`drawer-backdrop ${isSettingsOpen ? 'open' : ''}`}
        onClick={() => setIsSettingsOpen(false)}
      />

      {/* Settings Drawer Panel */}
      <div className={`glass-panel settings-drawer ${isSettingsOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <h3 className="drawer-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpen size={20} className="text-purple-400" />
            高级系统设置
          </h3>
          <button 
            className="tile-mini-btn"
            onClick={() => setIsSettingsOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSaveDirectory} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 10 }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
              指定本地照片文件夹路径:
            </label>
            <input
              type="text"
              className="glass-input"
              value={inputScanDir}
              onChange={(e) => setInputScanDir(e.target.value)}
              placeholder="例如: D:/Photos/Vacation"
              style={{ width: '100%', fontSize: '0.85rem' }}
              required
            />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginTop: 6, lineHeight: 1.4 }}>
              * 默认扫描项目内的 <code>resources/</code> 目录。您可以指定本地电脑上的任何文件夹，系统会自动扫描该目录下包含图片的<strong>一级子目录</strong>，作为不同的播放"图片集"。
            </span>
          </div>

          {dirError && (
            <div style={{ color: '#f87171', fontSize: '0.75rem', padding: '8px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 6 }}>
              {dirError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmittingDir}
            className="glass-button active"
            style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
          >
            {isSubmittingDir ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>正在重载目录...</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>确认并重新扫描</span>
              </>
            )}
          </button>
        </form>

        {/* Layout Info */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 16 }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Image size={16} />
            当前布局
          </h4>
          
          <div style={{  
            background: 'rgba(139, 92, 246, 0.1)', 
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: 6, 
            padding: 10,
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.6
          }}>
            <div style={{ marginBottom: 6 }}>
              <strong>分屏模式:</strong> {tileCount} 窗口 ({gridConfig.cols}×{gridConfig.rows})
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              💡 使用底部缩放条调整窗口大小，滚轮仅在缩放条上生效
            </div>
          </div>
        </div>

        {/* Cache Management Section */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Database size={16} />
              缓存管理
            </h4>
            <button
              onClick={() => {
                fetchCacheInfo();
                setCacheMessage('');
              }}
              className="glass-button"
              style={{ fontSize: '0.7rem', padding: '4px 10px' }}
            >
              <RefreshCw size={12} /> 刷新
            </button>
          </div>

          {cacheInfo && (
            <div style={{ 
              background: 'rgba(0,0,0,0.2)', 
              borderRadius: 8, 
              padding: 12, 
              marginBottom: 12,
              fontSize: '0.75rem',
              lineHeight: 1.6
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-secondary)' }}>缓存文件:</span>
                <span style={{ color: cacheInfo.cacheExists ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                  {cacheInfo.cacheExists ? '✓ 存在' : '✗ 不存在'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-secondary)' }}>缓存路径:</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cacheInfo.cachePath}>
                  {cacheInfo.cachePath}
                </span>
              </div>
              {cacheInfo.cacheExists && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>文件大小:</span>
                    <span>{(cacheInfo.cacheSize / 1024).toFixed(2)} KB</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>缓存集合数:</span>
                    <span>{cacheInfo.cachedCollectionsCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>缓存图片集数:</span>
                    <span>{cacheInfo.cachedImagesCount || 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>最后更新:</span>
                    <span>{new Date(cacheInfo.cacheModified).toLocaleString('zh-CN')}</span>
                  </div>
                </>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 8, paddingTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>内存缓存:</span>
                  <span style={{ color: cacheInfo.hasMemoryCache ? '#10b981' : '#f59e0b' }}>
                    {cacheInfo.hasMemoryCache ? '✓ 已加载' : '⚠ 未加载'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>内存集合数:</span>
                  <span>{cacheInfo.memoryCollectionsCount}</span>
                </div>
              </div>
            </div>
          )}

          {cacheMessage && (
            <div style={{ 
              color: cacheMessage.startsWith('✅') ? '#10b981' : '#ef4444',
              fontSize: '0.75rem', 
              padding: '8px 12px', 
              background: cacheMessage.startsWith('✅') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${cacheMessage.startsWith('✅') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
              borderRadius: 6,
              marginBottom: 12
            }}>
              {cacheMessage}
            </div>
          )}

          <button
            onClick={handleClearCache}
            disabled={isClearingCache}
            className="glass-button"
            style={{ 
              width: '100%', 
              justifyContent: 'center', 
              fontSize: '0.75rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              color: '#ef4444'
            }}
          >
            {isClearingCache ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>正在清除...</span>
              </>
            ) : (
              <>
                <Trash2 size={14} />
                <span>清除缓存文件</span>
              </>
            )}
          </button>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginTop: 6, lineHeight: 1.4 }}>
            * 清除缓存后，下次访问时将重新扫描目录并创建新缓存。
          </span>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 'auto' }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>快捷扫描预设:</h4>
          <button
            onClick={() => {
              setInputScanDir('');
              fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scanDirectory: 'RESET_TO_DEFAULT' })
              }).then(() => fetchCollections());
            }}
            className="glass-button"
            style={{ width: '100%', justifyContent: 'center', fontSize: '0.75rem', background: 'rgba(255, 255, 255, 0.03)' }}
          >
            重置为项目内置 resources/
          </button>
        </div>
      </div>

    </div>
  );
}
