import { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, Shuffle, Settings, Columns, Image, Sliders, ChevronDown,
  Sparkles, ZoomIn, ZoomOut, FolderOpen, ArrowUpDown, Instagram, LayoutGrid,
  SlidersHorizontal, X
} from 'lucide-react';
import FaradaySuiteMenu from './FaradaySuiteMenu';
import AccountList from './AccountList';

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
  isSyncMode,
  setIsSyncMode,
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
  videoSpeed,
  setVideoSpeed,
  imageSort,
  setImageSort,
  recentPostDays,
  setRecentPostDays,
  recentDlDays,
  setRecentDlDays,
  personFilter = '-',
  setPersonFilter,
  accountFilter = [],
  onSelectAccount,
  onOpenGridView,
}) {
  const [isAccountsOpen, setIsAccountsOpen] = useState(false);
  const accountsRef = useRef(null);
  const accountBtnRef = useRef(null);

  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const moreBtnRef = useRef(null);

  // 点击面板外部关闭弹层（排除按钮本身，防止 mousedown 与 click 冲突）
  useEffect(() => {
    if (!isAccountsOpen && !isMoreOpen) return;
    const handleClickOutside = (e) => {
      if (isAccountsOpen && accountsRef.current && !accountsRef.current.contains(e.target) && !accountBtnRef.current?.contains(e.target)) {
        setIsAccountsOpen(false);
      }
      if (isMoreOpen && moreRef.current && !moreRef.current.contains(e.target) && !moreBtnRef.current?.contains(e.target)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAccountsOpen, isMoreOpen]);

  const speedInSeconds = globalSpeed / 1000;

  // 判断“更多”内是否有非默认配置生效（显示小紫点提醒）
  const hasMoreActive = (recentPostDays > 0) || (recentDlDays > 0) || (zoomScale !== 1) || (videoSpeed !== 2) || (imageSort !== 'name');

  return (
    <>
      {/* Main Control Bar - Full width at bottom (常驻自适应单行显示) */}
      <div className="glass-panel hud-container">
        {/* Brand / Status Info */}
        <div className="hud-section hud-section-compact hud-brand-section">
          <div className="hud-title-brand" style={{ fontSize: '0.85rem' }}>
            <Image size={15} style={{ color: '#a855f7', flexShrink: 0 }} />
            <span className="hud-brand-text">BLISSFUL FARADAY</span>
          </div>
        </div>

        {/* 1. Grid Tile Count (分屏) */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', fontSize: '0.62rem' }}>
            <Columns size={11} /> 分屏
          </span>
          
          {/* Mode Toggle */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px' }}>
            <button
              onClick={() => setIsAutoTiling(true)}
              style={{
                background: isAutoTiling ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: isAutoTiling ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.58rem',
                padding: '2px 5px',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
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
                fontSize: '0.58rem',
                padding: '2px 5px',
                borderRadius: '3px',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              手动
            </button>
          </div>

          {/* Preset Buttons */}
          <div style={{ display: 'flex', gap: 2 }}>
            {ALLOWED_TILE_COUNTS.map(num => (
              <button
                key={num}
                onClick={() => setTileCount(num)}
                style={{
                  background: tileCount === num ? 'var(--accent-purple)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.62rem',
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

        {/* 2. Playback Controls (轮播) */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', fontSize: '0.62rem' }}>
            <Sliders size={11} /> 轮播
          </span>
          
          {/* Toggle Switch */}
          <div 
            onClick={() => setGlobalIsPlaying(!globalIsPlaying)}
            title={globalIsPlaying ? '暂停轮播 (空格键)' : '继续轮播 (空格键)'}
            style={{
              width: '32px',
              height: '16px',
              borderRadius: '8px',
              background: globalIsPlaying ? 'var(--accent-blue)' : 'rgba(255,255,255,0.1)',
              position: 'relative',
              cursor: 'pointer',
              transition: 'var(--transition-smooth)',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: '#fff',
              position: 'absolute',
              top: '2px',
              left: globalIsPlaying ? '18px' : '2px',
              transition: 'var(--transition-smooth)'
            }} />
          </div>

          {/* Sync/Async Mode Toggle */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px' }}>
            <button
              onClick={() => setIsSyncMode(false)}
              style={{
                background: !isSyncMode ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: !isSyncMode ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.58rem',
                padding: '2px 5px',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              异步
            </button>
            <button
              onClick={() => setIsSyncMode(true)}
              style={{
                background: isSyncMode ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: isSyncMode ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.58rem',
                padding: '2px 5px',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              同步
            </button>
          </div>

          {/* Speed control - slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: globalIsPlaying ? 1 : 0.4 }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', minWidth: '32px', textAlign: 'right' }}>
              {speedInSeconds.toFixed(1)}s
            </span>
            <input
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={speedInSeconds}
              onChange={(e) => setGlobalSpeed(parseFloat(e.target.value) * 1000)}
              className="glass-slider"
              style={{ width: '64px', height: '4px', cursor: 'pointer' }}
            />
          </div>
        </div>

        {/* 3. Folder Sorting (主排序) */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', fontSize: '0.62rem' }}>
            <ArrowUpDown size={11} /> 排序
          </span>
          <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '5px' }}>
            {[
              { id: 'name', label: '名称', title: '按文件夹名称排序' },
              { id: 'date', label: '时间', title: '按最后修改时间排序' },
              { id: 'random', label: '随机', title: '纯随机顺序' }
            ].map(method => (
              <button
                key={method.id}
                onClick={() => {
                  if (method.id === 'random' && sortMethod === 'random') {
                    onShuffleAll();
                  } else {
                    setSortMethod(method.id);
                  }
                }}
                style={{
                  background: sortMethod === method.id ? 'var(--accent-purple)' : 'transparent',
                  border: 'none',
                  color: sortMethod === method.id ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.58rem',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontWeight: sortMethod === method.id ? 'bold' : 'normal',
                  transition: 'var(--transition-smooth)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: method.id === 'random' && sortMethod === 'random' ? 3 : 0
                }}
                title={method.id === 'random' && sortMethod === 'random' ? '点击重新随机打乱' : method.title}
              >
                <span>{method.label}</span>
                {method.id === 'random' && sortMethod === 'random' && (
                  <Shuffle size={8} style={{ transition: 'transform 0.3s ease' }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 4. 人像三态筛选 */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', fontSize: '0.62rem' }}>
            人像
          </span>
          <select
            className="glass-select"
            value={personFilter}
            onChange={(e) => setPersonFilter && setPersonFilter(e.target.value)}
            title="人像智能筛选：是（只播人像图/视频）、否（只播非人像）、-（全部）"
            style={{
              fontSize: '0.62rem',
              padding: '1px 4px',
              height: '22px',
              minWidth: '50px',
              cursor: 'pointer',
              fontWeight: personFilter !== '-' ? 'bold' : 'normal',
              color: personFilter === '1' ? '#c084fc' : (personFilter === '0' ? '#38bdf8' : 'inherit'),
              background: personFilter !== '-' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${personFilter !== '-' ? 'rgba(168, 85, 247, 0.45)' : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <option value="-">- (全部)</option>
            <option value="1">是</option>
            <option value="0">否</option>
          </select>
        </div>

        {/* 5. Instagram 账号多选 */}
        <div className="hud-section hud-section-compact">
          <span className="hud-label" style={{ display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', fontSize: '0.62rem' }}>
            <Instagram size={11} /> 账号
          </span>
          <button
            ref={accountBtnRef}
            onClick={() => setIsAccountsOpen(v => !v)}
            title={accountFilter.length ? `当前只看 ${accountFilter.length} 个账号，点击管理` : '选择账号（可多选），只播放勾选账号的帖子'}
            style={{
              background: (isAccountsOpen || accountFilter.length) ? 'var(--accent-purple)' : 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#fff',
              fontSize: '0.58rem',
              padding: '2px 7px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: (isAccountsOpen || accountFilter.length) ? 'bold' : 'normal',
              maxWidth: '95px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {accountFilter.length === 0 ? '全部'
              : accountFilter.length === 1 ? `@${accountFilter[0]}`
              : `${accountFilter.length} 个`}
          </button>
        </div>

        {/* 6. 平铺检视工作台 */}
        <div className="hud-section hud-section-compact">
          <button
            className="glass-button"
            onClick={onOpenGridView}
            title="进入图片平铺检视工作台（自适应缩放、肉眼定位与快速纠偏）"
            style={{
              padding: '4px 9px',
              background: 'rgba(168, 85, 247, 0.18)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              color: '#d8b4fe',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <LayoutGrid size={12} />
            <span style={{ fontSize: '0.65rem', fontWeight: 600 }}>平铺</span>
          </button>
        </div>

        {/* 7. 更多控制项 (收纳次频项：范围、缩放、视频倍速、内部排序、Suite) */}
        <div className="hud-section hud-section-compact">
          <button
            ref={moreBtnRef}
            className="glass-button"
            onClick={() => setIsMoreOpen(v => !v)}
            title="更多控制项（时间范围、缩放、视频倍速、内部排序等）"
            style={{
              padding: '4px 9px',
              background: (isMoreOpen || hasMoreActive) ? 'rgba(168, 85, 247, 0.22)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${(isMoreOpen || hasMoreActive) ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255,255,255,0.08)'}`,
              color: (isMoreOpen || hasMoreActive) ? '#d8b4fe' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              position: 'relative',
            }}
          >
            <SlidersHorizontal size={12} />
            <span style={{ fontSize: '0.65rem' }}>更多</span>
            <ChevronDown size={10} style={{ transform: isMoreOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            {hasMoreActive && !isMoreOpen && (
              <span style={{
                position: 'absolute', top: -2, right: -2, width: 6, height: 6,
                borderRadius: '50%', background: '#a855f7', border: '1px solid #000'
              }} />
            )}
          </button>
        </div>

        {/* 8. 设置按钮 */}
        <div className="hud-section hud-section-compact" style={{ borderRight: 'none' }}>
          <button
            className="glass-button"
            onClick={onOpenSettings}
            style={{ padding: '4px 10px' }}
          >
            <Settings size={13} />
            <span style={{ fontSize: '0.65rem' }}>设置</span>
          </button>
        </div>
      </div>

      {/* ─── 独立顶层浮动弹层（脱离 .hud-container，绝不受任何裁切或图层隔离影响）─── */}

      {/* 账号清单弹层 */}
      {isAccountsOpen && (
        <div
          ref={accountsRef}
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 330,
            maxHeight: '62vh',
            overflowY: 'auto',
            zIndex: 100,
            padding: 12,
            boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.14)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Instagram size={13} style={{ color: '#a855f7' }} />
              Instagram 账号选择
            </span>
            <button
              type="button"
              className="tile-mini-btn"
              onClick={() => setIsAccountsOpen(false)}
              title="关闭"
            >
              <X size={13} />
            </button>
          </div>
          <AccountList
            dense
            accountFilter={accountFilter}
            onSelectAccount={(u) => {
              onSelectAccount && onSelectAccount(u);
            }}
            maxHeight="46vh"
          />
        </div>
      )}

      {/* 更多控制弹层面板 */}
      {isMoreOpen && (
        <div
          ref={moreRef}
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: 50,
            right: 20,
            width: 275,
            zIndex: 100,
            padding: '12px 14px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.7)',
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: '#d8b4fe' }}>
              <SlidersHorizontal size={13} />
              高级播放选项
            </span>
            <button
              type="button"
              className="tile-mini-btn"
              onClick={() => setIsMoreOpen(false)}
              title="关闭"
            >
              <X size={13} />
            </button>
          </div>

          {/* 1. 时间范围过滤 */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 4 }}>
              🕐 时间范围过滤
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { label: '发布天数', value: recentPostDays, setter: setRecentPostDays, title: '只看最近几天发布的帖子' },
                { label: '下载天数', value: recentDlDays, setter: setRecentDlDays, title: '只看最近几天下载的内容' },
              ].map(f => (
                <div key={f.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{f.label}:</span>
                  <select
                    className="glass-select"
                    value={String(f.value)}
                    onChange={(e) => f.setter(parseInt(e.target.value, 10))}
                    title={f.title}
                    style={{ fontSize: '0.65rem', padding: '2px 6px', height: '22px', width: '100px' }}
                  >
                    {[['0', '全部'], ['1', '1天内'], ['3', '3天内'], ['7', '7天内'], ['14', '14天内'], ['30', '30天内'], ['90', '90天内']].map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* 2. 缩放控制 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>🔍 窗口全局缩放</span>
              <button
                onClick={() => setZoomScale(1)}
                style={{
                  background: zoomScale === 1 ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.58rem',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                重置 {Math.round(zoomScale * 100)}%
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ZoomOut size={12} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={onZoomOut} />
              <input
                type="range"
                min="0.3"
                max="1.5"
                step="0.05"
                value={zoomScale}
                onChange={(e) => setZoomScale(parseFloat(e.target.value))}
                className="glass-slider"
                style={{ flex: 1, height: '4px' }}
              />
              <ZoomIn size={12} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={onZoomIn} />
            </div>
          </div>

          {/* 3. 视频倍速 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>🎬 视频播放倍速</span>
              <span style={{ fontSize: '0.65rem', color: '#c084fc', fontWeight: 'bold' }}>{videoSpeed.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              step="0.5"
              value={videoSpeed}
              onChange={(e) => setVideoSpeed(parseFloat(e.target.value))}
              className="glass-slider"
              style={{ width: '100%', height: '4px', cursor: 'pointer' }}
            />
          </div>

          {/* 4. 内部排序 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>📂 图集内部排序:</span>
            <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: '4px' }}>
              {[
                { id: 'name', label: '名称' },
                { id: 'date', label: '时间' },
              ].map(method => (
                <button
                  key={method.id}
                  onClick={() => setImageSort(method.id)}
                  style={{
                    background: imageSort === method.id ? 'var(--accent-purple)' : 'transparent',
                    border: 'none',
                    color: imageSort === method.id ? '#fff' : 'var(--text-secondary)',
                    fontSize: '0.6rem',
                    padding: '2px 8px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontWeight: imageSort === method.id ? 'bold' : 'normal',
                  }}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Faraday Suite 切换 */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>跨应用切换:</span>
            <FaradaySuiteMenu currentApp="gallery" direction="up" />
          </div>
        </div>
      )}
    </>
  );
}
