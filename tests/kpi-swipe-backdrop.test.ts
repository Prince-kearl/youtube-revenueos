import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/dashboard.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");

test("the KPI carousel does not change the app shell background", () => {
  assert.doesNotMatch(page, /KPI_TONES|dataset\.kpiTone/);
  assert.doesNotMatch(styles, /data-kpi-tone/);
  assert.doesNotMatch(styles, /\.dashboard-shell::before|\.dashboard-shell::after/);
  // still no active-card state in Dashboard itself
  assert.doesNotMatch(page, /activeKpiIndex|setActiveKpiIndex/);
});
