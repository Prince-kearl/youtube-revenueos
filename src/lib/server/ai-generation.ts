import { z } from "zod";
import { getServerEnv } from "./env";

export type ContentAnalysisInput = {
  title: string;
  description?: string | null;
  transcript?: string | null;
};

export type ContentAnalysisResult = {
  mainTopic: string;
  contentType: string;
  audienceIntent: string;
  complexity: string;
  engagementPotential: string;
  summary: string;
  topics: string[];
  strengths: string[];
  opportunities: string[];
};

export type ProjectConceptInput = {
  title: string;
  prompt: string;
};

export type ProjectConceptResult = {
  summary: string;
  wireframes: string[];
  flowchart: string[];
  developerHandoff: string[];
};

export type OptimizationSuggestionsInput = {
  title: string;
  currentDescription?: string | null;
  transcript?: string | null;
  destinations?: Array<{ name: string; url: string }>;
  /** Tone pill selected in AI Lab (Professional/Casual/Educational/Energetic) — optional, shapes
   *  the description's voice without inventing new content. */
  voice?: string | null;
  /** Free-text instructions from the user (e.g. "always mention the free toolkit first") — optional. */
  customInstructions?: string | null;
};

export type OptimizationSuggestionsResult = {
  description: string;
  titleIdeas: string[];
  tags: string[];
  ctaIdeas: string[];
};

export type LeadSummaryInput = {
  leadName: string;
  messages: Array<{ from: "lead" | "you" | "system"; text: string }>;
};

export type LeadSummaryResult = {
  painPoints: string[];
  desiredOutcomes: string[];
};

export type AssistantChatInput = {
  message: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  /** Real, live numbers about the creator's own workspace (deal counts, lead counts, link clicks,
   * etc.), gathered by the caller — never fabricated here. */
  accountContext: string;
};

export type FreebieInput = {
  product: string;
  audience: string;
  tone: string;
  /** Human-readable format label (e.g. "Cheatsheet", "Mini-Guide"). */
  formatLabel: string;
  /** Real material the creator dropped in (Knowledge Base notes/files) — ground the output in
   * this instead of inventing everything. */
  knowledgeContext?: string | null;
};

type Provider = "openrouter" | "openai" | "anthropic";

