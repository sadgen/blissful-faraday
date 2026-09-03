import React from 'react';
import { RotateCcw, X, Trash2 } from 'lucide-react';

export default function UndoToast({ toasts = [] }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="undo-toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="undo-toast-item">
          <div className="undo-toast-content">
            <div className="undo-toast-icon">
              <Trash2 size={16} />
            </div>
            <div className="undo-toast-text">
              <div className="undo-toast-title">
                已删除{toast.mediaType || '文件'} <span className="undo-toast-filename">"{toast.name}"</span>
                {toast.isLastMedia && <span className="undo-toast-last-tag">（空图集已清理）</span>}
              </div>
              <div className="undo-toast-subtitle">
                {toast.timeLeft !== undefined ? `${toast.timeLeft} 秒内可撤回` : '10 秒内可撤回'}
              </div>
            </div>
          </div>
          <div className="undo-toast-actions">
            <button
              type="button"
              className="undo-toast-btn-undo"
              onClick={(e) => {
                e.stopPropagation();
                toast.onUndo && toast.onUndo();
              }}
            >
              <RotateCcw size={13} />
              <span>撤回</span>
            </button>
            <button
              type="button"
              className="undo-toast-btn-close"
              title="立即确认并关闭"
              onClick={(e) => {
                e.stopPropagation();
                toast.onDismiss && toast.onDismiss();
              }}
            >
              <X size={14} />
            </button>
          </div>
          {/* Progress countdown bar */}
          <div
            className="undo-toast-progress-bar"
            style={{
              animationDuration: `${toast.duration || 10000}ms`
            }}
          />
        </div>
      ))}
    </div>
  );
}
