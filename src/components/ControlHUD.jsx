import React, { useState, useEffect } from 'react';
import { Play, Pause, Shuffle, Settings, Columns, Image, Sliders, ChevronUp, ChevronDown, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';

// Allowed tile counts
const ALLOWED_TILE_COUNTS = [1, 3, 5, 12];

export default function ControlHUD({
  tileCount,
  setTileCount,
  isAutoTiling,
  setIsAutoTiling,
  globalSpeed,
  setGlobalSpeed,
  globalIsPlaying,
  setGlobalIsPlaying,
  onShuffleAll,
  onOpenSettings,
  collectionsCount,
  scanDirectory,
  globalTransitionEffect,
  setGlobalTransitionEffect,
  sortMethod,
  setSortMethod,
  zoomScale,
  setZoomScale,
  onZoomIn,
  onZoomOut,
  zoomSliderRef,
  isHUDpinned,
  setIsHUDpinned
}) {
  const [isHovered, setIsHovered] = useState(false);

  const speedInSeconds = globalSpeed / 1000;

  return (
    <>
      {/* Main Control Bar - Full width at bottom */}
      <div 
        className={`glass-panel hud-container ${(!isHUDpinned && !isHovered) ? 'hidden' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Brand/Status Info */}
        <div className="hud-section hud-section-compact">
          <div className="hud-title-brand" style={{ fontSize: '0.9rem' }}>
            <Image size={16} className="text-purple-400" />
            <span>BLISSFUL FARADAY</span>
          </div>
        </div>

        {/* Grid Tile Count */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: '0.65rem' }}>
            <Columns size={11} /> 分屏
          </span>
          
          {/* Mode Toggle */}
          <div style={{ display: 'flex', gap: 3, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px' }}>
            <button
              onClick={() => setIsAutoTiling(true)}
              style={{
                background: isAutoTiling ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: isAutoTiling ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.6rem',
                padding: '2px 6px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              自动({collectionsCount})
            </button>
            <button
              onClick={() => setIsAutoTiling(false)}
              style={{
                background: !isAutoTiling ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: !isAutoTiling ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.6rem',
                padding: '2px 6px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              手动
            </button>
          </div>

          {/* Preset Buttons */}
          <div style={{ display: 'flex', gap: 3 }}>
            {ALLOWED_TILE_COUNTS.map(num => (
              <button
                key={num}
                onClick={() => setTileCount(num)}
                style={{
                  background: tileCount === num ? 'var(--accent-purple)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.65rem',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: tileCount === num ? 'bold' : 'normal'
                }}
              >
                {num}
              </button>
            ))}
          </div>
        </div>

        {/* Playback Controls */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: '0.65rem' }}>
            <Sliders size={11} /> 轮播
          </span>
          
          {/* Toggle Switch */}
          <div 
            onClick={() => setGlobalIsPlaying(!globalIsPlaying)}
            style={{
              width: '34px',
              height: '18px',
              borderRadius: '9px',
              background: globalIsPlaying ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)',
              position: 'relative',
              cursor: 'pointer',
              transition: 'var(--transition-smooth)'
            }}
          >
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: '2px',
              left: globalIsPlaying ? '16px' : '2px',
              transition: 'var(--transition-smooth)'
            }} />
          </div>

          {/* Speed control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, opacity: globalIsPlaying ? 1 : 0.4 }}>
            {[2, 3, 5, 10].map(sec => (
              <button
                key={sec}
                onClick={() => setGlobalSpeed(sec * 1000)}
                style={{
                  background: speedInSeconds === sec ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                  border: speedInSeconds === sec ? '1px solid var(--accent-blue)' : '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.6rem',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  fontWeight: speedInSeconds === sec ? 'bold' : 'normal'
                }}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {/* Zoom Control */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', fontSize: '0.65rem' }}>
            缩放
          </span>
          
          <ZoomOut 
            size={14} 
            style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} 
            onClick={onZoomOut}
          />
          
          <div 
            ref={zoomSliderRef}
            style={{ 
              width: '100px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: 'ns-resize'
            }}
          >
            <input
              type="range"
              min="0.3"
              max="1.5"
              step="0.05"
              value={zoomScale}
              onChange={(e) => setZoomScale(parseFloat(e.target.value))}
              className="glass-slider"
              style={{ width: '100px', height: '4px' }}
            />
          </div>
          
          <ZoomIn 
            size={14} 
            style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} 
            onClick={onZoomIn}
          />
          
          <button
            onClick={() => setZoomScale(1)}
            style={{
              background: zoomScale === 1 ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '0.6rem',
              padding: '2px 6px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {Math.round(zoomScale * 100)}%
          </button>
        </div>

        {/* Settings Button */}
        <div className="hud-section hud-section-compact" style={{ borderRight: 'none' }}>
          <button
            className="glass-button"
            onClick={onOpenSettings}
            style={{ padding: '6px 12px' }}
          >
            <Settings size={14} />
            <span style={{ fontSize: '0.7rem' }}>设置</span>
          </button>

          {/* Pin control */}
          <div 
            style={{ 
              cursor: 'pointer',
              color: isHUDpinned ? 'var(--accent-purple)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center'
            }}
            onClick={() => setIsHUDpinned(!isHUDpinned)}
          >
            {isHUDpinned ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </div>
        </div>
      </div>
    </>
  );
}
