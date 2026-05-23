import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Settings, ChevronLeft, ChevronRight, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react';
import MobileSlideshowCard from './MobileSlideshowCard';
import MobileControlSheet from './MobileControlSheet';
import '../mobile.css';

export default function MobileLayout({
  collections,
  displayedCollections,
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
  isPaginated,
  currentPage,
  setCurrentPage,
  totalPages,
  pageSize,
  directoryHistory = [],
  onRemoveHistoryItem
}) {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showZoomSlider, setShowZoomSlider] = useState(false);
  const sliderTimeoutRef = useRef(null);

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

  // Filter collections to display based on active tile count
  const renderCollections = displayedCollections.slice(0, activeTileCount);

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
                <MobileSlideshowCard
                  key={index}
                  tileId={index}
                  collections={collections}
                  displayedCollections={displayedCollections}
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
                  onTitleClick={(folderName) => {
                    setIsAutoTiling(false);
                    setTileCount(1);
                    handleCollectionChangeForTile(0, folderName);
                  }}
                />
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
              onClick={() => setIsSheetOpen(true)}
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
            onClick={() => setIsSheetOpen(true)}
          >
            <Settings size={18} />
          </button>

          {/* Pagination Deck (Only display when pagination is needed) */}
          {isPaginated && (
            <div className="mobile-pill-paginator">
              <button 
                type="button"
                className="mobile-pill-btn"
                onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
                disabled={currentPage === 0}
                style={{ width: 32, height: 32, opacity: currentPage === 0 ? 0.4 : 1 }}
              >
                <ChevronLeft size={14} />
              </button>
              
              <span className="mobile-pill-page-text">
                {currentPage + 1} / {totalPages} 批
              </span>

              <button 
                type="button"
                className="mobile-pill-btn"
                onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
                disabled={currentPage === totalPages - 1}
                style={{ width: 32, height: 32, opacity: currentPage === totalPages - 1 ? 0.4 : 1 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

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
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
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
