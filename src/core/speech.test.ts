import { describe, expect, it, vi } from 'vitest';
import {
  createSpeechRecognizer,
  speechSupported,
  splitSpokenItems,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from './speech';

describe('splitSpokenItems', () => {
  it('splits on commas and trims', () => {
    expect(splitSpokenItems('milk, eggs')).toEqual(['milk', 'eggs']);
    expect(splitSpokenItems('  oat milk ,  2 eggs , ')).toEqual(['oat milk', '2 eggs']);
  });

  it('collapses inner whitespace and drops empties', () => {
    expect(splitSpokenItems('milk,,,  ,bread')).toEqual(['milk', 'bread']);
    expect(splitSpokenItems('whole   wheat\nbread')).toEqual(['whole wheat bread']);
  });

  it('does not split on and', () => {
    expect(splitSpokenItems('bread and butter')).toEqual(['bread and butter']);
  });

  it('returns empty for blank transcripts', () => {
    expect(splitSpokenItems('')).toEqual([]);
    expect(splitSpokenItems('   ,  , ')).toEqual([]);
  });
});

describe('speechSupported', () => {
  it('detects SpeechRecognition or webkitSpeechRecognition', () => {
    expect(speechSupported({} as Window & { SpeechRecognition?: undefined })).toBe(false);
    expect(speechSupported({ SpeechRecognition: class {} } as never)).toBe(true);
    expect(speechSupported({ webkitSpeechRecognition: class {} } as never)).toBe(true);
  });
});

describe('createSpeechRecognizer', () => {
  it('fires onFinal for final results and restarts while armed', () => {
    const instances: SpeechRecognitionLike[] = [];
    class FakeRec implements SpeechRecognitionLike {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: ((ev: SpeechRecognitionEventLike) => void) | null = null;
      onerror: ((ev: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        instances.push(this);
      }
    }
    const onFinal = vi.fn();
    const onInterim = vi.fn();
    const r = createSpeechRecognizer({
      onFinal,
      onInterim,
      win: { SpeechRecognition: FakeRec } as never,
      lang: 'en-GB',
    });
    expect(r).toBeTruthy();
    r!.start();
    expect(instances).toHaveLength(1);
    expect(instances[0].lang).toBe('en-GB');
    expect(instances[0].continuous).toBe(true);
    expect(instances[0].start).toHaveBeenCalledOnce();

    instances[0].onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: 'mil' } },
        { isFinal: true, 0: { transcript: 'milk, eggs' } },
      ],
    });
    expect(onInterim).toHaveBeenCalledWith('mil');
    expect(onFinal).toHaveBeenCalledWith('milk, eggs');

    instances[0].onend?.();
    expect(instances[0].start).toHaveBeenCalledTimes(2);

    r!.stop();
    expect(instances[0].stop).toHaveBeenCalled();
    instances[0].onend?.();
    expect(instances[0].start).toHaveBeenCalledTimes(2);
  });
});
