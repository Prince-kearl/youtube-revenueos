import { z } from "zod";
import { APP_ROLES, toAppRole, type AppRole } from "./roles";

// The admin Users list, read page by page from the database (see the migration
// 202610180001_admin_user_directory.sql): request validation, the opaque keyset cursor, and the
// shape of each row returned to the console. Pure functions, so every rule here is unit-tested.
//
// Pagination is keyset (cursor), not offset: the next page is "the rows after the last one shown,
// in the same order", which costs the same on page 1 and page 10,000 and never skips or repeats a
// row when accounts are added or removed between requests. An offset would make every deep page
// read and discard all the rows before it.

export const ADMIN_USERS_DEFAULT_LIMIT = 25;
export const ADMIN_USERS_MAX_LIMIT = 100;
export const ADMIN_USERS_SORTS = ["newest", "oldest", "email"] as const;
export const ADMIN_USERS_STATUSES = ["active", "pending", "banned"] as const;
export type AdminUsersSort = (typeof ADMIN_USERS_SORTS)[number];
export type AdminUsersStatus = (typeof ADMIN_USERS_STATUSES)[number];
export type AdminUsersSearchKind = "id" | "email" | "text";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
// No control characters (they are never part of a name or an email address).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const listQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_USERS_MAX_LIMIT)
      .default(ADMIN_USERS_DEFAULT_LIMIT),
    sort: z.enum(ADMIN_USERS_SORTS).default("newest"),
    q: z
      .string()
      .trim()
      .max(100)
      .refine((value) => !CONTROL_CHARS.test(value), "invalid characters")
      .optional()
      .transform((value) => (value ? value : undefined)),
    role: z.enum(APP_ROLES).optional(),
    status: z.enum(ADMIN_USERS_STATUSES).optional(),
    cursor: z.string().max(600).optional(),
    stats: z.enum(["1"]).optional(),
  })
  .strict();

export interface AdminUsersQuery {
  limit: number;
  sort: AdminUsersSort;
  search: { kind: AdminUsersSearchKind; text: string } | null;
  role: AppRole | null;
  status: AdminUsersStatus | null;
  cursor: AdminUsersCursor | null;
  includeStats: boolean;
}

export interface AdminUsersCursor {
  /** The ordering the cursor belongs to. */
  sort: AdminUsersSort;
  /** The filters the cursor belongs to: a cursor is only valid for the list it came from. */
  filters: string;
  /** The last row's created_at, exactly as Postgres returned it (microseconds kept). */
  created: string | null;
  /** The last row's lower-cased email (email ordering only). */
  email: string | null;
  id: string;
}

export class AdminUsersQueryError extends Error {
  constructor(public readonly code: "VALIDATION_ERROR" | "INVALID_CURSOR") {
    super(code);
  }
}

/** A UUID is an exact id lookup; anything with "@" searches emails; otherwise names and emails. */
export function searchKindFor(text: string): AdminUsersSearchKind {
  if (UUID.test(text)) return "id";
  if (text.includes("@")) return "email";
  return "text";
}

function filtersKey(query: Pick<AdminUsersQuery, "search" | "role" | "status">): string {
  return JSON.stringify([
    query.search?.kind ?? null,
    query.search?.text.toLowerCase() ?? null,
    query.role,
    query.status,
  ]);
}

export function encodeAdminUsersCursor(cursor: AdminUsersCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      s: cursor.sort,
      f: cursor.filters,
      c: cursor.created,
      e: cursor.email,
      i: cursor.id,
    }),
  ).toString("base64url");
}

const cursorSchema = z
  .object({
    v: z.literal(1),
    s: z.enum(ADMIN_USERS_SORTS),
    f: z.string().max(400),
    // Exactly the timestamp format Postgres returns (microseconds kept) — not Date.parse, which
    // accepts almost any text.
    c: z.string().regex(TIMESTAMP).nullable(),
    e: z.string().max(320).nullable(),
    i: z.string().regex(UUID),
  })
  .strict();

