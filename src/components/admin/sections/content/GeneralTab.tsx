import { LayoutPanelLeft, FileText, Palette } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useSiteContent } from "@/lib/stores";
import { BRAND } from "@/lib/brand";
import { SectionCard, Field } from "./shared";

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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <SectionCard
          icon={<LayoutPanelLeft className="h-4 w-4" />}
          title="Core Identity"
          subtitle="Define your brand's basic information"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Site Name">
              <Input
                value={content.siteName}
                onChange={(e) => setContent({ ...content, siteName: e.target.value })}
              />
            </Field>
            <Field label="Site Tagline">
              <Input
                value={content.tagline}
                onChange={(e) => setContent({ ...content, tagline: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Site Description (SEO)">
            <Textarea
              rows={3}
              value={content.seoDescription}
              onChange={(e) => setContent({ ...content, seoDescription: e.target.value })}
            />
          </Field>
        </SectionCard>

        <SectionCard
          icon={<FileText className="h-4 w-4" />}
          title="Brand Logo"
          subtitle="Built into the app: the same three images everywhere"
        >
          <BrandPreview />
        </SectionCard>
      </div>

      <SectionCard
        icon={<Palette className="h-4 w-4" />}
        title="Visual Style"
        subtitle="Colors and themes"
      >
        <Field label="Global Primary Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={content.primaryColor}
              onChange={(e) => setContent({ ...content, primaryColor: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
            />
            <Input
              value={content.primaryColor}
              onChange={(e) => setContent({ ...content, primaryColor: e.target.value })}
              className="uppercase"
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setContent({ ...content, primaryColor: c })}
                aria-label={`Use ${c} as primary color`}
                className={cn(
                  "h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-shadow",
                  content.primaryColor.toLowerCase() === c ? "ring-2 ring-foreground" : "",
                )}
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
                className={cn(
                  "h-8 w-8 rounded-full border border-border ring-offset-2 ring-offset-card",
                  content.buttonTextColor.toUpperCase() === c ? "ring-2 ring-foreground" : "",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="text-xs font-medium text-muted-foreground">
              {content.buttonTextColor.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Controls the text color inside solid primary buttons to ensure readability.
          </p>
        </Field>

        <Field label="Secondary / Accent Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={content.accentColor}
              onChange={(e) => setContent({ ...content, accentColor: e.target.value })}
              className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
            />
            <Input
              value={content.accentColor}
              onChange={(e) => setContent({ ...content, accentColor: e.target.value })}
              className="uppercase"
            />
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

        <RadiusField
          label="KPI Card Roundness"
          value={content.kpiCardRadius}
          onChange={(v) => setContent({ ...content, kpiCardRadius: v })}
          hint="Controls the roundness of the KPI trend cards on the Dashboard and other analytics pages — separate from Card Roundness above."
        />
      </SectionCard>
    </div>
  );
}

function RadiusField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-3">
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={0}
          max={24}
          step={1}
          className="flex-1"
        />
        <span className="w-10 shrink-0 text-right text-xs font-medium text-muted-foreground">
          {value}px
        </span>
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5">
        {RADIUS_PRESETS.map((r) => (
          <button
            key={r.label}
            onClick={() => onChange(r.value)}
            style={{ borderRadius: Math.min(r.value, 12) }}
            className={cn(
              "flex h-9 items-center justify-center border text-[10px] font-medium transition-colors",
              value === r.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
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

// The brand images are built in (src/lib/brand.ts), not uploaded: each is shown where it is used.
function BrandPreview() {
  const items = [
    {
      src: BRAND.wordmark,
      label: "Wordmark",
      use: "Sidebar, sign-in, landing page, link previews",
    },
    {
      src: BRAND.appIcon,
      label: "App icon",
      use: "Browser tab, home screen, collapsed sidebar, phone header",
    },
    { src: BRAND.mascot, label: "Mascot", use: "The Tubi assistant, calls to action" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <figure key={item.label} className="rounded-lg border border-border bg-accent/20 p-3">
          <div className="flex h-20 items-center justify-center">
            <img src={item.src} alt={item.label} className="max-h-16 max-w-full object-contain" />
          </div>
          <figcaption className="mt-2">
            <span className="block text-xs font-semibold">{item.label}</span>
            <span className="block text-xs text-muted-foreground">{item.use}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
