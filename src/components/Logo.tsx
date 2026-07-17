import logoAsset from "@/assets/tubify-logo.png.asset.json";
import iconAsset from "@/assets/tubify-icon.png.asset.json";

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex items-center justify-center">
        <img src={iconAsset.url} alt="Tubify" className="h-9 w-9 object-contain" />
      </div>
    );
  }
  return (
    <div className="flex items-center">
      <img src={logoAsset.url} alt="Tubify" className="h-9 w-auto object-contain" />
    </div>
  );
}
