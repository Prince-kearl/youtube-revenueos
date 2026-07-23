import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight, Play, Youtube, MessageSquare, Link2, DollarSign, Sparkles, TrendingUp, Send, LifeBuoy,
} from "lucide-react";
import { toast } from "sonner";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import { useSupportTickets } from "@/lib/stores";
import { uid } from "@/lib/local-store";

export const Route = createFileRoute("/landing")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,rgba(2,132,199,0.09)_1px,transparent_1px)] bg-[length:22px_22px]" />
        <div className="pointer-events-none absolute -top-24 right-[-4rem] -z-10 h-80 w-80 rounded-full bg-brand-amber/15 blur-3xl" />
        <div className="pointer-events-none absolute -top-16 left-[-6rem] -z-10 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <NavBar />
        <Hero />
      </div>
      <ProblemSection />
      <ProductShowcase />
      <HowItWorks />
      <BuiltForCreators />
      <StatsSection />
      <FaqSection />
      <ContactSection />
      <FinalCta />
      <FooterSection />
    </div>
  );
}

function NavBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Tubify" className="h-8 w-8 object-contain" />
          <span className="text-lg font-bold tracking-tight">Tubify</span>
        </div>
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#how-it-works" className="hover:text-foreground">Features</a>
          <a href="#stats" className="hover:text-foreground">Results</a>
          <Link to="/changelog" className="hover:text-foreground">Changelog</Link>
          <a href="#faq" className="hover:text-foreground">FAQ</a>
          <a href="#contact" className="hover:text-foreground">Contact</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/" className="rounded-lg px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">Log In</Link>
          <Link to="/dashboard" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Get Started</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Now with AI-generated descriptions
      </span>
      <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-6xl">
        Stop guessing which videos<br className="hidden sm:block" /> make you money.
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
        Tubify turns your YouTube channel into a sales engine — auto-generated descriptions, tracked links,
        comment automation, and revenue attribution down to the video.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link to="/dashboard" className="flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          Get Started Free <ArrowRight className="h-4 w-4" />
        </Link>
        <Link to="/dashboard" className="flex h-12 items-center gap-2 rounded-lg border-2 border-foreground/10 bg-white px-6 text-sm font-semibold hover:bg-accent">
          <Play className="h-4 w-4" /> View Live Demo
        </Link>
      </div>

      <div className="mt-16 rounded-xl border-2 border-foreground/10 bg-white p-3">
        <DashboardMockup />
      </div>
    </section>
  );
}