// OpenRouter checked first — it's the default/primary provider (see .env.example) — then the
// two providers this file already supported. Only one of these is expected to be configured in
// practice, so this order mainly matters for the (currently theoretical) case of more than one
// key being present at once.
function configuredProvider(): Provider | null {
  const configured = getServerEnv("AI_PROVIDER")?.toLowerCase();
  if (configured === "openrouter" || configured === "openai" || configured === "anthropic") {
    return configured;
  }
  if (getServerEnv("OPENROUTER_API_KEY")) return "openrouter";
  if (getServerEnv("OPENAI_API_KEY")) return "openai";
  if (getServerEnv("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

// openrouter/free (routes to a small, free reasoning model) proved unreliable for Tubify's real
// Analyze Video workload in testing — it intermittently returned non-JSON content or burned its
// entire token budget on hidden reasoning with no answer left. openai/gpt-4o-mini was selected to
// replace it after evaluating several current OpenRouter models against the actual prompt (long
// system instructions + transcript + strict JSON schema): 128k context, native strict
// structured-output support, no hidden reasoning tokens, ~$0.15/$0.60 per million prompt/
// completion tokens (roughly $0.0003-0.0004 per analysis), and passed real end-to-end trials
// (Zod-valid, no fabricated metrics, handles a missing transcript honestly) every time it was
// tried. This is the ONE place the default lives — OPENROUTER_MODEL overrides it without any
// other code change.
function providerModel(provider: Provider): string {
  if (provider === "openrouter") return getServerEnv("OPENROUTER_MODEL") ?? "openai/gpt-4o-mini";
  return provider === "openai"
    ? (getServerEnv("OPENAI_MODEL") ?? "gpt-5-mini")
    : (getServerEnv("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest");
}

// For callers that need to record which provider/model actually served a request (usage
// tracking, cache keys) without duplicating the selection logic above — returns null exactly
// when generateVideoAnalysis (or any other task in this file) would throw
// AI_PROVIDER_NOT_CONFIGURED, so callers can check this first and skip the AI call entirely.
export function getActiveProviderInfo(): { provider: Provider; model: string } | null {
  const provider = configuredProvider();
  if (!provider) return null;
  return { provider, model: providerModel(provider) };
}

// Deliberately instructs the model to say when the transcript is missing rather than guess at
// content it can't see — analysis quality is capped by title+description alone in that case, and
// the result should read as "here's what's known", not a fabricated deep-dive.
function analysisPromptFor(input: ContentAnalysisInput): { system: string; user: string } {
  const transcript = input.transcript?.trim().slice(0, 30_000) || "No transcript was provided.";
  const description = input.description?.trim().slice(0, 12_000) || "No description was provided.";
  return {
    system:
      'You analyze YouTube video content for creators. Base every statement strictly on the supplied title, description, and transcript — never invent facts, statistics, claims, or content details that aren\'t present in the source material. If no transcript was provided, say so explicitly in the summary and keep the rest of the analysis limited to what the title and description actually support, rather than guessing at content you cannot see. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape: {"mainTopic": string, "contentType": string, "audienceIntent": string, "complexity": string, "engagementPotential": string, "summary": string, "topics": string[], "strengths": string[], "opportunities": string[]}. mainTopic: 2-4 words, e.g. "Design / Figma". contentType: one or two words classifying the video, e.g. "Tutorial", "Vlog", "Review", "Interview" — infer only from what the content actually is. audienceIntent: a short phrase (3-6 words) describing what a viewer wants to get out of it, e.g. "Learn how to create". complexity: one word — "Beginner", "Intermediate", or "Advanced" — based on the actual content, not a guess. engagementPotential: one word — "Low", "Medium", or "High" — your honest assessment of how engaging the content/structure is, not a popularity prediction. summary: 2-3 sentences. topics: 3-6 short phrases. strengths: 2-4 short phrases on what the video/description does well. opportunities: 2-4 short phrases on what could be improved — never invent a weakness that isn\'t evidenced by the source material.',
    user: `Analyze this YouTube video's content.\n\nTITLE:\n${input.title}\n\nTRANSCRIPT:\n${transcript}\n\nDESCRIPTION:\n${description}`,
  };
}

function projectConceptPromptFor(input: ProjectConceptInput): { system: string; user: string } {
  return {
    system:
      'You help creators turn a one-line product idea into a starter concept for scoping an MVP. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape: {"summary": string, "wireframes": string[], "flowchart": string[], "developerHandoff": string[]}. summary: 1-2 sentences describing the concept, grounded in the given title and prompt. wireframes: 3-5 short screen or section names this product would actually need, specific to the given prompt, not generic placeholders. flowchart: 3-5 short steps describing the core user flow in order, specific to the given prompt. developerHandoff: 3-5 short concrete technical starting points (e.g. key data model pieces, API endpoints, or integration notes) relevant to the given prompt.',
    user: `Title: ${input.title}\n\nPrompt: ${input.prompt}`,
  };
}

function optimizationPromptFor(input: OptimizationSuggestionsInput): {
  system: string;
  user: string;
} {
  const transcript = input.transcript?.trim().slice(0, 30_000) || "No transcript was provided.";
  const currentDescription =
    input.currentDescription?.trim().slice(0, 12_000) || "No existing description was provided.";
  const destinations = (input.destinations ?? [])
    .slice(0, 12)
    .map((destination) => `- ${destination.name}: ${destination.url}`)
    .join("\n");
  const voice = input.voice?.trim();
  const customInstructions = input.customInstructions?.trim().slice(0, 2_000);
  return {
    system:
      'You write accurate YouTube optimization copy for creators. Never invent claims, figures, timestamps, links, sponsors, or outcomes not supported by the supplied title, transcript, or existing description. If a tone or custom instructions are supplied, follow them for style only — they never justify inventing unsupported content. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape: {"description": string, "titleIdeas": string[], "tags": string[], "ctaIdeas": string[]}. description: a polished YouTube description — preserve factual details from the source material, a concise opening, useful sections, and a short call to action only when supported by the input; no unsupported hashtags or timestamps; if destinations are supplied, include them as labeled links near the end. titleIdeas: 3-5 alternative titles that better communicate the outcome/search intent, grounded in the actual content. tags: 5-10 short YouTube search tags/keywords relevant to the actual content. ctaIdeas: 2-4 short call-to-action suggestions appropriate for this specific video (e.g. referencing a destination that was actually supplied, or a generic subscribe/comment prompt — never invent a specific offer that wasn\'t supplied).',
    user: `Generate optimization suggestions for this YouTube video.\n\nTITLE:\n${input.title}\n\nTRANSCRIPT:\n${transcript}\n\nEXISTING DESCRIPTION:\n${currentDescription}\n\nDESTINATIONS:\n${destinations || "None supplied."}\n\nTONE:\n${voice || "No specific tone requested."}\n\nCUSTOM INSTRUCTIONS:\n${customInstructions || "None supplied."}`,
  };
}

function leadSummaryPromptFor(input: LeadSummaryInput): { system: string; user: string } {
  const thread = input.messages
    .filter((m) => m.from !== "system")
    .slice(-30)
    .map((m) => `${m.from === "lead" ? input.leadName : "You"}: ${m.text}`)
    .join("\n");
  return {
    system:
      'You summarize a creator\'s conversation with a lead for their CRM. Base every statement strictly on the supplied message thread — never invent pain points, needs, or outcomes not evidenced by what was actually said. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape: {"painPoints": string[], "desiredOutcomes": string[]}. painPoints: 0-4 short phrases describing problems or frustrations the lead actually expressed — empty array if none are evidenced. desiredOutcomes: 0-4 short phrases describing what the lead actually said they want — empty array if none are evidenced. Never pad either list to reach a target length.',
    user: `Conversation with ${input.leadName}:\n\n${thread || "No messages yet."}`,
  };
}

// Ground truth about what Tubify actually does, kept in sync by hand with the real features —
// this is what stops Tubi from inventing capabilities, prices, or behavior the app doesn't have.
const TUBIFY_FEATURES_REFERENCE = `
- Dashboard: revenue, subscriber, and video KPIs plus trend charts, sourced from the creator's connected YouTube channel. YouTube Analytics figures typically lag 24-72h behind real-time; revenue lags roughly 48h.
- AI Lab: generates an optimized YouTube description for one of the creator's videos from its title/transcript. Can auto-generate a real short tracking link for each selected destination (or freebie) and weave those links into the description, so clicks are tracked per video.
- Link Tracking: create short links (yourapp.com/r/<slug>) that redirect to any destination and record real clicks and unique visitors. Workspaces can connect a custom domain (verified via a real DNS CNAME check) so links use that domain instead.
- Destinations: the creator's conversion links (courses, newsletters, communities, etc.) and social profiles. Each destination has a "See top performers" view showing which videos drove the most clicks to it.
- Lead Inbox: a real CRM for people who reached out via Instagram, Email, or a YouTube comment. Leads captured on different channels for the same person can be linked into one grouped thread. Supports notes, tags, status stages, and an AI-generated summary of pain points/desired outcomes from the real conversation.
- Comment Automation: rules that watch a connected channel's YouTube comments for keywords, an @handle, or a question, and can auto-reply on YouTube for real; each fired rule logs that commenter as a lead. Each auto-reply costs YouTube API quota (about 50 units).
- AI Freebie: generates a lead magnet (cheatsheet/guide/list/checklist) grounded in the creator's own Knowledge Base (pasted notes or uploaded files — text/Markdown/CSV/PDF get real text extraction). A creator can also just upload a finished file instead of generating one. Freebies get a brand kit (logo/colors/font) and, once "launched," a real public opt-in page (yourapp.com/f/<slug>) that captures an email (and optional Instagram handle) before unlocking the content/file — every opt-in creates a real lead in Lead Inbox.
- Deals: a pipeline (Prospect -> Pitched -> Negotiating -> Contracted -> Completed) for tracking brand deal/sponsorship opportunities.
- Email: campaigns are drafted and saved to the creator's own real "leads with an email on file" audience, but sending is not connected yet — a campaign stays a draft the creator would send manually elsewhere.
- Team: invite teammates with a role (owner/manager/setter/editor) that controls what pages/data they can see.
- Settings/Admin: workspace branding (for freebie pages), custom domain, and account preferences.
`.trim();

function assistantPromptFor(input: AssistantChatInput): { system: string; user: string } {
  const history = input.history
    .slice(-8)
    .map((m) => `${m.role === "user" ? "Creator" : "Tubi"}: ${m.text}`)
    .join("\n");
  return {
    system:
      "You are Tubi, the in-app assistant built into Tubify (a YouTube Revenue OS for creators). Answer questions about how to use its real features, and about the creator's own real account numbers supplied below. Be concise — this is a chat widget, not an essay: normally 1-4 sentences, or a short list only for genuine multi-step instructions. Never invent numbers, features, prices, integrations, or capabilities beyond what's described in the app reference or account snapshot below; if something isn't covered there, say you're not sure and point to the most relevant page instead of guessing. Never claim to take an action for the creator (you can't click buttons, change settings, or send anything) — only explain where and how they'd do it themselves. Respond with ONLY your reply to the creator, no preamble, no markdown headers.\n\nHOW TUBIFY WORKS:\n" +
      TUBIFY_FEATURES_REFERENCE,
    user: `${input.accountContext}\n\n${history ? `Recent conversation:\n${history}\n\n` : ""}Creator's new message: ${input.message}`,
  };
}

function freebiePromptFor(input: FreebieInput): { system: string; user: string } {
  const knowledge = input.knowledgeContext?.trim().slice(0, 40_000);
  return {
    system:
      "You write real, specific, immediately useful lead-magnet content for creators — the kind someone would actually value getting in exchange for their email. Never pad with generic filler, fake statistics, invented testimonials, or vague platitudes; every point must be concrete and actionable for the specific product and audience given. Match the requested tone. When source material is supplied, treat it as ground truth: draw the actual points, examples, and phrasing style from it, write in that voice, and never contradict it or invent facts beyond what it and the given product/audience support — the source material is the whole reason this output should feel like it has 'real sauce' instead of generic AI filler. Respond with ONLY the lead magnet content itself, formatted as clean Markdown with a single top-level heading, no commentary before or after, no code fences.",
    user: `Product/service: ${input.product}\n\nTarget audience: ${input.audience}\n\nBrand tone: ${input.tone}\n\nFormat: ${input.formatLabel}\n\nSOURCE MATERIAL (the creator's own knowledge, sheets, and transcripts — ground the content in this):\n${knowledge || "None supplied — write from the product/audience/tone alone."}\n\nWrite the ${input.formatLabel.toLowerCase()} now.`,
  };
}

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function providerFailure(provider: Provider, status?: number): Error {
  return new Error(`AI_PROVIDER_FAILED:${provider}:${status ?? "network"}`);
}

// Real per-request token/cost accounting, when the provider reports it — currently only
// populated by callOpenRouter (the one caller, generateVideoAnalysis, that needs it for usage
// tracking). callOpenAi/callAnthropic report null rather than being retrofitted to extract it,
// since no existing caller needs it from those paths.
export type ProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};
type ProviderResponse = { text: string; usage: ProviderUsage | null };

// OpenAI-compatible strict structured-output mode (supported by OpenRouter and OpenAI directly) —
// stronger than jsonMode's loose "please output JSON" instruction: the API itself constrains
// generation to this exact shape, so a model that supports it structurally cannot return a
// differently-shaped object. jsonMode (response_format: json_object) remains the fallback for
// providers/models that don't support json_schema — the Zod parse below is still the final
// authority either way, in case a provider's structured-output claim doesn't fully hold up.
export type JsonSchemaSpec = { name: string; strict?: boolean; schema: Record<string, unknown> };
type CallOptions = { jsonMode?: boolean; jsonSchema?: JsonSchemaSpec; maxTokens?: number };

function responseFormatFor(options: CallOptions): Record<string, unknown> | undefined {
  if (options.jsonSchema) return { type: "json_schema", json_schema: options.jsonSchema };
  if (options.jsonMode) return { type: "json_object" };
  return undefined;
}

async function callOpenAi(
  system: string,
  user: string,
  options: CallOptions = {},
): Promise<ProviderResponse> {
  const key = getServerEnv("OPENAI_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const responseFormat = responseFormatFor(options);
  let response: Response;
  try {
    response = await providerFetch(
      getServerEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: providerModel("openai"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_completion_tokens: 2000,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
      },
    );
  } catch {
    throw providerFailure("openai");
  }
  if (!response.ok) throw providerFailure("openai", response.status);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw providerFailure("openai");
  return { text, usage: null };
}

async function callAnthropic(system: string, user: string): Promise<ProviderResponse> {
  const key = getServerEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  let response: Response;
  try {
    response = await providerFetch(
      getServerEnv("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: providerModel("anthropic"),
          system,
          messages: [{ role: "user", content: user }],
          max_tokens: 2000,
        }),
      },
    );
  } catch {
    throw providerFailure("anthropic");
  }
  if (!response.ok) throw providerFailure("anthropic", response.status);
  const body = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = body.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("")
    .trim();
  if (!text) throw providerFailure("anthropic");
  return { text, usage: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Transient = worth a retry (network blip, momentary 5xx, or a 429 the caller should briefly back
// off from). Never retried: 400 (malformed request/prompt) and 401/403 (invalid or missing API
// key) — retrying those just repeats the same failure and burns quota/time for nothing.
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// OpenRouter's chat/completions endpoint is OpenAI-compatible, so the request/response shape
// mirrors callOpenAi above — this is deliberately its own function (rather than parameterizing
// callOpenAi) because it also adds the retry/backoff behavior specific to this integration, and
// keeping OpenRouter's specifics isolated here matches how Anthropic's differences are kept out
// of callOpenAi rather than merged into one "generic" caller.
async function callOpenRouter(
  system: string,
  user: string,
  options: CallOptions = {},
): Promise<ProviderResponse> {
  const key = getServerEnv("OPENROUTER_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const url =
    getServerEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1/chat/completions";
  const responseFormat = responseFormatFor(options);
  const body = JSON.stringify({
    model: providerModel("openrouter"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: options.maxTokens ?? 2000,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  });

  const maxAttempts = 3;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await providerFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // Optional, non-sensitive — identifies this app on OpenRouter's own dashboard/leaderboard.
          "X-Title": "Tubify",
        },
        body,
      });
    } catch {
      if (attempt < maxAttempts) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw providerFailure("openrouter");
    }
    if (response.ok) {
      const responseBody = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          cost?: number;
        };
      };
      const text = responseBody.choices?.[0]?.message?.content?.trim();
      if (!text) throw providerFailure("openrouter");
      const usage: ProviderUsage | null = responseBody.usage
        ? {
            inputTokens: responseBody.usage.prompt_tokens ?? null,
            outputTokens: responseBody.usage.completion_tokens ?? null,
            costUsd: responseBody.usage.cost ?? null,
          }
        : null;
      return { text, usage };
    }
    lastStatus = response.status;
    if (isTransientStatus(response.status) && attempt < maxAttempts) {
      await sleep(300 * 2 ** (attempt - 1));
      continue;
    }
    throw providerFailure("openrouter", response.status);
  }
  throw providerFailure("openrouter", lastStatus);
}

