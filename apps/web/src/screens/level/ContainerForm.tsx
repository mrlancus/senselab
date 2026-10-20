import { useState, type FormEvent } from 'react';
import { frustumCapacityLitres } from '@senselab/dsp';
import type { Container, ContainerInput } from '@senselab/shared';
import { api } from '../../lib/api';
import { Link, navigate } from '../../lib/router';
import { useAsync } from '../../lib/useAsync';

const materials = ['plastic', 'metal', 'glass', 'ceramic', 'wood', 'other'];

export function ContainerForm({ id }: { id?: string }) {
  const existing = useAsync(() => (id ? api.getContainer(id) : Promise.resolve(null)), id ?? 'new');
  if (id && existing.loading) return <p className="muted">Loading…</p>;
  return <Form initial={existing.data} />;
}

function Form({ initial }: { initial: Container | null }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [material, setMaterial] = useState(initial?.material ?? 'plastic');
  const [top, setTop] = useState(initial?.shape?.topDiameterCm.toString() ?? '');
  const [bottom, setBottom] = useState(initial?.shape?.bottomDiameterCm.toString() ?? '');
  const [height, setHeight] = useState(initial?.shape?.heightCm.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dims = [top, bottom, height].map((v) => parseFloat(v.replace(',', '.')));
  const anyDims = [top, bottom, height].some((v) => v.trim());
  const dimsValid = dims.every((v) => v > 0 && v < 500);
  const shape = dimsValid
    ? { topDiameterCm: dims[0], bottomDiameterCm: dims[1], heightCm: dims[2] }
    : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (anyDims && !dimsValid) {
      setError('Fill in all three dimensions, or leave them all empty.');
      return;
    }
    setSaving(true);
    setError(null);
    const input: ContainerInput = { name: name.trim(), material, shape };
    try {
      const c = initial
        ? await api.updateContainer(initial.id, input)
        : await api.createContainer(input);
      navigate(`/level/${c.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <h1>{initial ? 'Edit container' : 'New container'}</h1>
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Blue 10 L bucket"
          required
          maxLength={80}
        />
      </label>
      <label>
        Material
        <select value={material} onChange={(e) => setMaterial(e.target.value)}>
          {materials.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <fieldset className="card stack">
        <legend>Inside dimensions (optional)</legend>
        <p className="muted small">
          Measured inside, in cm. Tap mode works without them, but they set the capacity and let us
          show the water height. Camera measurement is coming.
        </p>
        <div className="field-row">
          <label>
            Top ⌀
            <input
              inputMode="decimal"
              value={top}
              onChange={(e) => setTop(e.target.value)}
              placeholder="28"
            />
          </label>
          <label>
            Bottom ⌀
            <input
              inputMode="decimal"
              value={bottom}
              onChange={(e) => setBottom(e.target.value)}
              placeholder="22"
            />
          </label>
          <label>
            Height
            <input
              inputMode="decimal"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="24"
            />
          </label>
        </div>
        {shape && (
          <p className="small">
            Capacity ≈ {frustumCapacityLitres(shape).toFixed(1)} L (truncated cone)
          </p>
        )}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button className="primary block" disabled={saving || !name.trim()}>
        {saving ? 'Saving…' : initial ? 'Save' : 'Create container'}
      </button>
      <Link href={initial ? `/level/${initial.id}` : '/level'}>Cancel</Link>
    </form>
  );
}
