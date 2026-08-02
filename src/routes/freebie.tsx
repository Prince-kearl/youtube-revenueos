import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Download, FileText, Gift, Users, Percent, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { llm } from "@/lib/llm";

export const Route = createFileRoute("/freebie")({
  component: Freebie,
});

const formats = [
  { id: "cheatsheet", label: "Cheatsheet" },
  { id: "guide", label: "Mini-Guide" },
  { id: "list", label: "Resource List" },
  { id: "checklist", label: "Actionable Checklist" },
];

const magnets = [
  { title: "Dropshipping Product Research Cheatsheet", downloads: "1,842", optin: "34.9%", format: "Cheatsheet" },
  { title: "7-Day Creator Launch Checklist", downloads: "1,204", optin: "41.2%", format: "Checklist" },
  { title: "Brand Deal Negotiation Mini-Guide", downloads: "864", optin: "28.6%", format: "Mini-Guide" },
];

const previewMd = `# The Dropshipping Product Research Cheatsheet

## 1. Validate demand before you commit
- Search the product on TikTok — look for videos with 100K+ views in the last 30 days.
- Check Google Trends for a rising 12-month curve, not a fading spike.

## 2. Vet the supplier
- Order a sample. Always. Measure shipping time door-to-door.
- Confirm they can handle 50+ orders/day without delays.

## 3. The 3-point margin rule
- Sell price ≥ 3× landed cost.
- Keep ad cost under 30% of revenue.
- Reserve 10% for refunds and chargebacks.

## 4. Test cheaply
- Launch with one product, one angle, $20/day.
- Kill it in 3 days if CTR < 1%.`;

function Freebie() {
  const [product, setProduct] = useState("Dropshipping course");
  const [audience, setAudience] = useState("Beginner e-commerce creators");
  const [tone, setTone] = useState("Direct, no-fluff, practical");
  const [format, setFormat] = useState("cheatsheet");
  const [preview, setPreview] = useState<string | null>(previewMd);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    const formatLabel = formats.find((f) => f.id === format)?.label ?? "Cheatsheet";
    const result = await llm.generateFreebie({ product, audience, tone, formatLabel });
    setPreview(result);
    setIsGenerating(false);
  };

  return (
    <DashboardLayout title="AI Freebie">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Freebie Generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spin up high-converting lead magnets in seconds — captured emails sync straight to your leads.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard icon={<Download className="h-5 w-5" />} value="3,910" label="Total Downloads" change="16.4%" up />
        <StatCard icon={<Users className="h-5 w-5" />} value="2,884" label="Emails Collected" change="11.9%" up />
        <StatCard icon={<Percent className="h-5 w-5" />} value="34.7%" label="Avg Opt-in Rate" change="4.2%" up />
      </div>

      {/* Freebie studio — split screen */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Input form */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-brand-purple" /> Build your freebie
          </h3>
          <div className="mt-4 space-y-4">
            <Field label="Product / service">
              <input value={product} onChange={(e) => setProduct(e.target.value)} className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-background px-3 text-sm outline-none focus:border-primary" placeholder="e.g. Dropshipping course" />
            </Field>
            <Field label="Target audience">
              <input value={audience} onChange={(e) => setAudience(e.target.value)} className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-background px-3 text-sm outline-none focus:border-primary" placeholder="e.g. Beginner e-commerce creators" />
            </Field>
            <Field label="Brand tone">
              <input value={tone} onChange={(e) => setTone(e.target.value)} className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-background px-3 text-sm outline-none focus:border-primary" placeholder="e.g. Direct, no-fluff, practical" />
            </Field>
            <Field label="Format">
              <div className="flex flex-wrap gap-2">
                {formats.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      format === f.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </Field>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !product.trim() || !audience.trim()}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isGenerating ? "Generating…" : "Generate Freebie"}
            </button>
            <p className="text-[11px] text-muted-foreground">
              Powered by AI. Output renders to a branded, downloadable PDF and emails automatically on lead capture.
            </p>
          </div>
        </div>

        {/* Live preview */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <FileText className="h-5 w-5" /> Live Preview
            </h3>
            <button className="flex h-9 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 text-sm text-muted-foreground hover:text-foreground">
              <Download className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
          {preview ? (
            <div className="mt-4 h-[420px] overflow-y-auto rounded-lg border border-border bg-background p-5">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">{preview}</pre>
            </div>
          ) : (
            <div className="mt-4 flex h-[420px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-muted-foreground">
              <Gift className="h-8 w-8 text-brand-purple/60" />
              <p className="text-sm">Fill in the form and generate to preview.</p>
            </div>
          )}
        </div>
      </div>

      {/* Lead performance tracker */}
      <div className="relative mt-5 rounded-xl card-gradient-outline">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <div className="border-b border-border p-5">
          <h3 className="text-lg font-semibold">Lead Performance</h3>
        </div>
        {/* Mobile: stacked cards */}
        <div className="space-y-3 p-5 sm:hidden">
          {magnets.map((m) => (
            <div key={m.title} className="rounded-xl border border-border p-4">
              <p className="font-medium">{m.title}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="inline-flex rounded-md bg-brand-purple/15 px-2 py-0.5 text-[11px] font-medium text-brand-purple">{m.format}</span>
                <span className="text-xs text-muted-foreground">{m.downloads} downloads</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-brand-green">{m.optin} opt-in rate</p>
            </div>
          ))}
        </div>

        {/* Desktop: table */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Lead Magnet</th>
                <th className="px-5 py-3 font-medium">Format</th>
                <th className="px-5 py-3 font-medium">Downloads</th>
                <th className="px-5 py-3 font-medium">Opt-in Rate</th>
              </tr>
            </thead>
            <tbody>
              {magnets.map((m) => (
                <tr key={m.title} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 font-medium">{m.title}</td>
                  <td className="px-5 py-3.5">
                    <span className="inline-flex rounded-md bg-brand-purple/15 px-2 py-0.5 text-[11px] font-medium text-brand-purple">{m.format}</span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">{m.downloads}</td>
                  <td className="px-5 py-3.5 font-semibold text-brand-green">{m.optin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
