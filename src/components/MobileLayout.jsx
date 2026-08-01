import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Settings, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react';
import MobileSlideshowCard from './MobileSlideshowCard';
import ErrorBoundary from './ErrorBoundary';
import MobileControlSheet from './MobileControlSheet';
import '../mobile.css';

// Calculate mobile tile coordinates in viewport percentage space
function getMobileTileCoords(tileId, totalTiles, zoomScale) {
  let cols = 2;
  let rows = 1;
  let col = 0;
  let row = 0;

  if (totalTiles === 1) {
    cols = 1;
    rows = 1;
    col = 0;
    row = 0;
  } else if (totalTiles === 2) {
    cols = 1;
    rows = 2;
    col = 0;
    row = tileId;
  } else if (totalTiles === 3) {
    cols = 1;
    rows = 3;
    col = 0;
    row = tileId;
  } else if (totalTiles === 4) {
    cols = 2;
    rows = 2;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else if (totalTiles === 5) {
    rows = 3;
    if (tileId < 4) {
      cols = 2;
      col = tileId % 2;
      row = Math.floor(tileId / 2);
    } else {
      cols = 1;
      col = 0;
      row = 2;
    }
  } else if (totalTiles === 6) {
    cols = 2;
    rows = 3;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else if (totalTiles === 12) {
    cols = 2;
    rows = 6;
    col = tileId % 2;
    row = Math.floor(tileId / 2);
  } else {
    cols = totalTiles === 2 ? 1 : 2;
    col = tileId % cols;
    row = Math.floor(tileId / cols);
    rows = Math.ceil(totalTiles / cols);
  }

  const W_slot = 100 / cols;
  const H_slot = 100 / rows;

  const left_base = col * W_slot;
  const top_base = row * H_slot;

  const W_scaled = W_slot * zoomScale;
  const H_scaled = H_slot * zoomScale;

  const shiftPercent = Math.abs(zoomScale - 1) * 50;

  const translateX = cols > 1 
    ? ((cols - 1 - 2 * col) / (cols - 1)) * shiftPercent 
    : 0;

  const translateY = rows > 1 
    ? ((rows - 1 - 2 * row) / (rows - 1)) * shiftPercent 
    : 0;

  const shift_X = (translateX / 100) * W_slot;
  const shift_Y = (translateY / 100) * H_slot;

  const left = left_base + (W_slot - W_scaled) / 2 + shift_X;
  const top = top_base + (H_slot - H_scaled) / 2 + shift_Y;

  return {
    left,
    top,
    width: W_scaled,
    height: H_scaled,
    right: left + W_scaled,
    bottom: top + H_scaled
  };
}

export default function MobileLayout({
  collections,
  displayedCollections,
  dirResetKey,
  handleCollectionChangeForTile,
  globalSpeed,
  globalIsPlaying,
  isDocumentVisible,
  globalRefreshTrigger,
  activeTileCount,
  globalTransitionEffect,
  handleAspectRatioChange,
  sortMethod,
  isLoading,
  fetchError,
  scanDirectory,
  fetchCollections,
  isSettingsOpen,
  setIsSettingsOpen,
  tileCount,
  setTileCount,
  isAutoTiling,
  setIsAutoTiling,
  setGlobalSpeed,
  setGlobalIsPlaying,
  shuffleAllTiles,
  setGlobalTransitionEffect,
  setSortMethod,
  zoomScale,
  setZoomScale,
  zoomIn,
  zoomOut,
  inputScanDir,
  setInputScanDir,
  handleSaveDirectory,
  dirError,
  isSubmittingDir,
  fetchCacheInfo,
  setCacheMessage,
  cacheInfo,
  cacheMessage,
  handleClearCache,
  isClearingCache,
  gridConfig,
  lanIp,
  directoryHistory = [],
  onRemoveHistoryItem,
  // Security props
  adminConfig,
  authError,
  fetchAdminConfig,
  onUpdateConfig,
  onRevokeSession,
  onClearLogs,
  onLogout,
  isSyncMode,
  setIsSyncMode,
  videoSpeed,
  setVideoSpeed,
  imageSort,
  setImageSort,
  deletedAccounts = [],
  onRestoreAccount,
}) {
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [showUnmanagedOnly, setShowUnmanagedOnly] = useState(false);
  const [downloadList, setDownloadList] = useState([]);
  const [showZoomSlider, setShowZoomSlider] = useState(false);
  const sliderTimeoutRef = useRef(null);

  // Remaining queue: tracks collections not yet shown this session (never repeats)
  const remainingQueueRef = useRef([]);
  const prevFilterKeyRef = useRef('');

  const consumeNext = useCallback(() => {
    if (remainingQueueRef.current.length > 0) {
      const next = remainingQueueRef.current[0];
      remainingQueueRef.current = remainingQueueRef.current.slice(1);
      return next;
    }
    return null;
  }, []);

  const fetchDownloadList = React.useCallback(async () => {
    try {
      const res = await fetch('/api/download-list');
      const data = await res.json();
      if (data.list) setDownloadList(data.list);
    } catch (err) {
      console.error('Failed to fetch download list:', err);
    }
  }, []);

  React.useEffect(() => {
    fetchDownloadList();
  }, [fetchDownloadList]);

  React.useEffect(() => {
    if (isSettingsOpen) fetchDownloadList();
  }, [isSettingsOpen, fetchDownloadList]);

  // Apply filters: favorites or unmanaged
  const filteredCollections = React.useMemo(() => {
    if (showFavoritesOnly) {
      return downloadList.filter(c => collections.includes(c));
    }
    if (showUnmanagedOnly) {
      return collections.filter(c =>
        !downloadList.includes(c) && !(deletedAccounts || []).includes(c)
      );
    }
    return displayedCollections;
  }, [showFavoritesOnly, showUnmanagedOnly, downloadList, collections, displayedCollections, deletedAccounts]);

  // Collections list to pass to tiles — filtered when a filter is active so getNextUniqueCollection only picks from valid items
  const tileCollections = React.useMemo(() => {
    if (showFavoritesOnly) return collections.filter(c => downloadList.includes(c));
    if (showUnmanagedOnly) return collections.filter(c =>
      !downloadList.includes(c) && !(deletedAccounts || []).includes(c)
    );
    return collections;
  }, [showFavoritesOnly, showUnmanagedOnly, downloadList, collections, deletedAccounts]);

  const triggerZoomSliderBriefly = () => {
    setShowZoomSlider(true);
    if (sliderTimeoutRef.current) {
      clearTimeout(sliderTimeoutRef.current);
    }
    sliderTimeoutRef.current = setTimeout(() => {
      setShowZoomSlider(false);
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (sliderTimeoutRef.current) {
        clearTimeout(sliderTimeoutRef.current);
      }
    };
  }, []);

  // Sync mode: single timer that drives all tiles simultaneously
  const [syncTrigger, setSyncTrigger] = React.useState(0);
  const syncTimerRef = useRef(null);

  useEffect(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (!isSyncMode || !globalIsPlaying || !isDocumentVisible) return;

    let targetTime = Date.now() + globalSpeed;

    const tick = () => {
      setSyncTrigger(prev => prev + 1);
      const elapsed = Date.now() - targetTime;
      // Clamp minimum delay to 16ms (1 frame): if a tick ran late,
      // nextDelay=0 would spin a busy loop that starves rendering.
      const nextDelay = Math.max(16, globalSpeed - elapsed);
      targetTime += globalSpeed;
      syncTimerRef.current = setTimeout(tick, nextDelay);
    };

    syncTimerRef.current = setTimeout(tick, globalSpeed);

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [isSyncMode, globalSpeed, globalIsPlaying, isDocumentVisible]);

  // Calculate relative overlap intersections for mobile tiles
  const tileIntersections = React.useMemo(() => {
    const intersections = {};
    for (let i = 0; i < activeTileCount; i++) {
      intersections[i] = [];
    }

    const coords = [];
    for (let i = 0; i < activeTileCount; i++) {
      coords.push(getMobileTileCoords(i, activeTileCount, zoomScale));
    }

    for (let i = 0; i < activeTileCount; i++) {
      for (let j = 0; j < i; j++) { // Only look at tiles underneath (index j < i)
        const r1 = coords[j];
        const r2 = coords[i];

        // Check if they intersect
        const intersect = !(r2.left >= r1.right ||
                            r2.right <= r1.left ||
                            r2.top >= r1.bottom ||
                            r2.bottom <= r1.top);
        if (intersect) {
          // Calculate intersection bounds in percentage
          const left = Math.max(r1.left, r2.left);
          const top = Math.max(r1.top, r2.top);
          const right = Math.min(r1.right, r2.right);
          const bottom = Math.min(r1.bottom, r2.bottom);

          const width = right - left;
          const height = bottom - top;

          if (width > 0 && height > 0) {
            // Convert to relative coordinates of tile i (which is on top)
            // relative to the tile's own width and height as fractions (0 to 1)
            intersections[i].push({
              x: (left - r2.left) / r2.width,
              y: (top - r2.top) / r2.height,
              w: width / r2.width,
              h: height / r2.height
            });
          }
        }
      }
    }
    return intersections;
  }, [activeTileCount, zoomScale]);

  // Filter collections to display based on active tile count and favorites filter
  const renderCollections = filteredCollections.slice(0, activeTileCount);

  // Initialize/reset remaining queue when filter/collections/sort change
  React.useEffect(() => {
    const filterKey = `${showFavoritesOnly}:${showUnmanagedOnly}:${collections.length}:${sortMethod}:${dirResetKey}:${activeTileCount}`;
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey;
      remainingQueueRef.current = filteredCollections.slice(activeTileCount);
    }
  }, [showFavoritesOnly, showUnmanagedOnly, collections, sortMethod, dirResetKey, activeTileCount, filteredCollections]);

  // Responsive class for active tile counts
  let gridClass = 'mobile-grid-2';
  if (activeTileCount === 4) {
    gridClass = 'mobile-grid-4';
  } else if (activeTileCount === 6) {
    gridClass = 'mobile-grid-6';
  } else if (activeTileCount === 1) {
    gridClass = 'mobile-grid-1';
  } else if (activeTileCount === 3) {
    gridClass = 'mobile-grid-3';
  } else if (activeTileCount === 5) {
    gridClass = 'mobile-grid-5';
  } else if (activeTileCount === 12) {
    gridClass = 'mobile-grid-12';
  }

  return (
    <div className="mobile-layout">
      {/* 1. Main Slideshow Viewport Area */}
      <main className="mobile-viewport">
        {/* Dynamic SVG Mask Definitions for Overlapping Mobile Windows */}
        {collections.length > 0 && (
          <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
            <defs>
              {Array.from({ length: activeTileCount }).map((_, index) => {
                const intersections = tileIntersections[index] || [];
                return (
                  <mask id={`mobile-tile-mask-${index}`} key={index} maskContentUnits="objectBoundingBox" mask-type="luminance">
                    {/* Entire tile is white by default (100% opaque) */}
                    <rect x="0" y="0" width="1" height="1" fill="white" />
                    {/* Overlapping parts are grey #7f7f7f (exactly 50% opaque) */}
                    {intersections.map((rect, rIdx) => (
                      <rect
                        key={rIdx}
                        x={rect.x}
                        y={rect.y}
                        width={rect.w}
                        height={rect.h}
                        fill="#7f7f7f"
                      />
                    ))}
                  </mask>
                );
              })}
            </defs>
          </svg>
        )}

        {collections.length > 0 ? (
          <div 
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}
          >
            <div 
              className={`mobile-grid ${gridClass}`}
              style={{
                width: '100%',
                height: '100%',
                overflow: 'visible'
              }}
            >
              {renderCollections.map((collName, index) => (
                <ErrorBoundary key={index} fallbackLabel="该窗口出现异常">
                  <MobileSlideshowCard
                    tileId={index}
                    collections={tileCollections}
                    displayedCollections={filteredCollections}
                    onCollectionChange={handleCollectionChangeForTile}
                    initialCollectionName={collName}
                    globalSpeed={globalSpeed}
                    globalIsPlaying={globalIsPlaying && isDocumentVisible}
                    globalRefreshTrigger={globalRefreshTrigger}
                    isSingle={activeTileCount === 1}
                    globalTransitionEffect={globalTransitionEffect}
                    totalTiles={activeTileCount}
                    onAspectRatioChange={handleAspectRatioChange}
                    sortMethod={sortMethod}
                    zoomScale={zoomScale}
                    intersections={tileIntersections[index] || []}
                    onTitleClick={(folderName) => {
                      setIsAutoTiling(false);
                      setTileCount(1);
                      handleCollectionChangeForTile(0, folderName);
                    }}
                    isSyncMode={isSyncMode}
                    syncTrigger={syncTrigger}
                    videoSpeed={videoSpeed}
                    imageSort={imageSort}
                    downloadList={downloadList}
                    fetchCollections={fetchCollections}
                    onRequestNextCollection={consumeNext}
                  />
                </ErrorBoundary>
              ))}
            </div>
          </div>
        ) : (
          /* Empty or Error view fallback */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center',
            color: 'var(--text-secondary)'
          }}>
            <p style={{ fontSize: '0.85rem', marginBottom: 12 }}>未在扫描目录中检测到任何图片集</p>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>目录路径: {scanDirectory}</p>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="mobile-action-btn primary"
              style={{ marginTop: 20, minWidth: 120 }}
            >
              打开扫描配置
            </button>
          </div>
        )}
      </main>

      {/* 3. Floating Bottom Control Pill */}
      {collections.length > 0 && (
        <div className="mobile-floating-pill">
          {/* Settings Trigger */}
          <button 
            type="button"
            className="mobile-pill-btn"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>

          {/* Central Play/Pause button */}
          <button 
            type="button"
            className="mobile-pill-btn play-pause"
            onClick={() => setGlobalIsPlaying(!globalIsPlaying)}
          >
            {globalIsPlaying ? <Pause size={20} style={{ fill: 'white' }} /> : <Play size={20} style={{ fill: 'white' }} />}
          </button>
        </div>
      )}

      {/* 4. Glassmorphic Slide-Up Settings Drawer */}
      <MobileControlSheet
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        collections={collections}
        tileCount={tileCount}
        setTileCount={setTileCount}
        isAutoTiling={isAutoTiling}
        setIsAutoTiling={setIsAutoTiling}
        globalSpeed={globalSpeed}
        setGlobalSpeed={setGlobalSpeed}
        sortMethod={sortMethod}
        setSortMethod={setSortMethod}
        shuffleAllTiles={shuffleAllTiles}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        inputScanDir={inputScanDir}
        setInputScanDir={setInputScanDir}
        handleSaveDirectory={handleSaveDirectory}
        dirError={dirError}
        isSubmittingDir={isSubmittingDir}
        scanDirectory={scanDirectory}
        fetchCacheInfo={fetchCacheInfo}
        cacheInfo={cacheInfo}
        cacheMessage={cacheMessage}
        setCacheMessage={setCacheMessage}
        handleClearCache={handleClearCache}
        isClearingCache={isClearingCache}
        directoryHistory={directoryHistory}
        onRemoveHistoryItem={onRemoveHistoryItem}
        adminConfig={adminConfig}
        authError={authError}
        fetchAdminConfig={fetchAdminConfig}
        onUpdateConfig={onUpdateConfig}
        onRevokeSession={onRevokeSession}
        onClearLogs={onClearLogs}
        onLogout={onLogout}
        isSyncMode={isSyncMode}
        setIsSyncMode={setIsSyncMode}
        deletedAccounts={deletedAccounts}
        onRestoreAccount={onRestoreAccount}
        videoSpeed={videoSpeed}
        setVideoSpeed={setVideoSpeed}
        imageSort={imageSort}
        setImageSort={setImageSort}
        showFavoritesOnly={showFavoritesOnly}
        setShowFavoritesOnly={setShowFavoritesOnly}
        showUnmanagedOnly={showUnmanagedOnly}
        setShowUnmanagedOnly={setShowUnmanagedOnly}
        downloadList={downloadList}
        fetchDownloadList={fetchDownloadList}
      />

      {/* 5. Floating Vertical Zoom Slider on Right Screen Edge */}
      <div 
        className="mobile-edge-zoom-sensor"
        onTouchStart={triggerZoomSliderBriefly}
        onTouchMove={triggerZoomSliderBriefly}
      />

      <div 
        className={`mobile-edge-zoom-panel ${showZoomSlider ? 'visible' : ''}`}
        onTouchStart={triggerZoomSliderBriefly}
        onTouchMove={triggerZoomSliderBriefly}
      >
        <button 
          type="button" 
          className="mobile-edge-zoom-btn"
          onClick={() => {
            zoomIn();
            triggerZoomSliderBriefly();
          }}
        >
          <ZoomIn size={16} />
        </button>

        <div className="mobile-edge-zoom-slider-wrapper">
          <input 
            type="range"
            min="0.3"
            max="1.5"
            step="0.05"
            value={zoomScale}
            onChange={(e) => {
              setZoomScale(parseFloat(e.target.value));
              triggerZoomSliderBriefly();
            }}
            className="mobile-edge-zoom-input"
          />
        </div>

        <button 
          type="button" 
          className="mobile-edge-zoom-btn"
          onClick={() => {
            zoomOut();
            triggerZoomSliderBriefly();
          }}
        >
          <ZoomOut size={16} />
        </button>

        {/* Zoom scale floating percentage bubble */}
        <div className="mobile-edge-zoom-bubble">
          {Math.round(zoomScale * 100)}%
        </div>
      </div>
    </div>
  );
}
