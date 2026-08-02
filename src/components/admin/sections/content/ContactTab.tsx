import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSiteContent } from "@/lib/stores";
import { SectionCard, Field } from "./shared";

export function ContactTab() {
  const [content, setContent] = useSiteContent();

  return (
    <SectionCard icon={<Mail className="h-4 w-4" />} title="Contact Section" subtitle="The contact form and footer contact details on your landing page">
      <Field label="Heading">
        <Input value={content.contactHeading} onChange={(e) => setContent({ ...content, contactHeading: e.target.value })} />
      </Field>
      <Field label="Subheading">
        <Input value={content.contactSubheading} onChange={(e) => setContent({ ...content, contactSubheading: e.target.value })} />
      </Field>
      <Field label="Contact Email">
        <Input type="email" value={content.contactEmail} onChange={(e) => setContent({ ...content, contactEmail: e.target.value })} />
      </Field>
    </SectionCard>
  );
}
