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
        <p className="muted">Aisle Wise sorts your list into the order you’ll pass things in <b>your</b> store.</p>
        <ol className="intro-steps">
          <li><span className="intro-icon" aria-hidden="true">＋</span><div><b>Add what you need.</b> Type it (“2 milk” works), speak it, or tap things you usually buy.</div></li>
          <li><span className="intro-icon" aria-hidden="true">🏬</span><div><b>Add your store</b> (not the demo). A typical layout is a starting guess; answers redraw it as you shop.</div></li>
          <li><span className="intro-icon" aria-hidden="true">✓</span><div><b>Tick things off as you go.</b> When the app isn’t sure where something was, it asks once; otherwise it saves a guess you can Change. Next trip, the list is in walking order.</div></li>
        </ol>
        <p className="muted small intro-tips">Tips: swipe a row right for “got it”, left for “not here”. Tap the sort control for nearest / category / A–Z. Tap the list name under the store for reusable lists. Edit map (under ⚙) is only if you want to draw shelves by hand.</p>
        <div className="intro-actions">
          <button className="btn primary wide" onClick={onAtStore}>I’m at a store now</button>
          <button className="btn wide" onClick={onStart}>Start my list</button>
          <button className="link" onClick={onClose}>Look around the demo store (sample map)</button>
        </div>
      </div>
    </div>
  );
}
