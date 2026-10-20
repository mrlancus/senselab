import type { Capability } from '../lib/capabilities';

const icon = { yes: '✅', no: '⛔', permission: '🔐', unknown: '❔' } as const;

export function CapabilityList({ caps }: { caps: Capability[] }) {
  return (
    <ul className="caps">
      {caps.map((c) => (
        <li key={c.id} className={`cap ${c.support}`}>
          <span aria-hidden>{icon[c.support]}</span>
          <span>
            <strong>{c.label}</strong>
            <span className="muted small">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