function decodeCursor(raw: string): AdminUsersCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (parsed.s === "email" ? parsed.e === null : parsed.c === null) throw new Error("incomplete");
    return {
      sort: parsed.s,
      filters: parsed.f,
      created: parsed.c,
      email: parsed.e,
      id: parsed.i,
    };
  } catch {
    throw new AdminUsersQueryError("INVALID_CURSOR");
  }
}

/** Validates the list request's query string. Throws AdminUsersQueryError on anything unexpected. */
export function parseAdminUsersQuery(params: URLSearchParams): AdminUsersQuery {
  const result = listQuerySchema.safeParse(Object.fromEntries(params));
  if (!result.success) throw new AdminUsersQueryError("VALIDATION_ERROR");
  const input = result.data;

  let search: AdminUsersQuery["search"] = null;
  if (input.q !== undefined) {
    const kind = searchKindFor(input.q);
    // Two characters at least: a one-letter prefix would match a large share of all accounts.
    if (kind !== "id" && input.q.length < 2) throw new AdminUsersQueryError("VALIDATION_ERROR");
    search = { kind, text: input.q };
  }

  const query: AdminUsersQuery = {
    limit: input.limit,
    sort: input.sort,
    search,
    role: input.role ?? null,
    status: input.status ?? null,
    cursor: null,
    includeStats: input.stats === "1",
  };
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (cursor.sort !== query.sort || cursor.filters !== filtersKey(query))
      throw new AdminUsersQueryError("INVALID_CURSOR");
    query.cursor = cursor;
  }
  return query;
}

/** The arguments for public.admin_list_users. One extra row is asked for to detect a next page. */
export function adminListUsersArgs(query: AdminUsersQuery) {
  return {
    p_limit: query.limit + 1,
    p_sort: query.sort,
    p_search_kind: query.search?.kind ?? null,
    p_search: query.search?.text ?? null,
    p_role: query.role,
    p_status: query.status,
    p_cursor_created: query.cursor?.created ?? null,
    p_cursor_email: query.cursor?.email ?? null,
    p_cursor_id: query.cursor?.id ?? null,
  };
}

/** The arguments for public.admin_count_users: the same filters, no ordering or cursor. */
export function adminCountUsersArgs(query: AdminUsersQuery) {
  return {
    p_search_kind: query.search?.kind ?? null,
    p_search: query.search?.text ?? null,
    p_role: query.role,
    p_status: query.status,
  };
}

/** A row as public.admin_list_users returns it. */
export interface AdminUserDirectoryRow {
  id: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
  role: string;
  created_at: string;
  email_lower: string;
  email_confirmed_at: string | null;
  banned_until: string | null;
  last_sign_in_at: string | null;
  creator_verified: boolean;
}

export type AdminUserStatus = "Active" | "Pending" | "Banned";

export function adminUserStatus(
  row: Pick<AdminUserDirectoryRow, "banned_until" | "email_confirmed_at">,
  now = Date.now(),
): AdminUserStatus {
  if (row.banned_until && new Date(row.banned_until).getTime() > now) return "Banned";
  if (!row.email_confirmed_at) return "Pending";
  return "Active";
}

/** What the console receives for each account: identity, role and account status — nothing else. */
export function toAdminUserListItem(row: AdminUserDirectoryRow, now = Date.now()) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    role: toAppRole(row.role),
    created_at: row.created_at,
    status: adminUserStatus(row, now),
    emailVerified: Boolean(row.email_confirmed_at),
    creatorVerified: row.creator_verified === true,
    bannedUntil: row.banned_until,
    lastSignInAt: row.last_sign_in_at,
  };
}

/** Turns the function's rows into one page: at most `limit` items and the cursor for the next. */
export function toAdminUsersPage(rows: AdminUserDirectoryRow[], query: AdminUsersQuery) {
  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeAdminUsersCursor({
          sort: query.sort,
          filters: filtersKey(query),
          created: query.sort === "email" ? null : last.created_at,
          email: query.sort === "email" ? last.email_lower : null,
          id: last.id,
        })
      : null;
  return { items: items.map((row) => toAdminUserListItem(row)), nextCursor };
}

/** PostgREST's "function not found" (the migration has not been applied yet). */
export function isMissingFunctionError(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
}
