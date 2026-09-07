import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X } from 'lucide-react';

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

/**
 * Instagram 账号清单（桌面 HUD 弹层与手机控制抽屉共用）。
 * 从 /api/instagram/accounts 拉取账号（帖子数/最近更新），支持按
 * 更新时间或帖子数排序；点击账号 → onSelectAccount(username)，
 * 仅播放该账号的帖子。普通文件夹不涉及此组件。
 */
export default function AccountList({
  accountFilter = '',
  onSelectAccount,
  dense = false,
  maxHeight = 300,
}) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState('recent'); // 'recent' | 'posts'

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

      {/* 当前过滤提示 */}
      {accountFilter && (
        <button
          type="button"
          onClick={() => onSelectAccount && onSelectAccount(accountFilter)}
          title="取消过滤，显示全部账号"
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
          只看 @{accountFilter}（点击取消）
        </button>
      )}

      {/* 账号列表 */}
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
            const active = accountFilter === acc.username;
            const updated = Math.max(acc.latestPostTs ? acc.latestPostTs * 1000 : 0, acc.mtime || 0);
            return (
              <button
                key={acc.username}
                type="button"
                onClick={() => onSelectAccount && onSelectAccount(acc.username)}
                title={active ? `取消只看 @${acc.username}` : `只播放 @${acc.username} 的帖子`}
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
    </div>
  );
}
