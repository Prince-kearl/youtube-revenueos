// ============================================================================================
// LLM service — the one file every "AI-shaped" feature in the app calls through, instead of
// each owning its own copy of prompt-matching/generation logic. Today MockLlmService is the only
// implementation, and it's just the same canned/keyword-matched demo copy that used to live
// scattered across DashboardLayout.tsx, leads.tsx, ai-lab.tsx, add-video.tsx, freebie.tsx, and
// mock-generation.ts — moved here and given a shared shape. Every method is async and awaits an
// artificial delay, the same way a real network call would, so call sites already handle loading
// states correctly.
//
// When a real provider gets wired in: write a new class implementing LlmService (e.g.
// `class OpenAiLlmService implements LlmService { ... }`, calling out to the actual SDK) and
// change the single assignment at the bottom of this file. No call site — not DashboardLayout,
// not leads.tsx, not any of the others — needs to change, because they only ever depend on the
// LlmService interface, never on how a given implementation produces its answers.
// ============================================================================================

export type Suggestion = { label: string; text: string };

export type GenerateVideoDescriptionInput = {
  transcript?: string;
  /** Brand voice pill selected in AI Lab (Professional/Casual/Educational/Energetic). */
  voice?: string;
  /** Primary CTA pill selected in AI Lab (Course signup/Newsletter/Coaching/Affiliates). */
  cta?: string;
  /** Tracked destination links selected in Add Video — when present, the description is built
   *  around injecting these instead of AI Lab's voice/CTA-driven resource section. */
  links?: { label: string; url: string }[];
};

export type GenerateFreebieInput = {
  product: string;
  audience: string;
  tone: string;
  /** Human-readable format label (e.g. "Cheatsheet", "Mini-Guide") — the caller resolves this
   *  from whatever format-id state it keeps, so the service doesn't need to know that mapping. */
  formatLabel: string;
};

export type GenerationOutput = {
  summary: string;
  wireframes: string[];
  flowchart: string[];
  developerHandoff: string[];
};

export interface LlmService {
  /** Tubi, the assistant panel available app-wide (DashboardLayout.tsx). */
  chatReply(message: string): Promise<string>;
  /** Reply-draft suggestions shown above the composer in Lead Inbox (leads.tsx). Callers decide
   *  whether it's their turn to reply (e.g. the lead spoke last) before calling this. */
  suggestLeadReplies(lastLeadMessage: string): Promise<Suggestion[]>;
  /** Video description generation — used by both AI Lab and Add Video, which pass different
   *  subsets of the input depending on what they know (see GenerateVideoDescriptionInput). */
  generateVideoDescription(input: GenerateVideoDescriptionInput): Promise<string>;
  /** Lead-magnet content generation (AI Freebie). */
  generateFreebie(input: GenerateFreebieInput): Promise<string>;
  /** Project concept generation (Projects page / mock-generation.ts job queue). */
  generateProjectConcept(input: { title: string; prompt: string }): Promise<GenerationOutput>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const CTA_RESOURCE_LINES: Record<string, string> = {
  "Course signup": "My Course (Tubify): https://creator.io/course",
  Newsletter: "Newsletter (Weekly insights): https://creator.io/newsletter",
  Coaching: "1:1 Coaching: https://creator.io/coaching",
  Affiliates: "Affiliate Program: https://creator.io/affiliates",
};

class MockLlmService implements LlmService {
  async chatReply(message: string): Promise<string> {
    await delay(500);
    const s = message.toLowerCase();
    if (s.includes("link")) {
      return "Go to Link Tracking → Create Link. Enter a destination URL and an optional slug; you get a rvos.io short link that tracks clicks, conversions, and Stripe revenue attribution.";
    }
    if (s.includes("deal") || s.includes("brand")) {
      return "Deals move through Prospect → Pitched → Negotiating → Contracted → Completed. Use Quick Add Deal in the topbar or click any stage's Add deal button.";
    }
    if (s.includes("delay") || s.includes("24") || s.includes("fresh")) {
      return "YouTube Analytics reports lag 24–72h and revenue metrics ~48h. Click and Stripe attribution are real-time — that's why the two feeds are shown separately.";
    }
    if (s.includes("comment") || s.includes("rule")) {
      return "Comment rules watch new comments for keywords, @handles, or AI-detected questions. Each match triggers your saved reply and creates a lead. Each auto-reply costs ~50 YouTube API units.";
    }
    return "I can help with deals, links, comments, analytics, and settings. Try one of the suggestions above.";
  }

