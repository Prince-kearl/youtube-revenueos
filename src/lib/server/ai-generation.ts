import { getServerEnv } from "./env";

export type GenerateVideoDescriptionInput = {
  title: string;
  currentDescription?: string | null;
  transcript?: string | null;
  destinations?: Array<{ name: string; url: string }>;
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

function promptFor(input: GenerateVideoDescriptionInput): { system: string; user: string } {
  const transcript = input.transcript?.trim().slice(0, 30_000) || "No transcript was provided.";
  const currentDescription =
    input.currentDescription?.trim().slice(0, 12_000) || "No existing description was provided.";
  const destinations = (input.destinations ?? [])
    .slice(0, 12)
    .map((destination) => `- ${destination.name}: ${destination.url}`)
    .join("\n");
  return {
    system:
      "You write accurate YouTube descriptions for creators. Never invent claims, figures, timestamps, links, sponsors, or outcomes. Use only the supplied title, transcript, and existing description. Return plain text only, without commentary about your process.",
    user: `Create a polished YouTube description for this video. Preserve factual details from the source material, organize the copy with a concise opening, useful sections, and a short call to action only when supported by the input. Do not add unsupported hashtags or timestamps. If destinations are supplied, include them as labeled links near the end.\n\nTITLE:\n${input.title}\n\nTRANSCRIPT:\n${transcript}\n\nEXISTING DESCRIPTION:\n${currentDescription}\n\nDESTINATIONS:\n${destinations || "None supplied."}`,
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

async function generateOpenAi(input: GenerateVideoDescriptionInput): Promise<string> {
  const key = getServerEnv("OPENAI_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = promptFor(input);
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
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_completion_tokens: 1600,
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

async function generateAnthropic(input: GenerateVideoDescriptionInput): Promise<string> {
  const key = getServerEnv("ANTHROPIC_API_KEY");
  if (!key) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const prompt = promptFor(input);
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
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
          max_tokens: 1600,
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

export async function generateVideoDescription(
  input: GenerateVideoDescriptionInput,
): Promise<string> {
  const provider = configuredProvider();
  if (!provider) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  return provider === "openai" ? generateOpenAi(input) : generateAnthropic(input);
}
