import { useRef, useState, type ReactNode } from 'react';
import { SWIPE_REVEAL, SWIPE_TRIGGER, swipeDirection, swipeRelease } from '../core/items';

/**
 * A list row you can swipe: right to run `onSwipeRight` (shown underneath as
 * `rightLabel`), left to reveal `leftActions` buttons. Up/down movement is
 * left to the page so scrolling still works. A tap that ends a swipe doesn't
 * reach the row's own buttons.
 */
export function SwipeRow({ children, onSwipeRight, rightLabel, leftActions, disabled }: {
  children: ReactNode;
  onSwipeRight?: () => void;
  rightLabel: ReactNode;
  /** Buttons revealed by swiping left. Each should close the row (it re-renders closed after acting). */
  leftActions: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const start = useRef<{ x: number; y: number; id: number; mode: 'undecided' | 'swipe' | 'scroll' } | null>(null);
  const swallowClick = useRef(false);
  const base = revealed ? -SWIPE_REVEAL : 0;
  const close = () => { setRevealed(false); setOffset(0); };
  /** Ignore the click that the same release fires straight after a swipe. */
  const swallowNextClick = () => {
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 0);
  };

  return (
    <div className={`swipe${dragging ? ' dragging' : ''}${revealed ? ' revealed' : ''}`}>
      <div className="swipe-under" aria-hidden={!revealed && offset === 0}>
        <span className={`swipe-right${offset > 0 ? ' show' : ''}${offset >= SWIPE_TRIGGER ? ' armed' : ''}`}>{rightLabel}</span>
        <span className="swipe-left">{leftActions(close)}</span>
      </div>
      <div
        className="swipe-top"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'undecided' };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (s.mode === 'undecided') {
            s.mode = swipeDirection(dx, dy);
            if (s.mode === 'scroll') { start.current = null; return; }
            if (s.mode !== 'swipe') return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }
          // Only add-to-list goes right, and only the buttons' width goes left.
          setOffset(Math.max(-SWIPE_REVEAL - 24, Math.min(onSwipeRight ? 140 : 0, base + dx)));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (!s || s.mode !== 'swipe') {
            if (revealed && s) { swallowNextClick(); close(); }
            return;
          }
          swallowNextClick();
          setDragging(false);
          const what = swipeRelease(offset);
          if (what === 'right' && onSwipeRight) {
            onSwipeRight();
            close();
          } else if (what === 'reveal') {
            setRevealed(true);
            setOffset(-SWIPE_REVEAL);
          } else close();
        }}
        onPointerCancel={() => { start.current = null; setDragging(false); setOffset(base); }}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {children}
      </div>
    </div>
  );
}
