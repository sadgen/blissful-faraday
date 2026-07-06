import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';

export default function LoginOverlay({ onLoginSuccess }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '登录验证失败');
      }

      // 登录成功
      onLoginSuccess();
    } catch (err) {
      console.error(err);
      setError(err.message);
      setShake(true);
      setTimeout(() => setShake(false), 400); // 抖动动画时长 400ms
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-overlay">
      <div className={`glass-panel login-card ${shake ? 'shake' : ''}`}>
        
        {/* Header */}
        <div className="login-header">
          <div className="login-icon-wrap">
            <Lock size={24} style={{ color: '#a855f7' }} />
          </div>
          <h2 className="login-title">BLISSFUL FARADAY</h2>
          <p className="login-subtitle">画廊受密码保护，请输入访问密码</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="login-input-container">
            <Lock size={16} className="login-input-icon" />
            <input
              type={showPassword ? "text" : "password"}
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码..."
              autoFocus
              required
              disabled={isLoading}
            />
            <button
              type="button"
              className="login-input-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div style={{
              color: '#f87171',
              fontSize: '0.75rem',
              textAlign: 'center',
              padding: '6px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '8px'
            }}>
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="login-button"
          >
            {isLoading ? (
              <>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span>正在验证安全证书...</span>
              </>
            ) : (
              <>
                <span>验证并安全登录</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

      </div>
      

    </div>
  );
}
