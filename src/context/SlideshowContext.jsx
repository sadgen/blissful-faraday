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
  
  // 当前轮次和下一个应该切换的窗口索引
  const [nextWindowIndex, setNextWindowIndex] = useState(0);
  const cycleCountRef = useRef(0);
  
  // 窗口注册：报告自己的加载状态
  const registerWindow = useCallback((tileId, isLoaded) => {
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
  
  // 协调器逻辑
  useEffect(() => {
    if (!globalIsPlaying) return;
    if (totalTiles <= 0) return;
    
    const switchInterval = globalSpeed / totalTiles;
    
    let currentIndex = 0;
    let lastSwitchTime = Date.now();
    let cycleSkips = new Set(); // 记录本轮跳过的窗口
    
    const checkAndSwitch = () => {
      const now = Date.now();
      const elapsed = now - lastSwitchTime;
      
      if (elapsed >= switchInterval) {
        lastSwitchTime = now;
        
        // 从当前索引开始，找下一个已加载且未跳过的窗口
        let switched = false;
        for (let i = 0; i < totalTiles; i++) {
          const checkIndex = (currentIndex + i) % totalTiles;
          
          // 如果这个窗口已经被跳过（图片加载失败），继续找下一个
          if (cycleSkips.has(checkIndex)) continue;
          
          // 检查是否已加载（默认为true，如果没注册过）
          const isLoaded = windowLoadStatus[checkIndex] !== false;
          
          if (isLoaded) {
            // 切换这个窗口
            currentIndex = (checkIndex + 1) % totalTiles;
            notifySwitch(checkIndex);
            switched = true;
            console.log(`[Coordinator] Switching window ${checkIndex}`);
            break;
          } else {
            // 标记为跳过
            cycleSkips.add(checkIndex);
            console.log(`[Coordinator] Skipping window ${checkIndex} (not loaded)`);
          }
        }
        
        // 如果本轮所有窗口都检查过了，重置
        if (!switched && cycleSkips.size >= totalTiles) {
          cycleCountRef.current++;
          cycleSkips.clear();
          currentIndex = 0;
          console.log(`[Coordinator] Cycle ${cycleCountRef.current} complete, all windows skipped`);
        }
        
        setNextWindowIndex(currentIndex);
      }
    };
    
    const timer = setInterval(checkAndSwitch, 50);
    
    return () => clearInterval(timer);
  }, [globalIsPlaying, globalSpeed, totalTiles, windowLoadStatus, notifySwitch]);

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