async function callProvider(
  provider: Provider,
  system: string,
  user: string,
  options: CallOptions = {},
): Promise<ProviderResponse> {
  if (provider === "openrouter") return callOpenRouter(system, user, options);
  return provider === "openai" ? callOpenAi(system, user, options) : callAnthropic(system, user);
}

// Strips a ```json fence if the model added one despite instructions not to — Anthropic in
// particular sometimes wraps JSON responses in markdown even when told not to.
function stripJsonFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseJsonResponse(provider: Provider, raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stripJsonFence(raw));
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw providerFailure(provider);
  }
}

export async function generateContentAnalysis(
  input: ContentAnalysisInput,
): Promise<ContentAnalysisResult> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = analysisPromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user, {
    jsonMode: true,
  });
  const parsed = parseJsonResponse(provider, raw);
  if (
    typeof parsed.mainTopic !== "string" ||
    typeof parsed.contentType !== "string" ||
    typeof parsed.audienceIntent !== "string" ||
    typeof parsed.complexity !== "string" ||
    typeof parsed.engagementPotential !== "string" ||
    typeof parsed.summary !== "string" ||
    !isStringArray(parsed.topics) ||
    !isStringArray(parsed.strengths) ||
    !isStringArray(parsed.opportunities)
  ) {
    throw providerFailure(provider);
  }
  return parsed as unknown as ContentAnalysisResult;
}

