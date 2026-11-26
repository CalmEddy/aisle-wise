import type { LayoutQuestion } from '../core/learn';
import { Icon } from './Icon';

/** One quick question about how the store is laid out, when the trips can't tell. */
export function LayoutQuestionCard({ question, onAnswer, compact }: {
  question: LayoutQuestion;
  /** The chosen option's index, or undefined for "Not sure". */
  onAnswer: (option: number | undefined) => void;
  compact?: boolean;
}) {
  return (
    <div className={`layout-question${compact ? ' compact' : ''}`} role="group" aria-label="A question about this store">
      <p><Icon name="compass" /> {question.text}</p>
      <div className="layout-question-choices">
        {question.options.map((o, i) => (
          <button key={o.label} className="btn" onClick={() => onAnswer(i)}>{o.label}</button>
        ))}
        <button className="link" onClick={() => onAnswer(undefined)}>Not sure</button>
      </div>
    </div>
  );
}
