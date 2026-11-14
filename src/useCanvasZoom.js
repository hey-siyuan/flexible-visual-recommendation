import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const MIN_ZOOM = 0.000001;
export const MAX_ZOOM = 1.6;
const clamp = value => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

export function useCanvasZoom(viewport, content) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const committedZoom = useRef(zoom);
  const pendingAnchor = useRef(null);

  useLayoutEffect(() => {
    committedZoom.current = zoom;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (!anchor || !content.current || !viewport.current) return;
    const bounds = content.current.getBoundingClientRect();
    viewport.current.scrollBy(bounds.left + anchor.x * zoom - anchor.clientX, bounds.top + anchor.y * zoom - anchor.clientY);
  }, [content, viewport, zoom]);

  useEffect(() => {
    const canvas = viewport.current;
    let gestureStartZoom = null;

    function zoomAt(event, change) {
      if (!content.current) return;
      event.preventDefault();
      const bounds = content.current.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const clientX = event.clientX ?? canvasBounds.left + canvasBounds.width / 2;
      const clientY = event.clientY ?? canvasBounds.top + canvasBounds.height / 2;
      pendingAnchor.current = {
        clientX,
        clientY,
        x: (clientX - bounds.left) / committedZoom.current,
        y: (clientY - bounds.top) / committedZoom.current,
      };
      setPanX(0);
      setZoom(current => clamp(change(current)));
    }

    function onWheel(event) {
      if (!event.ctrlKey) return;
      if (gestureStartZoom !== null) {
        event.preventDefault();
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      zoomAt(event, current => current * Math.exp(-event.deltaY * unit * 0.005));
    }

    function onGestureStart(event) {
      if (!content.current) return;
      event.preventDefault();
      gestureStartZoom = committedZoom.current;
    }

    function onGestureChange(event) {
      if (gestureStartZoom === null || !Number.isFinite(event.scale)) return;
      const target = gestureStartZoom * event.scale;
      zoomAt(event, () => target);
    }

    function onGestureEnd(event) {
      if (gestureStartZoom === null) return;
      event.preventDefault();
      gestureStartZoom = null;
    }

    const events = { wheel: onWheel, gesturestart: onGestureStart, gesturechange: onGestureChange, gestureend: onGestureEnd };
    for (const [name, listener] of Object.entries(events)) canvas.addEventListener(name, listener, { passive: false });
    return () => {
      for (const [name, listener] of Object.entries(events)) canvas.removeEventListener(name, listener);
    };
  }, [content, viewport]);

  const changeZoom = useCallback((value) => {
    pendingAnchor.current = null;
    setPanX(0);
    setZoom(clamp(value));
  }, []);

  return { zoom, setZoom: changeZoom, panX, setPanX };
}
