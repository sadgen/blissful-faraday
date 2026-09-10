import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, UserCheck, UserX, HelpCircle, ArrowUpDown, ZoomIn, ZoomOut, RefreshCw, Play, Maximize2 } from 'lucide-react';

export default function MediaGridView({
  isOpen,
  onClose,
  accountFilter = [],
  personFilter = '-',
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [sortMethod, setSortMethod] = useState('mtime_desc'); // mtime_desc | mtime_asc | name
  const [tileSize, setTileSize] = useState(110); // 网格单元宽度 px (支持 60 ~ 280)
  const [togglingMap, setTogglingMap] = useState(new Set()); // 正在翻转的文件 key
  const [hoveredKey, setHoveredKey] = useState(null); // 鼠标当前悬停预览的视频 key（单例播放）

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const scrollContainerRef = useRef(null);

  // 整理账号参数
  const accountsParam = Array.isArray(accountFilter)
    ? accountFilter.join(',')
    : (accountFilter ? String(accountFilter) : '');

  const loadData = useCallback(async (isReset = false) => {
    if (loadingRef.current) return;
    if (!isReset && !hasMore) return;

    loadingRef.current = true;
    setLoading(true);
    if (isReset) {
      offsetRef.current = 0;
      setError('');
    }

    try {
      const qs = new URLSearchParams({
        accounts: accountsParam,
        person: personFilter || '-',
        sort: sortMethod,
        offset: String(offsetRef.current),
        limit: '60',
      });
      const res = await fetch(`/api/media/flat-list?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const newItems = Array.isArray(data.items) ? data.items : [];
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
      offsetRef.current += newItems.length;

      setItems(prev => isReset ? newItems : [...prev, ...newItems]);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [accountsParam, personFilter, sortMethod, hasMore]);

  // 依赖变化时重置
  useEffect(() => {
    if (isOpen) {
      loadData(true);
    } else {
      setItems([]);
      offsetRef.current = 0;
    }
  }, [isOpen, accountsParam, personFilter, sortMethod]);

  // 监听 Escape 退出
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // 滚动触底懒加载（距离底部小于 350px 平滑追加下一批）
  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 350) {
      if (!loadingRef.current && hasMore) {
        loadData(false);
      }
    }
  };

  // 一键快速翻转人像状态
  const handleTogglePerson = async (item, e) => {
    e.stopPropagation();
    const key = `${item.collection}:${item.name}`;
    if (togglingMap.has(key)) return;

    setTogglingMap(prev => new Set(prev).add(key));

    try {
      const res = await fetch(`/api/person/toggle?collection=${encodeURIComponent(item.collection)}&name=${encodeURIComponent(item.name)}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data && data.success) {
        // 本地即时更新该项
        setItems(prev => prev.map(it => {
          if (it.collection === item.collection && it.name === item.name) {
            return { ...it, p: data.p, s: data.s, manual: true };
          }
          return it;
        }));
      }
    } catch (err) {
      console.warn('Toggle failed:', err);
    } finally {
      setTogglingMap(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#070a13',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--text-primary)',
        userSelect: 'none',
      }}
    >
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(15, 20, 32, 0.8)',
          flexShrink: 0,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* 左侧：标题与状态摘要 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 6, color: '#fff' }}>
            <span>🖼️ 图片平铺检视</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
              （共 {total} 项 · 已载入 {items.length}）
            </span>
          </div>

          {/* 筛选标签提示 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}>
            <span style={{
              padding: '2px 8px', borderRadius: 4,
              background: personFilter === '1' ? 'rgba(168, 85, 247, 0.2)' : (personFilter === '0' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)'),
              color: personFilter === '1' ? '#c084fc' : (personFilter === '0' ? '#38bdf8' : 'var(--text-secondary)'),
              border: `1px solid ${personFilter === '1' ? 'rgba(168, 85, 247, 0.4)' : (personFilter === '0' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255,255,255,0.1)')}`
            }}>
              人像: {personFilter === '1' ? '只看人像' : (personFilter === '0' ? '只看非人像' : '全部')}
            </span>

            {accountsParam && (
              <span style={{
                padding: '2px 8px', borderRadius: 4,
                background: 'rgba(168, 85, 247, 0.15)',
                color: '#d8b4fe',
                border: '1px solid rgba(168, 85, 247, 0.35)'
              }}>
                {Array.isArray(accountFilter) ? `${accountFilter.length} 个账号` : `@${accountFilter}`}
              </span>
            )}
          </div>
        </div>

        {/* 中间：缩放控制 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.25)', padding: '4px 10px', borderRadius: 8 }}>
          <ZoomOut size={13} style={{ opacity: 0.6 }} />
          <input
            type="range"
            min="60"
            max="260"
            step="10"
            value={tileSize}
            onChange={(e) => setTileSize(parseInt(e.target.value, 10))}
            title={`调整平铺大小: ${tileSize}px`}
            style={{ width: 110, cursor: 'pointer', height: 4 }}
          />
          <ZoomIn size={13} style={{ opacity: 0.6 }} />
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            {[
              { label: '小', size: 75 },
              { label: '中', size: 120 },
              { label: '大', size: 190 },
            ].map(b => (
              <button
                key={b.size}
                type="button"
                onClick={() => setTileSize(b.size)}
                style={{
                  padding: '2px 6px',
                  fontSize: '0.65rem',
                  borderRadius: 3,
                  border: 'none',
                  background: tileSize === b.size ? 'var(--accent-purple)' : 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* 右侧：排序与关闭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            <ArrowUpDown size={12} />
            <select
              className="glass-select"
              value={sortMethod}
              onChange={(e) => setSortMethod(e.target.value)}
              style={{ fontSize: '0.7rem', padding: '3px 8px', height: 26 }}
            >
              <option value="mtime_desc">最新下载在前</option>
              <option value="mtime_asc">最早下载在前</option>
              <option value="name">按文件名</option>
            </select>
          </div>

          <button
            type="button"
            className="tile-mini-btn"
            onClick={() => loadData(true)}
            title="重新加载"
            style={{ padding: '5px 8px' }}
          >
            <RefreshCw size={14} className={loading ? 'opencode-spin' : ''} />
          </button>

          <button
            type="button"
            className="tile-mini-btn"
            onClick={onClose}
            title="退出平铺检视 (Esc)"
            style={{ background: 'rgba(255, 255, 255, 0.08)', borderRadius: 6, padding: '5px 8px' }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 平铺主体网格（纯 CSS Grid，自动换行，永不重叠） */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
        }}
      >
        {items.length === 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 12, color: 'var(--text-muted)' }}>
            <HelpCircle size={40} style={{ opacity: 0.4 }} />
            <div>当前筛选条件下暂无图片</div>
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
            gap: 6,
          }}
        >
          {items.map((item, idx) => {
            const isP = item.p === 1;
            const isNP = item.p === 0;
            const key = `${item.collection}:${item.name}`;
            const isToggling = togglingMap.has(key);
            const isHovered = hoveredKey === key;
            // 静态媒体源：图片直接读，视频读专用的首帧缩略图缓存接口
            const staticUrl = item.isVideo
              ? `/api/media/thumbnail?collection=${encodeURIComponent(item.collection)}&name=${encodeURIComponent(item.name)}`
              : `/api/image?collection=${encodeURIComponent(item.collection)}&name=${encodeURIComponent(item.name)}`;
            const videoPlayUrl = `/api/image?collection=${encodeURIComponent(item.collection)}&name=${encodeURIComponent(item.name)}`;

            return (
              <div
                key={key}
                onMouseEnter={() => { if (item.isVideo) setHoveredKey(key); }}
                onMouseLeave={() => { if (item.isVideo && hoveredKey === key) setHoveredKey(null); }}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: '#000',
                  border: isP
                    ? '1px solid rgba(168, 85, 247, 0.45)'
                    : (isNP ? '2px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.12)'),
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
                onClick={(e) => handleTogglePerson(item, e)}
                title={`@${item.collection} / ${item.name}\n当前状态: ${isP ? '人像' : (isNP ? '非人像' : '未识别')}${item.manual ? '（手动纠偏）' : ''} (置信度: ${item.s ?? '—'})\n${item.isVideo ? '鼠标悬停可静音预览视频\n' : ''}点击一键翻转人像/非人像`}
              >
                {/* 媒体内容：100% 原始色彩全开，无任何滤镜或透明度遮罩 */}
                {item.isVideo && isHovered ? (
                  <video
                    src={videoPlayUrl}
                    autoPlay
                    muted
                    loop
                    playsInline
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <img
                    src={staticUrl}
                    alt={item.name}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                      opacity: 1,
                      filter: 'none',
                    }}
                  />
                )}

                {/* 视频标记 */}
                {item.isVideo && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4, left: 4,
                      background: isHovered ? 'rgba(168, 85, 247, 0.85)' : 'rgba(0,0,0,0.65)',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontSize: '9px',
                      color: '#fff',
                      display: 'flex', alignItems: 'center', gap: 3,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    }}
                  >
                    <Play size={8} />
                    <span>{isHovered ? '播放中' : '视频'}</span>
                  </div>
                )}

                {/* 人像状态角标（点击直接翻转） */}
                <div
                  onClick={(e) => handleTogglePerson(item, e)}
                  style={{
                    position: 'absolute',
                    bottom: 4, right: 4,
                    padding: '2px 5px',
                    borderRadius: 4,
                    fontSize: '10px',
                    lineHeight: 1.2,
                    display: 'flex', alignItems: 'center', gap: 3,
                    background: isP
                      ? 'rgba(147, 51, 234, 0.88)'
                      : (isNP ? 'rgba(220, 38, 38, 0.85)' : 'rgba(75, 85, 99, 0.85)'),
                    color: '#fff',
                    backdropFilter: 'blur(4px)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
                    fontWeight: 600,
                    opacity: isToggling ? 0.5 : 1,
                  }}
                >
                  {isP ? <UserCheck size={11} /> : (isNP ? <UserX size={11} /> : <HelpCircle size={11} />)}
                  {tileSize >= 100 && (
                    <span>{isP ? '人像' : (isNP ? '非人' : '未定')}</span>
                  )}
                  {item.manual && <span style={{ color: '#fef08a', fontSize: '8px' }}>★</span>}
                </div>

                {/* 账号水印（卡片稍大时显示） */}
                {tileSize >= 130 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4, right: 4,
                      maxWidth: '85%',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: 3,
                      padding: '1px 4px',
                      fontSize: '9px',
                      color: 'rgba(255,255,255,0.7)',
                    }}
                  >
                    @{item.collection}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部加载指示与手动追加按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0 36px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={14} className="opencode-spin" />
              正在加载更多图片...
            </span>
          ) : hasMore ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                className="glass-button"
                onClick={() => loadData(false)}
                style={{
                  padding: '6px 16px',
                  fontSize: '0.75rem',
                  background: 'rgba(168, 85, 247, 0.22)',
                  border: '1px solid rgba(168, 85, 247, 0.5)',
                  color: '#d8b4fe',
                  cursor: 'pointer',
                  borderRadius: 6
                }}
              >
                点此加载下一批（还有 {total - items.length} 张）
              </button>
              <span style={{ opacity: 0.6 }}>或向下滚动自动加载</span>
            </div>
          ) : items.length > 0 ? (
            <span>已加载全部 {total} 张图片</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
