import { useSiteContent } from "@/lib/stores";
import { BRAND } from "@/lib/brand";

// Collapsed (sidebar, phone header, loading screen): the app icon. Expanded: the Tubify wordmark.
export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  const [content] = useSiteContent();
  if (collapsed) {
    return (
      <div className="flex items-center justify-center">
        <img
          src={BRAND.appIcon}
          alt={content.siteName}
          width={160}
          height={160}
          className="h-9 w-9 object-contain"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center">
      <img
        src={BRAND.wordmark}
        alt={content.siteName}
        width={480}
        height={248}
        className="h-12 w-auto shrink-0 object-contain"
      />
    </div>
  );
}
