import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { ThemeInjector } from "@/components/ThemeInjector";
import { ThemeModeApplier } from "@/components/ThemeModeApplier";
import { CookieConsent } from "@/components/CookieConsent";

// Sets the dark class before first paint, so there's no flash of the wrong theme while React
// hydrates. Reads the same localStorage key useThemeMode()/useLocalStore write (JSON-encoded),
// mirroring the "system" resolution logic in src/lib/theme.ts. Also sets the ios26 class from the
// Customization → General "iOS 26 Design" toggle (stored on yroos.siteContent) for the same
// reason — ThemeInjector's effect runs after first paint, which would otherwise flash flat-then-glass.
// Defaults to true (glass on) when the key is missing, matching seedSiteContent's default.
const NO_FLASH_THEME_SCRIPT = `(function(){try{var raw=localStorage.getItem("yroos.theme");var mode=raw?JSON.parse(raw):"system";var isDark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(isDark)document.documentElement.classList.add("dark");}catch(e){}try{var rawContent=localStorage.getItem("yroos.siteContent");var content=rawContent?JSON.parse(rawContent):null;var ios26=content&&typeof content.ios26Design==="boolean"?content.ios26Design:true;if(ios26)document.documentElement.classList.add("ios26");}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, interactive-widget=resizes-content" },
      { title: "Tubify — Turn Your Channel into a Sales Engine" },
      { name: "description", content: "Tubify ingests videos, auto-writes AI descriptions from transcripts, tracks multi-destination links,attributes Stripe sales, and automates comment engagement." },
      { name: "author", content: "Tubify" },
      { property: "og:title", content: "Tubify — Turn Your Channel into a Sales Engine" },
      { property: "og:description", content: "Tubify ingests videos, auto-writes AI descriptions from transcripts, tracks multi-destination links,attributes Stripe sales, and automates comment engagement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Tubify — Turn Your Channel into a Sales Engine" },
      { name: "twitter:description", content: "Tubify ingests videos, auto-writes AI descriptions from transcripts, tracks multi-destination links,attributes Stripe sales, and automates comment engagement." },
      { property: "og:image", content: "/logo.png" },
      { name: "twitter:image", content: "/logo.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeInjector />
      <ThemeModeApplier />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
      <CookieConsent />
    </QueryClientProvider>
  );
}