export async function generateProjectConcept(
  input: ProjectConceptInput,
): Promise<ProjectConceptResult> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = projectConceptPromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user, {
    jsonMode: true,
  });
  const parsed = parseJsonResponse(provider, raw);
  if (
    typeof parsed.summary !== "string" ||
    !isStringArray(parsed.wireframes) ||
    !isStringArray(parsed.flowchart) ||
    !isStringArray(parsed.developerHandoff)
  ) {
    throw providerFailure(provider);
  }
  return parsed as unknown as ProjectConceptResult;
}

export async function generateOptimizationSuggestions(
  input: OptimizationSuggestionsInput,
): Promise<OptimizationSuggestionsResult> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = optimizationPromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user, {
    jsonMode: true,
  });
  const parsed = parseJsonResponse(provider, raw);
  if (
    typeof parsed.description !== "string" ||
    !isStringArray(parsed.titleIdeas) ||
    !isStringArray(parsed.tags) ||
    !isStringArray(parsed.ctaIdeas)
  ) {
    throw providerFailure(provider);
  }
  return parsed as unknown as OptimizationSuggestionsResult;
}

export async function generateLeadSummary(input: LeadSummaryInput): Promise<LeadSummaryResult> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = leadSummaryPromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user, {
    jsonMode: true,
  });
  const parsed = parseJsonResponse(provider, raw);
  if (!isStringArray(parsed.painPoints) || !isStringArray(parsed.desiredOutcomes)) {
    throw providerFailure(provider);
  }
  return parsed as unknown as LeadSummaryResult;
}

