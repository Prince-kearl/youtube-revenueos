import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType = "message" | "check" | "dollar" | "alert" | "zap" | "clock";

// Best-effort — inserting a notification should never fail the real action that triggered it
// (a teammate joining, a ticket getting resolved). Use the service-role client so it always
// succeeds regardless of which workspace member happens to be the one triggering the event.
export async function notifyWorkspace(
  service: SupabaseClient,
  params: {
    workspaceId: string;
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
  },
): Promise<void> {
  try {
    await service.from("notifications").insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
    });
  } catch {
    // best-effort, see above
  }
}
