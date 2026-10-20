export function ConfidencePill({ value }: { value: number }) {
  const label = value >= 0.7 ? 'high' : value >= 0.4 ? 'medium' : 'low';
  return (
    <span className={`pill ${label}`}>
      {label} confidence ({(value * 100).toFixed(0)}%)
    </span>
  );
}
