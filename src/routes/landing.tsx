import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion, useMotionValue, animate } from "motion/react";
import {
  ArrowRight, Play, Youtube, Twitter, Instagram, Music2, MessageSquare, Link2, DollarSign, Sparkles, TrendingUp, Send, LifeBuoy,
  ChevronDown, BarChart3, Users2, LayoutDashboard, Radio, Megaphone, Bot, Settings, Search, User, MousePointer2, Bell, Menu, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer,
} from "recharts";
import { useSupportTickets, useSiteContent } from "@/lib/stores";
import { uid } from "@/lib/local-store";
import { ThreeDMarquee } from "@/components/ui/3d-marquee";

export const Route = createFileRoute("/landing")({
  component: Landing,
});

function Landing() {
  const [content] = useSiteContent();
  useEffect(() => {
    document.title = `${content.siteName} — ${content.tagline}`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", content.seoDescription);
  }, [content.siteName, content.tagline, content.seoDescription]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        className="relative z-0 overflow-hidden"
        style={{ background: "radial-gradient(circle at 22% 20%, #0a1420 0%, #0a1420 45%, #060b12 100%)" }}
      >
        <div
          aria-hidden="true"
          className="hero-glow-aurora pointer-events-none -z-10"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent) 0%, transparent 70%)" }}
        />
        <div
          aria-hidden="true"
          className="hero-glow-aurora hero-glow-aurora--secondary pointer-events-none -z-10"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 45%, transparent) 0%, transparent 70%)" }}
        />
        <div className="pointer-events-none absolute -top-24 right-[-4rem] -z-10 h-80 w-80 rounded-full bg-brand-amber/10 blur-3xl" />
        <div className="pointer-events-none absolute -top-16 left-[-6rem] -z-10 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <NavBar />
        <Hero />
      </div>
      <ProblemSection />
      <ProductShowcase />
      <HowItWorks />
      <BuiltForCreators />
      <FaqSection />
      <ContactSection />
      <ContentMarqueeSection />
      <FinalCta />
      <FooterSection />
    </div>
  );
}

const NAV_DESTINATIONS: { label: string; href?: string; to?: string }[] = [
  { label: "Home", href: "#" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Product Showcase", href: "#product" },
  { label: "Changelog", to: "/changelog" },
  { label: "Roadmap", to: "/roadmap" },
  { label: "Support", to: "/support" },
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "#contact" },
  { label: "Log In", to: "/" },
];