// Plain text, not JSON — a chat reply is prose to read, not data to parse.
export async function generateAssistantReply(input: AssistantChatInput): Promise<string> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = assistantPromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user);
  const text = stripJsonFence(raw).trim();
  if (!text) throw providerFailure(provider);
  return text;
}

// Plain Markdown output, not JSON — a lead magnet is prose/structured content to read, not data
// to parse.
export async function generateFreebieContent(input: FreebieInput): Promise<string> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = freebiePromptFor(input);
  const { text: raw } = await callProvider(provider, prompt.system, prompt.user);
  const text = stripJsonFence(raw).trim();
  if (!text) throw providerFailure(provider);
  return text;
}

// ============================================================
// Analyze Video — Tubify's AI-powered content intelligence report for a single YouTube video.
// Bump this whenever analyzeVideoPromptFor's instructions or the output shape change; callers use
// it as part of the analysis cache key so a prompt change can never silently serve a stale-shaped
// cached result.
//
// v2 (current): switched to OpenRouter's strict json_schema structured-output mode (see
// ANALYZE_VIDEO_JSON_SCHEMA below) instead of relying solely on prompt instructions for shape —
// the schema-spelled-out-in-prose text is no longer needed since the API itself now enforces the
// shape, so the prompt was rewritten shorter, and explicit FACTS/INFERENCES/RECOMMENDATIONS
// framing was added. Also moved off openrouter/free (unreliable for this workload in real
// testing — see the model-selection note on generateVideoAnalysis) onto a specific capable model.
export const ANALYZE_VIDEO_PROMPT_VERSION = "v2";

