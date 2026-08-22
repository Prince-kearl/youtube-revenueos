import { createFileRoute } from "@tanstack/react-router";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { Users, UserCheck, Target, Globe } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatCard } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";

export const Route = createFileRoute("/audience")({
  component: Audience,
});

const ageData = [
  { age: "13–17", views: 4, cvr: 0.8 },
  { age: "18–24", views: 22, cvr: 3.1 },
  { age: "25–34", views: 38, cvr: 6.4 },
  { age: "35–44", views: 21, cvr: 5.2 },
  { age: "45–54", views: 9, cvr: 2.6 },
  { age: "55–64", views: 4, cvr: 1.4 },
  { age: "65+", views: 2, cvr: 0.6 },
];

const genderData = [
  { label: "Male", pct: 64, color: "var(--color-brand-blue)" },
  { label: "Female", pct: 33, color: "var(--color-brand-purple)" },
  { label: "User-specified", pct: 3, color: "var(--color-brand-amber)" },
];

const geo = [
  { country: "United States", pct: 42 },
  { country: "United Kingdom", pct: 14 },
  { country: "Canada", pct: 11 },
  { country: "Australia", pct: 8 },
  { country: "Germany", pct: 6 },
  { country: "Other", pct: 19 },
];

function Audience() {
  return (
    <DashboardLayout title="Audience">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Demographics & Conversion</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See exactly which age groups and genders convert best — overlaid with attributed revenue.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} value="25–34" label="Top Age Group" sub="38% of views" />
        <StatCard icon={<UserCheck className="h-5 w-5" />} value="64% M" label="Gender Split" sub="33% F · 3% other" />
        <StatCard icon={<Target className="h-5 w-5" />} value="6.4%" label="Best Converting Segment" sub="25–34, Male" />
        <StatCard icon={<Globe className="h-5 w-5" />} value="42%" label="Top Country" sub="United States" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Dual-axis: age vs views + conversion rate */}
        <div className="relative rounded-xl card-gradient-outline p-5 lg:col-span-2">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Age Groups — Views vs Conversion Rate</h3>
          <div className="mt-4 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={ageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="age" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "var(--color-accent)" }} contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 12, fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="views" name="Views %" fill="var(--color-brand-blue)" radius={[4, 4, 0, 0]} barSize={28} />
                <Line yAxisId="right" dataKey="cvr" name="Conversion %" stroke="var(--color-brand-purple)" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-brand-blue)" }} /> Views (left)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-brand-purple)" }} /> Conversion rate (right)</span>
          </div>
        </div>

        {/* Gender donut */}
        <div className="relative rounded-xl card-gradient-outline p-5">
          <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
          <h3 className="text-lg font-semibold">Gender by Revenue</h3>
          <div className="mt-4 h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={genderData} dataKey="pct" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                  {genderData.map((g, i) => <Cell key={i} fill={g.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            {genderData.map((g) => (
              <div key={g.label} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: g.color }} /> {g.label}
                </span>
                <span className="font-semibold">{g.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Geography */}
      <div className="relative mt-5 rounded-xl card-gradient-outline p-5">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
        <h3 className="text-lg font-semibold">Geography</h3>
        <div className="mt-4 space-y-3">
          {geo.map((g) => (
            <div key={g.country} className="flex items-center gap-4">
              <span className="w-36 shrink-0 text-sm text-muted-foreground">{g.country}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-accent">
                <div className="h-full rounded-full bg-brand-blue" style={{ width: `${g.pct}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-semibold">{g.pct}%</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Demographic data via YouTube Analytics API (ageGroup, gender dimensions), refreshed daily. Conversion overlay blends attributed revenue with viewer ratios.
        </p>
      </div>
    </DashboardLayout>
  );
}
