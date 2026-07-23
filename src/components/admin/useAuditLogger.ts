import { useProfile, useAuditLog, makeAuditEntry } from "@/lib/stores";

export function useAuditLogger() {
  const [profile] = useProfile();
  const [, setLog] = useAuditLog();
  return (action: string, module: string, target: string, outcome: "Success" | "Failed" = "Success") => {
    setLog((prev) => [makeAuditEntry(profile.name, action, module, target, outcome), ...prev]);
  };
}
