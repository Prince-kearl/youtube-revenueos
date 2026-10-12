import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_REVENUE_VISIBILITY,
  REVENUE_HIDDEN_ERROR,
  REVENUE_HIDDEN_MESSAGE,
  canManageRevenueVisibility,
  canViewWorkspaceRevenue,
  canWriteWorkspaceRevenue,
  type RevenueVisibilitySettings,
} from "@/lib/revenue-visibility";
import { isPlatformSuperadmin } from "./platform-staff";
import type {
  MoneyReader,
  MoneyStatsRow,
  RevenueReadContext,
  RevenueReadMode,
} from "./revenue-store";
import { createServiceSupabaseClient } from "./supabase";
import { getWorkspaceContext, type WorkspaceContext } from "./workspace";

// The server side of revenue visibility (the rules themselves are in lib/revenue-visibility.ts).
//
// Every route that can return or change money asks ONE question here — resolveRevenueAccess —
// and gets one answer for the request. Nothing else decides who sees revenue.
//
// How money is kept from a member who may not see it:
//
//   * The monetary columns (stored YouTube revenue, deal values) are not readable through the
//     member-facing database role at all, and deals are not writable through it — see the
//     revenue-column-privacy migration. A member querying or writing the database directly gets
//     a permission error, whatever the workspace's setting.
//   * Amounts are therefore read only here on the server, with the service role, and only AFTER
//     this module has said the caller may see them.
//   * The service-role client is never handed to the code that reads revenue. What that code
//     receives is a MoneyReader: a handful of fixed queries, each bound to the caller's own
//     workspace when it is created. It has no way to name another workspace, another table or
//     another column, and it is null for a caller who may not see revenue — so amounts cannot be
//     read by accident, and cannot be read across workspaces even by a route that passes it the
//     wrong ids.
//
// Everything fails closed: an unreadable setting is "off", an unreadable profile is "not staff".

export interface RevenueAccess {
  /** May this caller see revenue amounts in their workspace? */
  canView: boolean;
  /** May this caller create, change or remove amounts (deal values)? Never true without
   * `canView`; the route's own feature gate still applies on top. */
  canWrite: boolean;
  /** May this caller change the workspace's revenue visibility? */
  canManage: boolean;
  /** The workspace's stored setting (defaults when missing or unreadable). */
  settings: RevenueVisibilitySettings;
  /** False when the setting could not be read (e.g. the columns do not exist yet). */
  settingsAvailable: boolean;
  /** Reads amounts for the caller's own workspace. Present ONLY when `canView` is true. */
  money: MoneyReader | null;
}

const NO_ACCESS: RevenueAccess = {
  canView: false,
  canWrite: false,
  canManage: false,
  settings: DEFAULT_REVENUE_VISIBILITY,
  settingsAvailable: false,
  money: null,
};

const SETTINGS_COLUMNS = "editor_revenue_visible, setter_revenue_visible";

/** The workspace's stored revenue visibility. Never throws; anything unexpected is the default
 * (both off) with `available: false`. */
export async function readRevenueVisibility(
  service: SupabaseClient,
  workspaceId: string,
): Promise<{ settings: RevenueVisibilitySettings; available: boolean }> {
  try {
    const { data, error } = await service
      .from("workspaces")
      .select(SETTINGS_COLUMNS)
      .eq("id", workspaceId)
      .maybeSingle();
    if (error || !data) return { settings: DEFAULT_REVENUE_VISIBILITY, available: false };
    return {
      settings: {
        // Strictly `true`: a null, a string or anything else is "off".
        editor: data.editor_revenue_visible === true,
        setter: data.setter_revenue_visible === true,
      },
      available: true,
    };
  } catch {
    return { settings: DEFAULT_REVENUE_VISIBILITY, available: false };
  }
}

// ---------- the only code that reads amounts with the service role ----------

const PAGE_SIZE = 1000;
const STATS_MONEY_COLUMNS =
  "channel_id, day, views, watch_minutes, estimated_revenue_usd, ad_revenue_usd, premium_revenue_usd";

/** A failed privileged read: logged without row contents, surfaced as a stable code. */
function moneyReadFailed(operation: string, error: { code?: string } | null): never {
  console.error("Revenue read failed", { operation, code: error?.code });
  throw new Error(`REVENUE_MONEY:${operation}`);
}

/**
 * Reads amounts for ONE workspace, fixed at creation. Every query below is filtered by that
 * workspace itself — it does not rely on the caller having passed only its own ids:
 *
 *   * stats rows are read only for channels this reader has itself confirmed belong to the
 *     workspace, whatever channel ids it was handed;
 *   * deal values are read with the workspace as a filter, so an id from elsewhere matches
 *     nothing.
 *
 * Not exported: the only way to get one is resolveRevenueAccess, for a caller it has authorised.
 */
