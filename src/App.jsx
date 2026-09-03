import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DesktopLayout from './components/DesktopLayout';
import MobileLayout from './components/MobileLayout';
import ErrorBoundary from './components/ErrorBoundary';
import UndoToast from './components/UndoToast';
import useDeleteUndoManager from './hooks/useDeleteUndoManager';
import { RefreshCw } from 'lucide-react';

import LoginOverlay from './components/LoginOverlay';

// Preset grid configurations for each tile count
const GRID_PRESETS = {
  1: { cols: 1, rows: 1 },
  2: { cols: 1, rows: 2 },
  3: { cols: 3, rows: 1 },
  4: { cols: 2, rows: 2 },
  5: { cols: 5, rows: 1 },
  6: { cols: 2, rows: 3 },
  12: { cols: 6, rows: 2 }
};

// Allowed tile counts
const ALLOWED_TILE_COUNTS = [1, 3, 5, 12];

// Zoom slider constants
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.05;

// HUD bar height (for bottom bar)
const HUD_HEIGHT = 50;

// High-Performance Safe JSON Fetcher (with friendly fallback for static hosting modes)
const safeFetchJSON = async (url, options = {}) => {
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const err = new Error(`非 JSON 格式响应 (收到 ${contentType || '空'})`);
    err.isStaticFallback = true;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData.error || `HTTP 错误 ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
};

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

  // Load cached collections list for instant rendering on refresh (SWR pattern)
  const loadCachedCollections = () => {
    try {
      const cached = localStorage.getItem('blissfulFaradayCollectionsCache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.warn('Failed to load cached collections:', err);
    }
    return { collections: [], scanDirectory: '' };
  };

  const cachedData = loadCachedCollections();

  const [rawCollections, setRawCollections] = useState(cachedData.collections || []);
  const [scanDirectory, setScanDirectory] = useState(cachedData.scanDirectory || '');
  const [isAutoTiling, setIsAutoTiling] = useState(savedConfig?.isAutoTiling !== undefined ? savedConfig.isAutoTiling : true);
  const [tileCount, setTileCount] = useState(savedConfig?.tileCount || 1);
  const [globalSpeed, setGlobalSpeed] = useState(savedConfig?.globalSpeed || 5000);
  const [globalIsPlaying, setGlobalIsPlaying] = useState(savedConfig?.globalIsPlaying !== undefined ? savedConfig.globalIsPlaying : true);
  const [globalRefreshTrigger, setGlobalRefreshTrigger] = useState(0);
  const [globalTransitionEffect, setGlobalTransitionEffect] = useState(savedConfig?.globalTransitionEffect || 'none');
  const [isSyncMode, setIsSyncMode] = useState(savedConfig?.isSyncMode !== undefined ? savedConfig.isSyncMode : false);
  const [videoSpeed, setVideoSpeed] = useState(savedConfig?.videoSpeed || 2);
  const [imageSort, setImageSort] = useState(savedConfig?.imageSort || 'name');

  // Track page visibility to pause/resume slideshow when tab is inactive/active
  const [isDocumentVisible, setIsDocumentVisible] = useState(document.visibilityState === 'visible');

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  
  // 目录历史记录状态
  const [directoryHistory, setDirectoryHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('blissfulFaradayDirHistory');
      return saved ? JSON.parse(saved) : [];
    } catch (err) {
      console.warn('Failed to load directory history:', err);
      return [];
    }
  });

  // 当 scanDirectory 改变时，更新并持久化目录历史
  useEffect(() => {
    if (scanDirectory) {
      setDirectoryHistory(prev => {
        const next = [scanDirectory, ...prev.filter(d => d !== scanDirectory)];
        const sliced = next.slice(0, 10);
        try {
          localStorage.setItem('blissfulFaradayDirHistory', JSON.stringify(sliced));
        } catch (err) {
          console.warn('Failed to save directory history:', err);
        }
        return sliced;
      });
    }
  }, [scanDirectory]);

  // 删除单条目录历史记录
  const handleRemoveHistoryItem = useCallback((dirToRemove) => {
    setDirectoryHistory(prev => {
      const next = prev.filter(d => d !== dirToRemove);
      try {
        localStorage.setItem('blissfulFaradayDirHistory', JSON.stringify(next));
      } catch (err) {
        console.warn('Failed to update directory history:', err);
      }
      return next;
    });
  }, []);

  // Settings drawer state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [inputScanDir, setInputScanDir] = useState(cachedData.scanDirectory || '');
  const [isSubmittingDir, setIsSubmittingDir] = useState(false);
  const [dirError, setDirError] = useState('');
  const [isLoading, setIsLoading] = useState(cachedData.collections && cachedData.collections.length > 0 ? false : true);
  const [fetchError, setFetchError] = useState('');
  
  // Cache management state
  const [cacheInfo, setCacheInfo] = useState(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState('');

    const [sortMethod, setSortMethod] = useState(savedConfig?.sortMethod || 'random');
  const [randomTrigger, setRandomTrigger] = useState(0);
  
  // Viewport detection
  const [isMobile, setIsMobile] = useState(false);

  // Authentication & Security state
  const [adminConfig, setAdminConfig] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [authStatusChecked, setAuthStatusChecked] = useState(false);
  const [authError, setAuthError] = useState('');

  const checkAuthStatus = useCallback(async () => {
    try {
      const data = await safeFetchJSON('/api/auth/status');
      setIsAuthenticated(!data.enabled || data.authenticated);
    } catch (err) {
      if (err.isStaticFallback) {
        console.info('Backend security service is unavailable (static hosting mode). Defaulting to unauthenticated access.');
        setIsAuthenticated(true);
      } else {
        console.warn('Failed to check auth status:', err.message || err);
      }
    } finally {
      setAuthStatusChecked(true);
    }
  }, []);

  const fetchAdminConfig = useCallback(async () => {
    try {
      setAuthError('');
      const data = await safeFetchJSON('/api/auth/admin/config');
      setAdminConfig(data);
    } catch (err) {
      if (err.isStaticFallback) {
        console.info('Admin security config is unavailable in static hosting mode.');
        setAuthError('STATIC_FALLBACK');
      } else {
        console.warn('Failed to fetch admin security config:', err.message || err);
        setAuthError(err.message || '连接安全服务出错');
      }
    }
  }, []);

  // Fetch collections from API
  const fetchCollections = async () => {
    try {
      // Only show loader if we have no cached collections to prevent full-screen spinner on refresh
      if (rawCollections.length === 0) {
        setIsLoading(true);
      }
      setFetchError('');
      const data = await safeFetchJSON('/api/collections');
      
      const nextCollections = data.collections || [];
      const nextScanDirectory = data.scanDirectory || '';
      
      setRawCollections(nextCollections);
      setScanDirectory(nextScanDirectory);
      setInputScanDir(nextScanDirectory);
      
      // Update local storage cache
      try {
        localStorage.setItem('blissfulFaradayCollectionsCache', JSON.stringify({
          collections: nextCollections,
          scanDirectory: nextScanDirectory
        }));
      } catch (err) {
        console.warn('Failed to cache collections in localStorage:', err);
      }
    } catch (err) {
      if (err.isStaticFallback) {
        console.info('Backend scanner is unavailable. Using cached local collections (static hosting/offline mode).');
      } else {
        console.error('Failed to fetch collections:', err.message || err);
        setFetchError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const { toasts, queueDelete } = useDeleteUndoManager(fetchCollections);

  // Fetch admin config automatically on settings open
  useEffect(() => {
    if (isSettingsOpen && isAuthenticated) {
      fetchAdminConfig();
    }
  }, [isSettingsOpen, isAuthenticated, fetchAdminConfig]);

  // Initial check
  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  // Security Operations Mutators
  const handleUpdateAdminConfig = async (updates) => {
    try {
      const res = await fetch('/api/auth/admin/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || '更新安全设置失败');
      }
      // Reload states
      await checkAuthStatus();
      await fetchAdminConfig();
      return true;
    } catch (err) {
      console.error(err);
      throw err;
    }
  };

  const handleRevokeSession = async (id) => {
    try {
      const res = await fetch('/api/auth/admin/revoke-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        throw new Error('无法注销在线设备');
      }
      await fetchAdminConfig();
    } catch (err) {
      console.warn('Failed to revoke session:', err);
    }
  };

  const handleClearLogs = async () => {
    try {
      const res = await fetch('/api/auth/admin/clear-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        throw new Error('无法清空日志');
      }
      await fetchAdminConfig();
    } catch (err) {
      console.warn('Failed to clear logs:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setIsAuthenticated(false);
      await checkAuthStatus();
    } catch (err) {
      console.warn('Logout request failed:', err);
    }
  };

  
  // Tile positioning state
  const [tilePositions, setTilePositions] = useState({});
  
  // Tile aspect ratios for adaptive sizing
  const [tileAspectRatios, setTileAspectRatios] = useState({});
  
  // Zoom state for the scale slider
  const [zoomScale, setZoomScale] = useState(savedConfig?.zoomScale || 1);
  
  // HUD pinned state (whether the HUD bar is always visible)
  const [isHUDpinned, setIsHUDpinned] = useState(savedConfig?.isHUDpinned !== undefined ? savedConfig.isHUDpinned : true);
  
  // Ref for zoom slider container to capture wheel events
  const zoomSliderRef = useRef(null);

  // Synchronized state for displayed collections per tile slot
  const [displayedCollections, setDisplayedCollections] = useState([]);
  // Counter that increments only on directory switch (not on per-tile collection changes),
  // so DesktopLayout's reset effect doesn't fire when a single tile changes its collection.
  const [dirResetKey, setDirResetKey] = useState(0);

  // Track dragging offset positions for layout intersection checks
  const [draggedOffsets, setDraggedOffsets] = useState({});

  // Reset all dragged offsets whenever global speed, refresh, tile count, or layout settings change
  useEffect(() => {
    setDraggedOffsets({});
  }, [globalRefreshTrigger, tileCount, isAutoTiling]);

  // Callback to record a tile's dragged offset
  const handleTileDrag = useCallback((tileId, offset) => {
    setDraggedOffsets(prev => ({
      ...prev,
      [tileId]: offset
    }));
  }, []);

  // 1. Process, sort and map collections
  const collections = useMemo(() => {
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
    fetchCollections();
  }, []);

  // Viewport & LAN IP Fetching Effects
  useEffect(() => {
    const checkMobile = () => {
      const widthMatch = window.innerWidth < 768;
      const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(widthMatch || uaMatch);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Enforce mobile-specific split screen presets [1, 2, 4, 6] and manual-only mode
  useEffect(() => {
    if (isMobile) {
      setIsAutoTiling(false);
      if (![1, 2, 4, 6].includes(tileCount)) {
        setTileCount(2);
      }
    }
  }, [isMobile, tileCount]);

  // Save configuration to localStorage
  useEffect(() => {
    const config = {
      tileCount,
      globalSpeed,
      globalIsPlaying,
      globalTransitionEffect,
      isSyncMode,
      sortMethod,
      isAutoTiling,
      zoomScale,
      isHUDpinned,
      videoSpeed,
      imageSort
    };
    try {
      localStorage.setItem('blissfulFaradayConfig', JSON.stringify(config));
    } catch (err) {
      console.warn('Failed to save config:', err);
    }
  }, [tileCount, globalSpeed, globalIsPlaying, globalTransitionEffect, isSyncMode, sortMethod, isAutoTiling, zoomScale, isHUDpinned, videoSpeed, imageSort]);

  // Get current grid config
  const gridConfig = GRID_PRESETS[tileCount] || GRID_PRESETS[1];

  // Handle aspect ratio change from tiles - shrink height for landscape images
  const handleAspectRatioChange = useCallback((tileId, aspectRatio) => {
    setTileAspectRatios(prev => ({
      ...prev,
      [tileId]: aspectRatio
    }));
  }, []);

  // Calculate tile positions - adaptive height based on aspect ratio
  // Width is determined by layout, then height is calculated from aspect ratio
  const calculateTilePositions = useCallback((count, containerWidth, containerHeight) => {
    const positions = {};
    
    if (count === 0) return positions;
    
    const { cols, rows } = gridConfig;
    
    // Calculate available height (subtract HUD bar height)
    const availableHeight = containerHeight - HUD_HEIGHT;
    
    // Base tile dimensions from layout
    const baseWidth = containerWidth / cols;
    const baseHeight = availableHeight / rows;
    
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      // Get aspect ratio for this tile (default to 9:16 portrait)
      const aspectRatio = tileAspectRatios[i] || (9 / 16);
      
      // Calculate height based on width and aspect ratio
      // Height = Width / AspectRatio
      const calculatedHeight = baseWidth / aspectRatio;
      
      // Use the smaller of base height or calculated height (to fit in cell)
      const adjustedHeight = rows === 2 ? calculatedHeight : Math.min(baseHeight, calculatedHeight);
      
      // Calculate vertical offset to center the tile within the cell
      // For 2-row layouts (like 12 windows), stick top row to page top (offset 0) and bottom row to page bottom
      let verticalOffset = (baseHeight - adjustedHeight) / 2;
      if (rows === 2) {
        if (row === 0) {
          verticalOffset = 0;
        } else if (row === 1) {
          verticalOffset = baseHeight - adjustedHeight;
        }
      }
      
      const baseLeft = col * baseWidth;
      const baseTop = row * baseHeight;
      
      positions[i] = {
        left: baseLeft,
        top: baseTop + verticalOffset,
        width: baseWidth,
        height: adjustedHeight,
        // Store base dimensions for zoom calculations
        baseWidth: baseWidth,
        baseHeight: adjustedHeight
      };
    }
    
    return positions;
  }, [gridConfig, tileAspectRatios]);

  // Calculate scaled positions based on zoom scale
  // Only scale width, recalculate height based on aspect ratio
  const getScaledPositions = useCallback(() => {
    const scaledPositions = {};
    
    Object.entries(tilePositions).forEach(([index, pos]) => {
      // Get aspect ratio from tileAspectRatios (default to 9:16 portrait)
      const aspectRatio = tileAspectRatios[index] || (9 / 16);
      
      // Scale only the width
      const scaledWidth = pos.baseWidth * zoomScale;
      
      // Recalculate height based on aspect ratio: height = width / aspectRatio
      const calculatedHeight = scaledWidth / aspectRatio;
      
      // Get the baseHeight from the cell (available height per row)
      const containerHeight = window.innerHeight;
      const { cols, rows } = gridConfig;
      const availableHeight = containerHeight - HUD_HEIGHT;
      const baseHeight = availableHeight / rows;
      
      // Use the smaller of cell height or calculated height
      const scaledHeight = rows === 2 ? calculatedHeight : Math.min(baseHeight, calculatedHeight);
      
      // Keep left position aligned with grid column
      // Adjust top to center within the cell
      // For 2-row layouts (like 12 windows), stick top row to page top (offset 0) and bottom row to page bottom
      let verticalOffset = (baseHeight - scaledHeight) / 2;
      const col = index % cols;
      const row = Math.floor(index / cols);
      if (rows === 2) {
        if (row === 0) {
          verticalOffset = 0;
        } else if (row === 1) {
          verticalOffset = baseHeight - scaledHeight;
        }
      }
      const baseWidth = window.innerWidth / cols;
      
      scaledPositions[index] = {
        left: col * baseWidth,
        top: row * baseHeight + verticalOffset,
        width: scaledWidth,
        height: scaledHeight,
        baseWidth: pos.baseWidth
      };
    });
    
    return scaledPositions;
  }, [tilePositions, zoomScale, tileAspectRatios, gridConfig]);

  // Calculate tile positions when collections change or window resizes
  useEffect(() => {
    if (collections.length > 0) {
      let resizeTimeout;
      
      const updatePositions = () => {
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;
        
        const count = isAutoTiling
          ? Math.min(tileCount || collections.length, collections.length)
          : Math.min(tileCount, collections.length);
        
        const positions = calculateTilePositions(count, containerWidth, containerHeight);
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
  }, [collections, tileCount, isAutoTiling, calculateTilePositions]);

  // Recalculate positions when aspect ratios change
  useEffect(() => {
    if (collections.length > 0 && Object.keys(tileAspectRatios).length > 0) {
      const containerWidth = window.innerWidth;
      const containerHeight = window.innerHeight;
      
      const count = isAutoTiling
        ? Math.min(tileCount || collections.length, collections.length)
        : Math.min(tileCount, collections.length);
      
      const positions = calculateTilePositions(count, containerWidth, containerHeight);
      setTilePositions(positions);
    }
  }, [tileAspectRatios, collections.length, tileCount, isAutoTiling]);

  // Handle wheel events globally - only work when mouse is over zoom slider
  const handleGlobalWheel = useCallback((e) => {
    const slider = zoomSliderRef.current;
    if (!slider) return;
    
    // Get the bounding rect of the zoom slider
    const rect = slider.getBoundingClientRect();
    
    // Check if mouse position is within the zoom slider area
    const isOverZoomSlider = 
      e.clientX >= rect.left && 
      e.clientX <= rect.right && 
      e.clientY >= rect.top && 
      e.clientY <= rect.bottom;
    
    // Only adjust zoom when mouse is over the zoom slider area
    if (isOverZoomSlider) {
      e.preventDefault();
      e.stopPropagation();
      
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoomScale(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
    }
    // If not over zoom slider, do nothing (don't prevent default)
  }, []);

  // Add global wheel event listener
  useEffect(() => {
    const wheelHandler = (e) => handleGlobalWheel(e);
    
    window.addEventListener('wheel', wheelHandler, { passive: false });
    
    return () => {
      window.removeEventListener('wheel', wheelHandler);
    };
  }, [handleGlobalWheel]);

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

      // Clear local cache for the old directory to force clean loading
      try {
        localStorage.removeItem('blissfulFaradayCollectionsCache');
      } catch (err) {}

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
      const res = await fetch(`/api/cache/info?t=${Date.now()}`);
      if (!res.ok) {
        throw new Error(`API error: ${res.statusText}`);
      }
      const data = await res.json();
      setCacheInfo(data);
    } catch (err) {
      console.error('Failed to fetch cache info:', err);
      setCacheInfo({ error: true, message: err.message });
      setCacheMessage('⚠️ 无法连接到本地后台服务。请检查命令行窗口，确认已运行 npm run dev 启动了 Vite 开发服务器。如果直接双击打开了 dist/index.html 文件，部分高级缓存功能将无法使用。');
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
      
      // Clear frontend cache as well
      try {
        localStorage.removeItem('blissfulFaradayCollectionsCache');
      } catch (err) {}

      setCacheMessage('✅ 缓存已成功清除');
      setCacheInfo(null);
      await fetchCollections();
    } catch (err) {
      setCacheMessage(`❌ 错误: ${err.message}`);
    } finally {
      setIsClearingCache(false);
    }
  };

  // Active collections for display - matches exactly the active split screen count
  const activeCollections = useMemo(() => {
    return collections.slice(0, tileCount || collections.length);
  }, [collections, tileCount]);

  const activeTileCount = isAutoTiling ? (activeCollections.length || 1) : tileCount;

  const prevScanDirRef = useRef(scanDirectory);
  // Sync displayed collections only on initial load or when scanDirectory truly switches
  useEffect(() => {
    if (prevScanDirRef.current !== scanDirectory) {
      prevScanDirRef.current = scanDirectory;
      setDirResetKey(k => k + 1);
      setDisplayedCollections(activeCollections);
    } else if (displayedCollections.length === 0 && activeCollections.length > 0) {
      setDisplayedCollections(activeCollections);
    }
  }, [scanDirectory, activeCollections, displayedCollections.length]);

  // Handle folder change for a specific tile slot
  const handleCollectionChangeForTile = useCallback((tileId, newCollName) => {
    setDisplayedCollections(prev => {
      const next = [...prev];
      next[tileId] = newCollName;
      return next;
    });
  }, []);

  // Get scaled positions for rendering
  const scaledPositions = useMemo(() => {
    if (zoomScale === 1) return tilePositions;
    return getScaledPositions();
  }, [zoomScale, tilePositions, tileAspectRatios, tileCount]);

  // Real positions of tiles incorporating drag offsets
  const realTilePositions = useMemo(() => {
    const positions = {};
    Object.entries(scaledPositions).forEach(([index, pos]) => {
      const offset = draggedOffsets[index] || { x: 0, y: 0 };
      positions[index] = {
        left: pos.left + offset.x,
        top: pos.top + offset.y,
        width: pos.width,
        height: pos.height
      };
    });
    return positions;
  }, [scaledPositions, draggedOffsets]);

  // Calculate overlapping tile IDs (2D rectangular collision detection)
  // To keep non-overlapping parts at 100% opacity, we only flag the upper-most overlapping element (id2)
  // as overlapping. The under-lapping element (id1) remains at 100% opacity.
  const overlappingTiles = useMemo(() => {
    const overlapping = new Set();
    const keys = Object.keys(realTilePositions);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const id1 = keys[i];
        const id2 = keys[j];
        const r1 = realTilePositions[id1];
        const r2 = realTilePositions[id2];
        if (!r1 || !r2) continue;
        const intersect = !(r2.left >= r1.left + r1.width ||
                            r2.left + r2.width <= r1.left ||
                            r2.top >= r1.top + r1.height ||
                            r2.top + r2.height <= r1.top);
        if (intersect) {
          // id2 is rendered later, so it naturally stacks on top of id1.
          // By only flagging id2, the top window becomes 50% translucent,
          // allowing the 100% opaque bottom window to peek through,
          // whilst the bottom window's non-overlapped parts remain perfectly 100% opaque.
          overlapping.add(Number(id2));
        }
      }
    }
    return overlapping;
  }, [realTilePositions]);

  // Calculate detailed relative overlap intersections for each tile (with lower index tiles underneath it)
  const tileIntersections = useMemo(() => {
    const intersections = {};
    const keys = Object.keys(realTilePositions);
    
    // Initialize empty array for each tile
    keys.forEach(key => {
      intersections[key] = [];
    });

    for (let i = 0; i < keys.length; i++) {
      for (let j = 0; j < i; j++) { // Only look at tiles underneath (index j < i)
        const id1 = keys[j];
        const id2 = keys[i];
        const r1 = realTilePositions[id1];
        const r2 = realTilePositions[id2];
        if (!r1 || !r2) continue;
        
        // Check intersection
        const intersect = !(r2.left >= r1.left + r1.width ||
                            r2.left + r2.width <= r1.left ||
                            r2.top >= r1.top + r1.height ||
                            r2.top + r2.height <= r1.top);
        if (intersect) {
          // Calculate intersection bounds in absolute grid coordinates
          const left = Math.max(r1.left, r2.left);
          const top = Math.max(r1.top, r2.top);
          const right = Math.min(r1.left + r1.width, r2.left + r2.width);
          const bottom = Math.min(r1.top + r1.height, r2.top + r2.height);
          
          const width = right - left;
          const height = bottom - top;
          
          if (width > 0 && height > 0) {
            // Convert to relative coordinates of tile id2 (which is on top)
            intersections[id2].push({
              x: left - r2.left,
              y: top - r2.top,
              w: width,
              h: height
            });
          }
        }
      }
    }
    return intersections;
  }, [realTilePositions]);

  // 0. Security Verification Blocks
  if (!authStatusChecked) {
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
        <RefreshCw size={32} style={{ color: '#a855f7' }} className="opencode-spin" />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
          正在校验安全状态...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginOverlay onLoginSuccess={() => { setIsAuthenticated(true); checkAuthStatus(); }} />;
  }

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
        <RefreshCw size={32} style={{ color: '#a855f7' }} className="opencode-spin" />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
          正在扫描本地图片集...
        </span>
      </div>
    );
  }

  if (isMobile) {
    return (
      <ErrorBoundary>
        <MobileLayout
          collections={collections}
          displayedCollections={displayedCollections}
          dirResetKey={dirResetKey}
          handleCollectionChangeForTile={handleCollectionChangeForTile}
          globalSpeed={globalSpeed}
          globalIsPlaying={globalIsPlaying}
          isDocumentVisible={isDocumentVisible}
          globalRefreshTrigger={globalRefreshTrigger}
          activeTileCount={activeTileCount}
          globalTransitionEffect={globalTransitionEffect}
          isSyncMode={isSyncMode}
          setIsSyncMode={setIsSyncMode}
          handleAspectRatioChange={handleAspectRatioChange}
          sortMethod={sortMethod}
          isLoading={isLoading}
          fetchError={fetchError}
          scanDirectory={scanDirectory}
          fetchCollections={fetchCollections}
          setIsSettingsOpen={setIsSettingsOpen}
          isSettingsOpen={isSettingsOpen}
          tileCount={tileCount}
          setTileCount={setTileCount}
          isAutoTiling={isAutoTiling}
          setIsAutoTiling={setIsAutoTiling}
          setGlobalSpeed={setGlobalSpeed}
          setGlobalIsPlaying={setGlobalIsPlaying}
          shuffleAllTiles={shuffleAllTiles}
          setGlobalTransitionEffect={setGlobalTransitionEffect}
          setSortMethod={setSortMethod}
          zoomScale={zoomScale}
          setZoomScale={setZoomScale}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
          inputScanDir={inputScanDir}
          setInputScanDir={setInputScanDir}
          handleSaveDirectory={handleSaveDirectory}
          dirError={dirError}
          isSubmittingDir={isSubmittingDir}
          fetchCacheInfo={fetchCacheInfo}
          setCacheMessage={setCacheMessage}
          cacheInfo={cacheInfo}
          cacheMessage={cacheMessage}
          handleClearCache={handleClearCache}
          isClearingCache={isClearingCache}
          gridConfig={gridConfig}
          directoryHistory={directoryHistory}
          onRemoveHistoryItem={handleRemoveHistoryItem}
          adminConfig={adminConfig}
          authError={authError}
          fetchAdminConfig={fetchAdminConfig}
          onUpdateConfig={handleUpdateAdminConfig}
          onRevokeSession={handleRevokeSession}
          onClearLogs={handleClearLogs}
          onLogout={handleLogout}
          videoSpeed={videoSpeed}
          setVideoSpeed={setVideoSpeed}
          imageSort={imageSort}
          setImageSort={setImageSort}
          onQueueDelete={queueDelete}
        />
        <UndoToast toasts={toasts} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <DesktopLayout
      collections={collections}
      displayedCollections={displayedCollections}
      dirResetKey={dirResetKey}
      scaledPositions={scaledPositions}
      tilePositions={tilePositions}
      handleCollectionChangeForTile={handleCollectionChangeForTile}
      onDragPositionChange={handleTileDrag}
      overlappingTiles={overlappingTiles}
      tileIntersections={tileIntersections}
      globalSpeed={globalSpeed}
      globalIsPlaying={globalIsPlaying}
      isDocumentVisible={isDocumentVisible}
      globalRefreshTrigger={globalRefreshTrigger}
      activeTileCount={activeTileCount}
      globalTransitionEffect={globalTransitionEffect}
      isSyncMode={isSyncMode}
      setIsSyncMode={setIsSyncMode}
      handleAspectRatioChange={handleAspectRatioChange}
      sortMethod={sortMethod}
      isLoading={isLoading}
      fetchError={fetchError}
      scanDirectory={scanDirectory}
      fetchCollections={fetchCollections}
      setIsSettingsOpen={setIsSettingsOpen}
      isSettingsOpen={isSettingsOpen}
      tileCount={tileCount}
      setTileCount={setTileCount}
      isAutoTiling={isAutoTiling}
      setIsAutoTiling={setIsAutoTiling}
      setGlobalSpeed={setGlobalSpeed}
      setGlobalIsPlaying={setGlobalIsPlaying}
      shuffleAllTiles={shuffleAllTiles}
      setGlobalTransitionEffect={setGlobalTransitionEffect}
      setSortMethod={setSortMethod}
      zoomScale={zoomScale}
      setZoomScale={setZoomScale}
      zoomIn={zoomIn}
      zoomOut={zoomOut}
      zoomSliderRef={zoomSliderRef}
      isHUDpinned={isHUDpinned}
      setIsHUDpinned={setIsHUDpinned}
      inputScanDir={inputScanDir}
      setInputScanDir={setInputScanDir}
      handleSaveDirectory={handleSaveDirectory}
      dirError={dirError}
      isSubmittingDir={isSubmittingDir}
      fetchCacheInfo={fetchCacheInfo}
      setCacheMessage={setCacheMessage}
      cacheInfo={cacheInfo}
      cacheMessage={cacheMessage}
      handleClearCache={handleClearCache}
      isClearingCache={isClearingCache}
      gridConfig={gridConfig}
      directoryHistory={directoryHistory}
      onRemoveHistoryItem={handleRemoveHistoryItem}
      adminConfig={adminConfig}
      authError={authError}
      fetchAdminConfig={fetchAdminConfig}
      onUpdateConfig={handleUpdateAdminConfig}
      onRevokeSession={handleRevokeSession}
      onClearLogs={handleClearLogs}
      onLogout={handleLogout}
      videoSpeed={videoSpeed}
      setVideoSpeed={setVideoSpeed}
      imageSort={imageSort}
      setImageSort={setImageSort}
      onQueueDelete={queueDelete}
    />
    <UndoToast toasts={toasts} />
    </ErrorBoundary>
  );
}
