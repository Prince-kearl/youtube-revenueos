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

type Provider = "openai" | "anthropic";

function configuredProvider(): Provider | null {
  const configured = getServerEnv("AI_PROVIDER")?.toLowerCase();
  if (configured === "openai" || configured === "anthropic") return configured;
  if (getServerEnv("OPENAI_API_KEY")) return "openai";
  if (getServerEnv("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

function providerModel(provider: Provider): string {
  return provider === "openai"
    ? (getServerEnv("OPENAI_MODEL") ?? "gpt-5-mini")
    : (getServerEnv("ANTHROPIC_MODEL") ?? "claude-3-5-sonnet-latest");
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

async function callOpenAi(
  system: string,
  user: string,
  options: { jsonMode?: boolean } = {},
): Promise<string> {
  const key = getServerEnv("OPENAI_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
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
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
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
  return text;
}

async function callAnthropic(system: string, user: string): Promise<string> {
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
  return text;
}

async function callProvider(
  provider: Provider,
  system: string,
  user: string,
  options: { jsonMode?: boolean } = {},
): Promise<string> {
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
  const raw = await callProvider(provider, prompt.system, prompt.user, { jsonMode: true });
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
  const raw = await callProvider(provider, prompt.system, prompt.user, { jsonMode: true });
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
  const raw = await callProvider(provider, prompt.system, prompt.user, { jsonMode: true });
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
  const raw = await callProvider(provider, prompt.system, prompt.user, { jsonMode: true });
  const parsed = parseJsonResponse(provider, raw);
  if (!isStringArray(parsed.painPoints) || !isStringArray(parsed.desiredOutcomes)) {
    throw providerFailure(provider);
  }
  return parsed as unknown as LeadSummaryResult;
}
