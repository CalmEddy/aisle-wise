import type { ReactNode } from 'react';
import type { LayoutQuestion } from '../core/learn';
import { LayoutQuestionCard } from './LayoutQuestionCard';

/**
 * Everything's in the cart: how the trip went, what to get elsewhere, any
 * "ask later" items to place, the layout question, and clearing the cart.
 */
export function TripDoneCard({ inCart, minutes, elsewhere, toPlace, onReview, question, onAnswer, onClear, otherLists = [], onShopList, door, extend, walls }: {
  inCart: number;
  /** First to last check-off, if known. */
  minutes?: number;
  /** Things this store doesn't sell (they stay on the list). */
  elsewhere: string[];
  /** Things checked off with "ask later". */
  toPlace: string[];
  onReview: () => void;
  question?: LayoutQuestion;
  onAnswer: (option: number | undefined) => void;
  onClear: () => void;
  /** Other lists that still have things to buy. */
  otherLists?: { id: string; name: string; toBuy: number }[];
  onShopList?: (id: string) => void;
  /** "Where's the door?", asked once per store. */
  door?: ReactNode;
  /** "Is this shelf longer?" */
  extend?: ReactNode;
  /** Offer the departments screen (once a few departments are known). */
  walls?: () => void;
}) {
  return (
    <section className="card trip-done-card" aria-label="Trip done">
      <h3>✓ All done – head to checkout</h3>
      <p className="muted small">
        {inCart} item{inCart === 1 ? '' : 's'} in your cart
        {minutes !== undefined && minutes >= 1 ? ` · shopped in ${minutes} min` : ''}
      </p>
      {elsewhere.length > 0 && <p className="small">Get elsewhere: {elsewhere.join(', ')}</p>}
      {toPlace.length > 0 && (
        <button className="btn wide" onClick={onReview}>
          📍 Say where {toPlace.length === 1 ? toPlace[0] : `${toPlace.length} things`} {toPlace.length === 1 ? 'was' : 'were'} – it helps next time
        </button>
      )}
      {question && <LayoutQuestionCard compact question={question} onAnswer={onAnswer} />}
      {door}
      {extend}
      {walls && <button className="btn wide" onClick={walls}>🧱 Show where the departments are along the walls</button>}
      <button className="btn primary wide" onClick={onClear}>Clear cart · start next trip</button>
      {elsewhere.length > 0 && <p className="muted small">Things to get elsewhere stay on your list.</p>}
      {otherLists.length > 0 && onShopList && (
        <div className="trip-other-lists">
          <p className="muted small">Still to buy on another list:</p>
          {otherLists.map((l) => (
            <button key={l.id} className="btn wide" onClick={() => onShopList(l.id)}>
              Shop “{l.name}” · {l.toBuy} to buy
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