export type AnalyzeVideoInput = {
  video: {
    videoId: string;
    title: string;
    description: string | null;
    publishedAt: string | null;
    durationSeconds: number | null;
    channelName: string | null;
  };
  // null = legitimately unavailable (no caption track, or none pasted by the user) — never an
  // empty string standing in for "none", so the prompt below can tell the model the difference.
  transcript: string | null;
  performance: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    watchTimeMinutes: number | null;
    averageViewDurationSeconds: number | null;
    averageViewPercentage: number | null;
    estimatedRevenueUsd: number | null;
  };
  channel: {
    subscriberCount: number | null;
  };
};

const scoreSchema = z.number().min(0).max(10);
export const AnalyzeVideoResultSchema = z.object({
  summary: z.string().min(1),
  overallScore: scoreSchema,
  scores: z.object({
    hook: scoreSchema,
    title: scoreSchema,
    seo: scoreSchema,
    content: scoreSchema,
    engagement: scoreSchema,
  }),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  titleSuggestions: z.array(z.string()),
  descriptionSuggestion: z.string(),
  keywordSuggestions: z.array(z.string()),
  recommendations: z.array(z.string()),
  contentIdeas: z.array(z.string()),
});
export type AnalyzeVideoResult = z.infer<typeof AnalyzeVideoResultSchema>;

