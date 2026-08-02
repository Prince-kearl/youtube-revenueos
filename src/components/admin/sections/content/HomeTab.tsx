import { TrendingUp, Youtube, BarChart3, Users2, Megaphone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSiteContent, type SiteContent } from "@/lib/stores";
import { SectionCard, Field } from "./shared";

export function HomeTab() {
  const [content, setContent] = useSiteContent();

  const updateProblemItem = (i: number, patch: Partial<SiteContent["problemItems"][number]>) => {
    setContent({ ...content, problemItems: content.problemItems.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  };
  const updateStep = (i: number, patch: Partial<SiteContent["howItWorksSteps"][number]>) => {
    setContent({ ...content, howItWorksSteps: content.howItWorksSteps.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  };
  const updateStat = (i: number, patch: Partial<SiteContent["stats"][number]>) => {
    setContent({ ...content, stats: content.stats.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  };

  return (
    <div className="space-y-5">
      <SectionCard icon={<TrendingUp className="h-4 w-4" />} title="Problem Section" subtitle="Why your product matters">
        <Field label="Heading"><Input value={content.problemHeading} onChange={(e) => setContent({ ...content, problemHeading: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {content.problemItems.map((it, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <Input value={it.title} onChange={(e) => updateProblemItem(i, { title: e.target.value })} placeholder="Title" />
              <Textarea rows={3} value={it.desc} onChange={(e) => updateProblemItem(i, { desc: e.target.value })} placeholder="Description" />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<BarChart3 className="h-4 w-4" />} title="Product Showcase" subtitle="Highlight your core product">
        <Field label="Badge"><Input value={content.showcaseBadge} onChange={(e) => setContent({ ...content, showcaseBadge: e.target.value })} /></Field>
        <Field label="Heading"><Input value={content.showcaseHeading} onChange={(e) => setContent({ ...content, showcaseHeading: e.target.value })} /></Field>
        <Field label="Subtext"><Textarea rows={2} value={content.showcaseSubtext} onChange={(e) => setContent({ ...content, showcaseSubtext: e.target.value })} /></Field>
      </SectionCard>

      <SectionCard icon={<Youtube className="h-4 w-4" />} title="How It Works" subtitle="Walk visitors through your product step by step">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Heading"><Input value={content.howItWorksHeading} onChange={(e) => setContent({ ...content, howItWorksHeading: e.target.value })} /></Field>
          <Field label="Subtitle"><Input value={content.howItWorksSubtitle} onChange={(e) => setContent({ ...content, howItWorksSubtitle: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {content.howItWorksSteps.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <Input value={s.title} onChange={(e) => updateStep(i, { title: e.target.value })} placeholder={`Step ${i + 1} title`} />
              <Textarea rows={2} value={s.desc} onChange={(e) => updateStep(i, { desc: e.target.value })} placeholder="Description" />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<Users2 className="h-4 w-4" />} title="Built For Creators" subtitle="Social proof for teams">
        <Field label="Heading"><Input value={content.creatorsHeading} onChange={(e) => setContent({ ...content, creatorsHeading: e.target.value })} /></Field>
        <Field label="Subtitle"><Textarea rows={2} value={content.creatorsSubtitle} onChange={(e) => setContent({ ...content, creatorsSubtitle: e.target.value })} /></Field>
      </SectionCard>

      <SectionCard icon={<BarChart3 className="h-4 w-4" />} title="Stats" subtitle="Numbers that build trust">
        <Field label="Heading"><Input value={content.statsHeading} onChange={(e) => setContent({ ...content, statsHeading: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {content.stats.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <Input value={s.value} onChange={(e) => updateStat(i, { value: e.target.value })} placeholder="Value" />
              <Input value={s.label} onChange={(e) => updateStat(i, { label: e.target.value })} placeholder="Label" />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<Megaphone className="h-4 w-4" />} title="Final Call to Action" subtitle="The last nudge before conversion">
        <Field label="Heading"><Textarea rows={2} value={content.finalCtaHeading} onChange={(e) => setContent({ ...content, finalCtaHeading: e.target.value })} /></Field>
        <Field label="Subtitle"><Input value={content.finalCtaSubtitle} onChange={(e) => setContent({ ...content, finalCtaSubtitle: e.target.value })} /></Field>
      </SectionCard>
    </div>
  );
}
