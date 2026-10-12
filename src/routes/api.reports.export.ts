import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { resolveRevenueAccess } from "@/lib/server/revenue-visibility";
import { HIDDEN_AMOUNT_TEXT } from "@/lib/revenue-visibility";

type ReportType = "deals" | "leads" | "videos";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function inRange(dateStr: string | null, start: Date | null, end: Date | null): boolean {
  if (!dateStr) return !start && !end;
  const date = new Date(dateStr);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

// Real CSV export straight from workspace data — no PDF/XLSX yet (those need a rendering library
// this app doesn't otherwise depend on; adding one just for this button wasn't worth the new
// dependency, so CSV is the one real, honest format offered rather than pretending the others
// work too).
export const Route = createFileRoute("/api/reports/export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "reports");
          const { client, workspaceId } = ctx;
          const url = new URL(request.url);
          const type = url.searchParams.get("type") as ReportType | null;
          const startParam = url.searchParams.get("startDate");
          const endParam = url.searchParams.get("endDate");
          const start = startParam ? new Date(startParam) : null;
          const end = endParam ? new Date(`${endParam}T23:59:59.999Z`) : null;
          const stamp = new Date().toISOString().slice(0, 10);

          if (type === "deals") {
            // The Value column follows the workspace's revenue visibility: a member who may not
            // see amounts still gets the export, with every value written as "Hidden" (never
            // blank and never 0, either of which would be read as a real figure).
            const access = await resolveRevenueAccess(ctx);
            const { data, error } = await client
              .from("deals")
              .select(
                "id, name, contact_name, currency, stage, tag, next_action, expected_close_date, closed_at, created_at",
              )
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false });
            if (error) return new Response("Database error", { status: 500 });
            let valueById = new Map<string, number | null>();
            if (access.money) {
              try {
                valueById = await access.money.dealValues();
              } catch {
                return new Response("Database error", { status: 500 });
              }
            }
            const rows = (data ?? []).filter((d) => inRange(d.created_at, start, end));
            const csv = toCsv(
              [
                "Name",
                "Contact",
                "Value",
                "Currency",
                "Stage",
                "Tag",
                "Next Action",
                "Expected Close",
                "Closed At",
                "Created",
              ],
              rows.map((d) => [
                d.name,
                d.contact_name,
                access.canView ? (valueById.get(d.id as string) ?? null) : HIDDEN_AMOUNT_TEXT,
                d.currency,
                d.stage,
                d.tag,
                d.next_action,
                d.expected_close_date,
                d.closed_at,
                d.created_at,
              ]),
            );
            return csvResponse(csv, `deals-${stamp}.csv`);
          }

          if (type === "leads") {
            const { data, error } = await client
              .from("leads")
              .select("name, platform, username, email, status, source, created_at")
              .eq("workspace_id", workspaceId)
              .order("created_at", { ascending: false });
            if (error) return new Response("Database error", { status: 500 });
            const rows = (data ?? []).filter((l) => inRange(l.created_at, start, end));
            const csv = toCsv(
              ["Name", "Platform", "Username", "Email", "Status", "Source", "Created"],
              rows.map((l) => [
                l.name,
                l.platform,
                l.username,
                l.email,
                l.status,
                l.source,
                l.created_at,
              ]),
            );
            return csvResponse(csv, `leads-${stamp}.csv`);
          }

          if (type === "videos") {
            const { data: channels, error: channelsError } = await client
              .from("youtube_channels")
              .select("id")
              .eq("workspace_id", workspaceId);
            if (channelsError) return new Response("Database error", { status: 500 });
            const channelIds = (channels ?? []).map((c) => c.id);
            if (channelIds.length === 0)
              return csvResponse(toCsv(["Title"], []), `videos-${stamp}.csv`);

            const { data, error } = await client
              .from("videos")
              .select("title, status, duration_seconds, published_at, created_at")
              .in("channel_id", channelIds)
              .order("published_at", { ascending: false });
            if (error) return new Response("Database error", { status: 500 });
            const rows = (data ?? []).filter((v) => inRange(v.published_at, start, end));
            const csv = toCsv(
              ["Title", "Status", "Duration (seconds)", "Published"],
              rows.map((v) => [v.title, v.status, v.duration_seconds, v.published_at]),
            );
            return csvResponse(csv, `videos-${stamp}.csv`);
          }

          return new Response("Unknown report type", { status: 400 });
        } catch (error) {
          if (error instanceof Response) return error;
          return new Response("Server error", { status: 500 });
        }
      },
    },
  },
});
