import React from 'react';
import { 
  RefreshCw, FolderOpen, Save, X, Settings, Image, 
  AlertTriangle, Trash2, Sparkles, History, Shield
} from 'lucide-react';
import SlideshowTile from './SlideshowTile';
import ControlHUD from './ControlHUD';
import SecurityCenter from './SecurityCenter';

export default function DesktopLayout({
  collections,
  displayedCollections,
  scaledPositions,
  tilePositions,
  handleCollectionChangeForTile,
  onDragPositionChange,
  overlappingTiles = new Set(),
  tileIntersections = {},
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
  setIsSettingsOpen,
  isSettingsOpen,
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
  zoomSliderRef,
  isHUDpinned,
  setIsHUDpinned,
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
  // LAN connection modal support
  showLanModal,
  setShowLanModal,
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
  onLogout
}) {
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const historyRef = React.useRef(null);
  const [activeTab, setActiveTab] = React.useState('storage');

  React.useEffect(() => {
    function handleClickOutside(event) {
      if (historyRef.current && !historyRef.current.contains(event.target)) {
        setIsHistoryOpen(false);
      }
    }
    if (isHistoryOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isHistoryOpen]);

  // Fetch cache info automatically when settings drawer opens
  React.useEffect(() => {
    if (isSettingsOpen) {
      fetchCacheInfo();
    }
  }, [isSettingsOpen, fetchCacheInfo]);

  // Fetch admin config automatically when switching to security tab
  React.useEffect(() => {
    if (activeTab === 'security') {
      fetchAdminConfig();
    }
  }, [activeTab, fetchAdminConfig]);

  return (
    <div className="app-container">
      
      {/* Viewport Tiled Grid */}
      {collections.length > 0 ? (
        <div className="viewport-grid" style={{ position: 'relative' }}>
          {/* Dynamic SVG Mask Definitions for Overlapping Windows */}
          <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
            <defs>
              {displayedCollections.map((_, index) => {
                const intersections = tileIntersections[index] || [];
                const position = scaledPositions[index] || tilePositions[index] || { width: 350, height: 467 };
                return (
                  <mask id={`tile-mask-${index}`} key={index} maskContentUnits="userSpaceOnUse" mask-type="luminance">
                    {/* Entire tile is white by default (100% opaque) */}
                    <rect x="0" y="0" width={position.width} height={position.height} fill="white" />
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

          {displayedCollections.map((collName, index) => {
            const position = scaledPositions[index] || tilePositions[index] || { left: 20, top: 20, width: 350, height: 467 };
            
            return (
              <div
                key={index}
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
                  onDragPositionChange={onDragPositionChange}
                  isOverlapping={overlappingTiles.has(index)}
                  intersections={tileIntersections[index] || []}
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
          zoomScale={zoomScale}
          setZoomScale={setZoomScale}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          zoomSliderRef={zoomSliderRef}
          isHUDpinned={isHUDpinned}
          setIsHUDpinned={setIsHUDpinned}
          onOpenLan={lanIp ? () => setShowLanModal(true) : null}
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
            <FolderOpen size={20} style={{ color: '#a855f7' }} />
            高级系统设置
          </h3>
          <button 
            className="tile-mini-btn"
            onClick={() => setIsSettingsOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        {/* Settings tabs */}
        <div className="settings-tabs" style={{ marginTop: 14 }}>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <FolderOpen size={14} />
            存储设置
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Shield size={14} />
            安全中心
          </button>
        </div>

        {activeTab === 'storage' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, overflowY: 'auto', paddingRight: 4, marginTop: 10 }}>
            <form 
              onSubmit={(e) => {
                setIsHistoryOpen(false);
                handleSaveDirectory(e);
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>
                  指定本地照片文件夹路径:
                </label>
                <div ref={historyRef} style={{ display: 'flex', gap: 8, position: 'relative' }}>
                  <input
                    type="text"
                    className="glass-input"
                    value={inputScanDir}
                    onChange={(e) => setInputScanDir(e.target.value)}
                    placeholder="例如: D:/Photos/Vacation"
                    style={{ flex: 1, fontSize: '0.85rem' }}
                    required
                  />
                  {directoryHistory.length > 0 && (
                    <button
                      type="button"
                      className={`glass-button ${isHistoryOpen ? 'active' : ''}`}
                      onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                      title="历史记录"
                      style={{ padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <History size={16} />
                    </button>
                  )}
                  
                  {isHistoryOpen && directoryHistory.length > 0 && (
                    <div 
                      className="glass-panel" 
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        zIndex: 100,
                        padding: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        border: '1px solid rgba(255,255,255,0.12)'
                      }}
                    >
                      <div className="history-title" style={{ padding: '2px 4px 6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 4 }}>
                        <History size={12} />
                        历史扫描目录 (点击选择):
                      </div>
                      <div className="history-list" style={{ maxHeight: '140px' }}>
                        {directoryHistory.map((dir, idx) => (
                          <div 
                            key={idx} 
                            className="history-item"
                            onClick={() => {
                              setInputScanDir(dir);
                              setIsHistoryOpen(false);
                            }}
                            style={{ margin: 0, background: 'rgba(255,255,255,0.02)' }}
                          >
                            <span className="history-item-text" title={dir}>
                              {dir}
                            </span>
                            <button
                              type="button"
                              className="history-item-delete"
                              title="删除此历史记录"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveHistoryItem(dir);
                              }}
                              style={{ background: 'none', border: 'none', padding: 0 }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                
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
                    <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
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
                  💡 使用底部缩放条调整窗口大小
                </div>
              </div>
            </div>

            {/* Transition Animation Effect */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 16 }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} />
                过渡动画
              </h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                      fontSize: '0.7rem',
                      padding: '4px 10px',
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

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16, marginTop: 'auto' }}>
              <h4 style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>快捷扫描预设:</h4>
              <button
                type="button"
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
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, marginTop: 10 }}>
            <SecurityCenter
              adminConfig={adminConfig}
              authError={authError}
              onUpdateConfig={onUpdateConfig}
              onRevokeSession={onRevokeSession}
              onClearLogs={onClearLogs}
              onLogout={onLogout}
            />
          </div>
        )}
      </div>

      {/* LAN Connect QR Modal */}
      {showLanModal && lanIp && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          animation: 'fadeIn 0.25s ease'
        }}>
          <div className="glass-panel" style={{
            padding: 30,
            maxWidth: 380,
            width: '90%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            position: 'relative'
          }}>
            <button 
              style={{
                position: 'absolute',
                top: 15,
                right: 15,
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
              onClick={() => setShowLanModal(false)}
            >
              <X size={20} />
            </button>
            
            <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', textAlign: 'center', letterSpacing: '0.05em' }}>
              手机连入播放器
            </h3>
            
            {/* Direct text display or QR code placeholder if qr-generator not installed */}
            <div style={{
              background: '#fff',
              padding: 16,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
            }}>
              {/* Dynamic QR Code via public API to avoid extra package dependencies */}
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`http://${lanIp}:3000/`)}`}
                alt="QR Code"
                style={{ width: 200, height: 200 }}
              />
            </div>
            
            <div style={{ textAlign: 'center', width: '100%' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                请确保您的手机与电脑连接在<strong>同一个 Wi-Fi (局域网)</strong>。
              </span>
              <span style={{ fontSize: '0.8rem', color: '#fff', display: 'block', background: 'rgba(0,0,0,0.3)', padding: '6px 12px', borderRadius: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                http://{lanIp}:3000/
              </span>
            </div>

            <button 
              className="glass-button active"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                navigator.clipboard.writeText(`http://${lanIp}:3000/`);
                alert('链接已复制到剪贴板！');
              }}
            >
              复制连接
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}} />

    </div>
  );
}
