import React, { useEffect } from 'react';
import { 
  Grid, Compass, Sliders, FolderOpen,
  RefreshCw, Trash2, Shuffle, ZoomIn, ZoomOut, Check, History, Shield, RotateCcw, Download
} from 'lucide-react';
import SecurityCenter from './SecurityCenter';

export default function MobileControlSheet({
  isOpen,
  onClose,
  collections = [],
  tileCount,
  setTileCount,
  isAutoTiling,
  setIsAutoTiling,
  globalSpeed,
  setGlobalSpeed,
  sortMethod,
  setSortMethod,
  shuffleAllTiles,
  zoomScale,
  setZoomScale,
  zoomIn,
  zoomOut,
  inputScanDir,
  setInputScanDir,
  handleSaveDirectory,
  dirError,
  isSubmittingDir,
  scanDirectory,
  fetchCacheInfo,
  cacheInfo,
  cacheMessage,
  setCacheMessage,
  handleClearCache,
  isClearingCache,
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
  deletedAccounts = [],
  onRestoreAccount,
  videoSpeed,
  setVideoSpeed,
  imageSort,
  setImageSort,
  showFavoritesOnly,
  setShowFavoritesOnly,
  showUnmanagedOnly,
  setShowUnmanagedOnly,
  downloadList = [],
  fetchDownloadList,
}) {
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const historyRef = React.useRef(null);
  const [activeTab, setActiveTab] = React.useState('storage');

  const [newDownloadUser, setNewDownloadUser] = React.useState('');

  React.useEffect(() => {
    function handleClickOutside(event) {
      if (historyRef.current && !historyRef.current.contains(event.target)) {
        setIsHistoryOpen(false);
      }
    }
    if (isHistoryOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isHistoryOpen]);

  // Fetch cache info on load/open
  useEffect(() => {
    if (isOpen) {
      fetchCacheInfo();
    }
  }, [isOpen]);

  // Fetch admin config automatically when switching to security tab on mobile
  useEffect(() => {
    if (activeTab === 'security') {
      fetchAdminConfig();
    }
  }, [activeTab, fetchAdminConfig]);

  const handleSpeedChange = (speedMs) => {
    setGlobalSpeed(speedMs);
  };

  const handleGridPresetClick = (count) => {
    setIsAutoTiling(false);
    setTileCount(count);
  };

  return (
    <>
      {/* 1. Semi-transparent backdrop blur */}
      <div 
        className={`mobile-sheet-backdrop ${isOpen ? 'open' : ''}`} 
        onClick={onClose}
      />

      {/* 2. Slide-up bottom sheet panel */}
      <div className={`mobile-control-sheet ${isOpen ? 'open' : ''}`}>
        
        {/* Visual Drag Handle */}
        <div className="mobile-sheet-handle" onClick={onClose} />

        {/* Content Container */}
        <div className="mobile-sheet-content">

          {/* Settings Tabs for mobile */}
          <div className="settings-tabs" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`settings-tab-btn ${activeTab === 'storage' ? 'active' : ''}`}
              onClick={() => setActiveTab('storage')}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <FolderOpen size={14} />
              存储与播放
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${activeTab === 'daily-download' ? 'active' : ''}`}
              onClick={() => setActiveTab('daily-download')}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <Download size={14} />
              每日下载
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
              onClick={() => setActiveTab('security')}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <Shield size={14} />
              安全中心
            </button>
          </div>

          {activeTab === 'storage' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Quick Stats Panel */}
              <div className="mobile-sheet-summary" style={{
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: '12px',
                padding: '12px 16px',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden', flex: 1 }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>当前扫描目录</span>
                  <span 
                    style={{ 
                      fontSize: '0.8rem', 
                      color: 'var(--text-primary)', 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis', 
                      direction: 'rtl', 
                      textAlign: 'left',
                      fontFamily: 'monospace'
                    }}
                    title={scanDirectory}
                  >
                    {scanDirectory || './resources'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, alignItems: 'flex-end' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--accent-pink)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>图片集总数</span>
                  <span style={{ fontSize: '0.95rem', color: 'var(--accent-purple)', fontWeight: 700 }}>
                    📁 {collections ? collections.length : 0} 个
                  </span>
                </div>
              </div>

              {/* SECTION A: Layout Grid (Split Tiles) */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Grid size={14} /> 分屏布局 (分屏数量)
                </div>

                {/* Layout Presets Buttons */}
                <div className="mobile-grid-selectors">
                  {[1, 2, 4, 6].map(count => {
                    const isActive = tileCount === count;
                    return (
                      <button
                        key={count}
                        className={`mobile-capsule-btn ${isActive ? 'active' : ''}`}
                        onClick={() => handleGridPresetClick(count)}
                        style={{ height: 44, borderRadius: 10 }}
                      >
                        {count} 屏
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SECTION B: Playback speed */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Compass size={14} /> 自动轮播速度
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '4px 0'
                }}>
                  <input
                    type="range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={globalSpeed / 1000}
                    onChange={(e) => setGlobalSpeed(parseFloat(e.target.value) * 1000)}
                    className="mobile-range-slider"
                    style={{ flex: 1, height: '6px' }}
                  />
                  <span style={{
                    fontSize: '0.85rem',
                    color: 'var(--accent-purple)',
                    fontWeight: 600,
                    minWidth: '48px',
                    textAlign: 'right'
                  }}>
                    {globalSpeed / 1000}秒
                  </span>
                </div>
              </div>

              {/* Sync/Async Mode Toggle */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Sliders size={14} /> 轮播模式
                </div>
                <div className="mobile-capsule-group">
                  <button
                    className={`mobile-capsule-btn ${!isSyncMode ? 'active' : ''}`}
                    onClick={() => setIsSyncMode(false)}
                  >
                    异步 (各自独立)
                  </button>
                  <button
                    className={`mobile-capsule-btn ${isSyncMode ? 'active' : ''}`}
                    onClick={() => setIsSyncMode(true)}
                  >
                    同步 (同时切换)
                  </button>
                </div>
              </div>

              {/* SECTION C: Image Sort Order */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Sliders size={14} /> 图片集排序方式
                </div>
                <div className="mobile-capsule-group">
                  {[
                    { id: 'random', label: '随机乱序' },
                    { id: 'name', label: '按名称排序' },
                    { id: 'date', label: '按时间排序' }
                  ].map(method => {
                    const isActive = sortMethod === method.id;
                    return (
                      <button
                        key={method.id}
                        className={`mobile-capsule-btn ${isActive ? 'active' : ''}`}
                        onClick={() => setSortMethod(method.id)}
                      >
                        {method.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Internal Image Sort */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Grid size={14} /> 内部图片排序
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  文件夹内图片的播放顺序
                </div>
                <div className="mobile-capsule-group">
                  {[
                    { id: 'name', label: '按名称' },
                    { id: 'date', label: '按时间' },
                  ].map(method => (
                    <button
                      key={method.id}
                      className={`mobile-capsule-btn ${imageSort === method.id ? 'active' : ''}`}
                      onClick={() => setImageSort(method.id)}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Speed Control */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  🎬 视频播放倍速
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0'
                }}>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="0.5"
                    value={videoSpeed}
                    onChange={(e) => setVideoSpeed(parseFloat(e.target.value))}
                    className="mobile-range-slider"
                    style={{ flex: 1, height: '6px' }}
                  />
                  <span style={{
                    fontSize: '0.85rem', color: 'var(--accent-purple)', fontWeight: 600,
                    minWidth: '42px', textAlign: 'right'
                  }}>
                    {videoSpeed}x
                  </span>
                </div>
              </div>

              {/* Favorites Filter Toggle */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  ⭐ 最爱筛选
                </div>
                <div className="mobile-capsule-group">
                  <button
                    className={`mobile-capsule-btn ${showFavoritesOnly ? 'active' : ''}`}
                    onClick={() => {
                      setShowFavoritesOnly(true);
                      setShowUnmanagedOnly(false);
                    }}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    ⭐ 最爱
                  </button>
                  <button
                    className={`mobile-capsule-btn ${showUnmanagedOnly ? 'active' : ''}`}
                    onClick={() => {
                      setShowUnmanagedOnly(true);
                      setShowFavoritesOnly(false);
                    }}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    👤 未管理
                  </button>
                  {(showFavoritesOnly || showUnmanagedOnly) && (
                    <button
                      className="mobile-capsule-btn"
                      onClick={() => {
                        setShowFavoritesOnly(false);
                        setShowUnmanagedOnly(false);
                      }}
                      style={{ flex: 0, padding: '0 12px', justifyContent: 'center' }}
                    >
                      全部
                    </button>
                  )}
                </div>
              </div>

              {/* SECTION D: Manual Control Panel */}
              <div className="mobile-sheet-section">
                <button
                  type="button"
                  className="mobile-action-btn primary w-full"
                  onClick={() => {
                    shuffleAllTiles();
                    onClose();
                  }}
                  style={{ gap: 8, height: 44, borderRadius: 10 }}
                >
                  <Shuffle size={14} /> 立即打乱重组所有分屏
                </button>
              </div>

              {/* Deleted Accounts Section */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <Trash2 size={14} /> 已删除账号
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  以下账号已从本地删除，可随时恢复重新下载。
                </div>
                {deletedAccounts.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                    暂无已删除的账号
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {deletedAccounts.map((username, idx) => (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6,
                        fontSize: '0.75rem'
                      }}>
                        <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{username}</span>
                        <button onClick={() => onRestoreAccount(username)} style={{
                          background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.2)',
                          color: '#22c55e', padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                          fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4
                        }}>
                          <RotateCcw size={11} /> 恢复
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SECTION E: Folder Scan Path Configuration */}
              <div className="mobile-sheet-section">
                <div className="mobile-sheet-section-title">
                  <FolderOpen size={14} /> 服务器照片扫描目录
                </div>
                <form 
                  ref={historyRef}
                  onSubmit={(e) => {
                    setIsHistoryOpen(false);
                    handleSaveDirectory(e);
                  }} 
                  className="mobile-dir-form"
                  style={{ position: 'relative' }}
                >
                  <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                    <div className="mobile-input-wrapper" style={{ flex: 1, margin: 0 }}>
                      <input 
                        type="text"
                        value={inputScanDir}
                        onChange={(e) => setInputScanDir(e.target.value)}
                        className="mobile-text-input"
                        placeholder="例如 C:\Users\Pics"
                      />
                    </div>
                    {directoryHistory.length > 0 && (
                      <button
                        type="button"
                        className={`mobile-action-btn ${isHistoryOpen ? 'primary' : ''}`}
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        style={{ flex: '0 0 44px', width: 44, height: 44, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0 }}
                      >
                        <History size={16} />
                      </button>
                    )}
                  </div>
                  
                  {isHistoryOpen && directoryHistory.length > 0 && (
                    <div 
                      className="glass-panel" 
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        zIndex: 100,
                        padding: 8,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        boxShadow: '0 -10px 25px rgba(0,0,0,0.5)',
                        border: '1px solid rgba(255,255,255,0.12)'
                      }}
                    >
                      <div className="history-title" style={{ padding: '2px 4px 6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 4 }}>
                        <History size={12} />
                        历史扫描目录 (点击选择):
                      </div>
                      <div className="history-list" style={{ maxHeight: '140px', overflowY: 'auto' }}>
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
                            <span className="history-item-text" title={dir} style={{ fontSize: '0.75rem' }}>
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

                  <div className="mobile-action-btn-row" style={{ marginTop: 12 }}>
                    <button 
                      type="button" 
                      onClick={() => {
                        setInputScanDir(scanDirectory);
                        setIsHistoryOpen(false);
                      }}
                      className="mobile-action-btn"
                      disabled={isSubmittingDir}
                    >
                      重置
                    </button>
                    <button 
                      type="submit" 
                      className="mobile-action-btn primary"
                      disabled={isSubmittingDir || !inputScanDir.trim() || inputScanDir.trim() === scanDirectory}
                    >
                      {isSubmittingDir ? '保存中...' : '应用并 rescan'}
                    </button>
                  </div>
                  {dirError && <div className="mobile-sheet-error">⚠️ {dirError}</div>}
                </form>
              </div>
            </div>
          ) : activeTab === 'daily-download' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflowY: 'auto', padding: '4px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block' }}>
                每日下载列表 — 每天凌晨 2:00 自动下载以下账号的最新图片
              </label>
              {downloadList.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', padding: '12px 0', textAlign: 'center' }}>
                  列表为空。在播放窗口中点击 ⭐ 按钮添加账号，或在下方的输入框中手动添加。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {downloadList.map((username, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 10px', background: 'rgba(255,255,255,0.04)',
                      borderRadius: 6, fontSize: '0.75rem'
                    }}>
                      <span>@{username}</span>
                      <button
                        type="button"
                        className="tile-mini-btn"
                        onClick={async () => {
                          await fetch('/api/download-list/remove', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username })
                          });
                          fetchDownloadList();
                        }}
                        title="移除"
                        style={{ color: '#ef4444' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input
                  type="text"
                  className="mobile-text-input"
                  value={newDownloadUser}
                  onChange={(e) => setNewDownloadUser(e.target.value)}
                  placeholder="输入 Instagram 用户名"
                  style={{ flex: 1, fontSize: '0.75rem', padding: '8px 10px' }}
                />
                <button
                  type="button"
                  className="mobile-action-btn primary"
                  disabled={!newDownloadUser.trim()}
                  onClick={async () => {
                    const name = newDownloadUser.trim();
                    if (!name) return;
                    await fetch('/api/download-list/add', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ username: name })
                    });
                    setNewDownloadUser('');
                    fetchDownloadList();
                  }}
                  style={{ padding: '0 14px', fontSize: '0.7rem', whiteSpace: 'nowrap' }}
                >
                  添加
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '0 4px', maxHeight: '55vh', overflowY: 'auto' }}>
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
      </div>
    </>
  );
}
