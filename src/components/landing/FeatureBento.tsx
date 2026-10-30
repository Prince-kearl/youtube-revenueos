import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Check,
  Globe2,
  Handshake,
  Inbox,
  Link2,
  MessageSquareReply,
  MousePointer2,
  Sparkles,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

// The landing page's feature grid: a dark bento of Tubify's tools, each tile a title, one line
// with the key phrase in white, and a small illustration of the tool. Illustrations are
// decorative (aria-hidden); the text carries the meaning.

function Tile({
  icon: Icon,
  title,
  children,
  art,
  className = "",
}: {
  icon: typeof BarChart3;
  title: string;
  children: ReactNode;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`group relative flex min-h-[260px] flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#141414] transition-colors hover:border-white/[0.16] ${className}`}
    >
      <div className="relative z-10 p-6 pb-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold text-white">
          <Icon className="h-4 w-4 text-white/70" aria-hidden="true" />
          {title}
        </h3>
        <p className="mt-3 max-w-[30ch] text-sm leading-relaxed text-white/50">{children}</p>
      </div>
      {art && (
        <div className="relative mt-auto flex-1" aria-hidden="true">
          {art}
        </div>
      )}
    </div>
  );
}

const em = (text: string) => <span className="font-medium text-white">{text}</span>;

