import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { generateFreebieContent } from "@/lib/server/ai-generation";
import { deleteWorkspaceFile, uploadWorkspaceFile, workspaceFilePath } from "@/lib/server/storage";
import { extractTextFromFile } from "@/lib/server/text-extraction";

const idSchema = z.string().uuid();

const publishSchema = z.object({
  teaser: z.string().trim().max(300).nullable().optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/i, "Use only letters, numbers, and dashes")
    .min(3)
    .max(60)
    .optional(),
});
const editSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1).max(50_000).optional(),
  teaser: z.string().trim().max(300).nullable().optional(),
});

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

function withCookies(response: Response, setCookieHeaders: string[]) {
  return applySetCookies(response, setCookieHeaders);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "freebie"
  );
}

type SupabaseClientLike = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

// Gathers ready-to-use text from the workspace's selected Knowledge Base items plus, if present,
// a file uploaded specifically for this generation — this IS the "real sauce" the model is told
// to ground the freebie in (see freebiePromptFor in ai-generation.ts).
async function buildKnowledgeContext(
  client: SupabaseClientLike,
  workspaceId: string,
  knowledgeItemIds: string[],
  perFreebieItem: { title: string; content: string | null } | null,
): Promise<string> {
  const parts: string[] = [];
  if (knowledgeItemIds.length > 0) {
    const { data } = await client
      .from("knowledge_items")
      .select("title, content, extraction_status")
      .eq("workspace_id", workspaceId)
      .in("id", knowledgeItemIds);
    for (const item of data ?? []) {
      if (item.extraction_status === "ready" && item.content) {
        parts.push(`### ${item.title}\n${item.content}`);
      }
    }
  }
  if (perFreebieItem?.content) {
    parts.push(`### ${perFreebieItem.title}\n${perFreebieItem.content}`);
  }
  return parts.join("\n\n").slice(0, 40_000);
}

