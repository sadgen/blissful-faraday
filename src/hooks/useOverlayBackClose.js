import { useEffect, useRef } from 'react';

// 手机返回键 / 屏幕边缘侧滑返回关闭浮层，而不是退出整个页面。
// 原理：浮层打开时压入一条哨兵历史条目（pushState）；用户按返回时浏览器
// 弹出该条目并触发 popstate，此时只关闭浮层、页面留在原地。
//
// 所有浮层共享一个栈：同一拍内「配置抽屉关闭 + 平铺检视打开」的交接只占
// 一条历史条目（后开者继承先闭者的哨兵，延迟一拍再决定是否 history.back()）。
const stack = [];
let attached = false;
let selfNav = false;       // 下一次 popstate 由我们自己的 history.back() 引起，忽略
let pendingRelease = null; // 已通过 UI 关闭、正在等一拍确认是否直接交接的哨兵

function attachPopListener() {
  if (attached) return;
  attached = true;
  window.addEventListener('popstate', () => {
    if (selfNav) {
      selfNav = false;
      return;
    }
    const top = stack[stack.length - 1];
    if (!top) return; // 栈空： genuine 导航，不拦截
    stack.pop();
    top.consumed = true; // 哨兵已被浏览器弹出，关闭时无需再 history.back()
    top.onBack();
  });
}

function releaseSentinel(entry) {
  if (pendingRelease) return;
  pendingRelease = { entry };
  pendingRelease.timer = setTimeout(() => {
    pendingRelease = null;
    selfNav = true;
    window.history.back();
  }, 0);
}

function cancelPendingRelease() {
  if (!pendingRelease) return false;
  clearTimeout(pendingRelease.timer);
  pendingRelease = null;
  return true;
}

function detachEntry(entry) {
  const idx = stack.indexOf(entry);
  if (idx !== -1) stack.splice(idx, 1);
  if (!entry.consumed) releaseSentinel(entry);
}

/**
 * @param {boolean} isOpen 浮层是否打开
 * @param {() => void} onBack 用户按返回键时应执行的动作（通常是关闭浮层）
 */
export default function useOverlayBackClose(isOpen, onBack) {
  const entryRef = useRef(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (isOpen) {
      attachPopListener();
      if (entryRef.current) return; // 已打开，避免重复压栈
      const entry = { consumed: false, onBack: () => onBackRef.current() };
      entryRef.current = entry;
      if (cancelPendingRelease()) {
        // 同一拍有浮层刚关闭：继承它的哨兵，不再额外压栈
        stack.push(entry);
      } else {
        stack.push(entry);
        window.history.pushState({ overlayBackClose: true }, '');
      }
    } else if (entryRef.current) {
      const entry = entryRef.current;
      entryRef.current = null;
      detachEntry(entry);
    }
  }, [isOpen]);

  // 携带哨兵直接卸载（如登出、切换桌面/移动布局）时按 UI 关闭处理
  useEffect(() => {
    return () => {
      if (entryRef.current) {
        const entry = entryRef.current;
        entryRef.current = null;
        detachEntry(entry);
      }
    };
  }, []);
}