function DashboardMockup() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/40" />
      </div>
      <div className="grid grid-cols-1 gap-3 p-5 text-left sm:grid-cols-3">
        {[
          { label: "Total Revenue", value: "$142,800", change: "18.4%", up: true },
          { label: "Monthly Revenue", value: "$44,300", change: "12.7%", up: true },
          { label: "Active Deals", value: "7", change: "1%", up: false },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-xl font-bold">{s.value}</p>
            <p className={`mt-1 text-xs font-medium ${s.up ? "text-success" : "text-destructive"}`}>{s.up ? "↗" : "↘"} {s.change}</p>
          </div>
        ))}
        <div className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">Revenue Trends</p>
          <svg viewBox="0 0 200 60" className="mt-3 h-16 w-full">
            <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2.5" points="0,45 30,35 60,38 90,20 120,25 150,10 200,5" />
          </svg>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Revenue Split</p>
          <div className="mt-3 space-y-2">
            {[["Brand Deals", 62], ["AdSense", 21], ["Memberships", 10]].map(([label, pct]) => (
              <div key={label as string}>
                <div className="flex justify-between text-[11px] text-muted-foreground"><span>{label}</span><span>{pct}%</span></div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-accent">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProblemSection() {
  const items = [
    { icon: TrendingUp, title: "Views, not revenue clarity", desc: "YouTube Studio shows watch time. It doesn't show which video actually paid your rent." },
    { icon: MessageSquare, title: "Comments pile up", desc: "Every \"link please?\" and dropped @handle is a lead — most creators never reply in time." },
    { icon: DollarSign, title: "Deals live in spreadsheets", desc: "Brand deals, affiliate payouts, and memberships tracked in five different tools." },
  ];
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
        YouTube Studio wasn't built<br className="hidden sm:block" /> to run your business.
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.title} className="rounded-xl border-2 border-foreground/10 bg-white p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <it.icon className="h-5 w-5" />
            </span>
            <p className="mt-4 font-semibold">{it.title}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{it.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductShowcase() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 text-center">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Product</span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Turn your inbox of comments into a pipeline of leads.</h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        Every comment, every tracked link, every brand deal — in one dashboard instead of five browser tabs.
      </p>
      <div className="mt-10 rounded-xl border-2 border-foreground/10 bg-white p-3">
        <DashboardMockup />
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Youtube, title: "Connect your channel", desc: "Sync videos, analytics, and revenue in a few minutes — no spreadsheets required." },
    { icon: Sparkles, title: "AI writes descriptions & tracked links", desc: "Paste a URL. Tubify transcribes it, writes the description, and injects your tracked links automatically." },
    { icon: MessageSquare, title: "Comment automation finds your leads", desc: "Auto-reply to keyword comments, dropped @handles, and AI-detected questions — every trigger creates a lead." },
    { icon: DollarSign, title: "Track revenue across every stream", desc: "AdSense, brand deals, memberships, affiliates — attributed down to the video, in one dashboard." },
  ];
  return (
    <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">How Tubify works</h2>
      <p className="mt-3 text-center text-muted-foreground">Simple enough to start today. Structured enough to grow into.</p>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-xl border-2 border-foreground/10 bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="h-4 w-4" /></span>
            </div>
            <p className="mt-4 font-semibold">{s.title}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BuiltForCreators() {
  const rows = [
    { name: "Alex Chen", role: "Owner", leads: 128, revenue: "$44,300" },
    { name: "Jamie Rivera", role: "Setter", leads: 96, revenue: "$18,200" },
    { name: "Sam Patel", role: "Setter", leads: 61, revenue: "$9,600" },
  ];
  return (
    <section className="bg-foreground py-20 text-background">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Built for creators who run a real business.</h2>
        <p className="mx-auto mt-3 max-w-xl text-background/60">
          Invite editors and setters, split lead distribution by percentage, and see who's actually driving revenue.
        </p>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.name} className="rounded-lg border-2 border-white/10 bg-white/5 p-5">
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-background/50">{r.role}</p>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-background/40">Leads</p>
                  <p className="mt-0.5 font-semibold text-background/80">{r.leads}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wide text-background/40">Revenue</p>
                  <p className="mt-0.5 font-semibold text-success">{r.revenue}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const stats = [
    { value: "$48.2M+", label: "Revenue tracked" },
    { value: "12,400+", label: "Videos synced" },
    { value: "3,100+", label: "Creators onboard" },
    { value: "34%", label: "Avg. revenue lift" },
  ];
  return (
    <section id="stats" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Revenue tracked so far</h2>
      <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border-2 border-foreground/10 bg-white p-6 text-center">
            <p className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const faqs = [
  { q: "Do I need to connect my YouTube channel to get started?", a: "You can explore the dashboard with sample data first. Connecting your channel unlocks real analytics, revenue attribution, and comment automation." },
  { q: "How does comment automation work?", a: "You set trigger rules — keywords, @handle patterns, or AI-detected questions — and Tubify auto-replies and logs the commenter as a lead, all within your YouTube API quota." },
  { q: "Is my revenue data accurate?", a: "YouTube Analytics typically lags 24–72 hours and revenue ~48 hours. Click and Stripe attribution are real-time, which is why we show both feeds separately." },
  { q: "Can I track brand deals and affiliate revenue too?", a: "Yes — Brand Deals has a full pipeline board (Prospect → Completed), and Affiliate tracks referrals and commissions alongside your AdSense and membership revenue." },
  { q: "Does this replace YouTube Studio?", a: "No — Tubify reads from YouTube's API and layers revenue attribution, automation, and team collaboration on top. You'll still upload and manage videos in Studio." },
  { q: "What if I work with a team?", a: "Invite editors and setters from the Team page, assign roles, and split incoming leads by percentage so everyone knows what's theirs." },
];

function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">FAQ</span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">Frequently Asked Questions</h2>
      <Accordion type="single" collapsible className="mt-8 rounded-xl border-2 border-foreground/10 bg-white px-2">
        {faqs.map((f, i) => (
          <AccordionItem key={i} value={`item-${i}`} className="last:border-0">
            <AccordionTrigger className="px-4 text-left text-sm font-medium hover:no-underline">{f.q}</AccordionTrigger>
            <AccordionContent className="px-4 text-sm text-muted-foreground">{f.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function ContactSection() {
  const [, setTickets] = useSupportTickets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return toast.error("Please fill in every field");
    const today = new Date().toISOString().slice(0, 10);
    setTickets((prev) => [
      {
        id: uid(),
        subject: message.length > 60 ? `${message.slice(0, 57)}…` : message,
        message,
        org: "Not signed in",
        requester: name,
        email,
        priority: "Medium",
        status: "Open",
        source: "Landing Page",
        created: today,
        lastReply: today,
      },
      ...prev,
    ]);
    setSent(true);
    toast.success("Thanks — we got it!", { description: "Someone from the Tubify team will follow up by email." });
  };

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 py-16">
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <LifeBuoy className="h-3.5 w-3.5" /> Contact
      </span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">Found a problem? Have a question?</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        Tell us what's going on — this goes straight to the Tubify team, whether or not you have an account yet.
      </p>

      <div className="mt-8 rounded-xl border-2 border-foreground/10 bg-white p-6 sm:p-8">
        {sent ? (
          <div className="py-6 text-center">
            <p className="font-semibold">Message sent.</p>
            <p className="mt-1 text-sm text-muted-foreground">We'll get back to you at {email}.</p>
            <button onClick={() => { setSent(false); setName(""); setEmail(""); setMessage(""); }} className="mt-4 text-sm font-medium text-primary hover:underline">
              Send another message
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="h-11 w-full rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 w-full rounded-lg border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">What's going on?</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} className="w-full rounded-lg border border-border bg-accent/10 px-3 py-2.5 text-sm outline-none focus:border-primary" />
            </div>
            <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Send className="h-4 w-4" /> Send Message
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16">
      <div className="rounded-xl bg-primary p-10 text-center text-primary-foreground sm:p-14">
        <img src="/tubi.png" alt="" className="pointer-events-none mx-auto h-16 w-16 object-contain opacity-95" />
        <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">You already grew an audience.<br />Now let's grow the revenue.</h2>
        <p className="mx-auto mt-3 max-w-md text-primary-foreground/80">Free to start. Connect your channel in minutes.</p>
        <Link to="/dashboard" className="mt-7 inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-primary hover:bg-white/90">
          Get Started Free <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function FooterSection() {
  const columns = [
    { title: "Features", links: ["AI Descriptions", "Comment Automation", "Link Tracking", "Analytics", "Team Collaboration"] },
    { title: "Data Hub", links: ["Revenue Attribution", "Brand Deals", "Affiliate", "YouTube Sync"] },
    { title: "Resources", links: ["Changelog", "Roadmap", "Docs", "Blog"] },
  ];
  return (
    <footer className="relative overflow-hidden bg-foreground text-background">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-brand-amber to-brand-purple" />
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 pb-16 pt-16 sm:grid-cols-5">
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Tubify" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold">Tubify</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-background/60">
            Turn your YouTube channel into a predictable revenue engine.
          </p>
          <div className="mt-4 flex items-center gap-3 text-background/60">
            <Youtube className="h-4 w-4" />
            <Link2 className="h-4 w-4" />
          </div>
        </div>
        {columns.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l}><a href="#" className="flex items-center gap-1 text-sm text-background/60 hover:text-background">{l}</a></li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="text-sm font-semibold">Contact</p>
          <p className="mt-3 text-sm text-background/60">hey@tubify.app</p>
          <a href="#contact" className="mt-2 inline-block text-sm text-background/60 hover:text-background">Report a problem →</a>
        </div>
      </div>
      <div className="border-t border-white/10 px-6 py-5 text-center text-xs text-background/40">
        © 2026 Tubify. All rights reserved.
      </div>
    </footer>
  );
}
