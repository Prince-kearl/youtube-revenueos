import { HelpCircle, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSiteContent } from "@/lib/stores";
import { SectionCard, Field } from "./shared";

export function FaqTab() {
  const [content, setContent] = useSiteContent();

  const updateFaq = (i: number, patch: Partial<{ q: string; a: string }>) => {
    setContent({ ...content, faqs: content.faqs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  };
  const removeFaq = (i: number) => {
    setContent({ ...content, faqs: content.faqs.filter((_, idx) => idx !== i) });
  };
  const addFaq = () => {
    setContent({ ...content, faqs: [...content.faqs, { q: "", a: "" }] });
  };

  return (
    <SectionCard icon={<HelpCircle className="h-4 w-4" />} title="Frequently Asked Questions" subtitle="Shown in the FAQ accordion on your landing page">
      <Field label="Section Heading">
        <Input value={content.faqHeading} onChange={(e) => setContent({ ...content, faqHeading: e.target.value })} />
      </Field>

      <div className="space-y-3">
        {content.faqs.map((f, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Input value={f.q} onChange={(e) => updateFaq(i, { q: e.target.value })} placeholder="Question" />
                <Textarea rows={2} value={f.a} onChange={(e) => updateFaq(i, { a: e.target.value })} placeholder="Answer" />
              </div>
              <button onClick={() => removeFaq(i)} aria-label="Delete FAQ" className="shrink-0 rounded-[var(--button-radius)] p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addFaq} className="flex items-center gap-1.5 rounded-[var(--button-radius)] border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary">
        <Plus className="h-4 w-4" /> Add FAQ
      </button>
    </SectionCard>
  );
}
