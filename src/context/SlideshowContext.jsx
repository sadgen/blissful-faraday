import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const SlideshowContext = createContext(null);

export function SlideshowProvider({ 
  children, 
  totalTiles, 
  globalSpeed, 
  globalIsPlaying,
  onWindowSwitch // 回调：当需要切换某个窗口时调用
}) {
  // 跟踪每个窗口的加载状态
  const [windowLoadStatus, setWindowLoadStatus] = useState({});
  
  // 使用 ref 存储可变协调器状态，避免闭包过期
  const windowLoadStatusRef = useRef({});
  const nextWindowIndexRef = useRef(0);
  const timeoutRef = useRef(null);
  const activeRef = useRef(false);
  const LOAD_TIMEOUT = 30000; // 单窗口加载超时 30 秒，防止链式调度被卡住
  
  // 窗口注册：报告自己的加载状态（同时更新 ref，确保协调器始终读到最新值）
  const registerWindow = useCallback((tileId, isLoaded) => {
    windowLoadStatusRef.current = { 
      ...windowLoadStatusRef.current, 
      [tileId]: isLoaded 
    };
    setWindowLoadStatus(prev => ({
      ...prev,
      [tileId]: isLoaded
    }));
  }, []);
  
  // 通知某个窗口需要切换
  const notifySwitch = useCallback((tileId) => {
    if (onWindowSwitch) {
      onWindowSwitch(tileId);
    }
  }, [onWindowSwitch]);
  
  // 顺序链式协调器：
  // 窗口 N 触发 → 等待 N 加载完成 → 等待间隔(globalSpeed/totalTiles) → 触发窗口 N+1
  // 这样每个窗口的切换都依赖前一个窗口是否完成加载，
  // 避免因网络延迟导致所有窗口同时堆积触发。
  useEffect(() => {
    if (!globalIsPlaying || totalTiles <= 0) {
      // 暂停：取消所有待执行的调度
      activeRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }
    
    activeRef.current = true;
    const switchInterval = globalSpeed / totalTiles;
    
    // 找到下一个已加载的窗口并触发，然后等待其加载完成再继续
    const triggerNextWindow = () => {
      if (!activeRef.current) return;
      
      let currentIndex = nextWindowIndexRef.current;
      let triggeredWindow = -1;
      let found = false;
      
      // 从当前索引开始，找下一个已加载的窗口
      for (let i = 0; i < totalTiles; i++) {
        const idx = (currentIndex + i) % totalTiles;
        // undefined（从未注册）也视为已加载
        const isLoaded = windowLoadStatusRef.current[idx] !== false;
        
        if (isLoaded) {
          nextWindowIndexRef.current = (idx + 1) % totalTiles;
          notifySwitch(idx);
          triggeredWindow = idx;
          found = true;
          console.log(`[Coordinator] Sequential switch: window ${idx} triggered`);
          break;
        }
      }
      
      if (!found) {
        // 所有窗口都未加载，短暂重试
        console.log(`[Coordinator] No loaded window found, retrying in 100ms...`);
        timeoutRef.current = setTimeout(triggerNextWindow, 100);
        return;
      }
      
      // 等待刚触发的窗口完成图片加载
      const loadStartTime = Date.now();
      const waitForLoadComplete = () => {
        if (!activeRef.current) return;
        
        const isLoaded = windowLoadStatusRef.current[triggeredWindow] !== false;
        
        if (!isLoaded) {
          // 加载超时保护：防止某个窗口加载失败导致整个链路卡死
          if (Date.now() - loadStartTime > LOAD_TIMEOUT) {
            console.log(`[Coordinator] Window ${triggeredWindow} load timeout (${LOAD_TIMEOUT}ms), skipping`);
            // 超时后跳过，等待间隔后触发下一个
            timeoutRef.current = setTimeout(triggerNextWindow, switchInterval);
            return;
          }
          // 仍在加载中，轮询等待
          timeoutRef.current = setTimeout(waitForLoadComplete, 100);
          return;
        }
        
        // 窗口加载完成！等待间隔后触发下一个窗口
        console.log(`[Coordinator] Window ${triggeredWindow} loaded, waiting ${switchInterval}ms for next`);
        timeoutRef.current = setTimeout(triggerNextWindow, switchInterval);
      };
      
      // 延迟首次检查：给 React 一个事件循环的时间，
      // 让 tile 的 fetch useEffect 有机会调用 registerWindow(tileId, false)
      timeoutRef.current = setTimeout(waitForLoadComplete, 50);
    };
    
    // 启动链式调度（首次立即触发）
    timeoutRef.current = setTimeout(triggerNextWindow, 0);
    
    return () => {
      activeRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [globalIsPlaying, globalSpeed, totalTiles, notifySwitch]);

  return (
    <SlideshowContext.Provider value={{
      registerWindow,
      windowLoadStatus
    }}>
      {children}
    </SlideshowContext.Provider>
  );
}

export function useSlideshow() {
  return useContext(SlideshowContext);
}
