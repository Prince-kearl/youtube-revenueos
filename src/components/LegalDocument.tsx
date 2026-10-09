import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Mail } from "lucide-react";
import { Logo } from "@/components/Logo";

// The shared shell for Tubify's public legal pages (Privacy Policy, Terms of Service).
//
// These pages must be readable without an account — visitors arrive from the landing page's
// footer, and Google's OAuth and YouTube API reviews open them signed out — so they do NOT use
// DashboardLayout, which sends signed-out visitors back to the landing page.

export const LEGAL_CONTACT_EMAIL = "youtubesoftware5@gmail.com";
export const LEGAL_WEBSITE_URL = "https://youtube-revenueos.vercel.app/";

/** The legal pages, in the order they are cross-linked in each page's footer. */
export const LEGAL_PAGES = [
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" },
] as const;

// ---------- building blocks for a page's sections ----------

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 first:mt-0">{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold text-foreground first:mt-0">{children}</h3>;
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-primary/70">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

const linkClass =
  "font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm";

/** A link to another site: opens in a new tab without handing over the opener. */
export function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

/** A link to one of Tubify's own legal pages. */
export function LegalLink({
  to,
  children,
}: {
  to: (typeof LEGAL_PAGES)[number]["to"];
  children: ReactNode;
}) {
  return (
    <Link to={to} className={linkClass}>
      {children}
    </Link>
  );
}

export function Email({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className={linkClass}>
      {address}
    </a>
  );
}

/** The boxed "Tubify / Email / Website" block that closes each document. */
export function ContactBlock() {
  return (
    <address className="mt-4 rounded-xl border border-border bg-accent/30 p-5 not-italic">
      <p className="font-semibold text-foreground">Tubify</p>
      <dl className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Email:</dt>
          <dd>
            <Email address={LEGAL_CONTACT_EMAIL} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Website:</dt>
          <dd>
            <External href={LEGAL_WEBSITE_URL}>{LEGAL_WEBSITE_URL}</External>
          </dd>
        </div>
      </dl>
    </address>
  );
}

// ---------- the document ----------

export interface LegalSection {
  /** Used for in-page links (and for links into the page from elsewhere in the app). */
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalDocument({
  path,
  title,
  lastUpdated,
  lastUpdatedIso,
  intro,
  sections,
  closing,
}: {
  /** This page's own route, so its footer can link to the other legal pages. */
  path: (typeof LEGAL_PAGES)[number]["to"];
  title: string;
  /** As shown, e.g. "October 9, 2026". */
  lastUpdated: string;
  /** Machine-readable form of the same date, e.g. "2026-10-09". */
  lastUpdatedIso: string;
  /** The paragraphs before the first numbered section. */
  intro: ReactNode;
  sections: LegalSection[];
  /** The statement under the last section. */
  closing: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#document"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to the document
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur print:static print:border-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link to="/" aria-label="Tubify home" className="shrink-0">
            <Logo />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Tubify
          </Link>
        </div>
      </header>

      <main id="document" className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Legal</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Last updated: <time dateTime={lastUpdatedIso}>{lastUpdated}</time>
          </p>
          <div className="mt-8 space-y-3 text-base leading-relaxed text-muted-foreground">
            {intro}
          </div>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
          <nav
            aria-label="On this page"
            className="self-start rounded-xl border border-border bg-card/60 p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto print:hidden"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              On this page
            </p>
            <ol className="mt-3 space-y-1.5 text-sm">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex gap-2 rounded-md py-0.5 text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="w-5 shrink-0 tabular-nums text-muted-foreground/70">
                      {index + 1}.
                    </span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="min-w-0 max-w-3xl">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-24 border-t border-border py-9 first:border-t-0 first:pt-0"
              >
                <h2
                  id={`${section.id}-title`}
                  className="flex items-baseline gap-3 text-2xl font-semibold tracking-tight"
                >
                  <span className="text-base font-semibold tabular-nums text-primary">
                    {index + 1}.
                  </span>
                  {section.title}
                </h2>
                <div className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
                  {section.body}
                </div>
              </section>
            ))}

            <p className="mt-2 border-t border-border pt-8 text-sm text-muted-foreground">
              {closing}
            </p>
          </article>
        </div>
      </main>

      <footer className="border-t border-border print:hidden">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground sm:flex-row sm:px-8">
          <span>&copy; {new Date().getFullYear()} Tubify</span>
          <nav
            aria-label="Legal"
            className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
          >
            {LEGAL_PAGES.map((page) =>
              page.to === path ? (
                <span key={page.to} aria-current="page" className="font-medium text-foreground">
                  {page.label}
                </span>
              ) : (
                <Link key={page.to} to={page.to} className="hover:text-foreground">
                  {page.label}
                </Link>
              ),
            )}
            <a
              href={`mailto:${LEGAL_CONTACT_EMAIL}`}
              className="flex items-center gap-1.5 hover:text-foreground"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