export const Route = createFileRoute("/api/freebies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const status = new URL(request.url).searchParams.get("status");
          let query = client
            .from("lead_magnets")
            .select("*, optins:lead_magnet_optins(count)")
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (status === "draft" || status === "published") query = query.eq("status", status);
          const { data, error } = await query;
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );

          // Total clicks across every video a freebie's tracking link was attached to (see
          // ai-lab.tsx) — summed here rather than stored, same "compute live" approach as the rest
          // of this app's stats.
          const destinationIds = (data ?? [])
            .map((m) => m.destination_id as string | null)
            .filter((id): id is string => !!id);
          const clicksByDestination = new Map<string, number>();
          if (destinationIds.length > 0) {
            const { data: links } = await client
              .from("tracking_links")
              .select("destination_id, clicks")
              .in("destination_id", destinationIds);
            for (const link of links ?? []) {
              const key = link.destination_id as string;
              clicksByDestination.set(
                key,
                (clicksByDestination.get(key) ?? 0) + ((link.clicks as number) ?? 0),
              );
            }
          }
          const withClicks = (data ?? []).map((m) => ({
            ...m,
            clicks: m.destination_id
              ? (clicksByDestination.get(m.destination_id as string) ?? 0)
              : 0,
          }));
          return withCookies(json({ data: withClicks }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Synchronous generate+save. A per-freebie "just for this one" knowledge file (if attached)
      // is uploaded as a floating workspace item first, then reparented onto the new lead_magnet
      // row on success, or cleaned up on failure — see buildKnowledgeContext and the catch block.
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const form = await request.formData();
          const product = String(form.get("product") ?? "").trim();
          const audience = String(form.get("audience") ?? "").trim();
          const tone = String(form.get("tone") ?? "").trim();
          const format = String(form.get("format") ?? "").trim();
          const formatLabel = String(form.get("formatLabel") ?? "").trim();
          if (!product || !audience || !tone || !format || !formatLabel)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          let knowledgeItemIds: string[] = [];
          try {
            const raw = form.get("knowledgeItemIds");
            knowledgeItemIds = raw ? z.array(idSchema).parse(JSON.parse(String(raw))) : [];
          } catch {
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          }

          let perFreebieItemId: string | null = null;
          let perFreebieFilePath: string | null = null;
          let perFreebieItem: { title: string; content: string | null } | null = null;
          const file = form.get("file");
          if (file instanceof File && file.size > 0) {
            if (file.size > 15 * 1024 * 1024)
              return json({ error: "FILE_TOO_LARGE" }, { status: 413 });
            perFreebieFilePath = workspaceFilePath(
              workspaceId,
              "knowledge",
              crypto.randomUUID(),
              file.name,
            );
            const { error: uploadError } = await uploadWorkspaceFile(perFreebieFilePath, file);
            if (uploadError) return json({ error: "UPLOAD_FAILED" }, { status: 500 });
            const extraction = await extractTextFromFile(file);
            const { data: itemRow, error: itemError } = await client
              .from("knowledge_items")
              .insert({
                workspace_id: workspaceId,
                created_by: user.id,
                title: file.name,
                kind: "file",
                content: extraction.content,
                file_path: perFreebieFilePath,
                file_name: file.name,
                file_type: file.type || null,
                file_size: file.size,
                extraction_status: extraction.status,
              })
              .select("id, title, content")
              .single();
            if (itemError || !itemRow) {
              await deleteWorkspaceFile(perFreebieFilePath);
              return json({ error: "DATABASE_ERROR" }, { status: 500 });
            }
            perFreebieItemId = itemRow.id;
            perFreebieItem = { title: itemRow.title, content: itemRow.content };
          }

          const cleanupOrphan = async () => {
            if (perFreebieItemId)
              await client.from("knowledge_items").delete().eq("id", perFreebieItemId);
            if (perFreebieFilePath) await deleteWorkspaceFile(perFreebieFilePath);
          };

          const knowledgeContext = await buildKnowledgeContext(
            client,
            workspaceId,
            knowledgeItemIds,
            perFreebieItem,
          );

          let content: string;
          try {
            content = await generateFreebieContent({
              product,
              audience,
              tone,
              formatLabel,
              knowledgeContext,
            });
          } catch (error) {
            await cleanupOrphan();
            if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
              return withCookies(
                json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 }),
                setCookieHeaders,
              );
            }
            return withCookies(
              json({ error: "GENERATION_FAILED" }, { status: 502 }),
              setCookieHeaders,
            );
          }

          const title = `${product} ${formatLabel}`.slice(0, 120);
          const { data, error } = await client
            .from("lead_magnets")
            .insert({
              user_id: user.id,
              workspace_id: workspaceId,
              title,
              product,
              audience,
              tone,
              format,
              content,
              source: "generated",
              status: "draft",
            })
            .select()
            .single();
          if (error) {
            await cleanupOrphan();
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }
          if (perFreebieItemId) {
            await client
              .from("knowledge_items")
              .update({ lead_magnet_id: data.id })
              .eq("id", perFreebieItemId);
          }
          return withCookies(json({ data }, { status: 201 }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const action = url.searchParams.get("action");
          const { data: existing, error: existingError } = await client
            .from("lead_magnets")
            .select("id, title, slug, status, source, file_path, destination_id")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (existingError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!existing) return json({ error: "NOT_FOUND" }, { status: 404 });

          let bodyJson: unknown = {};
          try {
            bodyJson = await request.json();
          } catch {
            bodyJson = {};
          }

          if (action === "publish") {
            if (existing.source === "uploaded" && !existing.file_path) {
              return json({ error: "NO_FILE" }, { status: 422 });
            }
            const input = publishSchema.parse(bodyJson);
            const update: Record<string, unknown> = {
              status: "published",
              published_at: new Date().toISOString(),
            };
            if (input.teaser !== undefined) update.teaser = input.teaser;

            let candidate = input.slug ?? existing.slug ?? slugify(existing.title);
            for (let attempt = 0; attempt < 6; attempt++) {
              const { data, error } = await client
                .from("lead_magnets")
                .update({ ...update, slug: candidate })
                .eq("id", id)
                .select()
                .single();
              if (!error) {
                // Real click tracking piggybacks on the existing destinations/tracking_links
                // system: publishing gives (or reuses) a destination pointing at the public page,
                // so AI Lab can attach a tracking link to it exactly like any other destination.
                const publicPageUrl = `${url.origin}/f/${data.slug}`;
                let destinationId = data.destination_id as string | null;
                if (destinationId) {
                  await client
                    .from("destinations")
                    .update({ name: data.title, url: publicPageUrl, status: "active" })
                    .eq("id", destinationId);
                } else {
                  const { data: destination } = await client
                    .from("destinations")
                    .insert({
                      user_id: user.id,
                      workspace_id: workspaceId,
                      lead_magnet_id: id,
                      name: data.title,
                      type: "freebie",
                      url: publicPageUrl,
                    })
                    .select("id")
                    .single();
                  destinationId = destination?.id ?? null;
                  if (destinationId) {
                    await client
                      .from("lead_magnets")
                      .update({ destination_id: destinationId })
                      .eq("id", id);
                  }
                }
                return withCookies(
                  json({ data: { ...data, destination_id: destinationId, clicks: 0 } }),
                  setCookieHeaders,
                );
              }
              const isSlugCollision = error.code === "23505";
              if (isSlugCollision && !input.slug) {
                candidate = `${slugify(existing.title)}-${Math.random().toString(36).slice(2, 6)}`;
                continue;
              }
              return withCookies(
                json(
                  { error: isSlugCollision ? "SLUG_TAKEN" : "DATABASE_ERROR" },
                  { status: isSlugCollision ? 409 : 500 },
                ),
                setCookieHeaders,
              );
            }
            return withCookies(json({ error: "SLUG_TAKEN" }, { status: 409 }), setCookieHeaders);
          }

          const update: Record<string, unknown> = {};
          if (action === "unpublish") {
            update.status = "draft";
          } else {
            const input = editSchema.parse(bodyJson);
            if (input.title !== undefined) update.title = input.title;
            if (input.content !== undefined) update.content = input.content;
            if (input.teaser !== undefined) update.teaser = input.teaser;
          }

          const { data, error } = await client
            .from("lead_magnets")
            .update(update)
            .eq("id", id)
            .select()
            .single();
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (action === "unpublish" && existing.destination_id) {
            // The public page 404s once unpublished, so pull it out of active pickers too —
            // history (clicks, existing tracking links) is untouched, and re-publishing
            // reactivates the same destination.
            await client
              .from("destinations")
              .update({ status: "archived" })
              .eq("id", existing.destination_id);
          }
          return withCookies(json({ data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await requireWorkspaceFeature(
            request,
            "freebie",
          );
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const { data: existing } = await client
            .from("lead_magnets")
            .select("file_path, destination_id")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          const { data: attachments } = await client
            .from("knowledge_items")
            .select("file_path")
            .eq("lead_magnet_id", id)
            .not("file_path", "is", null);

          const { error } = await client.from("lead_magnets").delete().eq("id", id);
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (existing?.file_path) await deleteWorkspaceFile(existing.file_path);
          for (const item of attachments ?? []) {
            if (item.file_path) await deleteWorkspaceFile(item.file_path);
          }
          // Detached by the FK (set null) already — archive it too so it drops out of active
          // pickers, while any tracking links and click history it earned stay intact.
          if (existing?.destination_id) {
            await client
              .from("destinations")
              .update({ status: "archived" })
              .eq("id", existing.destination_id);
          }
          return withCookies(json({ success: true }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
