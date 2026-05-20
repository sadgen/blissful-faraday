import React, { useState, useEffect } from 'react';
import { RefreshCw, FolderOpen, Save, X, Settings, Image, Play, Pause, AlertTriangle, ChevronLeft, ChevronRight, Database, Trash2 } from 'lucide-react';
import SlideshowTile from './components/SlideshowTile';
import ControlHUD from './components/ControlHUD';

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
  const [tileCount, setTileCount] = useState(savedConfig?.tileCount || 4);
  const [globalSpeed, setGlobalSpeed] = useState(savedConfig?.globalSpeed || 5000);
  const [globalIsPlaying, setGlobalIsPlaying] = useState(savedConfig?.globalIsPlaying !== undefined ? savedConfig.globalIsPlaying : true);
  const [globalRefreshTrigger, setGlobalRefreshTrigger] = useState(0);
  const [globalTransitionEffect, setGlobalTransitionEffect] = useState(savedConfig?.globalTransitionEffect || 'none');
  
  // Grid layout configuration
  const [gridCols, setGridCols] = useState(savedConfig?.gridCols || 3);
  const [gridRows, setGridRows] = useState(savedConfig?.gridRows || 2);
  const [isGridLayoutManual, setIsGridLayoutManual] = useState(savedConfig?.isGridLayoutManual || false);
  
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
  const pageSize = 12; // Fixed page size for non-auto tiling mode only

  const [sortMethod, setSortMethod] = useState('name'); // 'name', 'date', 'random'
  const [randomTrigger, setRandomTrigger] = useState(0);
  
  // Tile positioning state for floating layout
  const [tilePositions, setTilePositions] = useState({});
  
  // Store aspect ratios for each collection
  const [collectionAspectRatios, setCollectionAspectRatios] = useState({});

  // 1.5. Process, sort and map collections to simple array of string names for backward compatibility
  const collections = React.useMemo(() => {
    if (!rawCollections || rawCollections.length === 0) return [];
    
    const items = [...rawCollections];
    
    let result;
    if (sortMethod === 'name') {
      result = items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    } else if (sortMethod === 'date') {
      result = items.sort((a, b) => b.mtime - a.mtime);
    } else if (sortMethod === 'random') {
      // Standard stable Fisher-Yates random shuffle based on randomTrigger
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
    
    // Remove duplicates by name and map to names only
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

  // Reset currentPage when rawCollections, sortMethod, or tileCount change
  useEffect(() => {
    setCurrentPage(0);
  }, [rawCollections, sortMethod, tileCount]);

  // 1. Fetch collections from API
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

  // Save configuration to localStorage when it changes
  useEffect(() => {
    const config = {
      tileCount,
      globalSpeed,
      globalIsPlaying,
      globalTransitionEffect,
      gridCols,
      gridRows,
      isGridLayoutManual
    };
    try {
      localStorage.setItem('blissfulFaradayConfig', JSON.stringify(config));
    } catch (err) {
      console.warn('Failed to save config:', err);
    }
  }, [tileCount, globalSpeed, globalIsPlaying, globalTransitionEffect, gridCols, gridRows, isGridLayoutManual]);

  // Auto-calculate grid layout based on collection count and screen size
  const autoCalculateGridLayout = React.useCallback((collectionCount, containerWidth, containerHeight) => {
    if (collectionCount === 0) return { cols: 3, rows: 2 };
    
    // Calculate optimal grid dimensions to fill the entire screen
    // Allow overlapping to maximize screen utilization
    const aspectRatio = containerWidth / containerHeight;
    
    // More aggressive calculation: aim for tighter packing with overlap
    // Use a smaller divisor to create more columns/rows
    let cols = Math.ceil(Math.sqrt(collectionCount * aspectRatio * 1.2)); // 1.2 factor for tighter packing
    let rows = Math.ceil(collectionCount / cols);
    
    // Optimize to minimize empty cells while maximizing coverage
    const totalCells = cols * rows;
    const emptyCells = totalCells - collectionCount;
    
    // If we have too many empty cells, try alternative configurations
    if (emptyCells > collectionCount * 0.2 && rows > 1) {
      // Try reducing columns by 1
      const altCols1 = cols - 1;
      const altRows1 = Math.ceil(collectionCount / altCols1);
      const altEmpty1 = (altCols1 * altRows1) - collectionCount;
      
      // Try increasing columns by 1
      const altCols2 = cols + 1;
      const altRows2 = Math.ceil(collectionCount / altCols2);
      const altEmpty2 = (altCols2 * altRows2) - collectionCount;
      
      // Choose the configuration with fewer empty cells
      if (altEmpty1 < emptyCells && altEmpty1 <= altEmpty2) {
        cols = altCols1;
        rows = altRows1;
      } else if (altEmpty2 < emptyCells) {
        cols = altCols2;
        rows = altRows2;
      }
    }
    
    // Ensure minimum coverage: prefer more cells over fewer
    // Check if adding one more row would reduce empty space significantly
    if (rows > 1) {
      const altRows = rows - 1;
      const altCols = Math.ceil(collectionCount / altRows);
      const altEmpty = (altCols * altRows) - collectionCount;
      const currentEmpty = (cols * rows) - collectionCount;
      
      // Only reduce rows if it doesn't increase empty cells too much
      if (altEmpty <= currentEmpty + 2) {
        cols = altCols;
        rows = altRows;
      }
    }
    
    // Apply reasonable limits (slightly increased for better coverage)
    cols = Math.max(1, Math.min(16, cols));
    rows = Math.max(1, Math.min(10, rows));
    
    return { cols, rows };
  }, []);

  // Auto-adjust grid layout when tileCount changes (only if user hasn't manually adjusted)
  useEffect(() => {
    if (collections.length > 0 && !isGridLayoutManual) {
      let cols, rows;
      
      // Preset configurations for specific tile counts
      const presets = {
        1: { cols: 1, rows: 1 },
        3: { cols: 3, rows: 1 },
        5: { cols: 5, rows: 1 },
        12: { cols: 6, rows: 2 }
      };
      
      if (presets[tileCount]) {
        // Use preset configuration
        cols = presets[tileCount].cols;
        rows = presets[tileCount].rows;
      } else {
        // Auto-calculate for other values
        const result = autoCalculateGridLayout(
          tileCount,
          window.innerWidth,
          window.innerHeight
        );
        cols = result.cols;
        rows = result.rows;
      }
      
      // Only update if values actually changed
      setGridCols(prevCols => prevCols !== cols ? cols : prevCols);
      setGridRows(prevRows => prevRows !== rows ? rows : prevRows);
    }
  }, [tileCount, isAutoTiling, autoCalculateGridLayout]);

  // Handle manual grid column change - mark as manual and update
  const handleGridColsChange = (value) => {
    setIsGridLayoutManual(true);
    setGridCols(value);
  };

  // Handle manual grid row change - mark as manual and update
  const handleGridRowsChange = (value) => {
    setIsGridLayoutManual(true);
    setGridRows(value);
  };

  // Calculate floating tile positions with overlap
  const calculateTilePositions = React.useCallback((collections, containerWidth, containerHeight) => {
    const positions = {};
    const overlapOffset = 80; // Increased overlap for tighter packing
    const padding = 5; // Minimal padding to fill the screen
    
    // Calculate available space (use almost entire screen)
    const availableWidth = containerWidth - (padding * 2);
    const availableHeight = containerHeight - (padding * 2);
    
    // Use a larger base size to fill more space
    const baseSize = Math.min(450, availableWidth / gridCols * 1.1); // 1.1 factor for better coverage
    
    let currentX = padding;
    let currentY = padding;
    let rowHeight = 0;
    let colCount = 0;
    
    collections.forEach((collName, index) => {
      // Use actual aspect ratio if available, otherwise default to 0.75 (3:4 portrait)
      const aspectRatio = collectionAspectRatios[collName] || 0.75;
      
      // Calculate dimensions based on aspect ratio, but keep within reasonable bounds
      let tileWidth, tileHeight;
      
      if (aspectRatio >= 1) {
        // Landscape or square: width-based
        tileWidth = baseSize;
        tileHeight = tileWidth / aspectRatio;
      } else {
        // Portrait: height-based, but ensure minimum width
        tileHeight = baseSize / 0.75; // Target height for portrait
        tileWidth = tileHeight * aspectRatio;
        
        // Ensure portrait photos don't become too narrow
        if (tileWidth < baseSize * 0.6) {
          tileWidth = baseSize * 0.6;
          tileHeight = tileWidth / aspectRatio;
        }
      }
      
      // Apply min/max constraints (slightly increased for better coverage)
      tileWidth = Math.max(280, Math.min(550, tileWidth));
      tileHeight = Math.max(320, Math.min(750, tileHeight));
      
      // Check if we need to start a new row
      if (colCount >= gridCols && index > 0) {
        currentX = padding;
        currentY += rowHeight - overlapOffset; // Overlap between rows
        rowHeight = 0;
        colCount = 0;
      }
      
      positions[collName] = {
        left: currentX,
        top: currentY,
        width: tileWidth,
        height: tileHeight
      };
      
      // Update position for next tile (horizontal overlap)
      currentX += tileWidth - overlapOffset * 0.7; // More horizontal overlap
      rowHeight = Math.max(rowHeight, tileHeight);
      colCount++;
    });
    
    return positions;
  }, [gridCols, gridRows, collectionAspectRatios]);

  // Calculate tile positions when collections change or window resizes
  useEffect(() => {
    if (collections.length > 0) {
      let resizeTimeout;
      
      const updatePositions = () => {
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;
        
        // Recalculate grid layout based on new screen size (only if not manually adjusted)
        if (!isGridLayoutManual) {
          let cols, rows;
          
          // Check for preset configurations
          const presets = {
            1: { cols: 1, rows: 1 },
            3: { cols: 3, rows: 1 },
            5: { cols: 5, rows: 1 },
            12: { cols: 6, rows: 2 }
          };
          
          if (presets[tileCount]) {
            cols = presets[tileCount].cols;
            rows = presets[tileCount].rows;
          } else {
            const result = autoCalculateGridLayout(
              tileCount,
              containerWidth,
              containerHeight
            );
            cols = result.cols;
            rows = result.rows;
          }
          
          // Only update if grid dimensions changed significantly
          if (cols !== gridCols || rows !== gridRows) {
            setGridCols(cols);
            setGridRows(rows);
          }
        }
        
        const positions = calculateTilePositions(collections, containerWidth, containerHeight);
        setTilePositions(positions);
      };
      
      // Debounce resize events to avoid excessive recalculations
      const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(updatePositions, 300);
      };
      
      updatePositions();
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        clearTimeout(resizeTimeout);
      };
    }
  }, [collections, calculateTilePositions, autoCalculateGridLayout, gridCols, gridRows]);

  // Handle aspect ratio updates from child components
  const handleAspectRatioChange = React.useCallback((collName, aspectRatio) => {
    setCollectionAspectRatios(prev => {
      const prevRatio = prev[collName];
      // Only update if the aspect ratio changed significantly (more than 10% difference)
      // This prevents constant re-layout when switching between similar images
      if (prevRatio && Math.abs(prevRatio - aspectRatio) / prevRatio < 0.1) {
        return prev;
      }
      return { ...prev, [collName]: aspectRatio };
    });
  }, []);

  // 2. Save new scanned directory
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

      // Reload collections from new directory
      setScanDirectory(data.scanDirectory);
      setRawCollections([]); // Reset current
      setIsSettingsOpen(false);
      
      // Fetch collections
      await fetchCollections();
      // Shuffle tiles once loaded
      shuffleAllTiles();
    } catch (err) {
      setDirError(err.message);
    } finally {
      setIsSubmittingDir(false);
    }
  };

  // Trigger collections shuffle
  const shuffleAllTiles = () => {
    setRandomTrigger(prev => prev + 1);
    setGlobalRefreshTrigger(prev => prev + 1);
  };

  // Fetch cache information
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

  // Clear cache
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
      
      // Reload collections to rebuild cache
      await fetchCollections();
    } catch (err) {
      setCacheMessage(`❌ 错误: ${err.message}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  // 3. Grid sizing helper to fill the viewport seamlessly (Vertical Layout)
  const getGridLayout = (count) => {
    if (count === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    if (count === 2) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
    if (count === 3) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr 1fr' };
    if (count === 4) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
    if (count <= 6) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' };
    if (count <= 8) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr 1fr 1fr' };
    if (count === 9) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr' };
    if (count <= 12) return { gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr 1fr' };
    return { gridTemplateColumns: '1fr 1fr 1fr 1fr', gridTemplateRows: '1fr 1fr 1fr 1fr' };
  };

  const isPaginated = !isAutoTiling && collections.length > pageSize;
  const totalPages = isPaginated ? Math.ceil(collections.length / pageSize) : 1;

  // Auto tiling: limit to tileCount windows if set, otherwise show all
  const activeCollections = isAutoTiling
    ? collections.slice(0, tileCount || collections.length)
    : (isPaginated 
        ? collections.slice(currentPage * pageSize, (currentPage + 1) * pageSize) 
        : collections);

  const activeTileCount = isAutoTiling ? (activeCollections.length || 1) : tileCount;
  const gridStyle = getGridLayout(activeTileCount);

  // Render a nice loading screen
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
      
      {/* 1. Viewport Tiled Grid */}
      {collections.length > 0 ? (
        <div className="viewport-grid" style={{ position: 'relative' }}>
          {isAutoTiling ? (
            activeCollections.map((collName, index) => {
              const position = tilePositions[collName] || { left: 20, top: 20, width: 350, height: 467 };
              
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
                    collections={[collName]} // Only pass the current collection to avoid duplicates
                    initialCollectionName={collName}
                    globalSpeed={globalSpeed}
                    globalIsPlaying={globalIsPlaying}
                    globalRefreshTrigger={globalRefreshTrigger}
                    isSingle={activeTileCount === 1}
                    globalTransitionEffect={globalTransitionEffect}
                    onAspectRatioChange={handleAspectRatioChange}
                  />
                </div>
              );
            })
          ) : (
            // Non-auto tiling mode: create windows based on tileCount
            Array.from({ length: Math.min(tileCount, collections.length) }).map((_, index) => {
              const collName = collections[index];
              const position = tilePositions[collName] || { left: 20 + (index % 3) * 280, top: 20 + Math.floor(index / 3) * 380, width: 350, height: 467 };
              
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
                    collections={collections}
                    initialCollectionName={collName}
                    globalSpeed={globalSpeed}
                    globalIsPlaying={globalIsPlaying}
                    globalRefreshTrigger={globalRefreshTrigger}
                    isSingle={activeTileCount === 1}
                    globalTransitionEffect={globalTransitionEffect}
                    onAspectRatioChange={handleAspectRatioChange}
                  />
                </div>
              );
            })
          )}
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

      {/* Immersive Pagination Pill (Shows only in Auto Tiling when folders > pageSize) */}
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

      {/* 2. Floating Control HUD (Shows if collections exist) */}
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
          gridCols={gridCols}
          setGridCols={handleGridColsChange}
          gridRows={gridRows}
          setGridRows={handleGridRowsChange}
        />
      )}

      {/* 3. Settings Drawer Backdrop */}
      <div 
        className={`drawer-backdrop ${isSettingsOpen ? 'open' : ''}`}
        onClick={() => setIsSettingsOpen(false)}
      />

      {/* 4. Settings Drawer Panel (Glassmorphic) */}
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
              * 默认扫描项目内的 <code>resources/</code> 目录。您可以指定本地电脑上的任何文件夹，系统会自动扫描该目录下包含图片的<strong>一级子目录</strong>，作为不同的播放“图片集”。
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

        {/* Grid Layout Configuration */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 16 }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Image size={16} />
            网格布局配置
          </h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                列数 (Cols)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={gridCols}
                onChange={(e) => handleGridColsChange(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                className="glass-input"
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                行数 (Rows)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={gridRows}
                onChange={(e) => handleGridRowsChange(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                className="glass-input"
                style={{ width: '100%', fontSize: '0.85rem' }}
              />
            </div>
          </div>
          
          {/* Reset button when manually adjusted */}
          {isGridLayoutManual && (
            <button
              onClick={() => {
                setIsGridLayoutManual(false);
                // Recalculate based on tileCount with presets
                const presets = {
                  1: { cols: 1, rows: 1 },
                  3: { cols: 3, rows: 1 },
                  5: { cols: 5, rows: 1 },
                  12: { cols: 6, rows: 2 }
                };
                
                let cols, rows;
                if (presets[tileCount]) {
                  cols = presets[tileCount].cols;
                  rows = presets[tileCount].rows;
                } else {
                  const result = autoCalculateGridLayout(
                    tileCount,
                    window.innerWidth,
                    window.innerHeight
                  );
                  cols = result.cols;
                  rows = result.rows;
                }
                setGridCols(cols);
                setGridRows(rows);
              }}
              style={{
                width: '100%',
                marginTop: 12,
                padding: '8px 12px',
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: 6,
                color: '#60a5fa',
                fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.background = 'rgba(59, 130, 246, 0.3)'}
              onMouseLeave={(e) => e.target.style.background = 'rgba(59, 130, 246, 0.2)'}
            >
              🔄 恢复自动计算布局
            </button>
          )}
          
          <div style={{  
            background: 'rgba(139, 92, 246, 0.1)', 
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: 6, 
            padding: 10,
            fontSize: '0.7rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5
          }}>
            💡 提示：窗口大小会根据屏幕尺寸和布局配置自动调整，以平衡填充效果和图片显示质量。
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
              // Reset back to workspace 'resources' folder
              setInputScanDir(path => {
                // Let's set it to empty/default which the server resolves to original resources
                const defaultDir = window.location.origin; // server will reset it
                return '';
              });
              // Simple reload trick
              fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scanDirectory: 'RESET_TO_DEFAULT' }) // We can handle this in server or send original
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
