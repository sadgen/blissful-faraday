import { useState, useEffect, useRef } from 'react';
import { 
  Shield, Key, Users, ScrollText, Lock, Unlock, 
  Smartphone, Laptop, RefreshCw, Trash2, LogOut, CheckCircle, AlertCircle 
} from 'lucide-react';

export default function SecurityCenter({
  adminConfig,
  authError,
  onUpdateConfig,
  onRevokeSession,
  onClearLogs,
  onLogout
}) {
  // Password state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');
  const [isSubmittingPwd, setIsSubmittingPwd] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  // Terminal scroll helper
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = 0; // Keep newest logs at top
    }
  }, [adminConfig?.accessLogs]);

  if (!adminConfig) {
    if (authError === 'STATIC_FALLBACK') {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '24px 16px',
          background: 'rgba(139, 92, 246, 0.03)',
          border: '1px solid rgba(139, 92, 246, 0.1)',
          borderRadius: '12px',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          <Shield size={36} style={{ color: '#a855f7', filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.3))' }} />
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>安全中心 (静态托管模式)</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: '4px 0' }}>
            系统检测到当前画廊运行在静态网站托管或 Serverless CDN 上。
          </p>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, textAlign: 'left', background: 'rgba(0,0,0,0.25)', padding: 12, borderRadius: 8, width: '100%' }}>
            🔒 <strong>安全防护状态说明：</strong><br />
            1. <strong>局域网密码保护不可用</strong>：由于没有运行 Node.js 后端服务器，系统无法进行密码校验和在线会话管理。<br />
            2. <strong>访问说明</strong>：本画廊目前处于公开免登状态，任何人都可以直接访问播放。<br />
            3. <strong>启用安全管理</strong>：如需启用密码控制、查看在线设备和安全审计日志，请在本地终端运行 <code>npm run dev</code> 启动包含 API 服务的完整包。
          </div>
        </div>
      );
    }

    if (authError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '20px 16px',
          background: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.15)',
          borderRadius: '12px',
          textAlign: 'center',
          color: 'var(--text-secondary)'
        }}>
          <AlertCircle size={32} style={{ color: '#f87171' }} />
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>加载安全后台失败</div>
          <div style={{ fontSize: '0.72rem', color: 'rgba(248, 113, 113, 0.9)', lineHeight: 1.4, fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: 4, width: '100%', wordBreak: 'break-all' }}>
            {authError}
          </div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: 1.4, textAlign: 'left', background: 'rgba(0,0,0,0.3)', padding: 10, borderRadius: 8, width: '100%' }}>
            💡 <strong>可能的原因与反代解决方案：</strong><br />
            1. <strong>Nginx 路由代理规则限制</strong>：由于系统增加了密码管理，所有路由需经过后端 API。请检查 Nginx 配置文件，确保 <code>location /</code> 代理规则能够将所有子请求完整的转发到 Vite 端口。例如：<br />
            <pre style={{ background: '#000', padding: 6, borderRadius: 4, marginTop: 4, fontSize: '0.58rem', overflowX: 'auto', color: '#c084fc' }}>
{`location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Cookie $http_cookie; # 确保 Cookie 传递
}`}
            </pre>
            <span style={{ color: 'var(--text-muted)' }}>* 如果 Nginx 漏掉了 <code>proxy_set_header Cookie</code> 可能会导致鉴权 Session 丢失。</span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="glass-button active"
            style={{ fontSize: '0.7rem', padding: '6px 12px', width: '100%', justifyContent: 'center' }}
          >
            <RefreshCw size={12} />
            刷新页面重试
          </button>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
        <RefreshCw size={16} style={{ color: '#a855f7', animation: 'spin 1.5s linear infinite', marginRight: 8 }} />
        正在加载安全后台 data...
      </div>
    );
  }

  // Parse User-Agent
  const getDeviceInfo = (ua) => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    let name = '未知浏览器';
    if (ua.includes('Chrome')) name = 'Chrome 浏览器';
    else if (ua.includes('Firefox')) name = 'Firefox 浏览器';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) name = 'Safari 浏览器';
    else if (ua.includes('Edge')) name = 'Edge 浏览器';
    else if (ua.includes('Mobile')) name = '移动端浏览器';
    
    return { isMobile, name };
  };

  // Toggle switch
  const handleToggleProtection = async () => {
    if (isToggling) return;
    
    // Check if password exists
    if (!adminConfig.hasPassword && !adminConfig.enabled) {
      setPwdError('⚠️ 必须先在下方设置密码才能启用安全验证！');
      return;
    }

    try {
      setIsToggling(true);
      setPwdError('');
      setPwdSuccess('');
      const success = await onUpdateConfig({ enabled: !adminConfig.enabled });
      if (success) {
        setPwdSuccess(adminConfig.enabled ? '🔓 密码防护已成功禁用' : '🔒 密码防护已成功启用！本画廊现已安全封锁。');
      }
    } catch (err) {
      setPwdError(err.message || '操作失败');
    } finally {
      setIsToggling(false);
    }
  };

  // Save new password
  const handleSavePassword = async (e) => {
    e.preventDefault();
    if (isSubmittingPwd) return;

    setPwdError('');
    setPwdSuccess('');

    if (adminConfig.hasPassword && !oldPassword) {
      setPwdError('请输入旧密码以验证身份');
      return;
    }

    if (newPassword.length < 4) {
      setPwdError('新密码长度不能少于 4 位');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }

    try {
      setIsSubmittingPwd(true);
      const success = await onUpdateConfig({
        oldPassword,
        newPassword,
        // If enabling for the first time, auto-enable
        enabled: adminConfig.hasPassword ? adminConfig.enabled : true
      });

      if (success) {
        setPwdSuccess(adminConfig.hasPassword ? '密码修改成功，其他登录会话已全部强制下线。' : '访问密码初始化成功！防护已自动开启。');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setPwdError(err.message || '修改密码失败');
    } finally {
      setIsSubmittingPwd(false);
    }
  };

  // Handle Session expiry change
  const handleExpiryChange = async (e) => {
    const val = parseInt(e.target.value, 10);
    try {
      await onUpdateConfig({ sessionMaxAge: val });
    } catch (err) {
      console.warn('Failed to update session age:', err);
    }
  };

  // Display expiry labels
  const getExpiryLabel = (ms) => {
    if (ms === 3600000) return '1 小时 (高安全)';
    if (ms === 43200000) return '12 小时';
    if (ms === 86400000) return '24 小时 (推荐)';
    if (ms === 604800000) return '7 天 (常用设备)';
    if (ms === 2592000000) return '30 天 (长效登录)';
    return `${Math.round(ms / 3600000)} 小时`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      
      {/* 1. Status Check & iOS Switch */}
      <div className="ios-switch-container">
        <div className="ios-switch-label">
          <span className="ios-switch-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {adminConfig.enabled ? <Lock size={14} style={{ color: '#a855f7' }} /> : <Unlock size={14} style={{ color: '#9ca3af' }} />}
            局域网密码访问保护
          </span>
          <span className="ios-switch-desc">
            {adminConfig.enabled 
              ? '密码保护中。局域网连入时需输入密码。' 
              : '防护未开启。局域网内的设备可以直接访问您的画廊。'}
          </span>
        </div>
        <label className="ios-switch">
          <input
            type="checkbox"
            className="ios-switch-input"
            checked={adminConfig.enabled}
            disabled={isToggling}
            onChange={handleToggleProtection}
          />
          <span className="ios-switch-slider"></span>
        </label>
      </div>

      {/* Messages */}
      {pwdError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          color: '#f87171', fontSize: '0.75rem', padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>{pwdError}</span>
        </div>
      )}
      
      {pwdSuccess && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          color: '#34d399', fontSize: '0.75rem', padding: '8px 12px',
          background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', borderRadius: 8
        }}>
          <CheckCircle size={14} style={{ flexShrink: 0 }} />
          <span>{pwdSuccess}</span>
        </div>
      )}

      {/* 2. Password Form */}
      <div className="security-card">
        <h4 className="security-card-title">
          <Key size={14} />
          {adminConfig.hasPassword ? '修改安全访问密码' : '初始化安全密码'}
        </h4>
        <form onSubmit={handleSavePassword} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {adminConfig.hasPassword && (
            <div>
              <input
                type="password"
                className="glass-input"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="原访问密码"
                style={{ width: '100%', fontSize: '0.75rem', padding: '6px 10px' }}
                required
              />
            </div>
          )}
          <div>
            <input
              type="password"
              className="glass-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="新访问密码 (不少于4位)"
              style={{ width: '100%', fontSize: '0.75rem', padding: '6px 10px' }}
              required
            />
          </div>
          <div>
            <input
              type="password"
              className="glass-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="确认新密码"
              style={{ width: '100%', fontSize: '0.75rem', padding: '6px 10px' }}
              required
            />
          </div>
          <button
            type="submit"
            disabled={isSubmittingPwd}
            className="glass-button active"
            style={{ fontSize: '0.75rem', padding: '6px 12px', justifyContent: 'center', cursor: 'pointer' }}
          >
            {isSubmittingPwd ? '正在更新加密...' : (adminConfig.hasPassword ? '确认修改密码' : '设置密码并启用防护')}
          </button>
        </form>
      </div>

      {/* 3. Session Expiry Slider */}
      <div className="security-card">
        <h4 className="security-card-title">
          <Shield size={14} />
          登录会话有效期配置
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>保持登录时长:</span>
            <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>
              {getExpiryLabel(adminConfig.sessionMaxAge)}
            </span>
          </div>
          <input
            type="range"
            min="3600000"
            max="2592000000"
            step="3600000" // 1 hour step
            value={adminConfig.sessionMaxAge}
            onChange={handleExpiryChange}
            style={{
              width: '100%',
              accentColor: 'var(--accent-purple)',
              cursor: 'pointer',
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '4px',
              height: '4px'
            }}
          />
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
            * 超过此时间无任何操作，客户端需要重新进行密码登录验证。修改立即对新登录生效。
          </span>
        </div>
      </div>

      {/* 4. Active devices list */}
      <div className="security-card">
        <h4 className="security-card-title">
          <Users size={14} />
          当前在线设备管理 ({adminConfig.sessions?.length || 0})
        </h4>
        <div className="devices-list">
          {adminConfig.sessions && adminConfig.sessions.length > 0 ? (
            adminConfig.sessions.map((sess, idx) => {
              const info = getDeviceInfo(sess.userAgent);
              return (
                <div key={idx} className="device-item">
                  <div style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                    {info.isMobile ? <Smartphone size={16} style={{ color: '#a855f7' }} /> : <Laptop size={16} style={{ color: '#60a5fa' }} />}
                  </div>
                  <div className="device-info">
                    <div className="device-meta">
                      <span>{sess.ip.replace('::ffff:', '')}</span>
                      {sess.isCurrent && <span className="device-badge">当前设备</span>}
                    </div>
                    <div className="device-ua" title={sess.userAgent}>
                      {info.name} • {new Date(sess.loginTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  {!sess.isCurrent && (
                    <button
                      className="device-kick-btn"
                      onClick={() => onRevokeSession(sess.id)}
                    >
                      下线
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ textAlign: 'center', padding: '12px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              暂无其他在线设备
            </div>
          )}
        </div>
      </div>

      {/* 5. Terminal Audit Logs */}
      <div className="security-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.04)', paddingBottom: 8 }}>
          <h4 style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
            <ScrollText size={14} />
            安全审计访问日志
          </h4>
          {adminConfig.accessLogs?.length > 0 && (
            <button
              onClick={onClearLogs}
              style={{
                background: 'none', border: 'none', color: '#f87171', fontSize: '0.65rem',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3
              }}
              title="清空日志"
            >
              <Trash2 size={12} />
              清空
            </button>
          )}
        </div>
        
        <div ref={terminalRef} className="terminal-box">
          {adminConfig.accessLogs && adminConfig.accessLogs.length > 0 ? (
            adminConfig.accessLogs.map((log, idx) => (
              <div key={idx} className="terminal-line">
                <span className="terminal-line-time">
                  [{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                </span>
                <span className="terminal-line-ip">
                  [{log.ip.replace('::ffff:', '')}]
                </span>
                <span>{log.event}</span>
                {log.details && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({log.details})</span>}
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textAlign: 'center', marginTop: '40px' }}>
              $ cat /var/log/audit.log
              <br />
              [系统提示] 暂无审计安全日志记录
            </div>
          )}
        </div>
      </div>

      {/* 6. Logout Current Session (Only if protected) */}
      {adminConfig.enabled && (
        <button
          onClick={onLogout}
          className="glass-button"
          style={{ width: '100%', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontSize: '0.75rem', padding: '8px' }}
        >
          <LogOut size={14} />
          安全登出画廊 (退出当前设备)
        </button>
      )}

    </div>
  );
}
