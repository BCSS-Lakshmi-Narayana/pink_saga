import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

const MOBILE_BREAKPOINT = 1024;
const MIN_WIDTH = 780;
const MIN_HEIGHT = 520;
const WINDOW_MARGIN = 12;

const getViewport = () => ({
  width: typeof window !== 'undefined' ? window.innerWidth : 1440,
  height: typeof window !== 'undefined' ? window.innerHeight : 900
});

const clampSize = (nextSize, viewport) => {
  const minWidth = Math.max(420, Math.min(MIN_WIDTH, viewport.width - WINDOW_MARGIN * 2));
  const minHeight = Math.max(320, Math.min(MIN_HEIGHT, viewport.height - WINDOW_MARGIN * 2));
  const maxWidth = Math.max(minWidth, viewport.width - WINDOW_MARGIN * 2);
  const maxHeight = Math.max(minHeight, viewport.height - WINDOW_MARGIN * 2);

  return {
    width: Math.max(minWidth, Math.min(nextSize.width, maxWidth)),
    height: Math.max(minHeight, Math.min(nextSize.height, maxHeight))
  };
};

const clampPosition = (nextPosition, size, viewport) => {
  const maxX = Math.max(WINDOW_MARGIN, viewport.width - size.width - WINDOW_MARGIN);
  const maxY = Math.max(WINDOW_MARGIN, viewport.height - size.height - WINDOW_MARGIN);

  return {
    x: Math.max(WINDOW_MARGIN, Math.min(nextPosition.x, maxX)),
    y: Math.max(WINDOW_MARGIN, Math.min(nextPosition.y, maxY))
  };
};

const getDefaultRect = () => {
  const viewport = getViewport();
  const desired = {
    width: Math.min(1280, viewport.width - 64),
    height: Math.min(820, viewport.height - 80)
  };
  const size = clampSize(desired, viewport);
  const centered = {
    x: Math.round((viewport.width - size.width) / 2),
    y: Math.max(24, Math.round((viewport.height - size.height) / 2) - 20)
  };

  return {
    size,
    position: clampPosition(centered, size, viewport)
  };
};

const UnifiedReportWindow = ({ open, title, subtitle = '', onClose, children }) => {
  const [position, setPosition] = useState({ x: 40, y: 40 });
  const [size, setSize] = useState({ width: 1200, height: 760 });
  const [isMobile, setIsMobile] = useState(() => getViewport().width < MOBILE_BREAKPOINT);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({
    mouseX: 0,
    mouseY: 0,
    width: 0,
    height: 0
  });

  const wasOpenRef = useRef(false);
  const restoreRectRef = useRef(null);
  const effectiveFullscreen = isMobile || fullscreen;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const rect = getDefaultRect();
      setSize(rect.size);
      setPosition(rect.position);
      setFullscreen(false);
      setDragging(false);
      setResizing(false);
    }

    if (!open) {
      setDragging(false);
      setResizing(false);
    }

    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onResize = () => {
      const viewport = getViewport();
      setIsMobile(viewport.width < MOBILE_BREAKPOINT);

      setSize((prevSize) => {
        const clampedSize = clampSize(prevSize, viewport);
        setPosition((prevPosition) => clampPosition(prevPosition, clampedSize, viewport));
        return clampedSize;
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (effectiveFullscreen) {
      setDragging(false);
      setResizing(false);
    }
  }, [effectiveFullscreen]);

  useEffect(() => {
    if (!dragging || effectiveFullscreen) return undefined;

    const onMouseMove = (event) => {
      const viewport = getViewport();
      const nextPosition = {
        x: event.clientX - dragOffset.x,
        y: event.clientY - dragOffset.y
      };
      setPosition(clampPosition(nextPosition, size, viewport));
    };

    const onMouseUp = () => setDragging(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, dragOffset, size, effectiveFullscreen]);

  useEffect(() => {
    if (!resizing || effectiveFullscreen) return undefined;

    const onMouseMove = (event) => {
      const viewport = getViewport();
      const nextSize = {
        width: resizeStart.width + (event.clientX - resizeStart.mouseX),
        height: resizeStart.height + (event.clientY - resizeStart.mouseY)
      };
      const clampedSize = clampSize(nextSize, viewport);
      setSize(clampedSize);
      setPosition((prevPosition) => clampPosition(prevPosition, clampedSize, viewport));
    };

    const onMouseUp = () => setResizing(false);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizing, resizeStart, effectiveFullscreen]);

  const handleDragStart = (event) => {
    if (effectiveFullscreen || event.button !== 0) return;
    if (event.target.closest('[data-window-action="true"]')) return;

    setDragging(true);
    setDragOffset({
      x: event.clientX - position.x,
      y: event.clientY - position.y
    });
  };

  const handleResizeStart = (event) => {
    if (effectiveFullscreen || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    setResizing(true);
    setResizeStart({
      mouseX: event.clientX,
      mouseY: event.clientY,
      width: size.width,
      height: size.height
    });
  };

  const toggleFullscreen = () => {
    if (isMobile) return;

    if (fullscreen) {
      const restoreRect = restoreRectRef.current || getDefaultRect();
      setSize(restoreRect.size);
      setPosition(restoreRect.position);
      setFullscreen(false);
      return;
    }

    restoreRectRef.current = { size, position };
    setFullscreen(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120]">
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={cn(
          'absolute z-[121] flex flex-col overflow-hidden border border-slate-200 bg-white shadow-[0_18px_70px_rgba(15,23,42,0.32)] dark:border-slate-800 dark:bg-slate-950',
          effectiveFullscreen ? 'inset-2 rounded-xl sm:inset-4' : 'rounded-xl'
        )}
        style={
          effectiveFullscreen
            ? undefined
            : {
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height
              }
        }
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-3 dark:border-slate-700',
            !effectiveFullscreen && 'cursor-move'
          )}
          onMouseDown={handleDragStart}
        >
          <div className="flex min-w-0 items-center gap-2">
            {!effectiveFullscreen && <GripHorizontal className="h-4 w-4 text-slate-300" />}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">{title}</h2>
              {subtitle ? (
                <p className="truncate text-xs text-slate-300">{subtitle}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {!isMobile && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                data-window-action="true"
                className="h-8 w-8 text-slate-100 hover:bg-white/10 hover:text-white"
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-window-action="true"
              className="h-8 w-8 text-slate-100 hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900/40">{children}</div>

        {!effectiveFullscreen && (
          <div
            className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize rounded-tl bg-gradient-to-tl from-slate-300 to-transparent hover:from-slate-400 dark:from-slate-600 dark:hover:from-slate-500"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />
        )}
      </div>
    </div>
  );
};

export default UnifiedReportWindow;
