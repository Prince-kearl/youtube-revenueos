// ============================================================================================
// LLM service — the one file every remaining "AI-shaped" feature that hasn't been migrated to a
// real provider calls through, instead of owning its own copy of canned/keyword-matched demo
// copy. ai-lab.tsx, add-video.tsx, the Projects page, and Lead Inbox's AI summary have since moved
// to real AI calls (see src/lib/server/ai-generation.ts); Tubi chat (DashboardLayout.tsx) and AI
// Freebie still use MockLlmService here.
//
// When a real provider gets wired in for a remaining method: write a new class implementing
// LlmService (e.g. `class OpenAiLlmService implements LlmService { ... }`) and change the single
// assignment at the bottom of this file. No call site needs to change, because they only ever
// depend on the LlmService interface, never on how a given implementation produces its answers.
// ============================================================================================

export type GenerateFreebieInput = {
  product: string;
  audience: string;
  tone: string;
  /** Human-readable format label (e.g. "Cheatsheet", "Mini-Guide") — the caller resolves this
   *  from whatever format-id state it keeps, so the service doesn't need to know that mapping. */
  formatLabel: string;
};

export interface LlmService {
  /** Tubi, the assistant panel available app-wide (DashboardLayout.tsx). */
  chatReply(message: string): Promise<string>;
  /** Lead-magnet content generation (AI Freebie). */
  generateFreebie(input: GenerateFreebieInput): Promise<string>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockLlmService implements LlmService {
  async chatReply(message: string): Promise<string> {
    await delay(500);
    const s = message.toLowerCase();
    if (s.includes("link")) {
      return "Go to Link Tracking → Create Link. Choose a destination and an optional slug; you get a short link that tracks real clicks and unique visitors.";
    }
    if (s.includes("deal") || s.includes("brand")) {
      return "Deals move through Prospect → Pitched → Negotiating → Contracted → Completed. Use Quick Add Deal in the topbar or click any stage's Add deal button.";
    }
    if (s.includes("delay") || s.includes("24") || s.includes("fresh")) {
      return "YouTube Analytics reports lag 24–72h and revenue metrics ~48h. Click data is real-time — that's why the two feeds are shown separately.";
    }
    if (s.includes("comment") || s.includes("rule")) {
      return "Comment rules watch your video comments for keywords, @handles, or questions. Each match can auto-reply on YouTube for real and logs that commenter as a lead. Each auto-reply costs 50 YouTube API units.";
    }
    return "I can help with deals, links, comments, analytics, and settings. Try one of the suggestions above.";
  }

  async generateFreebie({
    product,
    audience,
    tone,
    formatLabel,
  }: GenerateFreebieInput): Promise<string> {
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
}

// The one line to change when a real provider is wired in.
export const llm: LlmService = new MockLlmService();
