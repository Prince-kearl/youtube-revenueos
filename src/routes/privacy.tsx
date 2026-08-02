import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ShieldCheck, Database, Youtube, Cookie, Users2, Lock, Globe, FileText, Trash2, Mail,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useSiteContent } from "@/lib/stores";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Tubify" },
      { name: "description", content: "How Tubify collects, uses, and protects your data, including data received via the YouTube API Services." },
      { property: "og:title", content: "Privacy Policy — Tubify" },
      { property: "og:description", content: "How Tubify collects, uses, and protects your data, including data received via the YouTube API Services." },
    ],
  }),
  component: Privacy,
});

const LAST_UPDATED = "July 1, 2026";

type Section = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
};

function Privacy() {
  const [content] = useSiteContent();

  const sections: Section[] = [
    {
      id: "collect",
      icon: Database,
      title: "Information we collect",
      body: (
        <>
          <p>We collect the following categories of information:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Account information</strong> — name, email address, avatar, and password (or OAuth identifier if you sign in with Google).</li>
            <li><strong>YouTube channel data</strong> — with your explicit authorization, video metadata, transcripts, analytics (views, watch time, subscriber counts), and revenue estimates retrieved via the YouTube Data API and YouTube Analytics API.</li>
            <li><strong>Usage data</strong> — pages visited, features used, and comment-automation activity within {content.siteName}, used to operate and improve the product.</li>
            <li><strong>Payment information</strong> — processed by our payment provider (Stripe); we store transaction and subscription status, never full card numbers.</li>
            <li><strong>Content you provide</strong> — comment-reply rules, tracked-link destinations, brand deal records, and any files or messages you upload (e.g. in Lead Inbox).</li>
          </ul>
        </>
      ),
    },
    {
      id: "use",
      icon: FileText,
      title: "How we use your information",
      body: (
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To operate core features: revenue attribution, AI-assisted descriptions, comment automation, and link tracking.</li>
          <li>To display your dashboard, analytics, and reports back to you.</li>
          <li>To send account-related notifications (billing, security alerts, product updates you've opted into).</li>
          <li>To detect, prevent, and respond to fraud, abuse, or security incidents.</li>
          <li>To comply with legal obligations, such as tax and accounting records for processed payments.</li>
        </ul>
      ),
    },
    {
      id: "youtube-api",
      icon: Youtube,
      title: "YouTube API Services",
      body: (
        <>
          <p>
            {content.siteName}'s use and transfer of information received from Google APIs adheres to the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              Google API Services User Data Policy
            </a>, including the Limited Use requirements. Google account data (e.g. channel analytics, video metadata) is used only to power the
            features you explicitly connect — it is never sold, and it is never used for advertising.
          </p>
          <p className="mt-2">
            You can revoke {content.siteName}'s access to your Google account at any time via your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              Google Security settings
            </a>. Google's own handling of your data is governed by the{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
              Google Privacy Policy
            </a>.
          </p>
        </>
      ),
    },
    {
      id: "sharing",
      icon: Users2,
      title: "Who we share data with",
      body: (
        <>
          <p>We do not sell your personal information. We share data only with:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li><strong>Service providers</strong> who process data on our behalf under contract — hosting (Hetzner, EU), payments (Stripe), and transactional email.</li>
            <li><strong>Your team</strong> — editors and setters you invite see the workspace data you grant them access to, per their assigned role.</li>
            <li><strong>Legal authorities</strong> — only when required by law, or to protect the rights, safety, and property of {content.siteName} or our users.</li>
          </ul>
        </>
      ),
    },
    {
      id: "cookies",
      icon: Cookie,
      title: "Cookies & local storage",
      body: (
        <p>
          We use essential cookies and browser local storage to keep you signed in, remember your preferences (such as theme and layout), and
          measure product usage. You can control non-essential cookies from the consent banner shown on your first visit, or clear them anytime
          in your browser settings — this may sign you out or reset saved preferences.
        </p>
      ),
    },
    {
      id: "security",
      icon: Lock,
      title: "Data security",
      body: (
        <p>
          Data is encrypted with TLS 1.3 in transit and AES-256 at rest. Access to production systems is limited to authorized personnel and
          logged. No method of transmission or storage is 100% secure, so while we work to protect your information, we cannot guarantee
          absolute security.
        </p>
      ),
    },
    {
      id: "retention",
      icon: Globe,
      title: "Data retention & storage location",
      body: (
        <p>
          Your data is hosted on EU servers (Hetzner, Nuremberg &amp; Helsinki — ISO 27001 certified) and is not transferred outside the EU
          except where a subprocessor requires it (e.g. Stripe for payment processing) under Standard Contractual Clauses. We retain account
          data for as long as your account is active, and audit logs for 12 months. When you delete your account, associated personal data is
          erased within 30 days, except where we're legally required to retain records (e.g. tax documents).
        </p>
      ),
    },
    {
      id: "rights",
      icon: ShieldCheck,
      title: "Your rights",
      body: (
        <>
          <p>Depending on your location, you have the right to:</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Access the personal data we hold about you, and receive a copy in a portable format (GDPR Art. 20).</li>
            <li>Correct inaccurate data.</li>
            <li>Request erasure of your account and associated data (GDPR Art. 17).</li>
            <li>Withdraw consent for optional tracking or AI processing at any time.</li>
          </ul>
          <p className="mt-2">
            You can exercise the export, consent, and deletion rights directly from{" "}
            <Link to="/settings" className="font-medium text-primary hover:underline">Settings → Compliance &amp; Data</Link> — account
            deletion there permanently erases your data and does not require emailing support.
          </p>
        </>
      ),
    },
  ];

  return (
    <DashboardLayout title="Privacy Policy">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {LAST_UPDATED}</p>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          This policy explains what information {content.siteName} collects, how we use it, and the choices you have — including data
          received through the YouTube API Services when you connect your channel.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {sections.map((s) => (
          <div key={s.id} id={s.id} className="relative rounded-xl card-gradient-outline p-5">
            <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <s.icon className="h-5 w-5 text-primary" /> {s.title}
            </h2>
            <div className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</div>
          </div>
        ))}

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Trash2 className="h-5 w-5 text-primary" /> Account deletion
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            You can delete your account at any time from{" "}
            <Link to="/settings" className="font-medium text-primary hover:underline">Settings → Compliance &amp; Data → Delete account</Link>.
            This immediately and permanently erases your profile, channel settings, deals, leads, and every other record tied to your account.
          </p>
        </div>

        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Mail className="h-5 w-5 text-primary" /> Contact us
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Questions about this policy or your data? Email us at{" "}
            <a href={`mailto:${content.contactEmail}`} className="font-medium text-primary hover:underline">{content.contactEmail}</a> or use
            the <Link to="/support" className="font-medium text-primary hover:underline">Support</Link> page.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
