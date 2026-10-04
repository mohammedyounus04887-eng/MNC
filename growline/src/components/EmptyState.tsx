export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-elevated text-gold-ink">
        {icon}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-text-dim">{body}</p>
      {children}
    </div>
  );
}