// Hand-written rather than generated from AnalyzeVideoResultSchema (no zod-to-json-schema
// dependency in this project) — keep the two in sync by hand when either changes. This is passed
// to OpenRouter/OpenAI's strict structured-output mode; Zod validation below remains the final
// application-level authority regardless of what the provider claims to guarantee.
export const ANALYZE_VIDEO_JSON_SCHEMA: JsonSchemaSpec = {
  name: "analyze_video_result",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      overallScore: { type: "number" },
      scores: {
        type: "object",
        properties: {
          hook: { type: "number" },
          title: { type: "number" },
          seo: { type: "number" },
          content: { type: "number" },
          engagement: { type: "number" },
        },
        required: ["hook", "title", "seo", "content", "engagement"],
        additionalProperties: false,
      },
      strengths: { type: "array", items: { type: "string" } },
      weaknesses: { type: "array", items: { type: "string" } },
      titleSuggestions: { type: "array", items: { type: "string" } },
      descriptionSuggestion: { type: "string" },
      keywordSuggestions: { type: "array", items: { type: "string" } },
      recommendations: { type: "array", items: { type: "string" } },
      contentIdeas: { type: "array", items: { type: "string" } },
    },
    required: [
      "summary",
      "overallScore",
      "scores",
      "strengths",
      "weaknesses",
      "titleSuggestions",
      "descriptionSuggestion",
      "keywordSuggestions",
      "recommendations",
      "contentIdeas",
    ],
    additionalProperties: false,
  },
};

function numOrUnavailable(value: number | null, unit = ""): string {
  return value === null || value === undefined
    ? "Not available"
    : `${value.toLocaleString()}${unit}`;
}

// Characters, not tokens (~4 chars/token for English) — 60,000 chars is roughly 13-15k tokens,
// comfortable within gpt-4o-mini's 128k context alongside the rest of the prompt, while covering
// the large majority of real YouTube transcripts (a 60-90 minute video at typical speaking pace).
// Simple hard truncation rather than chunking/summarization, per the "simplest reliable strategy"
// guidance — a video long enough to exceed this is rare, and the truncation is always disclosed
// to the model (and, via the same marker text, implicitly to anyone reading the raw prompt in
// logs/tests) rather than silently dropping the tail.
const TRANSCRIPT_CHAR_LIMIT = 60_000;

function truncatedTranscript(raw: string | null): string | null {
  const trimmed = raw?.trim() || null;
  if (!trimmed) return null;
  if (trimmed.length <= TRANSCRIPT_CHAR_LIMIT) return trimmed;
  return `${trimmed.slice(0, TRANSCRIPT_CHAR_LIMIT)}\n\n[TRANSCRIPT TRUNCATED — ${trimmed.length - TRANSCRIPT_CHAR_LIMIT} more characters were cut off. Base your analysis only on the portion shown, and note in the summary that this reflects only part of the video.]`;
}