function createMoneyReader(service: SupabaseClient, workspaceId: string): MoneyReader {
  async function ownChannels(channelIds: string[]): Promise<string[]> {
    if (channelIds.length === 0) return [];
    const { data, error } = await service
      .from("youtube_channels")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", channelIds);
    if (error) moneyReadFailed("VERIFY_CHANNELS", error);
    return (data ?? []).map((row) => row.id as string);
  }

  return {
    async readStats(table, channelIds, range) {
      const verified = await ownChannels(channelIds);
      if (verified.length === 0) return [];
      const tieBreaker = table === "video_daily_stats" ? "video_id" : "channel_id";
      const columns =
        table === "video_daily_stats" ? `video_id, ${STATS_MONEY_COLUMNS}` : STATS_MONEY_COLUMNS;
      const rows: MoneyStatsRow[] = [];
      for (let from = 0; ;) {
        // Ordered by the primary key so pages never overlap or skip.
        const { data, error } = await service
          .from(table)
          .select(columns)
          .in("channel_id", verified)
          .gte("day", range.startDate)
          .lte("day", range.endDate)
          .order("day", { ascending: true })
          .order(tieBreaker, { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) moneyReadFailed(`READ_${table.toUpperCase()}`, error);
        const page = (data ?? []) as unknown as MoneyStatsRow[];
        rows.push(...page);
        // A short page is not the end of the data — the API can cap a response below the size
        // asked for — so reading goes on from the rows actually received until a page is empty.
        if (page.length === 0) return rows;
        from += page.length;
      }
    },

    async dealValues(dealIds) {
      const values = new Map<string, number | null>();
      if (dealIds && dealIds.length === 0) return values;
      for (let from = 0; ;) {
        let query = service.from("deals").select("id, value").eq("workspace_id", workspaceId);
        if (dealIds) query = query.in("id", dealIds);
        const { data, error } = await query
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) moneyReadFailed("READ_DEAL_VALUES", error);
        for (const row of data ?? []) {
          const value = row.value === null || row.value === undefined ? null : Number(row.value);
          values.set(row.id as string, value !== null && Number.isFinite(value) ? value : null);
        }
        if ((data ?? []).length === 0) return values;
        from += (data ?? []).length;
      }
    },

    async dealSummaryRows() {
      const rows: Awaited<ReturnType<MoneyReader["dealSummaryRows"]>> = [];
      for (let from = 0; ;) {
        const { data, error } = await service
          .from("deals")
          .select("id, value, currency, stage, closed_at")
          .eq("workspace_id", workspaceId)
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) moneyReadFailed("READ_DEALS", error);
        rows.push(...((data ?? []) as unknown as typeof rows));
        if ((data ?? []).length === 0) return rows;
        from += (data ?? []).length;
      }
    },
  };
}

type AccessContext = Pick<WorkspaceContext, "user" | "workspaceId" | "workspaceRole">;

/**
 * The caller's revenue access in their own workspace.
 *
 * `ctx` must come from getWorkspaceContext / requireWorkspaceFeature — the caller's verified
 * session and their ACTIVE membership. The workspace and role are taken from it and from nowhere
 * else.
 */
export async function resolveRevenueAccess(
  ctx: AccessContext,
  service: SupabaseClient = createServiceSupabaseClient(),
): Promise<RevenueAccess> {
  const role = ctx.workspaceRole;
  // Owners and managers do not depend on the setting or on staff status, so neither lookup can
  // lock them out; the lookups run only for the roles they can actually affect.
  const alwaysAllowed = role === "owner" || role === "manager";
  const [{ settings, available }, isSuperadmin] = await Promise.all([
    readRevenueVisibility(service, ctx.workspaceId),
    alwaysAllowed ? Promise.resolve(false) : isPlatformSuperadmin(service, ctx.user.id),
  ]);
  const viewer = { role, isSuperadmin };
  const canView = canViewWorkspaceRevenue(viewer, settings);
  return {
    canView,
    canWrite: canWriteWorkspaceRevenue(viewer, settings),
    canManage: canManageRevenueVisibility(viewer),
    settings,
    settingsAvailable: available,
    money: canView ? createMoneyReader(service, ctx.workspaceId) : null,
  };
}

/** How the stored-revenue readers (revenue-store) may read for this caller. */
export function revenueReadMode(access: Pick<RevenueAccess, "money">): RevenueReadMode {
  return access.money ? { visible: true, money: access.money } : { visible: false };
}

/** The read context of the canonical revenue endpoints: the caller's workspace, plus whether —
 * and through which reader — they may read amounts. Throws the auth Response when there is no
 * signed-in member. */
export async function revenueReadContext(request: Request): Promise<RevenueReadContext> {
  const ctx = await getWorkspaceContext(request);
  const access = await resolveRevenueAccess(ctx);
  return { client: ctx.client, workspaceId: ctx.workspaceId, revenue: revenueReadMode(access) };
}

/** For a route that has only a Request: the caller's access, or "no access" when they have no
 * workspace at all. The route's own authentication still runs. */
export async function resolveRevenueAccessForRequest(request: Request): Promise<RevenueAccess> {
  try {
    return await resolveRevenueAccess(await getWorkspaceContext(request));
  } catch {
    return NO_ACCESS;
  }
}

/** The response of a financial endpoint that refuses a viewer outright. Never cached. */
export function revenueHiddenResponse(): Response {
  return new Response(
    JSON.stringify({ error: REVENUE_HIDDEN_ERROR, message: `${REVENUE_HIDDEN_MESSAGE}.` }),
    {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    },
  );
}
