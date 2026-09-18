import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Download, Gift, Loader2, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { renderMarkdown } from "@/lib/markdown";
import { freebieFormatLabel } from "@/lib/freebie-formats";

export const Route = createFileRoute("/f/$slug")({
  component: PublicFreebie,
});

type PublicMeta = {
  title: string;
  teaser: string | null;
  format: string;
  workspaceName: string | null;
  branding: {
    logoUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
    fontFamily: string;
  };
};
type Unlocked =
  | { kind: "file"; downloadUrl: string; fileName: string | null }
  | { kind: "content"; content: string; title: string };

function optinErrorMessage(error: string | undefined): string {
  const messages: Record<string, string> = {
    VALIDATION_ERROR: "Enter a real email address.",
    NOT_FOUND: "This freebie isn't available anymore.",
    FILE_UNAVAILABLE: "We couldn't prepare your download. Please try again.",
    CONTENT_UNAVAILABLE: "We couldn't load this freebie. Please try again.",
  };
  return messages[error ?? ""] ?? "Something went wrong. Please try again.";
}

function PublicFreebie() {
  const { slug } = Route.useParams();
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [meta, setMeta] = useState<PublicMeta | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [instagram, setInstagram] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [unlocked, setUnlocked] = useState<Unlocked | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/freebies/public?slug=${encodeURIComponent(slug)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { data?: PublicMeta; error?: string };
        if (response.status === 404) return setStatus("notfound");
        if (!response.ok || !body.data) throw new Error();
        setMeta(body.data);
        if (body.data.title) document.title = body.data.title;
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [slug]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/freebies/optin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          email: email.trim(),
          name: name.trim() || null,
          instagram: instagram.trim() || null,
        }),
      });
      const body = (await response.json()) as { data?: Unlocked; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "SERVER_ERROR");
      setUnlocked(body.data);
    } catch (error) {
      toast.error(optinErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  const primary = meta?.branding.primaryColor || "#7c3aed";
  const accent = meta?.branding.accentColor || primary;

  return (
    <div
      className="freebie-public-page min-h-screen bg-[#f5f5f7] px-4 py-10 sm:py-16"
      style={
        {
          fontFamily: meta?.branding.fontFamily,
          "--freebie-primary": primary,
          "--freebie-accent": accent,
        } as React.CSSProperties
      }
    >
      <style>{`
        @media print {
          .freebie-chrome { display: none !important; }
          .freebie-public-page { background: #fff !important; padding: 0 !important; }
        }
        .freebie-content h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 .75rem; }
        .freebie-content h2 { font-size: 1.2rem; font-weight: 700; margin: 1.5rem 0 .5rem; }
        .freebie-content h3 { font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 .4rem; }
        .freebie-content p { margin: 0 0 .85rem; }
        .freebie-content ul { margin: 0 0 .85rem; padding-left: 1.25rem; list-style: disc; }
        .freebie-content ol { margin: 0 0 .85rem; padding-left: 1.25rem; list-style: decimal; }
        .freebie-content li { margin: 0 0 .35rem; }
        .freebie-content strong { font-weight: 700; }
        .freebie-content a { color: var(--freebie-accent); text-decoration: underline; }
        .freebie-content hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.25rem 0; }
      `}</style>

      <div className="mx-auto max-w-xl">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-neutral-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-neutral-500">
            <p>We couldn't load this page. Please refresh and try again.</p>
          </div>
        )}

        {status === "notfound" && (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-10 text-center shadow-sm">
            <Gift className="h-8 w-8 text-neutral-300" />
            <p className="font-medium text-neutral-700">This freebie isn't available.</p>
            <p className="text-sm text-neutral-500">
              It may have been unpublished, or the link is incorrect.
            </p>
          </div>
        )}

        {status === "ready" && meta && (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="freebie-chrome flex flex-col items-center gap-3 px-8 pb-2 pt-10 text-center">
              {meta.branding.logoUrl && (
                <img
                  src={meta.branding.logoUrl}
                  alt={meta.workspaceName ?? "Logo"}
                  className="h-10 max-w-[180px] object-contain"
                />
              )}
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                style={{ backgroundColor: `${primary}1a`, color: primary }}
              >
                <Sparkles className="h-3 w-3" /> Free {freebieFormatLabel(meta.format)}
              </span>
            </div>

            {!unlocked && (
              <div className="freebie-chrome px-8 pb-10 pt-4 text-center">
                <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{meta.title}</h1>
                {meta.teaser && <p className="mt-2 text-sm text-neutral-600">{meta.teaser}</p>}
                <form onSubmit={submit} className="mx-auto mt-6 max-w-sm space-y-2.5 text-left">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name (optional)"
                    className="h-11 w-full rounded-full border border-neutral-200 px-4 text-sm outline-none focus:border-neutral-400"
                  />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    className="h-11 w-full rounded-full border border-neutral-200 px-4 text-sm outline-none focus:border-neutral-400"
                  />
                  <input
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="Instagram handle (optional)"
                    className="h-11 w-full rounded-full border border-neutral-200 px-4 text-sm outline-none focus:border-neutral-400"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{ backgroundColor: primary }}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Get it free →"}
                  </button>
                </form>
                {meta.workspaceName && (
                  <p className="mt-6 text-[11px] text-neutral-400">
                    Brought to you by {meta.workspaceName}
                  </p>
                )}
              </div>
            )}

            {unlocked?.kind === "file" && (
              <div className="px-8 pb-10 pt-4 text-center">
                <p className="freebie-chrome text-sm text-neutral-600">
                  You're in! Your download is ready.
                </p>
                <a
                  href={unlocked.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ backgroundColor: primary }}
                  className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold text-white hover:opacity-90"
                >
                  <Download className="h-4 w-4" /> Download {unlocked.fileName ?? "your freebie"}
                </a>
              </div>
            )}

            {unlocked?.kind === "content" && (
              <div className="px-6 pb-10 pt-2 sm:px-8">
                <div className="freebie-chrome mb-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400"
                  >
                    <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
                  </button>
                </div>
                <div
                  className="freebie-content rounded-xl border border-neutral-100 p-6 text-sm leading-relaxed text-neutral-800"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(unlocked.content) }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
