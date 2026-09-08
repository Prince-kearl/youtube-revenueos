import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, isYoutubeReauthError } from "@/lib/server/youtube-tokens";
import { queryYoutubeAnalytics } from "@/lib/server/google-oauth";

type AnalyticsPayload = {
  columnHeaders?: Array<{ name: string }>;
  rows?: Array<Array<string | number>>;
};
type AnalyticsAvailability = "available" | "unavailable" | "disabled" | "forbidden";

const defaults = { import_analytics: true };
const querySchema = z.object({ range: z.enum(["3M", "6M", "12M"]).default("12M") });

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRange(range: "3M" | "6M" | "12M") {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - (range === "3M" ? 3 : range === "6M" ? 6 : 12));
  return { startDate: isoDate(startDate), endDate: isoDate(endDate) };
}

function analyticsRows(payload: unknown): Array<Record<string, string | number>> {
  const report = payload as AnalyticsPayload;
  const headers = report.columnHeaders?.map((header) => header.name) ?? [];
  return (report.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? 0])),
  );
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

function isPermissionError(error: unknown): boolean {
  const reason = safeReason(error);
  return reason === "401" || reason === "403";
}

// The immediately-preceding period of the same length as [startDate, endDate) — used to give the
// KPI cards a real "vs prior period" comparison (matching the Dashboard/Analytics KpiTrendCard
// design) without resorting to a daily breakdown: viewerPercentage is a period-relative metric
// YouTube computes over whatever date range you ask for, not a daily rate, so averaging/summing it
// across days the way an additive metric like views can be would produce a meaningless number (the
// same class of mistake CPM required its own averaging pass to avoid). Comparing two independently
// -computed period totals sidesteps that entirely.
function previousPeriod(
  startDate: string,
  endDate: string,
): { startDate: string; endDate: string } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const spanMs = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime());
  const previousStart = new Date(start.getTime() - spanMs);
  return { startDate: isoDate(previousStart), endDate: isoDate(previousEnd) };
}

type AudiencePeriod = {
  topCountries: Array<{ country: string; views: number }>;
  ageGroups: Array<{ ageGroup: string; viewerPercentage: number }>;
  genders: Array<{ gender: string; viewerPercentage: number }>;
  succeeded: boolean;
  forbidden: boolean;
};

async function fetchAudiencePeriod(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string,
): Promise<AudiencePeriod> {
  try {
    const [countryPayload, agePayload, genderPayload] = await Promise.all([
      queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate,
        endDate,
        metrics: ["views"],
        dimensions: ["country"],
        sort: "-views",
        maxResults: 25,
      }) as Promise<AnalyticsPayload>,
      queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate,
        endDate,
        metrics: ["viewerPercentage"],
        dimensions: ["ageGroup"],
      }) as Promise<AnalyticsPayload>,
      queryYoutubeAnalytics(accessToken, {
        channelId,
        startDate,
        endDate,
        metrics: ["viewerPercentage"],
        dimensions: ["gender"],
      }) as Promise<AnalyticsPayload>,
    ]);
    return {
      topCountries: analyticsRows(countryPayload).map((row) => ({
        country: String(row.country ?? ""),
        views: Number(row.views ?? 0),
      })),
      ageGroups: analyticsRows(agePayload).map((row) => ({
        ageGroup: String(row.ageGroup ?? ""),
        viewerPercentage: Number(row.viewerPercentage ?? 0),
      })),
      genders: analyticsRows(genderPayload).map((row) => ({
        gender: String(row.gender ?? ""),
        viewerPercentage: Number(row.viewerPercentage ?? 0),
      })),
      succeeded: true,
      forbidden: false,
    };
  } catch (error) {
    return {
      topCountries: [],
      ageGroups: [],
      genders: [],
      succeeded: false,
      forbidden: isPermissionError(error),
    };
  }
}

export const Route = createFileRoute("/api/youtube/audience")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const requestUrl = new URL(request.url);
          const requestedChannelId = requestUrl.searchParams.get("channelId");
          if (requestedChannelId && !isUuid(requestedChannelId))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const input = querySchema.parse(Object.fromEntries(requestUrl.searchParams));
          const { startDate, endDate } = dateRange(input.range);

          let channelQuery = client
            .from("youtube_channels")
            .select("id, user_id, youtube_channel_id")
            .order("connected_at", { ascending: false });
          if (requestedChannelId) channelQuery = channelQuery.eq("id", requestedChannelId);
          const { data: channelRow, error: channelError } = await channelQuery
            .limit(1)
            .maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channelRow) {
            return requestedChannelId
              ? json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 })
              : json({ data: null, status: "not_connected" });
          }

          const serviceClient = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await serviceClient
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channelRow.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(serviceClient, secretRow);

          const { data: integrationSettings } = await client
            .from("youtube_integration_settings")
            .select("import_analytics")
            .eq("channel_id", channelRow.id)
            .maybeSingle();
          const settings = { ...defaults, ...(integrationSettings ?? {}) };

          let availability: AnalyticsAvailability = settings.import_analytics
            ? "available"
            : "disabled";
          let current: AudiencePeriod = {
            topCountries: [],
            ageGroups: [],
            genders: [],
            succeeded: false,
            forbidden: false,
          };
          let previous: AudiencePeriod = {
            topCountries: [],
            ageGroups: [],
            genders: [],
            succeeded: false,
            forbidden: false,
          };

          if (settings.import_analytics) {
            const previousRange = previousPeriod(startDate, endDate);
            [current, previous] = await Promise.all([
              fetchAudiencePeriod(accessToken, channelRow.youtube_channel_id, startDate, endDate),
              fetchAudiencePeriod(
                accessToken,
                channelRow.youtube_channel_id,
                previousRange.startDate,
                previousRange.endDate,
              ),
            ]);
            if (current.forbidden) {
              availability = "forbidden";
            } else if (
              !current.succeeded ||
              (!current.topCountries.length && !current.ageGroups.length && !current.genders.length)
            ) {
              availability = "unavailable";
              if (!current.succeeded) {
                console.warn("YouTube audience breakdown unavailable", {
                  userId: channelRow.user_id,
                  channelId: channelRow.id,
                });
              }
            }
            void serviceClient.from("youtube_quota_events").insert({
              user_id: user.id,
              channel_id: channelRow.id,
              operation: "reports.query.audience",
              quota_units: 6,
              succeeded: current.succeeded,
            });
          }

          return json({
            status: "connected",
            data: {
              range: input.range,
              startDate,
              endDate,
              availability,
              topCountries: current.topCountries,
              ageGroups: current.ageGroups,
              genders: current.genders,
              previous: {
                topCountries: previous.topCountries,
                ageGroups: previous.ageGroups,
                genders: previous.genders,
                available: previous.succeeded,
              },
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (isYoutubeReauthError(error))
            return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
          console.error("YouTube audience request failed", { reason: safeReason(error) });
          return json({ error: "YOUTUBE_AUDIENCE_ERROR" }, { status: 502 });
        }
      },
    },
  },
});
