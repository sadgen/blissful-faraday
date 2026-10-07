import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, X, Instagram, Download } from 'lucide-react';

// 相对时间：账号面板里展示"最近更新"
function relativeTime(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 86400000 * 30) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(ms).toLocaleDateString('zh-CN');
}

// 后台采集：优先走油猴脚本（v1.4.0+）注入的桥，在后台标签页打开该账号的
// Instagram 主页——首屏采集自动开始，不打断当前浏览；未装/未更新脚本时
// 降级为新标签页前台打开（采集同样自动开始）。
// 返回提示文案：让用户立刻知道走的哪条路（移动端浏览器即使有桥也可能
// 强制前台打开，属浏览器限制，采集不受影响）。
function openHarvest(username) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  if (typeof window !== 'undefined' && window.__bfHarvestBridge) {
    window.postMessage({ type: 'bf-harvest-open', username }, '*');
    return `已交脚本后台打开 @${username}（若被切到前台，是浏览器不支持后台标签，采集照常）`;
  }
  window.open(url, '_blank', 'noopener');
  return `未检测到脚本桥，已前台打开 @${username}（请把油猴脚本更新到 v1.4.1+）`;
}

// 增量深采最大页数（0=不限）：存本机 localStorage 并经油猴桥同步进脚本
// 的 GM 存储（同浏览器共享）；Instagram 页每次 tick 实时读取，改完即生效。
const DEEP_SCAN_KEY = 'bf_deepScanMaxPages';
const DEEP_SCAN_OPTIONS = [
  { v: 0, label: '不限' },
  { v: 3, label: '3' },
  { v: 5, label: '5' },
  { v: 10, label: '10' },
  { v: 20, label: '20' },
  { v: 50, label: '50' },
];

function readDeepScanMaxPages() {
  try {
    const v = parseInt(localStorage.getItem(DEEP_SCAN_KEY), 10);
    return Number.isFinite(v) && v >= 0 && v <= 200 ? v : 10;
  } catch { return 10; }
}

function pushDeepScanConfig(v) {
  try {
    if (typeof window !== 'undefined' && window.__bfHarvestBridge) {
      window.postMessage({ type: 'bf-harvest-config', deepScanMaxPages: v }, '*');
    }
  } catch { /* 无桥时仅存本机，脚本更新后打开画廊会重新同步 */ }
}

/**
 * Instagram 账号清单（桌面 HUD 弹层与手机控制抽屉共用）。
 * 从 /api/instagram/accounts 拉取账号（帖子数/最近更新），支持按
 * 更新时间或帖子数排序；账号行带多选框，勾选（可多选）后仅播放
 * 勾选账号的帖子；已选账号下方附 Instagram 主页直达链接。
 * 普通文件夹不涉及此组件。
 */
