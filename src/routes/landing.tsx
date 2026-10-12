import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Play,
  Youtube,
  Twitter,
  Instagram,
  Music2,
  MessageSquare,
  Link2,
  DollarSign,
  Sparkles,
  TrendingUp,
  Send,
  LifeBuoy,
  ChevronDown,
  BarChart3,
  Users2,
  LayoutDashboard,
  Radio,
  Megaphone,
  Bot,
  Settings,
  Search,
  User,
  Menu,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useSiteContent } from "@/lib/stores";
import { CookieConsent } from "@/components/CookieConsent";

export const Route = createFileRoute("/landing")({
  component: Landing,
});

function Landing() {
  const [content] = useSiteContent();
  useEffect(() => {
    document.title = `${content.siteName} — ${content.tagline}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", content.seoDescription);
  }, [content.siteName, content.tagline, content.seoDescription]);

  return (
    // theme-light: this page has one fixed design, so it is pinned to the light palette and looks
    // the same whatever the visitor's colour scheme (see .theme-light in styles.css).
    <div className="theme-light min-h-screen bg-background text-foreground">
      {/* This panel used to be `relative z-0` — being positioned with an explicit (even zero)
          z-index opens its own stacking context, which trapped everything inside it, including
          NavBar's fixed z-30 pill: capped at this context, it could never outrank later top-level
          sections (ContentMarqueeSection, FinalCta, …) once they scrolled underneath it, since
          none of those set a z-index of their own either and DOM order decided the winner instead.
          Dropping z-0 removes that boundary — `relative` alone (no z-index) does not create a
          stacking context, so NavBar's z-30 now escapes to the page's root context and legitimately
          outranks every sibling section. The -z-10 glow blobs below still render correctly: with no
          local stacking context to escape to, their negative z-index is compared at the root level
          too, but since they only ever spatially overlap the hero content directly above them,
          that's the only place the ordering is visible — behind Hero, in front of nothing else. */}
      <div
        className="relative overflow-hidden"
        style={{
          background: "radial-gradient(circle at 22% 20%, #0a1420 0%, #0a1420 45%, #060b12 100%)",
        }}
      >
        <div
          aria-hidden="true"
          className="hero-glow-aurora pointer-events-none -z-10"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent) 0%, transparent 70%)",
          }}
        />
        <div
          aria-hidden="true"
          className="hero-glow-aurora hero-glow-aurora--secondary pointer-events-none -z-10"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--primary) 45%, transparent) 0%, transparent 70%)",
          }}
        />
        <div className="pointer-events-none absolute -top-24 right-[-4rem] -z-10 h-80 w-80 rounded-full bg-brand-amber/10 blur-3xl" />
        <div className="pointer-events-none absolute -top-16 left-[-6rem] -z-10 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <NavBar />
        <Hero />
      </div>
      <ProblemSection />
      <ContentMarqueeSection />
      <ProductShowcase />
      <HowItWorks />
      <BuiltForCreators />
      <FaqSection />
      <ContactSection />
      <FinalCta />
      <FooterSection />
      <CookieConsent />
    </div>
  );
}

const NAV_DESTINATIONS: { label: string; href?: string; to?: string }[] = [
  { label: "Home", href: "#" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Product Showcase", href: "#product" },
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
            <img
              referrerPolicy="no-referrer"
              src={content.logoLightUrl}
              alt={content.siteName}
              className="h-8 w-8 object-contain"
            />
            <span className="text-lg font-bold tracking-tight text-white">{content.siteName}</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-white/70 md:flex">
            <a href="#" className="border-b-2 border-primary pb-1 text-white">
              Home
            </a>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 outline-none hover:text-white">
                Features <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="theme-light">
                <DropdownMenuItem asChild>
                  <a href="#how-it-works">How It Works</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="#product">Product Showcase</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 outline-none hover:text-white">
                Resources <ChevronDown className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="theme-light">
                <DropdownMenuItem asChild>
                  <Link to="/support">Support</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <a href="#faq" className="hover:text-white">
              FAQ
            </a>
            <a href="#contact" className="hover:text-white">
              Contact
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="hidden items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm font-medium text-white/80 hover:text-white sm:flex"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30">
                <User className="h-3 w-3" />
              </span>
              Log In
            </Link>
            <Link
              to="/dashboard"
              className="hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 md:inline-flex"
            >
              Get Started
            </Link>

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
                <Link
                  key={dest.label}
                  to={dest.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="hover:text-white"
                >
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
              ),
            )}
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-1.5 hover:text-white"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/30">
                <User className="h-3 w-3" />
              </span>
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

        <HeroArtwork />
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
  { day: "Jun 12", value: 800 },
  { day: "Jun 19", value: 1050 },
  { day: "Jun 26", value: 780 },
  { day: "Jul 03", value: 1200 },
  { day: "Jul 10", value: 950 },
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
            <div
              key={n.label}
              className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-medium ${n.active ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            >
              <n.icon className="h-3 w-3 shrink-0" /> <span className="truncate">{n.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Dashboard Overview</p>
          <span className="rounded-md border border-border px-2 py-0.5 text-[9px] text-muted-foreground">
            Jun 12 – Jul 12
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {MOCKUP_STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-[var(--card-radius)] border border-border bg-card p-2.5"
            >
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
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    fill={`url(#${gradientId}-revenue)`}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-[var(--card-radius)] border border-border bg-card p-2.5">
            <p className="text-[9px] font-medium text-muted-foreground">Traffic Sources</p>
            <div className="mt-1 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={MOCKUP_TRAFFIC}
                    dataKey="pct"
                    nameKey="label"
                    innerRadius="55%"
                    outerRadius="100%"
                    strokeWidth={1}
                  >
                    {MOCKUP_TRAFFIC.map((t) => (
                      <Cell key={t.label} fill={t.color} />
                    ))}
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
            <Area
              type="monotone"
              dataKey="v"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <button className="mt-1.5 w-full rounded-[var(--button-radius)] bg-primary px-2 py-1.5 text-[10px] font-semibold text-primary-foreground">
        View Full Analytics
      </button>
      <div className="mt-2 border-t border-border pt-1.5">
        <p className="text-[9px] text-muted-foreground">Realtime</p>
        <p className="text-xs font-bold">
          48,230 <span className="text-[9px] font-normal text-muted-foreground">Views · 48h</span>
        </p>
      </div>
    </div>
  );
}

// ============ HERO ARTWORK ============
// A single pre-rendered image (public/landing_asset.png, transparent background): the Tubify
// phone surrounded by floating stat cards. Width/height are the file's intrinsic size, so the
// browser reserves the right space before it loads and the hero copy beside it never shifts.
//
// The artwork is cropped flat across the wrist and down its right-hand edge. Left floating in
// the middle of the hero that crop reads as a mistake, so two things hide it:
//   * the image sits on the hero's bottom edge (self-end, and -mb-16 cancels the section's
//     pb-16), so the arm rises out of the base of the section instead of ending in mid-air;
//   * a mask fades the last stretch of the bottom and right edges into the background, so no
//     hard line is left where the picture stops. The two gradients are intersected; the fades
//     are short enough to leave the phone and every stat card untouched.
const HERO_ARTWORK_MASK =
  "linear-gradient(to bottom, #000 0%, #000 86%, transparent 100%), linear-gradient(to right, #000 0%, #000 93%, transparent 100%)";

function HeroArtwork() {
  return (
    <div className="relative mx-auto -mb-16 w-full max-w-xl self-end lg:max-w-none">
      {/* A soft brand-coloured glow behind the phone, so the artwork sits in the scene. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--primary) 30%, transparent) 0%, transparent 70%)",
        }}
      />
      <img
        src="/landing_asset.png"
        alt="The Tubify app on a phone, showing total revenue, views, watch time, subscribers and top videos"
        width={1341}
        height={1100}
        fetchPriority="high"
        decoding="async"
        draggable={false}
        className="pointer-events-none block h-auto w-full select-none"
        style={{
          maskImage: HERO_ARTWORK_MASK,
          WebkitMaskImage: HERO_ARTWORK_MASK,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
        }}
      />
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
            <div
              key={i}
              className="rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6"
            >
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
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        {content.showcaseBadge}
      </span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        {content.showcaseHeading}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{content.showcaseSubtext}</p>
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
      <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
        {content.howItWorksHeading}
      </h2>
      <p className="mt-3 text-center text-muted-foreground">{content.howItWorksSubtitle}</p>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {content.howItWorksSteps.map((s, i) => {
          const Icon = HOW_IT_WORKS_ICONS[i] ?? Sparkles;
          return (
            <div
              key={i}
              className="rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
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
        <p className="mx-auto mt-3 max-w-xl text-background/60">{content.creatorsSubtitle}</p>
        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {rows.map((r) => (
            <div
              key={r.name}
              className="rounded-[var(--card-radius)] border-2 border-white/10 bg-white/5 p-5"
            >
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
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        FAQ
      </span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">
        {content.faqHeading}
      </h2>
      <Accordion
        type="single"
        collapsible
        className="mt-8 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white px-2"
      >
        {content.faqs.map((f, i) => (
          <AccordionItem key={i} value={`item-${i}`} className="last:border-0">
            <AccordionTrigger className="px-4 text-left text-sm font-medium hover:no-underline">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="px-4 text-sm text-muted-foreground">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function ContactSection() {
  const [content] = useSiteContent();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim())
      return toast.error("Please fill in every field");
    setSending(true);
    try {
      const res = await fetch("/api/support/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) {
        toast.error("Couldn't send your message — please try again");
        return;
      }
      setSent(true);
      toast.success("Thanks — we got it!", {
        description: `Someone from the ${content.siteName} team will follow up by email.`,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="contact" className="mx-auto max-w-2xl px-6 py-16">
      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        <LifeBuoy className="h-3.5 w-3.5" /> Contact
      </span>
      <h2 className="mt-4 text-center text-3xl font-bold tracking-tight sm:text-4xl">
        {content.contactHeading}
      </h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        {content.contactSubheading}
      </p>

      <div className="mt-8 rounded-[var(--card-radius)] border-2 border-foreground/10 bg-white p-6 sm:p-8">
        {sent ? (
          <div className="py-6 text-center">
            <p className="font-semibold">Message sent.</p>
            <p className="mt-1 text-sm text-muted-foreground">We'll get back to you at {email}.</p>
            <button
              onClick={() => {
                setSent(false);
                setName("");
                setEmail("");
                setMessage("");
              }}
              className="mt-4 text-sm font-medium text-primary hover:underline"
            >
              Send another message
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-11 w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                What's going on?
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={4}
                className="w-full rounded-[var(--input-radius)] border border-border bg-accent/10 px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--button-radius)] bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send Message"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

// Deterministic placeholder video library — Tubify has no real footage to show, so these are
// seeded (stable across reloads, unlike /random) picsum photos with fake-but-plausible titles/
// stats. Rather than aping a plain YouTube grid (title + views + age), each card is built to
// depict the section's own headline: the #-badge spans #1 through #1,042 to sell "first upload to
// thousandth," and the chip row swaps YouTube's views/channel line for the three things Tubify
// actually tracks per video — revenue, link clicks, comments — so the grid IS the product claim,
// not just decoration next to it.
const MARQUEE_TITLES = [
  "How I Made $12,400 From One Video",
  "The Brand Deal Breakdown Nobody Talks About",
  "My AdSense Revenue Every Month This Year",
  "I Tried Every Monetization Method",
  "Turning Comments Into Customers",
  "Behind The Scenes: A $40K Launch",
  "What I Wish I Knew About Sponsorships",
  "Reacting To My First Year Of Analytics",
  "The Setup That 10x'd My Revenue",
  "Q&A: Your Creator Business Questions",
  "Why I Stopped Chasing Views",
  "My Link-In-Bio Actually Converts Now",
];
const MARQUEE_VIDEOS = MARQUEE_TITLES.map((title, i) => ({
  title,
  image: `https://picsum.photos/seed/tubify-${i + 1}/700/394`,
  duration: ["4:12", "12:47", "0:58", "8:03", "21:15", "3:29", "15:40", "6:51"][i % 8],
  index: [1, 47, 156, 289, 438, 512, 601, 734, 812, 901, 968, 1042][i],
  revenue: [
    "$4,120",
    "$2,860",
    "$1,940",
    "$1,510",
    "$980",
    "$640",
    "$1,280",
    "$710",
    "$2,240",
    "$390",
    "$3,050",
    "$860",
  ][i],
  clicks: [842, 615, 493, 371, 248, 156, 402, 189, 728, 97, 934, 265][i],
  comments: [128, 94, 76, 58, 41, 27, 63, 33, 112, 19, 145, 47][i],
}));

function ContentMarqueeSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16 text-center">
      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        Your library
      </span>
      <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
        Every video. Tracked automatically.
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        From your very first upload to your thousandth, Tubify keeps every video's revenue, links,
        and comments organized in one place.
      </p>
      <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 text-left sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
        {MARQUEE_VIDEOS.map((v) => (
          <div key={v.title} className="group">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-accent">
              <img
                referrerPolicy="no-referrer"
                src={v.image}
                alt={v.title}
                className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-red shadow-lg transition-transform group-hover:scale-110">
                  <Play className="ml-0.5 h-4 w-4 text-white" fill="white" />
                </span>
              </span>
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                #{v.index.toLocaleString()}
              </span>
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {v.duration}
              </span>
            </div>
            <p className="mt-2.5 line-clamp-1 text-sm font-medium leading-snug">{v.title}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                <DollarSign className="h-3 w-3" /> {v.revenue}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Link2 className="h-3 w-3" /> {v.clicks}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-purple/10 px-2 py-0.5 text-[11px] font-semibold text-brand-purple">
                <MessageSquare className="h-3 w-3" /> {v.comments}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  const [content] = useSiteContent();
  return (
    <section className="mx-auto max-w-4xl px-6 pb-16">
      <div className="rounded-[var(--card-radius)] bg-primary p-10 text-center text-primary-foreground sm:p-14">
        <img
          src="/tubi.png"
          alt=""
          className="pointer-events-none mx-auto h-16 w-16 object-contain opacity-95"
        />
        <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
          {content.finalCtaHeading}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-primary-foreground/80">
          {content.finalCtaSubtitle}
        </p>
        <Link
          to="/dashboard"
          className="mt-7 inline-flex h-12 items-center gap-2 rounded-[var(--button-radius)] bg-white px-6 text-sm font-semibold text-primary hover:bg-white/90"
        >
          {content.heroPrimaryCta} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

const SOCIAL_ICONS: {
  key: "youtube" | "twitter" | "instagram" | "tiktok";
  icon: typeof Youtube;
}[] = [
  { key: "youtube", icon: Youtube },
  { key: "twitter", icon: Twitter },
  { key: "instagram", icon: Instagram },
  { key: "tiktok", icon: Music2 },
];

function FooterSection() {
  const [content] = useSiteContent();
  const columns = [
    {
      title: "Features",
      links: [
        "AI Descriptions",
        "Comment Automation",
        "Link Tracking",
        "Analytics",
        "Team Collaboration",
      ],
    },
    {
      title: "Data Hub",
      links: ["Revenue Attribution", "Brand Deals", "Affiliate", "YouTube Sync"],
    },
    { title: "Resources", links: ["Changelog", "Roadmap", "Docs", "Blog"] },
  ];
  const activeSocials = SOCIAL_ICONS.filter((s) => content.socialLinks[s.key]);
  return (
    <footer className="relative overflow-hidden bg-[#060b12] text-background">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-brand-amber to-brand-purple" />
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 pb-16 pt-16 sm:grid-cols-5">
        <div className="col-span-2">
          <div className="flex items-center gap-2">
            <img
              referrerPolicy="no-referrer"
              src={content.logoDarkUrl}
              alt={content.siteName}
              className="h-8 w-8 object-contain"
            />
            <span className="text-lg font-bold">{content.siteName}</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-background/60">{content.tagline}</p>
          {activeSocials.length > 0 && (
            <div className="mt-4 flex items-center gap-3 text-background/60">
              {activeSocials.map((s) => (
                <a
                  key={s.key}
                  href={content.socialLinks[s.key]}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-background"
                >
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
                <li key={l}>
                  <a
                    href="#"
                    className="flex items-center gap-1 text-sm text-background/60 hover:text-background"
                  >
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <p className="text-sm font-semibold">Contact</p>
          <p className="mt-3 text-sm text-background/60">{content.contactEmail}</p>
          <a
            href="#contact"
            className="mt-2 inline-block text-sm text-background/60 hover:text-background"
          >
            Report a problem →
          </a>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 border-t border-white/10 px-6 py-5 text-center text-xs text-background/40 sm:flex-row sm:gap-4">
        <span>{content.copyrightText}</span>
        <span className="hidden sm:inline">·</span>
        <Link to="/privacy" className="hover:text-background/70">
          Privacy Policy
        </Link>
        <span className="hidden sm:inline">·</span>
        <Link to="/terms" className="hover:text-background/70">
          Terms of Service
        </Link>
      </div>
    </footer>
  );
}
