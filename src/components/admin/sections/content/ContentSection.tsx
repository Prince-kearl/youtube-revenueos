import { useState } from "react";
import { toast } from "sonner";
import {
  Palette, Save, LayoutPanelLeft, Type, Home, HelpCircle, Mail, Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuditLogger } from "../../useAuditLogger";
import { GeneralTab } from "./GeneralTab";
import { HeroTab } from "./HeroTab";
import { HomeTab } from "./HomeTab";
import { FaqTab } from "./FaqTab";
import { ContactTab } from "./ContactTab";
import { SocialTab } from "./SocialTab";

type Tab = "general" | "hero" | "home" | "faq" | "contact" | "social";
const TABS: { key: Tab; label: string; icon: typeof LayoutPanelLeft }[] = [
  { key: "general", label: "General", icon: LayoutPanelLeft },
  { key: "hero", label: "Hero", icon: Type },
  { key: "home", label: "Home", icon: Home },
  { key: "faq", label: "FAQ", icon: HelpCircle },
  { key: "contact", label: "Contact", icon: Mail },
  { key: "social", label: "Social", icon: Share2 },
];
const TAB_CONTENT: Record<Tab, React.ComponentType> = {
  general: GeneralTab,
  hero: HeroTab,
  home: HomeTab,
  faq: FaqTab,
  contact: ContactTab,
  social: SocialTab,
};

export function ContentSection() {
  const [tab, setTab] = useState<Tab>("general");
  const log = useAuditLogger();
  const Active = TAB_CONTENT[tab];

  const saveChanges = () => {
    log("Updated site content", "Customization", "Design Studio");
    toast.success("Changes saved", { description: "Your public site reflects these changes immediately." });
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Palette className="h-3 w-3" /> Customizer
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Design <span className="text-primary">Studio</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Refine your app's visual identity and public site content.</p>
        </div>
        <button onClick={saveChanges} className="flex h-10 shrink-0 items-center gap-2 rounded-[var(--button-radius)] bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Save className="h-4 w-4" /> Save Changes
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <Active />
      </div>
    </div>
  );
}
