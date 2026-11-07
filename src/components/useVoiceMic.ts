import { useEffect, useRef, useState } from 'react';
import { createSpeechRecognizer, speechSupported, type SpeechRecognizer } from '../core/speech';

/**
 * Mic toggle for adding by voice. Always safe to show the button; when the
 * browser has no SpeechRecognition API, toggle() sets a short error instead.
 */
export function useVoiceMic(opts: {
  onFinal: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  /** Stop after a final result so the user can review the filled text. */
  stopOnFinal?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const supported = speechSupported();
  const recRef = useRef<SpeechRecognizer>();
  const onFinalRef = useRef(opts.onFinal);
  const onInterimRef = useRef(opts.onInterim);
  const stopOnFinalRef = useRef(opts.stopOnFinal);
  onFinalRef.current = opts.onFinal;
  onInterimRef.current = opts.onInterim;
  stopOnFinalRef.current = opts.stopOnFinal;

  function stop() {
    recRef.current?.stop();
    recRef.current = undefined;
    setListening(false);
  }

  function toggle() {
    if (listening) {
      stop();
      return;
    }
    setError(undefined);
    if (!supported) {
      setError('Voice isn’t available in this browser. Use the keyboard mic in the text box, or try Chrome / Safari.');
      return;
    }
    const rec = createSpeechRecognizer({
      onFinal: (t) => {
        onFinalRef.current(t);
        if (stopOnFinalRef.current) stop();
      },
      onInterim: (t) => onInterimRef.current?.(t),
      onError: (err) => {
        setError(err === 'not-allowed' ? 'Microphone permission denied.' : 'Couldn’t hear that — try again.');
        stop();
      },
    });
    if (!rec) {
      setError('Voice isn’t available in this browser. Use the keyboard mic in the text box, or try Chrome / Safari.');
      return;
    }
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  useEffect(() => () => {
    recRef.current?.stop();
    recRef.current = undefined;
  }, []);

  return { listening, error, setError, supported, toggle, stop };
}
