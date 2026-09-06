import { useState, useRef, useCallback, useEffect } from 'react';

// 按条目类型拼删除 URL：postId → 整帖删除，否则单文件删除
function deleteUrlFor(item) {
  const qs = item.postId
    ? `post=${encodeURIComponent(item.postId)}`
    : `name=${encodeURIComponent(item.name)}`;
  return `/api/collection/delete?collection=${encodeURIComponent(item.collection)}&${qs}`;
}

export default function useDeleteUndoManager(fetchCollections) {
  const [toasts, setToasts] = useState([]);
  const pendingMapRef = useRef(new Map());

  // Cleanup on unmount / page unload: commit all pending deletes immediately
  useEffect(() => {
    const handleBeforeUnload = () => {
      pendingMapRef.current.forEach(({ item }) => {
        if (item.collection && (item.postId || item.name)) {
          const url = deleteUrlFor(item);
          if (navigator.sendBeacon) {
            navigator.sendBeacon(url);
          } else {
            fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
          }
        }
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      pendingMapRef.current.forEach(({ timerId, intervalId, item }) => {
        clearTimeout(timerId);
        clearInterval(intervalId);
        if (item && item.onCommit) item.onCommit();
      });
    };
  }, []);

  const commitDelete = useCallback(async (id) => {
    const entry = pendingMapRef.current.get(id);
    if (!entry) return;
    clearTimeout(entry.timerId);
    clearInterval(entry.intervalId);
    pendingMapRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));

    const { item } = entry;
    try {
      const res = await fetch(deleteUrlFor(item), { method: 'POST' });
      const data = await res.json();
      if (data.folderDeleted && fetchCollections) {
        await fetchCollections();
      }
    } catch (err) {
      console.error('Failed to commit delete:', err);
    }
  }, [fetchCollections]);

  const undoDelete = useCallback((id) => {
    const entry = pendingMapRef.current.get(id);
    if (!entry) return;
    clearTimeout(entry.timerId);
    clearInterval(entry.intervalId);
    pendingMapRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));

    if (entry.item && entry.item.onUndo) {
      entry.item.onUndo();
    }
  }, []);

  const queueDelete = useCallback(({ collection, name, names, postId, isVideo, isLastMedia, onUndo }) => {
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const duration = 10000;
    let timeLeft = 10;

    const intervalId = setInterval(() => {
      timeLeft -= 1;
      setToasts(prev => prev.map(t => t.id === id ? { ...t, timeLeft: Math.max(0, timeLeft) } : t));
    }, 1000);

    const timerId = setTimeout(() => {
      commitDelete(id);
    }, duration);

    // postId 条目（整帖删除）没有单一文件名，toast 显示批量摘要
    const displayName = postId
      ? `帖子（${(names || []).length} 个文件）`
      : name;
    const item = {
      id,
      collection,
      name: displayName,
      names,
      postId,
      mediaType: postId ? '帖子' : (isVideo ? '视频' : '图片'),
      isLastMedia,
      onUndo,
      onCommit: () => {
        fetch(deleteUrlFor({ collection, name, postId }), { method: 'POST' })
          .then(r => r.json())
          .then(d => { if (d.folderDeleted && fetchCollections) fetchCollections(); })
          .catch(e => console.error(e));
      }
    };

    pendingMapRef.current.set(id, { timerId, intervalId, item });

    const newToast = {
      id,
      name: displayName,
      mediaType: item.mediaType,
      isLastMedia,
      timeLeft: 10,
      duration,
      onUndo: () => undoDelete(id),
      onDismiss: () => commitDelete(id)
    };

    setToasts(prev => [...prev.slice(-2), newToast]);
  }, [commitDelete, undoDelete, fetchCollections]);

  return { toasts, queueDelete };
}
