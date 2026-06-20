interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
}

export default function StatCard({ label, value, subtext }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
        {value}
      </p>
      {subtext && (
        <p className="mt-1 text-xs text-[var(--muted)]">{subtext}</p>
      )}
    </div>
  );
}
