import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface VirtualWindow {
  start: number;
  end: number;
  totalHeight: number;
  offsetForIndex: (index: number) => number;
}

export interface VirtualRowsOptions {
  count: number;
  rowHeight: number;
  /** Index of the one expanded row, which is taller than the rest. */
  expandedIndex: number | null;
  expandedHeight: number;
  overscan?: number;
}

/**
 * Minimal windowing for a long packet list. Rows are a fixed height, with the
 * single expanded row allowed its own measured height, which keeps the maths
 * to a piecewise offset instead of a full measurement cache.
 */
export function useVirtualRows(
  scrollRef: RefObject<HTMLElement | null>,
  { count, rowHeight, expandedIndex, expandedHeight, overscan = 8 }: VirtualRowsOptions,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const frame = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const measure = () => setViewportHeight(element.clientHeight);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setScrollTop(element.scrollTop);
      });
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [scrollRef]);

  const extra = expandedIndex === null ? 0 : expandedHeight;

  const offsetForIndex = useCallback(
    (index: number) => {
      const base = index * rowHeight;
      return expandedIndex !== null && index > expandedIndex ? base + extra : base;
    },
    [rowHeight, expandedIndex, extra],
  );

  const indexAtOffset = (offset: number): number => {
    if (expandedIndex === null) return Math.floor(offset / rowHeight);
    if (offset <= expandedIndex * rowHeight) return Math.floor(offset / rowHeight);
    if (offset < (expandedIndex + 1) * rowHeight + extra) return expandedIndex;
    return Math.floor((offset - extra) / rowHeight);
  };

  const viewport = viewportHeight || 600;
  const start = Math.max(0, indexAtOffset(scrollTop) - overscan);
  const end = Math.min(count, indexAtOffset(scrollTop + viewport) + overscan + 1);

  return {
    start,
    end: Math.max(start, end),
    totalHeight: count * rowHeight + extra,
    offsetForIndex,
  };
}