// Exported for tests to verify unavailable metrics render as "Not available" text rather than
// silently becoming 0/blank — not called directly by any other module.
export function analyzeVideoPromptFor(input: AnalyzeVideoInput): { system: string; user: string } {
  const transcript = truncatedTranscript(input.transcript);
  const description = input.video.description?.trim().slice(0, 12_000) || null;

  // Short and unambiguous by design — the response *shape* is enforced structurally by
  // ANALYZE_VIDEO_JSON_SCHEMA now, so the prompt only needs to cover what the shape can't: which
  // parts of the answer are grounded facts vs. this model's own judgment, and the one hard rule
  // (never invent a metric).
  const system = [
    "You are Tubify's YouTube content analysis assistant, producing a content-intelligence report for one video.",
    "",
    "The user message gives you three kinds of information:",
    "- FACTS: video metadata and performance metrics, sourced directly from YouTube. Never contradict, recompute, or round these. A metric marked 'Not available' does not exist for this video — never treat it as zero, and never invent a value for it (this applies especially to revenue, views, watch time, retention, and subscriber count).",
    "- CONTENT: the title, description, and transcript (if supplied) — the only source for judging what the video is actually about and how it's made.",
    "- Your job: produce INFERENCES (scores, strengths, weaknesses — your honest read of the FACTS and CONTENT) and RECOMMENDATIONS (titleSuggestions, descriptionSuggestion, keywordSuggestions, recommendations, contentIdeas — your suggestions for what to do next). Write INFERENCES as observations about what exists; write RECOMMENDATIONS as suggestions, not claims about what already exists.",
    "",
    "Rules: base every statement on the supplied FACTS/CONTENT only, never generic advice that could apply to any video. If no transcript was supplied, say so in the summary and keep content-quality judgments limited to the title and description. Scores are 0-10, decimals allowed. Return only the structured response — no extra commentary.",
  ].join("\n");

  const performanceLines = [
    `Views: ${numOrUnavailable(input.performance.views)}`,
    `Likes: ${numOrUnavailable(input.performance.likes)}`,
    `Comments: ${numOrUnavailable(input.performance.comments)}`,
    `Watch time (minutes, recent period): ${numOrUnavailable(input.performance.watchTimeMinutes)}`,
    `Average view duration (seconds): ${numOrUnavailable(input.performance.averageViewDurationSeconds)}`,
    `Average view percentage (retention): ${numOrUnavailable(input.performance.averageViewPercentage, "%")}`,
    `Estimated revenue (USD): ${numOrUnavailable(input.performance.estimatedRevenueUsd)}`,
    `Subscriber count: ${numOrUnavailable(input.channel.subscriberCount)}`,
  ].join("\n");

  const user = [
    `FACTS:`,
    `Video ID: ${input.video.videoId}`,
    `Title: ${input.video.title}`,
    `Channel: ${input.video.channelName ?? "Not available"}`,
    `Published: ${input.video.publishedAt ?? "Not available"}`,
    `Duration (seconds): ${numOrUnavailable(input.video.durationSeconds)}`,
    performanceLines,
    "",
    `CONTENT — description:`,
    description ?? "Not available",
    "",
    `CONTENT — transcript:`,
    transcript ??
      "Not available — base content-quality judgments only on the title and description, and say so in the summary.",
  ].join("\n");

  return { system, user };
}

function parseAndValidateJson<T>(provider: Provider, raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    throw providerFailure(provider);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw providerFailure(provider);
  return result.data;
}

export async function generateVideoAnalysis(
  input: AnalyzeVideoInput,
): Promise<{ result: AnalyzeVideoResult; usage: ProviderUsage | null }> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = analyzeVideoPromptFor(input);
  // jsonSchema (strict structured output) takes priority over jsonMode inside callOpenAi/
  // callOpenRouter when both are set — jsonMode stays here only as a hint for a provider/model
  // that doesn't support structured_outputs and would otherwise get no response_format at all.
  // 3000 tokens (up from the 2000 other tasks in this file use): comfortable headroom for the
  // largest realistic answer (5 title suggestions + a full description + 10 keywords + 6
  // recommendations + 5 content ideas) without inviting an unnecessarily long response — and,
  // per the model-selection note above, the configured default doesn't spend this budget on
  // hidden reasoning tokens the way openrouter/free did.
  const { text: raw, usage } = await callProvider(provider, prompt.system, prompt.user, {
    jsonMode: true,
    jsonSchema: ANALYZE_VIDEO_JSON_SCHEMA,
    maxTokens: 3000,
  });
  const result = parseAndValidateJson(provider, raw, AnalyzeVideoResultSchema);
  return { result, usage };
}