export default function AccountList({
  accountFilter = [],
  onSelectAccount,
  dense = false,
  maxHeight = 300,
}) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('recent'); // 'recent' | 'posts'
  const [toast, setToast] = useState('');
  const toastTimerRef = useRef(null);
  const [deepScanMax, setDeepScanMax] = useState(readDeepScanMaxPages);

  // 挂载时向油猴桥推一次当前设置（脚本重装/更新后打开画廊即恢复同步）
  useEffect(() => { pushDeepScanConfig(readDeepScanMaxPages()); }, []);

  function setDeepScan(v) {
    setDeepScanMax(v);
    try { localStorage.setItem(DEEP_SCAN_KEY, String(v)); } catch { }
    pushDeepScanConfig(v);
  }

  function showToast(text) {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 3500);
  }

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // 兼容旧版单选字符串
  const selected = Array.isArray(accountFilter)
    ? accountFilter
    : (accountFilter ? [accountFilter] : []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/instagram/accounts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const sorted = [...accounts].sort((a, b) => {
    if (sortKey === 'posts') {
      return (b.postCount - a.postCount) || (b.mediaCount - a.mediaCount);
    }
    const ua = Math.max(a.latestPostTs ? a.latestPostTs * 1000 : 0, a.mtime || 0);
    const ub = Math.max(b.latestPostTs ? b.latestPostTs * 1000 : 0, b.mtime || 0);
    return ub - ua;
  });

  const rowMinHeight = dense ? 34 : 46;
  const checkboxSize = dense ? 13 : 15;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {/* 排序切换 + 刷新 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ display: 'flex', gap: 3, background: 'rgba(0,0,0,0.2)', padding: '2px', borderRadius: 6, flex: 1 }}>
          {[
            { id: 'recent', label: '最近更新', title: '按最近发帖/入库时间排序' },
            { id: 'posts', label: '帖子数', title: '按已入库帖子数量排序' },
          ].map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSortKey(s.id)}
              title={s.title}
              style={{
                flex: 1,
                background: sortKey === s.id ? 'var(--accent-purple)' : 'transparent',
                border: 'none',
                color: sortKey === s.id ? '#fff' : 'var(--text-secondary)',
                fontSize: dense ? '0.6rem' : '0.7rem',
                padding: dense ? '3px 6px' : '5px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: sortKey === s.id ? 'bold' : 'normal',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tile-mini-btn"
          onClick={fetchAccounts}
          title="刷新账号列表"
          style={{ flexShrink: 0 }}
        >
          <RefreshCw size={dense ? 12 : 14} className={loading ? 'opencode-spin' : ''} />
        </button>
      </div>

      {/* 当前过滤提示：多选时显示已选数量，点击全部清空 */}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => { [...selected].forEach(u => onSelectAccount && onSelectAccount(u)); }}
          title="取消全部勾选，显示全部账号"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'rgba(168, 85, 247, 0.18)',
            border: '1px solid rgba(168, 85, 247, 0.45)',
            color: '#d8b4fe',
            fontSize: dense ? '0.65rem' : '0.75rem',
            padding: dense ? '4px 8px' : '7px 10px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <X size={dense ? 11 : 13} />
          已选 {selected.length} 个账号{selected.length <= 2 ? `（@${selected.join('、@')}）` : ''}（点击清空）
        </button>
      )}

      {/* 账号列表（多选框，勾选即播放） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', maxHeight }}>
        {loading && accounts.length === 0 ? (
          <span style={{ fontSize: dense ? '0.65rem' : '0.75rem', color: 'var(--text-muted)', padding: '8px 4px' }}>
            正在加载账号...
          </span>
        ) : error ? (
          <span style={{ fontSize: dense ? '0.65rem' : '0.75rem', color: '#ef4444', padding: '8px 4px' }}>
            加载失败：{error}
          </span>
        ) : sorted.length === 0 ? (
          <span style={{ fontSize: dense ? '0.65rem' : '0.75rem', color: 'var(--text-muted)', padding: '8px 4px', lineHeight: 1.5 }}>
            暂无 Instagram 账号。通过油猴脚本在 Instagram 页面采集后，账号会出现在这里。
          </span>
        ) : (
          sorted.map(acc => {
            const active = selected.includes(acc.username);
            const updated = Math.max(acc.latestPostTs ? acc.latestPostTs * 1000 : 0, acc.mtime || 0);
            return (
              <button
                key={acc.username}
                type="button"
                onClick={() => onSelectAccount && onSelectAccount(acc.username)}
                title={active ? `取消勾选 @${acc.username}` : `勾选 @${acc.username}（可多选，勾选的账号都会播放）`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  minHeight: rowMinHeight,
                  padding: dense ? '4px 8px' : '7px 10px',
                  background: active ? 'rgba(168, 85, 247, 0.22)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${active ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                {/* 多选框 */}
                <span
                  style={{
                    flexShrink: 0,
                    width: checkboxSize, height: checkboxSize,
                    borderRadius: 4,
                    border: `1.5px solid ${active ? '#a855f7' : 'rgba(255,255,255,0.3)'}`,
                    background: active ? '#a855f7' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: checkboxSize - 5,
                    lineHeight: 1,
                    color: '#fff',
                    fontWeight: 'bold',
                  }}
                >
                  {active ? '✓' : ''}
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <div style={{
                    fontSize: dense ? '0.7rem' : '0.8rem',
                    fontWeight: active ? 'bold' : 600,
                    color: active ? '#d8b4fe' : 'var(--text-primary)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    @{acc.username}
                    {acc.fullName && (
                      <span style={{ fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: 6, fontSize: dense ? '0.6rem' : '0.7rem' }}>
                        {acc.fullName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: dense ? '0.55rem' : '0.65rem', color: 'var(--text-muted)' }}>
                    {relativeTime(updated)}
                    {acc.unsortedCount > 0 ? ` · 未归类 ${acc.unsortedCount}` : ''}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right', lineHeight: 1.3 }}>
                  <div style={{ fontSize: dense ? '0.65rem' : '0.75rem', color: 'var(--accent-purple)', fontWeight: 700 }}>
                    {acc.postCount} 帖
                  </div>
                  <div style={{ fontSize: dense ? '0.55rem' : '0.65rem', color: 'var(--text-muted)' }}>
                    {acc.mediaCount} 文件
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 增量深采最大页数（同步给油猴脚本；0=不限，翻到已采集帖子或主页底部才停） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          title="增量深采（首屏全新时自动往下翻页采集）的最大页数；0=不限制，遇到已采集帖子或翻到主页底部才停。改动经油猴脚本桥实时同步，Instagram 页即刻生效"
          style={{ fontSize: dense ? '0.6rem' : '0.68rem', color: 'var(--text-muted)', flexShrink: 0, cursor: 'help' }}
        >
          深采页数
        </span>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {DEEP_SCAN_OPTIONS.map(o => (
            <button
              key={o.v}
              type="button"
              onClick={() => setDeepScan(o.v)}
              title={`增量深采最多自动翻 ${o.v === 0 ? '不限页数' : o.v + ' 页'}`}
              style={{
                background: deepScanMax === o.v ? 'var(--accent-purple)' : 'rgba(0,0,0,0.2)',
                border: 'none',
                color: deepScanMax === o.v ? '#fff' : 'var(--text-secondary)',
                fontSize: dense ? '0.6rem' : '0.68rem',
                padding: dense ? '3px 7px' : '4px 9px',
                borderRadius: 10,
                cursor: 'pointer',
                fontWeight: deepScanMax === o.v ? 'bold' : 'normal',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* 已选账号的 Instagram 主页直达链接 */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: dense ? '0.6rem' : '0.68rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Instagram size={dense ? 10 : 12} /> 已选账号主页（⬇ = 后台采集）
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {selected.map(u => (
              <span key={u} style={{ display: 'inline-flex', alignItems: 'stretch', gap: 3 }}>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(u)}/`}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`打开 @${u} 的 Instagram 主页（Ctrl/中键点击=后台标签页）`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'rgba(168, 85, 247, 0.14)',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    color: '#d8b4fe',
                    fontSize: dense ? '0.6rem' : '0.7rem',
                    padding: dense ? '3px 7px' : '4px 9px',
                    borderRadius: 12,
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <Instagram size={dense ? 10 : 12} />
                  @{u} ↗
                </a>
                <button
                  type="button"
                  onClick={() => showToast(openHarvest(u))}
                  title={`后台打开 @${u} 主页并自动采集首屏（不影响当前页面）。若首次点击在前台打开，说明该浏览器还未装/未更新油猴脚本到 v1.4.0`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(168, 85, 247, 0.14)',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    color: '#d8b4fe',
                    borderRadius: 12,
                    padding: dense ? '3px 5px' : '4px 6px',
                    cursor: 'pointer',
                  }}
                >
                  <Download size={dense ? 10 : 12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 后台采集点击反馈 */}
      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 84, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1200, maxWidth: '86vw',
            background: 'rgba(20,20,28,.92)', color: '#e8e6f0',
            border: '1px solid rgba(168,85,247,0.5)', borderRadius: 12,
            padding: '8px 14px', fontSize: '0.72rem', lineHeight: 1.5,
            boxShadow: '0 4px 18px rgba(0,0,0,.5)', pointerEvents: 'none',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
