import { useEffect, useState } from "react";
import { commandCenterUrl, type CommandCenterRange } from "@/lib/command-center-view";
import type { CommandCenterResponse } from "@/lib/server/command-center";
import {
  RevenueCommandCenterContent,
  type CommandCenterState,
} from "@/components/RevenueCommandCenterView";

// Dashboard → Revenue command center: its own request, period, loading and error states, so the
// rest of the dashboard never waits for it or is taken down by it.

export function RevenueCommandCenter() {
  const [range, setRange] = useState<CommandCenterRange>("3M");
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<CommandCenterState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) =>
      previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" },
    );
    fetch(commandCenterUrl(range), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          setState({ status: "restricted" });
          return;
        }
        const body = (await response.json()) as Partial<CommandCenterResponse>;
        if (!response.ok || !body.data) throw new Error();
        setState({ status: "ready", response: body as CommandCenterResponse, refreshing: false });
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        // A failed request shows the error state and no figures — never a zero.
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [range, retryNonce]);

  return (
    <RevenueCommandCenterContent
      state={state}
      range={range}
      onRangeChange={setRange}
      onRetry={() => setRetryNonce((n) => n + 1)}
    />
  );
}