function NavBar() {
  const [content] = useSiteContent();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const goTo = (dest: { href?: string; to?: string }) => {
    setMobileMenuOpen(false);
    if (dest.to) {
      navigate({ to: dest.to });
    } else if (dest.href) {
      if (dest.href === "#") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        document.querySelector(dest.href)?.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  return (
    <header className="relative z-30">
      {/* Reserves the pill's normal-flow space so Hero isn't pulled up underneath it — the pill
          itself is `fixed`, not `sticky`, so it's the only piece that stays put on scroll; this
          spacer and everything else (including the dark gradient behind it) scrolls normally. */}
      <div className="h-24" aria-hidden="true" />

      {/* Dimmed, blurred backdrop behind the expanded mobile menu — closes it on click. Sits below
          the nav bar's own z-30 so the bar (and its expanded content) stay on top of the dimming. */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 backdrop-blur-sm md:hidden"
          aria-hidden="true"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* The mobile menu is rendered as part of THIS same element (not a separate floating card)
          so it reads as the nav pill extending downward, matching the reference: a fixed 2rem
          corner radius (visually identical to rounded-full at h-16, but stays constant instead of
          ballooning into a stadium shape once the box grows taller with the menu open). */}
      <div
        className="nav-glow-motion fixed inset-x-4 top-4 z-30 mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 shadow-xl backdrop-blur-xl"
        style={{
          background:
            "radial-gradient(circle at 22% 40%, color-mix(in srgb, color-mix(in srgb, var(--primary) 45%, #0a1420) 80%, transparent) 0%, color-mix(in srgb, #0a1420 80%, transparent) 55%, color-mix(in srgb, #060b12 80%, transparent) 100%)",
        }}
      >
        <div className="flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <img src={content.logoLightUrl} alt={content.siteName} className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold tracking-tight text-white">{content.siteName}</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-white/70 md:flex">
            <a href="#" className="border-b-2 border-primary pb-1 text-white">Home</a>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 outline-none hover:text-white">
                Features <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild><a href="#how-it-works">How It Works</a></DropdownMenuItem>
                <DropdownMenuItem asChild><a href="#product">Product Showcase</a></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 outline-none hover:text-white">
                Resources <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild><Link to="/changelog">Changelog</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/roadmap">Roadmap</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/support">Support</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <a href="#contact" className="hover:text-white">Contact</a>
            <Link to="/changelog" className="hover:text-white">Changelog</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/" className="hidden items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm font-medium text-white/80 hover:text-white sm:flex">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30"><User className="h-3 w-3" /></span>
              Log In
            </Link>
            <Link to="/dashboard" className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 md:inline-flex">Get Started</Link>

            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white outline-none md:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="flex flex-col gap-5 px-6 pb-6 pt-1 text-base font-medium text-white/90 md:hidden">
            {NAV_DESTINATIONS.filter((d) => d.label !== "Log In").map((dest) =>
              dest.to ? (
                <Link key={dest.label} to={dest.to} onClick={() => setMobileMenuOpen(false)} className="hover:text-white">
                  {dest.label}
                </Link>
              ) : (
                <a
                  key={dest.label}
                  href={dest.href}
                  onClick={(e) => {
                    if (dest.href && dest.href !== "#") {
                      e.preventDefault();
                      goTo(dest);
                    } else {
                      setMobileMenuOpen(false);
                    }
                  }}
                  className="hover:text-white"
                >
                  {dest.label}
                </a>
              )
            )}
            <Link to="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-1.5 hover:text-white">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30"><User className="h-3 w-3" /></span>
              Log In
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

function useTypewriter(text: string, speed = 45) {
  const [displayed, setDisplayed] = useState(text);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(text);
      return;
    }
    setDisplayed("");
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return displayed;
}

function Hero() {
  const [content] = useSiteContent();
  const typedHeadline = useTypewriter(content.heroHeadline);
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16 pt-14">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div className="text-center lg:text-left">
          <h1
            className="text-5xl font-extrabold tracking-tight text-white sm:text-6xl"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            <span aria-hidden="true">
              {typedHeadline}
              <span className="typewriter-cursor" />
            </span>
            <span className="sr-only">{content.heroHeadline}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-lg text-white/60 lg:mx-0">
            {content.heroSubheadline}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Link
              to="/dashboard"
              className="nav-glow-motion relative flex h-12 items-center gap-2 rounded-full border border-white/10 bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-xl transition-transform hover:scale-[1.02] hover:bg-primary/90"
            >
              {content.heroPrimaryCta} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/dashboard"
              className="nav-glow-motion relative flex h-12 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur-xl transition-transform hover:scale-[1.02] hover:bg-white/15"
            >
              <Play className="h-4 w-4" /> {content.heroSecondaryCta}
            </Link>
          </div>
        </div>

        <HeroDeviceShowcase />
      </div>
    </section>
  );
}

const MOCKUP_NAV = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Analytics", icon: BarChart3 },
  { label: "Revenue", icon: DollarSign },
  { label: "Content", icon: Play },
  { label: "Audience", icon: Users2 },
  { label: "Real Time", icon: Radio },
  { label: "Campaigns", icon: Megaphone },
  { label: "AI Assistant", icon: Bot },
  { label: "Link Tracker", icon: Link2 },
  { label: "Settings", icon: Settings },
];

const MOCKUP_STATS = [
  { label: "Estimated Revenue", value: "$12,540.80", change: "18.6%" },
  { label: "RPM", value: "$4.72", change: "7.3%" },
  { label: "Views", value: "2.65M", change: "12.5%" },
  { label: "Subscribers", value: "+18.7K", change: "8.9%" },
];

const MOCKUP_REVENUE_TREND = [
  { day: "Jun 12", value: 800 }, { day: "Jun 19", value: 1050 }, { day: "Jun 26", value: 780 },
  { day: "Jul 03", value: 1200 }, { day: "Jul 10", value: 950 },
];

const MOCKUP_TRAFFIC = [
  { label: "YouTube Search", pct: 41, color: "var(--color-primary)" },
  { label: "Suggested Videos", pct: 31, color: "var(--color-brand-purple)" },
  { label: "Browse Features", pct: 16, color: "var(--color-brand-blue)" },
  { label: "External", pct: 7, color: "var(--color-brand-amber)" },
  { label: "Others", pct: 5, color: "var(--color-muted-foreground)" },
];

const MOCKUP_VIDEOS = [
  { title: "10 Ways to Grow on YouTube in 2024", views: "312.6K", revenue: "$1,245.80" },
  { title: "My Studio Setup for High Quality Videos", views: "210.4K", revenue: "$842.65" },
  { title: "How I Make $10K/Month on YouTube", views: "180.7K", revenue: "$715.20" },
];

function DashboardMockup() {
  const gradientId = useId();
  return (
    <div className="flex overflow-hidden rounded-[var(--card-radius)] border border-border bg-background text-left">
      <div className="hidden w-36 shrink-0 border-r border-border bg-card p-3 sm:block">
        <div className="flex items-center gap-1.5 px-1">
          <Youtube className="h-3.5 w-3.5 text-brand-red" />
          <span className="text-[11px] font-bold">Tubify</span>
        </div>
        <div className="mt-4 space-y-0.5">
          {MOCKUP_NAV.map((n) => (
            <div key={n.label} className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium ${n.active ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
              <n.icon className="h-3 w-3 shrink-0" /> <span className="truncate">{n.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Dashboard Overview</p>
          <span className="rounded-md border border-border px-2 py-0.5 text-[9px] text-muted-foreground">Jun 12 – Jul 12</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {MOCKUP_STATS.map((s) => (
            <div key={s.label} className="rounded-[var(--card-radius)] border border-border bg-card p-2.5">
              <p className="text-[9px] text-muted-foreground">{s.label}</p>
              <p className="mt-0.5 text-sm font-bold">{s.value}</p>
              <p className="mt-0.5 text-[9px] font-medium text-success">↗ {s.change}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="col-span-2 rounded-[var(--card-radius)] border border-border bg-card p-2.5">
            <p className="text-[9px] font-medium text-muted-foreground">Revenue Over Time</p>
            <div className="mt-1 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCKUP_REVENUE_TREND}>
                  <defs>
                    <linearGradient id={`${gradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} fill={`url(#${gradientId}-revenue)`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-[var(--card-radius)] border border-border bg-card p-2.5">
            <p className="text-[9px] font-medium text-muted-foreground">Traffic Sources</p>
            <div className="mt-1 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={MOCKUP_TRAFFIC} dataKey="pct" nameKey="label" innerRadius="55%" outerRadius="100%" strokeWidth={1}>
                    {MOCKUP_TRAFFIC.map((t) => <Cell key={t.label} fill={t.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-[var(--card-radius)] border border-border bg-card p-2.5">
          <p className="text-[9px] font-medium text-muted-foreground">Top Performing Videos</p>
          <div className="mt-1.5 space-y-1.5">
            {MOCKUP_VIDEOS.map((v) => (
              <div key={v.title} className="flex items-center justify-between gap-2 text-[9px]">
                <span className="min-w-0 flex-1 truncate font-medium">{v.title}</span>
                <span className="shrink-0 text-muted-foreground">{v.views}</span>
                <span className="shrink-0 font-semibold text-success">{v.revenue}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FLOATING_SPARK = [4, 6, 5, 8, 7, 9, 11, 10, 13, 12, 15].map((v, i) => ({ i, v }));

function FloatingStatCard() {
  const gradientId = useId();
  return (
    <div className="absolute -bottom-8 -right-4 hidden w-44 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-3 shadow-xl sm:block">
      <p className="text-[9px] text-muted-foreground">Estimated Revenue</p>
      <p className="mt-0.5 text-sm font-bold">$12,540.80</p>
      <p className="mt-0.5 text-[9px] font-medium text-success">↗ 18.6% vs last 30 days</p>
      <div className="mt-1.5 h-7">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={FLOATING_SPARK}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke="var(--color-primary)" strokeWidth={2} fill={`url(#${gradientId})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <button className="mt-1.5 w-full rounded-[var(--button-radius)] bg-primary px-2 py-1.5 text-[10px] font-semibold text-primary-foreground">View Full Analytics</button>
      <div className="mt-2 border-t border-border pt-1.5">
        <p className="text-[9px] text-muted-foreground">Realtime</p>
        <p className="text-xs font-bold">48,230 <span className="text-[9px] font-normal text-muted-foreground">Views · 48h</span></p>
      </div>
    </div>
  );
}

// ============ HERO DASHBOARD DEMO (scripted cursor walkthrough) ============
// Simulates a person actually using the product behind the hero copy: a cursor drifts between
// sidebar sections, clicks trigger a content swap + chart redraw, and it settles back on Overview
// before looping. Framer Motion values drive the cursor's x/y/scale/opacity directly (no React
// state per frame) so the whole thing stays on the compositor at 60fps. Entirely separate from the
// static <DashboardMockup />/<FloatingStatCard /> used by ProductShowcase further down the page,
// which stay untouched.

type DemoSection = "Overview" | "Analytics" | "Revenue" | "Audience" | "Content";

const DEMO_SECTION_CONTENT: Record<DemoSection, { heading: string; stats: typeof MOCKUP_STATS; trend: typeof MOCKUP_REVENUE_TREND }> = {
  Overview: { heading: "Dashboard Overview", stats: MOCKUP_STATS, trend: MOCKUP_REVENUE_TREND },
  Analytics: {
    heading: "Analytics Overview",
    stats: [
      { label: "Watch Time", value: "482K hrs", change: "9.4%" },
      { label: "Avg. Duration", value: "6:42", change: "3.1%" },
      { label: "CTR", value: "5.8%", change: "1.2%" },
      { label: "Impressions", value: "9.2M", change: "14.7%" },
    ],
    trend: [{ day: "Jun 12", value: 600 }, { day: "Jun 19", value: 900 }, { day: "Jun 26", value: 1100 }, { day: "Jul 03", value: 850 }, { day: "Jul 10", value: 1300 }],
  },
  Revenue: {
    heading: "Revenue Overview",
    stats: [
      { label: "Ad Revenue", value: "$8,120.40", change: "11.2%" },
      { label: "Sponsorships", value: "$3,400.00", change: "22.0%" },
      { label: "Affiliate", value: "$920.15", change: "4.6%" },
      { label: "RPM", value: "$5.10", change: "6.8%" },
    ],
    trend: [{ day: "Jun 12", value: 1000 }, { day: "Jun 19", value: 1250 }, { day: "Jun 26", value: 1180 }, { day: "Jul 03", value: 1450 }, { day: "Jul 10", value: 1600 }],
  },
  Audience: {
    heading: "Audience Overview",
    stats: [
      { label: "Subscribers", value: "+18.7K", change: "8.9%" },
      { label: "Returning Viewers", value: "64%", change: "3.4%" },
      { label: "New Viewers", value: "36%", change: "2.1%" },
      { label: "Top Region", value: "US · 38%", change: "1.1%" },
    ],
    trend: [{ day: "Jun 12", value: 700 }, { day: "Jun 19", value: 820 }, { day: "Jun 26", value: 940 }, { day: "Jul 03", value: 880 }, { day: "Jul 10", value: 1020 }],
  },
  Content: {
    heading: "Content Overview",
    stats: [
      { label: "Videos Published", value: "7", change: "2.4%" },
      { label: "Total Views", value: "2.65M", change: "12.5%" },
      { label: "Likes", value: "91.4K", change: "9.7%" },
      { label: "Comments", value: "3.2K", change: "5.3%" },
    ],
    trend: [{ day: "Jun 12", value: 900 }, { day: "Jun 19", value: 1000 }, { day: "Jun 26", value: 850 }, { day: "Jul 03", value: 1150 }, { day: "Jul 10", value: 1050 }],
  },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitterWait = () => wait(500 + Math.random() * 1000);

const PHONE_TABS = MOCKUP_NAV.filter((n) => n.label in DEMO_SECTION_CONTENT) as { label: DemoSection; icon: typeof Youtube }[];

// Measures an element's rendered width reactively (ResizeObserver), so the SVG device frames'
// screen-cutout regions below can be positioned in real pixels rather than CSS percentages. A
// percentage `height` on an absolutely-positioned, `overflow-hidden` child of an auto-height
// parent triggers a genuine Chromium layout bug (the parent inflates to an unrelated size) —
// confirmed by isolated testing. Pixel values computed from a single observed width sidestep it
// entirely, and sidestep the SVG's own (possibly slow, ~10MB) image-decode/load timing too, since
// height is derived from the SVG's known intrinsic aspect ratio rather than measured post-load.
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// Screen-cutout regions as fractions of each SVG's own viewBox, measured directly from the
// artwork's alpha channel (the transparent cutout where the live dashboard shows through) rather
// than eyeballed — see the macbook-pro.svg / iphone-16-pro.svg viewBox vs. the embedded raster's
// transparent region for how these were derived.
const MACBOOK_VB = { w: 2170, h: 1430 };
const MACBOOK_SCREEN = { left: 0.10161, top: 0.10909, width: 0.79654, height: 0.78147 };
const IPHONE_VB = { w: 490, h: 992 };
const IPHONE_SCREEN = { left: 0.08095, top: 0.01983, width: 0.87823, height: 0.93985 };

// ============ HERO DEVICE SHOWCASE (laptop + phone, orchestrated together) ============
// One shared `activeSection` state feeds both device screens so they always agree on what
// they're displaying — realism comes from alternating WHICH device's pointer performs the
// interaction that changes it (laptop cursor vs. phone tap), with a `focus` state gently
// dimming/scaling whichever device isn't currently "in use". Everything pointer/tap-driven
// runs off Framer Motion values (never React state per frame), so it stays compositor-only.
function HeroDeviceShowcase() {
  const gradientId = useId();
  const mGradientId = useId();
  const laptopScreenRef = useRef<HTMLDivElement>(null);
  const phoneScreenRef = useRef<HTMLDivElement>(null);
  const navRefs = useRef<Partial<Record<DemoSection, HTMLDivElement | null>>>({});
  const tabRefs = useRef<Partial<Record<DemoSection, HTMLDivElement | null>>>({});
  const statCardRef = useRef<HTMLDivElement>(null);
  const [laptopWrapRef, laptopWidth] = useElementWidth<HTMLDivElement>();
  const laptopHeight = laptopWidth * (MACBOOK_VB.h / MACBOOK_VB.w);
  const [phoneWrapRef, phoneWidth] = useElementWidth<HTMLDivElement>();
  const phoneHeight = phoneWidth * (IPHONE_VB.h / IPHONE_VB.w);

  const cursorX = useMotionValue(190);
  const cursorY = useMotionValue(20);
  const cursorScale = useMotionValue(1);
  const cursorOpacity = useMotionValue(0);
  const phoneScrollY = useMotionValue(0);

  const [activeSection, setActiveSection] = useState<DemoSection>("Overview");
  const [hoveredNav, setHoveredNav] = useState<DemoSection | null>(null);
  const [cardElevated, setCardElevated] = useState(false);
  const [focus, setFocus] = useState<"laptop" | "phone">("laptop");
  const [pressedTab, setPressedTab] = useState<DemoSection | null>(null);
  const [laptopRipple, setLaptopRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const [phoneRipple, setPhoneRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    if (!laptopRipple) return;
    const t = setTimeout(() => setLaptopRipple(null), 550);
    return () => clearTimeout(t);
  }, [laptopRipple]);

  useEffect(() => {
    if (!phoneRipple) return;
    const t = setTimeout(() => setPhoneRipple(null), 550);
    return () => clearTimeout(t);
  }, [phoneRipple]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;

    const moveCursorTo = async (el: HTMLElement | null) => {
      const container = laptopScreenRef.current;
      if (!el || !container || cancelled) return;
      const c = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const endX = r.left - c.left + r.width * 0.35;
      const endY = r.top - c.top + r.height * 0.5;
      const startX = cursorX.get();
      const startY = cursorY.get();
      const midX = (startX + endX) / 2 + (Math.random() - 0.5) * 50;
      const midY = (startY + endY) / 2 + (Math.random() - 0.5) * 50;
      const duration = 0.75 + Math.random() * 0.4;
      await Promise.all([
        animate(cursorX, [startX, midX, endX], { duration, times: [0, 0.5, 1], ease: ["easeOut", "easeInOut"] }),
        animate(cursorY, [startY, midY, endY], { duration, times: [0, 0.5, 1], ease: ["easeOut", "easeInOut"] }),
      ]);
    };

    const pressCursor = async (onActivate?: () => void) => {
      if (cancelled) return;
      await animate(cursorScale, 0.8, { duration: 0.09 });
      setLaptopRipple({ x: cursorX.get(), y: cursorY.get(), id: Date.now() });
      onActivate?.();
      await animate(cursorScale, 1, { duration: 0.18, ease: "easeOut" });
    };

    const clickLaptopNav = async (section: DemoSection) => {
      await moveCursorTo(navRefs.current[section] ?? null);
      if (cancelled) return;
      setHoveredNav(section);
      await jitterWait();
      if (cancelled) return;
      await pressCursor(() => setActiveSection(section));
      await jitterWait();
    };

    const tapPhoneTab = async (section: DemoSection) => {
      const tabEl = tabRefs.current[section];
      const container = phoneScreenRef.current;
      if (!tabEl || !container || cancelled) return;
      const c = container.getBoundingClientRect();
      const r = tabEl.getBoundingClientRect();
      const x = r.left - c.left + r.width / 2;
      const y = r.top - c.top + r.height / 2;
      setPressedTab(section);
      setPhoneRipple({ x, y, id: Date.now() });
      setActiveSection(section);
      await wait(160);
      if (cancelled) return;
      setPressedTab(null);
      await animate(phoneScrollY, -14, { duration: 0.35, ease: "easeOut" });
      await wait(300);
      if (cancelled) return;
      await animate(phoneScrollY, 0, { duration: 0.35, ease: "easeIn" });
      await jitterWait();
    };

    async function run() {
      while (!cancelled) {
        cursorOpacity.set(0);
        cursorX.set(190);
        cursorY.set(20);
        setActiveSection("Overview");
        setFocus("laptop");
        await wait(600);
        if (cancelled) return;
        await animate(cursorOpacity, 1, { duration: 0.4 });

        await clickLaptopNav("Analytics");
        await clickLaptopNav("Revenue");

        await moveCursorTo(statCardRef.current);
        if (cancelled) return;
        setCardElevated(true);
        await wait(650);
        setCardElevated(false);
        await jitterWait();

        if (cancelled) return;
        await animate(cursorOpacity, 0, { duration: 0.4 });
        setFocus("phone");
        await wait(350);

        await tapPhoneTab("Audience");
        await tapPhoneTab("Content");

        setFocus("laptop");
        await wait(350);
        if (cancelled) return;
        cursorX.set(190);
        cursorY.set(20);
        await animate(cursorOpacity, 1, { duration: 0.4 });

        await clickLaptopNav("Overview");
        await wait(500);

        if (cancelled) return;
        await animate(cursorOpacity, 0, { duration: 0.5 });
        setFocus("laptop");
        await wait(500);
      }
    }
    run();

    return () => {
      cancelled = true;
    };
  }, []);

  const current = DEMO_SECTION_CONTENT[activeSection];

  return (
    <div className="relative mx-auto max-w-[300px] pb-10 pr-6 sm:max-w-none sm:pb-20 sm:pr-16">
      {/* Laptop — SVG hardware frame (decorative, pointer-events:none, z-20) sits above the live
          dashboard; the dashboard renders in a plain absolutely-positioned div sized in real
          pixels (not CSS %) to the SVG's screen cutout, computed from the wrapper's observed
          width via useElementWidth (see comment above the hook for why not percentages). Sized
          down on mobile (max-w-[300px] on the outer wrapper above) so the whole composition reads
          as compact rather than dominating the first screen; scales back up to its full size from
          sm: up. */}
      <div ref={laptopWrapRef} className="relative mx-auto w-full sm:max-w-[560px]" style={{ perspective: "1800px" }}>
        <div style={{ transform: "rotateX(6deg) rotateY(-8deg)", transformStyle: "preserve-3d" }}>
          <div className={`transition-transform duration-500 ease-out ${focus === "phone" ? "scale-[0.98]" : "scale-100"}`}>
            <div
              className="relative"
              style={{ filter: "drop-shadow(0 20px 60px rgba(0,0,0,.18)) drop-shadow(0 60px 120px rgba(0,0,0,.10))" }}
            >
              <div
                ref={laptopScreenRef}
                className="absolute overflow-hidden bg-white"
                style={{
                  left: laptopWidth * MACBOOK_SCREEN.left,
                  top: laptopHeight * MACBOOK_SCREEN.top,
                  width: laptopWidth * MACBOOK_SCREEN.width,
                  height: laptopHeight * MACBOOK_SCREEN.height,
                }}
              >
                <div className="flex h-full text-left">
                  <div className="hidden w-[86px] shrink-0 flex-col border-r border-border/70 bg-white p-2 sm:flex">
                    <div className="flex items-center gap-1.5 px-0.5">
                      <Youtube className="h-3 w-3 text-brand-red" />
                      <span className="text-[9px] font-bold tracking-tight">Tubify</span>
                    </div>
                    <div className="mt-3 space-y-0.5">
                      {MOCKUP_NAV.map((n) => {
                        const section = n.label as DemoSection;
                        const isDemoTarget = section in DEMO_SECTION_CONTENT;
                        const isActive = isDemoTarget && section === activeSection;
                        const isHovered = isDemoTarget && section === hoveredNav && !isActive;
                        return (
                          <div
                            key={n.label}
                            ref={isDemoTarget ? (el) => { navRefs.current[section] = el; } : undefined}
                            className={`flex items-center gap-1.5 rounded-md border-l-2 px-1 py-1 text-[7px] font-medium transition-colors duration-200 ${
                              isActive
                                ? "border-primary bg-primary/10 text-primary"
                                : isHovered
                                  ? "border-transparent bg-accent text-foreground"
                                  : "border-transparent text-muted-foreground"
                            }`}
                          >
                            <n.icon className="h-2.5 w-2.5 shrink-0" /> <span className="truncate">{n.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1 bg-muted p-3">
                    <div className="flex items-center justify-between gap-2">
                      <motion.p key={`heading-${activeSection}`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="min-w-0 truncate text-[11px] font-bold tracking-tight text-foreground">
                        {current.heading}
                      </motion.p>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="hidden h-4 w-4 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground sm:flex"><Search className="h-2 w-2" /></span>
                        <span className="hidden h-4 w-4 items-center justify-center rounded-md border border-border/70 bg-white text-muted-foreground sm:flex"><Bell className="h-2 w-2" /></span>
                        <span className="whitespace-nowrap rounded-md border border-border/70 bg-white px-1.5 py-0.5 text-[6.5px] font-medium text-muted-foreground">Jun 12 – Jul 12</span>
                      </div>
                    </div>

                    <motion.div key={`stats-${activeSection}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="mt-2 grid grid-cols-2 gap-2">
                      {current.stats.map((s, i) => (
                        <div
                          key={s.label}
                          ref={i === 0 ? statCardRef : undefined}
                          className={`overflow-hidden rounded-lg border border-border/70 bg-white p-2 shadow-sm transition-all duration-300 ${i === 0 && cardElevated ? "-translate-y-0.5 border-primary/30 shadow-md" : ""}`}
                        >
                          <p className="truncate text-[6px] font-semibold uppercase tracking-wide text-muted-foreground/80">{s.label}</p>
                          <p className="mt-1 truncate text-[12px] font-bold leading-none text-foreground">{s.value}</p>
                          <span className="mt-1 inline-flex items-center rounded-full bg-success/10 px-1 py-[1px] text-[5.5px] font-semibold text-success">↗ {s.change}</span>
                        </div>
                      ))}
                    </motion.div>

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div className="col-span-2 overflow-hidden rounded-lg border border-border/70 bg-white p-2 shadow-sm">
                        <p className="truncate text-[6px] font-semibold uppercase tracking-wide text-muted-foreground/80">Revenue Over Time</p>
                        <div className="mt-1 h-9">
                          <ResponsiveContainer key={`trend-${activeSection}`} width="100%" height="100%">
                            <AreaChart data={current.trend}>
                              <defs>
                                <linearGradient id={`${gradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <Area type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} fill={`url(#${gradientId}-revenue)`} isAnimationActive animationDuration={450} animationEasing="ease-out" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-lg border border-border/70 bg-white p-2 shadow-sm">
                        <p className="truncate text-[6px] font-semibold uppercase tracking-wide text-muted-foreground/80">Traffic Sources</p>
                        <div className="mt-1 h-9">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={MOCKUP_TRAFFIC} dataKey="pct" nameKey="label" innerRadius="55%" outerRadius="100%" strokeWidth={1}>
                                {MOCKUP_TRAFFIC.map((t) => <Cell key={t.label} fill={t.color} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 overflow-hidden rounded-lg border border-border/70 bg-white p-2 shadow-sm">
                      <p className="truncate text-[6px] font-semibold uppercase tracking-wide text-muted-foreground/80">Top Performing Videos</p>
                      <div className="mt-1 divide-y divide-border/60">
                        {MOCKUP_VIDEOS.slice(0, 2).map((v) => (
                          <div key={v.title} className="flex items-center justify-between gap-2 py-1 text-[7px] first:pt-0 last:pb-0">
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{v.title}</span>
                            <span className="shrink-0 text-muted-foreground">{v.views}</span>
                            <span className="shrink-0 font-semibold text-success">{v.revenue}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Scripted laptop cursor + click ripple — invisible under prefers-reduced-motion since cursorOpacity never leaves 0 */}
                <motion.div aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-50" style={{ x: cursorX, y: cursorY, scale: cursorScale, opacity: cursorOpacity }}>
                  <MousePointer2 className="h-4 w-4 fill-white text-foreground drop-shadow-md" />
                </motion.div>
                {laptopRipple && (
                  <motion.span
                    key={laptopRipple.id}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 z-40 h-6 w-6 rounded-full bg-primary/40"
                    style={{ x: laptopRipple.x - 12, y: laptopRipple.y - 12 }}
                    initial={{ scale: 0.2, opacity: 0.6 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                )}
              </div>
              <img
                src="/devices/macbook-pro.svg"
                alt=""
                draggable={false}
                className="pointer-events-none relative z-20 block w-full select-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Phone — upright beside the laptop, same SVG-frame-above-live-dashboard pattern */}
      <div ref={phoneWrapRef} className="absolute -bottom-2 right-0 z-20 w-[86px] sm:w-32">
        <div className={`transition-transform duration-500 ease-out ${focus === "laptop" ? "scale-[0.98]" : "scale-100 drop-shadow-[0_0_28px_color-mix(in_srgb,var(--primary)_45%,transparent)]"}`}>
          <div
            className="relative"
            style={{ filter: "drop-shadow(0 20px 60px rgba(0,0,0,.18)) drop-shadow(0 60px 120px rgba(0,0,0,.10))" }}
          >
            <div
              ref={phoneScreenRef}
              className="absolute flex flex-col overflow-hidden bg-white"
              style={{
                left: phoneWidth * IPHONE_SCREEN.left,
                top: phoneHeight * IPHONE_SCREEN.top,
                width: phoneWidth * IPHONE_SCREEN.width,
                height: phoneHeight * IPHONE_SCREEN.height,
              }}
            >
              <div className="flex-1 overflow-hidden bg-muted">
                <motion.div style={{ y: phoneScrollY }} className="flex flex-col">
                  <div className="flex items-center justify-between px-2.5 pb-1.5 pt-6">
                    <div className="flex items-center gap-1">
                      <Youtube className="h-2.5 w-2.5 text-brand-red" />
                      <span className="text-[7px] font-bold tracking-tight">Tubify</span>
                    </div>
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent"><User className="h-2 w-2" /></span>
                  </div>
                  <div className="px-2.5 pb-2">
                    <motion.p key={`m-heading-${activeSection}`} initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="text-[8px] font-bold tracking-tight text-foreground">
                      {current.heading}
                    </motion.p>
                    <motion.div key={`m-stats-${activeSection}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="mt-1.5 grid grid-cols-2 gap-1">
                      {current.stats.slice(0, 4).map((s) => (
                        <div key={s.label} className="overflow-hidden rounded-lg border border-border/70 bg-white p-1.5 shadow-sm">
                          <p className="truncate text-[5px] font-semibold uppercase tracking-wide text-muted-foreground/80">{s.label}</p>
                          <p className="mt-0.5 truncate text-[9px] font-bold leading-none text-foreground">{s.value}</p>
                        </div>
                      ))}
                    </motion.div>
                    <div className="mt-1 overflow-hidden rounded-lg border border-border/70 bg-white p-1.5 shadow-sm">
                      <p className="truncate text-[5px] font-semibold uppercase tracking-wide text-muted-foreground/80">Revenue Over Time</p>
                      <div className="mt-0.5 h-8">
                        <ResponsiveContainer key={`m-trend-${activeSection}`} width="100%" height="100%">
                          <AreaChart data={current.trend}>
                            <defs>
                              <linearGradient id={`${mGradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={1.5} fill={`url(#${mGradientId}-revenue)`} isAnimationActive animationDuration={450} animationEasing="ease-out" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              <div className="flex items-center justify-around border-t border-border/70 bg-white py-1.5">
                {PHONE_TABS.map((t) => {
                  const isActive = t.label === activeSection;
                  const isPressed = t.label === pressedTab;
                  return (
                    <div
                      key={t.label}
                      ref={(el) => { tabRefs.current[t.label] = el; }}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-full p-1 transition-all duration-150 ${isActive ? "text-primary" : "text-muted-foreground"} ${isPressed ? "scale-90" : "scale-100"}`}
                    >
                      <t.icon className="h-2.5 w-2.5" />
                      <span className={`h-[2px] w-[2px] rounded-full transition-colors duration-150 ${isActive ? "bg-primary" : "bg-transparent"}`} />
                    </div>
                  );
                })}
              </div>

                {phoneRipple && (
                  <motion.span
                    key={phoneRipple.id}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 z-40 h-5 w-5 rounded-full bg-primary/40"
                    style={{ x: phoneRipple.x - 10, y: phoneRipple.y - 10 }}
                    initial={{ scale: 0.2, opacity: 0.6 }}
                    animate={{ scale: 2, opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                )}
              </div>
              <img
                src="/devices/iphone-16-pro.svg"
                alt=""
                draggable={false}
                className="pointer-events-none relative z-20 block w-full select-none"
              />
            </div>
        </div>
      </div>
    </div>
  );
}

const PROBLEM_ICONS = [TrendingUp, MessageSquare, DollarSign];

function ProblemSection() {
  const [content] = useSiteContent();
  return (
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
        {content.problemHeading}
      </h2>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {content.problemItems.map((it, i) => {
          const Icon = PROBLEM_ICONS[i] ?? TrendingUp;
          return (
            <div key={i} className="rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-4 font-semibold">{it.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{it.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProductShowcase() {
  const [content] = useSiteContent();
  return (
    <section id="product" className="mx-auto max-w-5xl px-6 py-16 text-center">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{content.showcaseBadge}</span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{content.showcaseHeading}</h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        {content.showcaseSubtext}
      </p>
      <div className="mt-10 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-3">
        <DashboardMockup />
      </div>
    </section>
  );
}

const HOW_IT_WORKS_ICONS = [Youtube, Sparkles, MessageSquare, DollarSign];

function HowItWorks() {
  const [content] = useSiteContent();
  return (
    <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{content.howItWorksHeading}</h2>
      <p className="mt-3 text-center text-muted-foreground">{content.howItWorksSubtitle}</p>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {content.howItWorksSteps.map((s, i) => {
          const Icon = HOW_IT_WORKS_ICONS[i] ?? Sparkles;
          return (
            <div key={i} className="rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
              </div>
              <p className="mt-4 font-semibold">{s.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BuiltForCreators() {
  const [content] = useSiteContent();
  const rows = [
    { name: "Alex Chen", role: "Owner", leads: 128, revenue: "$44,300" },
    { name: "Jamie Rivera", role: "Setter", leads: 96, revenue: "$18,200" },
    { name: "Sam Patel", role: "Setter", leads: 61, revenue: "$9,600" },
  ];
  return (
    <section className="bg-[#060b12] py-20 text-background">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{content.creatorsHeading}</h2>
        <p className="mx-auto mt-3 max-w-xl text-background/60">
          {content.creatorsSubtitle}
        </p>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.name} className="rounded-[var(--card-radius)] border-2 border-white/10 bg-white/5 p-5">
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

function FaqSection() {
  const [content] = useSiteContent();
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">FAQ</span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">{content.faqHeading}</h2>
      <Accordion type="single" collapsible className="mt-8 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white px-2">
        {content.faqs.map((f, i) => (
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
  const [content] = useSiteContent();
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
    toast.success("Thanks — we got it!", { description: `Someone from the ${content.siteName} team will follow up by email.` });
  };

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 py-16">
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <LifeBuoy className="h-3.5 w-3.5" /> Contact
      </span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">{content.contactHeading}</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        {content.contactSubheading}
      </p>

      <div className="mt-8 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6 sm:p-8">
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
                <input value={name} onChange={(e) => setName(e.target.value)} required className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary" />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">What's going on?</label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} className="w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 py-2.5 text-sm outline-none focus:border-primary" />
            </div>
            <button type="submit" className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--button-radius)] bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
              <Send className="h-4 w-4" /> Send Message
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// Deterministic placeholder thumbnails standing in for a creator's actual video library — Tubify
// has no real footage to show, so these are seeded (stable across reloads, unlike /random) picsum
// photos sized to roughly match a YouTube thumbnail's 16:9-ish ratio.
const MARQUEE_IMAGES = Array.from(
  { length: 24 },
  (_, i) => `https://picsum.photos/seed/tubify-${i + 1}/700/500`,
);

function ContentMarqueeSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 text-center">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Your library</span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Every video. Tracked automatically.</h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        From your very first upload to your thousandth, Tubify keeps every video's revenue, links, and comments organized in one place.
      </p>
      <div className="mt-10 rounded-[var(--card-radius)] bg-gray-950/5 p-2 ring-1 ring-border dark:bg-neutral-800">
        <ThreeDMarquee images={MARQUEE_IMAGES} />
      </div>
    </section>
  );
}

function FinalCta() {
  const [content] = useSiteContent();
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16">
      <div className="rounded-[var(--card-radius)] bg-primary p-10 text-center text-primary-foreground sm:p-14">
        <img src="/tubi.png" alt="" className="pointer-events-none mx-auto h-16 w-16 object-contain opacity-95" />
        <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{content.finalCtaHeading}</h2>
        <p className="mx-auto mt-3 max-w-md text-primary-foreground/80">{content.finalCtaSubtitle}</p>
        <Link to="/dashboard" className="mt-7 inline-flex h-12 items-center gap-2 rounded-[var(--button-radius)] bg-white px-6 text-sm font-semibold text-primary hover:bg-white/90">
          {content.heroPrimaryCta} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

const SOCIAL_ICONS: { key: "youtube" | "twitter" | "instagram" | "tiktok"; icon: typeof Youtube }[] = [
  { key: "youtube", icon: Youtube },
  { key: "twitter", icon: Twitter },
  { key: "instagram", icon: Instagram },
  { key: "tiktok", icon: Music2 },
];

function FooterSection() {
  const [content] = useSiteContent();
  const columns = [
    { title: "Features", links: ["AI Descriptions", "Comment Automation", "Link Tracking", "Analytics", "Team Collaboration"] },
    { title: "Data Hub", links: ["Revenue Attribution", "Brand Deals", "Affiliate", "YouTube Sync"] },
    { title: "Resources", links: ["Changelog", "Roadmap", "Docs", "Blog"] },
  ];
  const activeSocials = SOCIAL_ICONS.filter((s) => content.socialLinks[s.key]);
  return (
    <footer className="relative overflow-hidden bg-[#060b12] text-background">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-brand-amber to-brand-purple" />
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 pb-16 pt-16 sm:grid-cols-5">
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <img src={content.logoDarkUrl} alt={content.siteName} className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold">{content.siteName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-background/60">
            {content.tagline}
          </p>
          {activeSocials.length > 0 && (
            <div className="mt-4 flex items-center gap-3 text-background/60">
              {activeSocials.map((s) => (
                <a key={s.key} href={content.socialLinks[s.key]} target="_blank" rel="noreferrer" className="hover:text-background">
                  <s.icon className="h-4 w-4" />
                </a>
              ))}
              <Link2 className="h-4 w-4" />
            </div>
          )}
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
          <p className="mt-3 text-sm text-background/60">{content.contactEmail}</p>
          <a href="#contact" className="mt-2 inline-block text-sm text-background/60 hover:text-background">Report a problem →</a>
        </div>
      </div>
      <div className="border-t border-white/10 px-6 py-5 text-center text-xs text-background/40">
        {content.copyrightText}
      </div>
    </footer>
  );
}
