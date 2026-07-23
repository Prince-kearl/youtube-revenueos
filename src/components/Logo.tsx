export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex items-center justify-center">
        <img src="/logo.png" alt="Tubify" className="h-9 w-9 object-contain" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <img src="/logo.png" alt="Tubify" className="h-9 w-9 shrink-0 object-contain" />
      <span className="text-lg font-bold tracking-tight text-primary">Tubify</span>
    </div>
  );
}
