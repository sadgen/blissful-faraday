import { useState, useRef, useEffect, useCallback } from 'react';

export default function useTileDrag({
  tileId,
  onDragPositionChange,
  globalRefreshTrigger,
  initialCollectionName,
  totalTiles,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 0 });

  // Reset drag position when layout changes
  useEffect(() => {
    setDragPosition({ x: 0, y: 0 });
    positionRef.current = { x: 0, y: 0 };
    if (onDragPositionChange) {
      onDragPositionChange(tileId, { x: 0, y: 0 });
    }
  }, [globalRefreshTrigger, initialCollectionName, totalTiles, tileId, onDragPositionChange]);

  const handleMouseDown = useCallback((e) => {
    // Left mouse button
    if (e.button === 0) {
      if (e.target.closest('button, select, option, input, svg, path')) return;
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      positionRef.current = { x: dragPosition.x, y: dragPosition.y };
      setIsDragging(true);
    }
  }, [dragPosition]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;
    const newX = positionRef.current.x + deltaX;
    const newY = positionRef.current.y + deltaY;
    setDragPosition({ x: newX, y: newY });
  }, [isDragging]);

  const handleMouseUp = useCallback((e) => {
    if (e.button === 0 && isDragging) {
      setIsDragging(false);
      positionRef.current = { x: dragPosition.x, y: dragPosition.y };
      dragStartRef.current = { x: 0, y: 0 };
      if (onDragPositionChange) onDragPositionChange(tileId, dragPosition);
    }
  }, [isDragging, dragPosition, onDragPositionChange, tileId]);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Computed drag transform style
  const dragTransform = (dragPosition.x !== 0 || dragPosition.y !== 0)
    ? {
        transform: `translate(${dragPosition.x}px, ${dragPosition.y}px)`,
        zIndex: 1000,
        cursor: isDragging ? 'grabbing' : 'grab',
      }
    : {};
  dragTransform.opacity = isDragging ? 0.5 : 1;
  dragTransform.mixBlendMode = 'lighten';

  return {
    isDragging,
    dragPosition,
    dragTransform,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
  };
}
