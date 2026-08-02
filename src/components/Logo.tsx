import { useSiteContent } from "@/lib/stores";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  const [content] = useSiteContent();
  if (collapsed) {
    return (
      <div className="flex items-center justify-center">
        <img src={content.logoLightUrl} alt={content.siteName} className="h-9 w-9 object-contain" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <img src={content.logoLightUrl} alt={content.siteName} className="h-9 w-9 shrink-0 object-contain" />
      <span className="text-lg font-bold tracking-tight text-primary">{content.siteName}</span>
    </div>
  );
}