/** Revenue: dot-matrix columns, the latest months in the brand colour. */
function RevenueArt() {
  const values = [3, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 10];
  return (
    <div className="absolute bottom-6 right-8 top-4 hidden w-[46%] items-end justify-end gap-[7px] sm:flex">
      {values.map((v, c) => (
        <div key={c} className="flex flex-col-reverse gap-[5px]">
          {Array.from({ length: 10 }).map((_, r) => (
            <span
              key={r}
              className="block h-[5px] w-[5px] rounded-full"
              style={{
                background:
                  r < v
                    ? c >= values.length - 4
                      ? "var(--primary)"
                      : "rgba(255,255,255,0.45)"
                    : "rgba(255,255,255,0.08)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** AI descriptions: a transcript turning into a description. */
function DescriptionArt() {
  return (
    <div className="absolute inset-x-6 bottom-6 space-y-2.5">
      <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-white/35">transcript</p>
        <div className="mt-2 space-y-1.5">
          <span className="block h-1.5 w-[90%] rounded-full bg-white/10" />
          <span className="block h-1.5 w-[70%] rounded-full bg-white/10" />
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#1b1b1b] px-3 py-1.5 font-mono text-[11px] text-white/70">
        <Sparkles className="h-3 w-3 text-primary" />
        writing description<span className="animate-pulse text-primary">▍</span>
      </div>
    </div>
  );
}

/** Comment automation: a keyword trigger and the reply it sends. */
function CommentArt() {
  return (
    <div className="absolute inset-x-6 bottom-6 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {["price", "cost", "link?"].map((k) => (
          <span
            key={k}
            className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/55"
          >
            {k}
          </span>
        ))}
      </div>
      <div className="ml-6 rounded-[12px] rounded-tr-[4px] bg-primary/90 px-3 py-2 text-[11px] leading-snug text-white">
        Thanks for asking! Pricing is linked in the description 🙌
      </div>
    </div>
  );
}

/** Link tracking: short links and their clicks. */
function LinkArt() {
  const rows = [
    ["course", "151"],
    ["merch", "88"],
    ["sponsor", "64"],
  ];
  return (
    <div className="absolute inset-x-0 bottom-5 space-y-2">
      {rows.map(([slug, clicks]) => (
        <div key={slug} className="flex items-center gap-2 border-t border-white/[0.06] px-6 pt-2">
          <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/45">
            /l/{slug}
          </span>
          <span className="h-px flex-1 border-t border-dashed border-white/15" />
          <span className="font-mono text-[11px] text-white/80">{clicks}</span>
        </div>
      ))}
    </div>
  );
}

/** Brand deals: a mini pipeline. */
function DealsArt() {
  const cols = [
    { name: "Pitched", cards: 3 },
    { name: "Negotiating", cards: 2 },
    { name: "Signed", cards: 1 },
  ];
  return (
    <div className="absolute inset-x-6 bottom-6 grid grid-cols-3 gap-2">
      {cols.map((c, i) => (
        <div key={c.name} className="space-y-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-white/35">{c.name}</p>
          {Array.from({ length: c.cards }).map((_, k) => (
            <span
              key={k}
              className={`block h-7 rounded-[6px] border ${i === 2 ? "border-primary/50 bg-primary/15" : "border-white/[0.08] bg-white/[0.04]"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Lead inbox: a conversation with someone typing, on a faint grid. */
function InboxArt() {
  return (
    <div
      className="absolute inset-0 top-6"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      <div className="absolute left-[38%] top-[34%] flex h-7 w-14 items-center justify-center gap-1 rounded-full border border-white/20 bg-[#1b1b1b]">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/70"
            style={{ animationDelay: `${d * 160}ms` }}
          />
        ))}
      </div>
      <MousePointer2 className="absolute left-[22%] top-[52%] h-6 w-6 -rotate-12 fill-white/10 text-white/60" />
      <MousePointer2 className="absolute bottom-[14%] right-[22%] h-4 w-4 rotate-12 text-primary/80" />
    </div>
  );
}

/** Audience: where viewers are. */
function AudienceArt() {
  const rows = [
    ["United States", 100],
    ["India", 52],
    ["United Kingdom", 24],
  ] as const;
  return (
    <div className="absolute inset-x-6 bottom-6 space-y-2.5">
      {rows.map(([country, pct]) => (
        <div key={country}>
          <div className="flex justify-between text-[11px] text-white/55">
            <span>{country}</span>
          </div>
          <div className="mt-1 flex gap-[3px]">
            {Array.from({ length: 22 }).map((_, i) => (
              <span
                key={i}
                className="h-[4px] w-[4px] rounded-full"
                style={{
                  background: i / 22 < pct / 100 ? "var(--primary)" : "rgba(255,255,255,0.1)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Team: members with their roles. */
function TeamArt() {
  const people = [
    ["AC", "Owner"],
    ["JR", "Manager"],
    ["SP", "Setter"],
  ];
  return (
    <div className="absolute inset-x-6 bottom-6 space-y-2">
      {people.map(([initials, role], i) => (
        <div
          key={initials}
          className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5"
        >
          <span
            className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold ${i === 0 ? "bg-primary text-white" : "bg-white/10 text-white/70"}`}
          >
            {initials}
          </span>
          <span className="text-[11px] text-white/60">{role}</span>
        </div>
      ))}
    </div>
  );
}

export function FeatureBento() {
  return (
    <section id="features" className="bg-[#0c0c0c] py-20 text-white sm:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
          <div>
            <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              Run your channel
              <br />
              <span className="text-primary">Grow your revenue</span>
            </h2>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                to="/dashboard"
                className="rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Start for free
              </Link>
              <a
                href="#how-it-works"
                className="rounded-[8px] border border-white/15 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                See how it works
              </a>
            </div>
          </div>
          <p className="max-w-md text-[15px] leading-relaxed text-white/55 lg:justify-self-end">
            Start with your YouTube channel. Add revenue analytics, AI descriptions, comment
            automation, link tracking, brand deals, a lead inbox and your team.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            icon={BarChart3}
            title="Revenue Analytics"
            className="sm:col-span-2"
            art={
              <>
                <ul className="absolute bottom-6 left-6 z-10 space-y-1.5 text-[13px] text-white/80">
                  {["Revenue per video", "Brand deals included", "Sales attributed to videos"].map(
                    (t) => (
                      <li key={t} className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-white/60" />
                        {t}
                      </li>
                    ),
                  )}
                </ul>
                <RevenueArt />
              </>
            }
          >
            Every channel gets {em("a full revenue picture")}, video by video, so you know what
            actually pays.
          </Tile>
          <Tile icon={Sparkles} title="AI Descriptions" art={<DescriptionArt />}>
            {em("Write descriptions from transcripts")}, with your links and chapters in place.
          </Tile>
          <Tile icon={MessageSquareReply} title="Comment Automation" art={<CommentArt />}>
            Reply by keyword, {em("automatically and in your voice")}.
          </Tile>

          <Tile icon={Link2} title="Link Tracking" art={<LinkArt />}>
            {em("Know which video sent every click")} and sale.
          </Tile>
          <Tile icon={Inbox} title="Lead Inbox" art={<InboxArt />}>
            {em("Two-way YouTube conversations")} in one inbox, assigned to your team.
          </Tile>
          <Tile icon={Handshake} title="Brand Deals" art={<DealsArt />}>
            A {em("pipeline for sponsorships")}, from pitch to signed.
          </Tile>
          <Tile icon={Globe2} title="Audience" art={<AudienceArt />}>
            {em("See who is watching")}: countries, ages and devices.
          </Tile>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Tile icon={Users} title="Team" className="min-h-[220px]" art={<TeamArt />}>
            {em("Roles, permissions and lead routing")} for editors, setters and managers.
          </Tile>
          <div className="flex min-h-[220px] flex-col justify-end rounded-[14px] border border-white/[0.08] bg-gradient-to-br from-primary/25 via-[#141414] to-[#141414] p-6">
            <p className="text-2xl font-semibold leading-snug tracking-tight">
              Use one or all.{" "}
              <span className="text-white/50">
                Every tool your channel needs, working together.
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
