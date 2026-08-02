import { Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSiteContent } from "@/lib/stores";
import { SectionCard, Field } from "./shared";

export function HeroTab() {
  const [content, setContent] = useSiteContent();

  return (
    <SectionCard icon={<Sparkles className="h-4 w-4" />} title="Hero Section" subtitle="The first thing visitors see on your landing page">
      <Field label="Badge Text">
        <Input value={content.heroBadge} onChange={(e) => setContent({ ...content, heroBadge: e.target.value })} />
      </Field>
      <Field label="Headline">
        <Textarea rows={2} value={content.heroHeadline} onChange={(e) => setContent({ ...content, heroHeadline: e.target.value })} />
      </Field>
      <Field label="Subheadline">
        <Textarea rows={3} value={content.heroSubheadline} onChange={(e) => setContent({ ...content, heroSubheadline: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Primary Button Label">
          <Input value={content.heroPrimaryCta} onChange={(e) => setContent({ ...content, heroPrimaryCta: e.target.value })} />
        </Field>
        <Field label="Secondary Button Label">
          <Input value={content.heroSecondaryCta} onChange={(e) => setContent({ ...content, heroSecondaryCta: e.target.value })} />
        </Field>
      </div>
    </SectionCard>
  );
}
