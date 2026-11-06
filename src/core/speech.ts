/**
 * Device speech recognition for adding list items.
 * Uses the browser/OS SpeechRecognition API (no cloud SDK of our own).
 */

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/** Whether this browser exposes SpeechRecognition / webkitSpeechRecognition. */
export function speechSupported(win: SpeechWindow = window as SpeechWindow): boolean {
  return typeof win.SpeechRecognition === 'function' || typeof win.webkitSpeechRecognition === 'function';
}

function SpeechCtor(win: SpeechWindow = window as SpeechWindow): (new () => SpeechRecognitionLike) | undefined {
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

/**
 * Spoken text → item names: commas separate items (same as typing);
 * whitespace collapsed; empty segments dropped. No "and" splitting.
 */
export function splitSpokenItems(transcript: string): string[] {
  const out: string[] = [];
  for (const raw of transcript.split(',')) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name) out.push(name);
  }
  return out;
}

export type SpeechRecognizer = {
  /** Begin listening (call from a user gesture). */
  start: () => void;
  /** Stop listening and do not restart. */
  stop: () => void;
};

/**
 * Thin wrapper: continuous + interim results, restarts on end while armed
 * (Chrome often stops after a pause that yields a final result).
 */
export function createSpeechRecognizer(opts: {
  onFinal: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  onError?: (error: string) => void;
  lang?: string;
  win?: SpeechWindow;
}): SpeechRecognizer | undefined {
  const win = opts.win ?? (window as SpeechWindow);
  const Ctor = SpeechCtor(win);
  if (!Ctor) return undefined;

  let armed = false;
  let rec: SpeechRecognitionLike | undefined;

  function attach(r: SpeechRecognitionLike) {
    r.lang = opts.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (text.trim()) opts.onFinal(text);
        } else {
          interim += text;
        }
      }
      if (interim && opts.onInterim) opts.onInterim(interim);
    };
    r.onerror = (ev) => {
      // "aborted" / "no-speech" are normal when stopping or pausing.
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;
      opts.onError?.(ev.error);
    };
    r.onend = () => {
      if (!armed) return;
      // Chrome ends after a final result; restart while the mic is still on.
      try {
        r.start();
      } catch {
        /* already started */
      }
    };
  }

  return {
    start() {
      if (armed) return;
      armed = true;
      rec = new Ctor();
      attach(rec);
      try {
        rec.start();
      } catch (e) {
        armed = false;
        opts.onError?.(e instanceof Error ? e.message : 'start-failed');
      }
    },
    stop() {
      armed = false;
      const r = rec;
      rec = undefined;
      if (!r) return;
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.stop();
      } catch {
        try {
          r.abort();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
