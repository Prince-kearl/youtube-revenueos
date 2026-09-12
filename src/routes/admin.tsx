import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminNav, type AdminSection } from "@/components/admin/AdminNav";
import { ExecutiveDashboard } from "@/components/admin/sections/ExecutiveDashboard";
import { UsersSection } from "@/components/admin/sections/UsersSection";
import { RolesSection } from "@/components/admin/sections/RolesSection";
import { OrganizationsSection } from "@/components/admin/sections/OrganizationsSection";
import { AiManagementSection } from "@/components/admin/sections/AiManagementSection";
import { BillingSection } from "@/components/admin/sections/BillingSection";
import { FeatureManagementSection } from "@/components/admin/sections/FeatureManagementSection";
import { VersionControlSection } from "@/components/admin/sections/VersionControlSection";
import { AnalyticsSection } from "@/components/admin/sections/AnalyticsSection";
import { CommunicationsSection } from "@/components/admin/sections/CommunicationsSection";
import { ContentSection } from "@/components/admin/sections/content/ContentSection";
import { SystemSection } from "@/components/admin/sections/SystemSection";
import { SecuritySection } from "@/components/admin/sections/SecuritySection";
import { AuditLogSection } from "@/components/admin/sections/AuditLogSection";
import { SupportSection } from "@/components/admin/sections/SupportSection";
import { InfrastructureSection } from "@/components/admin/sections/InfrastructureSection";
import { RoadmapSection } from "@/components/admin/sections/RoadmapSection";
import { ChangelogSection } from "@/components/admin/sections/ChangelogSection";

export const Route = createFileRoute("/admin")({
  component: AdminConsole,
});

const SECTIONS: Record<AdminSection, React.ComponentType> = {
  dashboard: ExecutiveDashboard,
  users: UsersSection,
  roles: RolesSection,
  organizations: OrganizationsSection,
  ai: AiManagementSection,
  billing: BillingSection,
  features: FeatureManagementSection,
  releases: VersionControlSection,
  analytics: AnalyticsSection,
  communications: CommunicationsSection,
  content: ContentSection,
  system: SystemSection,
  security: SecuritySection,
  audit: AuditLogSection,
  support: SupportSection,
  infrastructure: InfrastructureSection,
  roadmap: RoadmapSection,
  changelog: ChangelogSection,
};

function AdminConsole() {
  const navigate = useNavigate();
  const [section, setSection] = useState<AdminSection>("dashboard");
  // Real server-side authorization lives in every admin API route (requireAdminUser) — this is
  // only a UX guard so a non-admin who navigates here sees a redirect instead of the console
  // shell, not the actual security boundary.
  const [authStatus, setAuthStatus] = useState<"checking" | "allowed" | "denied">("checking");
  const Section = SECTIONS[section];

  useEffect(() => {
    fetch("/api/admin/whoami", { cache: "no-store" })
      .then((response) => setAuthStatus(response.ok ? "allowed" : "denied"))
      .catch(() => setAuthStatus("denied"));
  }, []);

  useEffect(() => {
    if (authStatus === "denied") navigate({ to: "/dashboard" });
  }, [authStatus, navigate]);

  if (authStatus !== "allowed") {
    return (
      <DashboardLayout title="Admin Console" hideAppNav>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Admin Console" hideAppNav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-brand-purple" />
          <div>
            <p className="text-sm font-semibold">Super Admin Console</p>
            <p className="text-xs text-muted-foreground">
              Command center for the entire platform — visible only to Superadmins.
            </p>
          </div>
        </div>
        <Link
          to="/dashboard"
          className="flex items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Exit to Workspace
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row">
        <AdminNav active={section} onSelect={setSection} />
        <div className="min-w-0 flex-1">
          <Section />
        </div>
      </div>
    </DashboardLayout>
  );
}
