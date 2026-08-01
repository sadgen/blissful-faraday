import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] ${this.props.fallbackLabel || '组件'} 崩溃:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) {
        return this.props.fallbackRender({
          error: this.state.error,
          retry: this.handleRetry,
        });
      }

      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          minHeight: 120,
          padding: 16,
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.15)',
          borderRadius: 8,
          color: '#94a3b8',
          textAlign: 'center',
          gap: 10,
          boxSizing: 'border-box',
        }}>
          <AlertTriangle size={24} style={{ color: '#f59e0b', filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.3))' }} />
          <div style={{ fontSize: '0.75rem', lineHeight: 1.4 }}>
            {this.props.fallbackLabel || '该区域出现问题'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', fontSize: '0.7rem',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6, color: '#fff', cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} /> 重试
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre style={{ fontSize: '0.6rem', color: '#ef4444', marginTop: 4, maxWidth: '100%', overflow: 'auto', textAlign: 'left', background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 4 }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
