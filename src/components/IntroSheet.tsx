/**
 * The first-run welcome (and what ⓘ shows later): how the app works in three
 * steps, with a way straight into a store or the demo.
 */
export function IntroSheet({ onStart, onAtStore, onClose }: {
  /** Start a list (closes the intro). */
  onStart: () => void;
  /** "I'm at a store": pick or add the store. */
  onAtStore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet intro-sheet" role="dialog" aria-label="How Aisle Wise works" onClick={(e) => e.stopPropagation()}>
        <h2>Shop in one walk</h2>
        <p className="muted">Aisle Wise sorts your list into the order you’ll pass things in the store.</p>
        <ol className="intro-steps">
          <li><span className="intro-icon" aria-hidden="true">＋</span><div><b>Add what you need.</b> Type it (“2 milk” works), or tap things you usually buy.</div></li>
          <li><span className="intro-icon" aria-hidden="true">🏬</span><div><b>Pick your store.</b> Add a new one where you’re standing and it’s picked by itself next time.</div></li>
          <li><span className="intro-icon" aria-hidden="true">✓</span><div><b>Tick things off as you go.</b> Say where something was in one tap (aisle, wall, fridge…) and the store’s map builds itself. Next time your list comes in walking order.</div></li>
        </ol>
        <p className="muted small intro-tips">Tips: swipe a row right for “got it”, left for “not here” or remove. ⋯ on a row sets the amount, a note, or where it is. 🛠 Edit map lets you draw the store yourself.</p>
        <div className="intro-actions">
          <button className="btn primary wide" onClick={onStart}>Start my list</button>
          <button className="btn wide" onClick={onAtStore}>I’m at a store now</button>
          <button className="link" onClick={onClose}>Look around the demo store</button>
        </div>
      </div>
    </div>
  );
}
