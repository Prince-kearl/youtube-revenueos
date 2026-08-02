import { Share2, Youtube, Twitter, Instagram, Music2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSiteContent } from "@/lib/stores";
import { SectionCard, Field } from "./shared";

export function SocialTab() {
  const [content, setContent] = useSiteContent();
  const links = content.socialLinks;
  const setLink = (key: keyof typeof links, value: string) => setContent({ ...content, socialLinks: { ...links, [key]: value } });

  return (
    <SectionCard icon={<Share2 className="h-4 w-4" />} title="Social Links" subtitle="Shown as icons in your site footer — leave blank to hide">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="YouTube URL">
          <div className="flex items-center gap-2"><Youtube className="h-4 w-4 shrink-0 text-muted-foreground" /><Input value={links.youtube} onChange={(e) => setLink("youtube", e.target.value)} placeholder="https://youtube.com/@yourchannel" /></div>
        </Field>
        <Field label="Twitter / X URL">
          <div className="flex items-center gap-2"><Twitter className="h-4 w-4 shrink-0 text-muted-foreground" /><Input value={links.twitter} onChange={(e) => setLink("twitter", e.target.value)} placeholder="https://x.com/yourhandle" /></div>
        </Field>
        <Field label="Instagram URL">
          <div className="flex items-center gap-2"><Instagram className="h-4 w-4 shrink-0 text-muted-foreground" /><Input value={links.instagram} onChange={(e) => setLink("instagram", e.target.value)} placeholder="https://instagram.com/yourhandle" /></div>
        </Field>
        <Field label="TikTok URL">
          <div className="flex items-center gap-2"><Music2 className="h-4 w-4 shrink-0 text-muted-foreground" /><Input value={links.tiktok} onChange={(e) => setLink("tiktok", e.target.value)} placeholder="https://tiktok.com/@yourhandle" /></div>
        </Field>
      </div>
      <Field label="Footer Copyright Text">
        <Input value={content.copyrightText} onChange={(e) => setContent({ ...content, copyrightText: e.target.value })} />
      </Field>
    </SectionCard>
  );
}
