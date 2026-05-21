import React, { useState, useEffect } from 'react';
import { Play, Pause, Shuffle, Settings, Columns, Image, Sliders, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';

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
  gridCols,
  setGridCols,
  gridRows,
  setGridRows
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(true);

  // Convert speed in ms to seconds for UI
  const speedInSeconds = globalSpeed / 1000;

  // Auto-hide HUD after 3 seconds of inactivity if not hovered and not pinned
  useEffect(() => {
    if (isPinned) return;
    
    let timeout;
    if (!isHovered) {
      timeout = setTimeout(() => {
        // We handle auto-hiding by adding classes in CSS
      }, 3000);
    }
    return () => clearTimeout(timeout);
  }, [isHovered, isPinned]);

  return (
    <>
      {/* Immersive HUD Trigger Zone */}
      <div 
        className="hud-trigger-zone" 
        onMouseEnter={() => setIsHovered(true)}
      />

      {/* Main Glassmorphic Control Deck */}
      <div 
        className={`glass-panel hud-container ${(!isPinned && !isHovered) ? 'hidden' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Brand/Status Info */}
        <div className="hud-section">
          <div className="hud-title-brand">
            <Image size={20} className="text-purple-400" />
            <span>BLISSFUL FARADAY</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            <span>读取目录: {scanDirectory ? scanDirectory.split(/[\\/]/).pop() : 'Loading'}</span>
            <span>共有 {collectionsCount} 个图片集</span>
          </div>
        </div>

        {/* 1. Grid Tile Count Adjustment with Mode Toggles */}
        <div className="hud-section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Columns size={12} /> 分屏模式
              </span>
              
              {/* Mode Selector Tabs */}
              <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => setIsAutoTiling(true)}
                  style={{
                    background: isAutoTiling ? 'var(--accent-purple)' : 'transparent',
                    border: 'none',
                    color: isAutoTiling ? '#fff' : 'var(--text-secondary)',
                    fontSize: '0.65rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: isAutoTiling ? '600' : 'normal',
                    transition: 'var(--transition-smooth)'
                  }}
                  title="为每一个本地图片集文件夹创建专属子窗口播放"
                >
                  文件夹分屏 ({collectionsCount})
                </button>
                <button
                  onClick={() => setIsAutoTiling(false)}
                  style={{
                    background: !isAutoTiling ? 'var(--accent-purple)' : 'transparent',
                    border: 'none',
                    color: !isAutoTiling ? '#fff' : 'var(--text-secondary)',
                    fontSize: '0.65rem',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: !isAutoTiling ? '600' : 'normal',
                    transition: 'var(--transition-smooth)'
                  }}
                  title="手动调整平铺播放窗口数量"
                >
                  自定义网格 ({tileCount})
                </button>
              </div>
            </div>

            {/* Slider & Presets Control Area */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              transition: 'var(--transition-smooth)'
            }}>
              <input
                type="range"
                min="1"
                max="16"
                value={tileCount}
                onChange={(e) => setTileCount(parseInt(e.target.value))}
                className="glass-slider"
                style={{ width: '100px' }}
              />
              {/* Current count display */}
              <span style={{ 
                fontSize: '0.75rem', 
                fontWeight: 'bold', 
                color: 'var(--accent-purple)',
                minWidth: '20px',
                textAlign: 'center'
              }}>
                {tileCount}
              </span>
              {/* Presets */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 3, 5, 12].map(num => (
                  <button
                    key={num}
                    onClick={() => setTileCount(num)}
                    style={{
                      background: tileCount === num ? 'var(--accent-purple)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: tileCount === num ? 'bold' : 'normal'
                    }}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid Layout Configuration */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: 8,
              marginTop: 8,
              padding: '8px',
              background: 'rgba(139, 92, 246, 0.05)',
              borderRadius: '6px',
              border: '1px solid rgba(139, 92, 246, 0.1)'
            }}>
              <div>
                <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  列数 (Cols)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={gridCols}
                  onChange={(e) => setGridCols(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="glass-input"
                  style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  行数 (Rows)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={gridRows}
                  onChange={(e) => setGridRows(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="glass-input"
                  style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px' }}
                />
              </div>
            </div>

            {/* Folder Sorting Selectors */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8,
              marginTop: 4,
              opacity: isAutoTiling ? 1 : 0.35,
              pointerEvents: isAutoTiling ? 'auto' : 'none',
              transition: 'var(--transition-smooth)'
            }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>文件夹排序:</span>
              <div style={{ 
                display: 'flex', 
                gap: 3, 
                background: 'rgba(0,0,0,0.2)', 
                padding: '2px', 
                borderRadius: '4px', 
                border: '1px solid rgba(255,255,255,0.05)' 
              }}>
                {[
                  { id: 'name', label: '文件名' },
                  { id: 'date', label: '修改日期' },
                  { id: 'random', label: '纯随机' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setSortMethod(opt.id)}
                    style={{
                      background: sortMethod === opt.id ? 'var(--accent-purple)' : 'transparent',
                      border: 'none',
                      color: sortMethod === opt.id ? '#fff' : 'var(--text-secondary)',
                      fontSize: '0.6rem',
                      padding: '2px 6px',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      fontWeight: sortMethod === opt.id ? '600' : 'normal',
                      transition: 'var(--transition-smooth)'
                    }}
                    title={`按照${opt.label}显示文件夹`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* 2. Global Slideshow Playback Controls */}
        <div className="hud-section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Sliders size={12} /> 幻灯片自动播放
              </span>
              
              {/* Premium Toggle Switch */}
              <div 
                onClick={() => setGlobalIsPlaying(!globalIsPlaying)}
                style={{
                  width: '38px',
                  height: '20px',
                  borderRadius: '10px',
                  background: globalIsPlaying ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'var(--transition-smooth)',
                  boxShadow: globalIsPlaying ? '0 0 8px rgba(59, 130, 246, 0.3)' : 'none'
                }}
                title={globalIsPlaying ? "暂停自动播放" : "开启自动播放"}
              >
                <div style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '2px',
                  left: globalIsPlaying ? '20px' : '2px',
                  transition: 'var(--transition-smooth)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
                }} />
              </div>
            </div>
            
            {/* Speed Slider Label */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: globalIsPlaying ? 1 : 0.4, transition: 'var(--transition-smooth)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>轮换周期 (所有窗口依次刷新):</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
                {speedInSeconds} 秒 / 轮
              </span>
            </div>

            {/* Slider Area */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              opacity: globalIsPlaying ? 1 : 0.4,
              pointerEvents: globalIsPlaying ? 'auto' : 'none',
              transition: 'var(--transition-smooth)' 
            }}>
              <input
                type="range"
                min="1"
                max="30"
                step="0.5"
                value={speedInSeconds}
                onChange={(e) => setGlobalSpeed(parseFloat(e.target.value) * 1000)}
                className="glass-slider"
                style={{ width: '100px' }}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                {[2, 5, 10, 15].map(sec => (
                  <button
                    key={sec}
                    onClick={() => setGlobalSpeed(sec * 1000)}
                    style={{
                      background: speedInSeconds === sec ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>
            
            {/* Stagger explanation */}
            <div style={{ 
              fontSize: '0.6rem', 
              color: 'var(--text-muted)', 
              lineHeight: 1.3,
              marginTop: -2,
              opacity: globalIsPlaying ? 1 : 0.4,
              transition: 'var(--transition-smooth)'
            }}>
              💡 切换间隔 = 周期 ÷ 窗口数。如 5 秒 5 窗口，每个窗口每 1 秒切换一张图，依次顺次更新。
            </div>
          </div>
        </div>

        {/* 3. Global Transition Animation Effect */}
        <div className="hud-section">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Sparkles size={12} /> 过渡动画
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { id: 'ken-burns', label: '温和缩放' },
                { id: 'fade', label: '平滑渐变' },
                { id: 'slide', label: '滑入' },
                { id: 'none', label: '关闭动画' }
              ].map(effect => (
                <button
                  key={effect.id}
                  onClick={() => setGlobalTransitionEffect(effect.id)}
                  style={{
                    background: globalTransitionEffect === effect.id ? 'var(--accent-purple)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#fff',
                    fontSize: '0.65rem',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: globalTransitionEffect === effect.id ? '600' : 'normal',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  {effect.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Global Action Commands */}
        <div className="hud-section" style={{ gap: 8 }}>
          <button
            className={`glass-button ${globalIsPlaying ? 'active' : ''}`}
            onClick={() => setGlobalIsPlaying(!globalIsPlaying)}
            title={globalIsPlaying ? "全部暂停" : "全部播放"}
            style={{ padding: '8px 12px' }}
          >
            {globalIsPlaying ? <Pause size={16} /> : <Play size={16} />}
            <span style={{ fontSize: '0.8rem' }}>{globalIsPlaying ? '全部暂停' : '全部播放'}</span>
          </button>

          <button
            className="glass-button"
            onClick={onShuffleAll}
            title="全部重新随机分配图片集"
            style={{ padding: '8px 12px' }}
          >
            <Shuffle size={16} />
            <span style={{ fontSize: '0.8rem' }}>全部随机</span>
          </button>

          <button
            className="glass-button"
            onClick={onOpenSettings}
            title="高级设置与目录管理"
            style={{ padding: '8px 12px' }}
          >
            <Settings size={16} />
            <span style={{ fontSize: '0.8rem' }}>设置</span>
          </button>
        </div>

        {/* 4. PIN/HIDE HUD control */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          marginLeft: -8,
          cursor: 'pointer',
          color: isPinned ? 'var(--accent-purple)' : 'var(--text-muted)',
          transition: 'var(--transition-smooth)'
        }}
        onClick={() => setIsPinned(!isPinned)}
        title={isPinned ? "取消固定（滑开鼠标自动隐藏控制条）" : "固定控制条"}
        >
          {isPinned ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </div>

      </div>
    </>
  );
}
