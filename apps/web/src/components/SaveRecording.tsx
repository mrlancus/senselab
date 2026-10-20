import { useState } from 'react';
import { encodeWav } from '@senselab/dsp';
import type { RecordingLabels, RecordingMode } from '@senselab/shared';
import { api } from '../lib/api';

/**
 * Debug-only: upload the raw recording plus labels to R2 so it can be replayed later as a
 * regression fixture. Nothing is uploaded unless this button is pressed.
 */
export function SaveRecording({
  samples,
  sampleRate,
  mode,
  labels,
  onSaved,
}: {
  samples: Float32Array;
  sampleRate: number;
  mode: RecordingMode;
  labels: RecordingLabels;
  /** Lets the caller attach the recording to a calibration point or measurement. */
  onSaved?: (key: string) => void;
}) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const save = async () => {
    setState('saving');
    try {
      const blob = new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' });
      const rec = await api.uploadRecording(blob, {
        mode,
        sampleRate,
        labels: {
          ...labels,
          ...(note.trim() ? { note: note.trim() } : {}),
          ua: navigator.userAgent.slice(0, 200),
        },
      });
      setState('saved');
      onSaved?.(rec.key);
      setMessage(`Saved ${(rec.sizeBytes / 1024).toFixed(0)} KB · ${rec.key.slice(0, 8)}`);
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack save-rec">
      <label>
        Label for this recording
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='e.g. "10 L bucket, 6 L water, pen tap"'
          maxLength={200}
        />
      </label>
      <div className="row">
        <button className="small" onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Uploading…' : 'Save recording to cloud'}
        </button>
        <span className={`small ${state === 'error' ? 'error' : 'muted'}`}>
          {message ||
            `${(samples.length / sampleRate).toFixed(1)} s WAV, ${Object.keys(labels).length} labels`}
        </span>
      </div>
    </div>
  );
}
