import { useSiteContent } from "@/lib/stores";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  const [content] = useSiteContent();
  if (collapsed) {
    return (
      <div className="flex items-center justify-center">
        <img referrerPolicy="no-referrer" src={content.logoLightUrl} alt={content.siteName} className="h-9 w-9 object-contain" />
      </div>
    );
  }
  const hasCustomIcon = content.siteIconUrl.startsWith("data:");
  return (
    <div className="flex items-center gap-2">
      <img
        referrerPolicy="no-referrer"
        src={content.logoLightUrl}
        alt={content.siteName}
        className="h-12 w-12 shrink-0 object-contain"
      />
      {hasCustomIcon ? (
        <img
          referrerPolicy="no-referrer"
          src={content.siteIconUrl}
          alt={content.siteName}
          className="h-12 w-12 shrink-0 object-contain"
        />
      ) : (
        <span className="text-2xl font-bold tracking-tight text-primary">{content.siteName}</span>
      )}
    </div>
  );
}
