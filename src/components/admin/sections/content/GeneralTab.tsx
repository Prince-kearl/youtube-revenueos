import { useRef } from "react";
import { toast } from "sonner";
import { LayoutPanelLeft, FileText, Palette, Upload, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useSiteContent } from "@/lib/stores";
import { useAuditLogger } from "../../useAuditLogger";
import { SectionCard, Field } from "./shared";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const PRESET_COLORS = ["#8b5cf6", "#f59e0b", "#3b82f6", "#dc2626", "#22c55e"];
const RADIUS_PRESETS = [
  { label: "Sharp", value: 0 },
  { label: "Soft", value: 6 },
  { label: "Rounded", value: 12 },
  { label: "Smooth", value: 18 },
  { label: "Full", value: 24 },
];

export function GeneralTab() {
  const [content, setContent] = useSiteContent();
  const log = useAuditLogger();

  const toggleIos26 = (v: boolean) => {
    setContent({ ...content, ios26Design: v });
    log(v ? "Enabled iOS 26 Design" : "Disabled iOS 26 Design", "Customization", "Design Studio");
    toast.success(v ? "iOS 26 Design enabled" : "iOS 26 Design disabled", {
      description: v
        ? "The Liquid Glass interface is now live for every user."
        : "Reverted to the standard interface for every user.",
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <SectionCard icon={<Sparkles className="h-4 w-4" />} title="Interface" subtitle="Platform-wide visual system">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold">iOS 26 Design</p>
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", content.ios26Design ? "bg-success/15 text-success" : "bg-accent text-muted-foreground")}>
                  {content.ios26Design ? "On" : "Off"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Enable the Liquid Glass-inspired interface with translucent surfaces, enhanced depth, rounded components, and modern visual effects across the application.
              </p>
            </div>
            <Switch checked={content.ios26Design} onCheckedChange={toggleIos26} aria-label="Toggle iOS 26 Design" className="shrink-0" />
          </div>
        </SectionCard>

        <SectionCard icon={<LayoutPanelLeft className="h-4 w-4" />} title="Core Identity" subtitle="Define your brand's basic information">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Site Name">
              <Input value={content.siteName} onChange={(e) => setContent({ ...content, siteName: e.target.value })} />
            </Field>
            <Field label="Site Tagline">
              <Input value={content.tagline} onChange={(e) => setContent({ ...content, tagline: e.target.value })} />
            </Field>
          </div>
          <Field label="Site Description (SEO)">
            <Textarea rows={3} value={content.seoDescription} onChange={(e) => setContent({ ...content, seoDescription: e.target.value })} />
          </Field>
        </SectionCard>

        <SectionCard icon={<FileText className="h-4 w-4" />} title="Brand Logo" subtitle="Visual representation of your brand">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LogoUploadField
              label="Primary Logo (Light Mode)"
              url={content.logoLightUrl}
              onChange={(url) => setContent({ ...content, logoLightUrl: url })}
            />
            <LogoUploadField
              label="White Logo (Dark Mode & Footer)"
              url={content.logoDarkUrl}
              onChange={(url) => setContent({ ...content, logoDarkUrl: url })}
              dark
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard icon={<Palette className="h-4 w-4" />} title="Visual Style" subtitle="Colors and themes">
        <Field label="Global Primary Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={content.primaryColor}
              onChange={(e) => setContent({ ...content, primaryColor: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
            />
            <Input value={content.primaryColor} onChange={(e) => setContent({ ...content, primaryColor: e.target.value })} className="uppercase" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setContent({ ...content, primaryColor: c })}
                aria-label={`Use ${c} as primary color`}
                className={cn("h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-shadow", content.primaryColor.toLowerCase() === c ? "ring-2 ring-foreground" : "")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </Field>

        <Field label="Button Text Color">
          <div className="flex items-center gap-2">
            {["#FFFFFF", "#000000"].map((c) => (
              <button
                key={c}
                onClick={() => setContent({ ...content, buttonTextColor: c })}
                aria-label={`Use ${c} as button text color`}
                className={cn("h-8 w-8 rounded-full border border-border ring-offset-2 ring-offset-card", content.buttonTextColor.toUpperCase() === c ? "ring-2 ring-foreground" : "")}
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="text-xs font-medium text-muted-foreground">{content.buttonTextColor.toUpperCase()}</span>
          </div>
          <p className="text-xs text-muted-foreground">Controls the text color inside solid primary buttons to ensure readability.</p>
        </Field>

        <Field label="Secondary / Accent Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={content.accentColor}
              onChange={(e) => setContent({ ...content, accentColor: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
            />
            <Input value={content.accentColor} onChange={(e) => setContent({ ...content, accentColor: e.target.value })} className="uppercase" />
          </div>
        </Field>

        <RadiusField
          label="Card Roundness"
          value={content.cardRadius}
          onChange={(v) => setContent({ ...content, cardRadius: v })}
          hint="Controls the roundness of cards throughout the app."
        />

        <RadiusField
          label="Button Roundness"
          value={content.buttonRadius}
          onChange={(v) => setContent({ ...content, buttonRadius: v })}
          hint="Controls the roundness of buttons throughout the app. Pill-shaped buttons are unaffected."
        />

        <RadiusField
          label="Input Roundness"
          value={content.inputRadius}
          onChange={(v) => setContent({ ...content, inputRadius: v })}
          hint="Controls the roundness of text fields, textareas, and dropdowns throughout the app."
        />
      </SectionCard>
    </div>
  );
}

function RadiusField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={0} max={24} step={1} className="flex-1" />
        <span className="w-10 shrink-0 text-right text-xs font-medium text-muted-foreground">{value}px</span>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {RADIUS_PRESETS.map((r) => (
          <button
            key={r.label}
            onClick={() => onChange(r.value)}
            style={{ borderRadius: Math.min(r.value, 12) }}
            className={cn(
              "flex h-9 items-center justify-center border text-[10px] font-medium transition-colors",
              value === r.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </Field>
  );
}

function LogoUploadField({ label, url, onChange, dark }: { label: string; url: string; onChange: (url: string) => void; dark?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) return toast.error("Logo must be under 2MB");
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <Field label={label}>
      <div
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border transition-colors hover:border-primary",
          dark ? "bg-foreground" : "bg-accent/20",
        )}
      >
        {url ? (
          <img src={url} alt={label} className="h-16 max-w-[80%] object-contain" />
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Click to upload</span>
          </>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      {url !== "/logo.png" && (
        <button onClick={() => onChange("/logo.png")} className="text-xs font-medium text-primary hover:underline">
          Reset to default
        </button>
      )}
    </Field>
  );
}