  async suggestLeadReplies(lastLeadMessage: string): Promise<Suggestion[]> {
    await delay(450);
    const msg = lastLeadMessage.toLowerCase();

    if (/sign(ed)? up|just joined|excited|can'?t wait/.test(msg)) {
      return [
        { label: "Direct Answer", text: "Amazing, welcome aboard! 🎉 Really glad to have you." },
        { label: "Value Pivot", text: "You're going to love how much time the AI Lab saves once it's set up." },
        { label: "Next Step", text: "Want a quick rundown of the best 3 things to set up first?" },
      ];
    }
    if (/thanks but|not (right )?now|all set|no thanks|pass on|already (have|got)/.test(msg)) {
      return [
        { label: "Direct Answer", text: "Totally understand — appreciate you taking the time to check it out." },
        { label: "Value Pivot", text: "Most people said the same thing until the spreadsheet started slipping. No pressure either way." },
        { label: "Next Step", text: "No worries at all — I'll leave the door open if priorities shift." },
      ];
    }
    if (/cost|price|pricing|\$|plan|budget/.test(msg)) {
      return [
        { label: "Direct Answer", text: "Yeah exactly — pricing scales with your team size, so you only pay for what you're actually using." },
        { label: "Value Pivot", text: "That's usually the moment it clicks — one dashboard instead of five tools adds up fast." },
        { label: "Next Step", text: "Want me to send a quick breakdown of what's included at each plan?" },
      ];
    }
    if (/call|time|free|available|schedule|thursday|friday|tomorrow|evening/.test(msg)) {
      return [
        { label: "Direct Answer", text: "Perfect — I'll lock that in and send a confirmation your way." },
        { label: "Value Pivot", text: "A quick call is honestly the fastest way to see if this is actually a fit for you." },
        { label: "Next Step", text: "Sending over a booking link now so you can grab whatever slot works best." },
      ];
    }
    if (/team|seat|editor|setter|hire|hiring/.test(msg)) {
      return [
        { label: "Direct Answer", text: "Got it — how many people are on the team right now?" },
        { label: "Value Pivot", text: "That's exactly what the Team page is for — everyone works off the same pipeline instead of a spreadsheet." },
        { label: "Next Step", text: "Want me to walk you through how seat-based pricing works for a team your size?" },
      ];
    }
    return [
      { label: "Direct Answer", text: "Thanks for sharing that — really helps me understand where you're at." },
      { label: "Value Pivot", text: "Honestly, that's the exact problem this was built to solve." },
      { label: "Next Step", text: "Want me to show you exactly how that would work for your channel?" },
    ];
  }

  async generateVideoDescription({ voice, cta, links }: GenerateVideoDescriptionInput): Promise<string> {
    await delay(900);

    if (links && links.length > 0) {
      const linkLines = links.map((l) => `▶ ${l.label}: ${l.url}`).join("\n");
      return `In this video I show you exactly how I went from 0 to €40K/month dropshipping with one product — no ads, no warehouse, no experience needed. I break down the exact product research method, the supplier I use, and the funnel that converts cold traffic into buyers.

${linkLines}

TIMESTAMPS
0:00 — How I found the product
2:14 — Setting up the store
5:33 — The ad strategy I used
9:01 — First sale moment
12:45 — Scaling to €40K

#dropshipping #ecommerce #makemoneyonline #shopify #passiveincome`;
    }

    const resourceLine = CTA_RESOURCE_LINES[cta ?? "Course signup"] ?? CTA_RESOURCE_LINES["Course signup"];
    const toneNote = voice ? ` Written in a ${voice.toLowerCase()} tone.` : "";
    return `🚀 How I Made $100K on YouTube (Complete Revenue Breakdown)

In this video, I reveal the exact strategies that helped me generate $100,000+ in YouTube revenue — covering every monetization stream from AdSense to 6-figure brand deals.${toneNote}

✅ What you'll learn:
→ The 4 revenue streams that actually matter
→ How to land premium brand deals (script included)
→ My membership funnel that converts at 8%
→ Affiliate stacking strategy for passive income

📌 RESOURCES MENTIONED:
→ Free Creator Business Toolkit: https://creator.io/toolkit
→ ${resourceLine}

🎬 CHAPTERS:
0:00 - The Full Picture
2:30 - AdSense Optimization
8:45 - Landing Brand Deals
15:20 - Membership Strategy
22:10 - Affiliate Revenue Stacking
28:00 - Putting It Together

🔔 Subscribe for weekly creator business content → @YourChannel

#YouTubeRevenue #CreatorEconomy #YouTubeMonetization #ContentCreator #PassiveIncome`;
  }

  async generateFreebie({ product, audience, tone, formatLabel }: GenerateFreebieInput): Promise<string> {
    await delay(900);
    return `# The ${product} ${formatLabel}

## 1. Validate demand before you commit
- Search ${product} on TikTok — look for videos with 100K+ views in the last 30 days.
- Check Google Trends for a rising 12-month curve, not a fading spike.

## 2. Vet the supplier
- Order a sample. Always. Measure shipping time door-to-door.
- Confirm they can handle 50+ orders/day without delays.

## 3. The 3-point margin rule
- Sell price ≥ 3× landed cost.
- Keep ad cost under 30% of revenue.
- Reserve 10% for refunds and chargebacks.

## 4. Test cheaply
- Launch with one product, one angle, $20/day.
- Kill it in 3 days if CTR < 1%.

_Written for: ${audience}. Tone: ${tone}._`;
  }

  async generateProjectConcept({ title, prompt }: { title: string; prompt: string }): Promise<GenerationOutput> {
    await delay(1200);
    const topic = titleCase(title || prompt || "AI product");
    return {
      summary: `${topic} concept generated with a polished UI direction and a starter workflow.`,
      wireframes: [
        "Onboarding screen with clear CTA",
        "Dashboard layout with key metrics widgets",
        "Settings flow with saved preferences",
      ],
      flowchart: [
        "Prompt intake → concept board",
        "Wireframe sketch → polished UI",
        "Review loop → developer handoff",
      ],
      developerHandoff: [
        "Component map and layout tokens",
        "API contract for core actions",
        "Export-ready starter code bundle",
      ],
    };
  }
}

// The one line to change when a real provider is wired in.
export const llm: LlmService = new MockLlmService();
