import type { LayoutQuestion } from '../core/learn';
import { LayoutQuestionCard } from './LayoutQuestionCard';

/**
 * Everything's in the cart: how the trip went, what to get elsewhere, any
 * "ask later" items to place, the layout question, and clearing the cart.
 */
export function TripDoneCard({ inCart, minutes, elsewhere, toPlace, onReview, question, onAnswer, onClear }: {
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
      <button className="btn primary wide" onClick={onClear}>Clear cart · start next trip</button>
      {elsewhere.length > 0 && <p className="muted small">Things to get elsewhere stay on your list.</p>}
    </section>
  );
}
