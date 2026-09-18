import { extractText } from "unpdf";

// What the Knowledge Base can actually turn into prompt-usable text right now. Anything else is
// still stored (so the creator keeps the file) but flagged 'unsupported' rather than silently
// dropped or fabricated.
const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json"];
const MAX_CHARS = 200_000;

export type ExtractionResult = {
  status: "ready" | "unsupported" | "failed";
  content: string | null;
};

export async function extractTextFromFile(file: File): Promise<ExtractionResult> {
  const name = file.name.toLowerCase();
  const type = file.type;

  try {
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const data = new Uint8Array(await file.arrayBuffer());
      const { text } = await extractText(data, { mergePages: true });
      const trimmed = text.trim();
      return trimmed
        ? { status: "ready", content: trimmed.slice(0, MAX_CHARS) }
        : { status: "failed", content: null };
    }

    if (type.startsWith("text/") || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      const text = (await file.text()).trim();
      return text
        ? { status: "ready", content: text.slice(0, MAX_CHARS) }
        : { status: "failed", content: null };
    }

    return { status: "unsupported", content: null };
  } catch {
    return { status: "failed", content: null };
  }
}
