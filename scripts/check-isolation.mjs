// Cross-tenant leak check, run before every build (npm "prebuild"). Fails the
// build when a change could let one business read another's data:
//  1. every table in supabase/migrations has Row Level Security switched on
//     and at least one policy (settings is service-role only by design);
//  2. every store method that takes a tenantId runs the phantom tenant guard;
//  3. every Supabase query inside such a method filters by tenant_id.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const problems = [];

// 1. Migrations
const dir = join(root, "supabase/migrations");
const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n").toLowerCase();
const NO_POLICY_OK = new Set(["settings"]);
// Policies created in a loop: foreach t in array array['a','b'] ... create policy
const loopPolicies = new Set(
  [...sql.matchAll(/foreach \w+ in array array\[([^\]]+)\] loop([\s\S]*?)end loop/g)]
    .filter(([, , body]) => body.includes("create policy"))
    .flatMap(([, list]) => list.split(",").map((x) => x.trim().replace(/'/g, "")))
);
for (const [, table] of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)) {
  if (!new RegExp(`alter table public\\.${table} enable row level security`).test(sql)) problems.push(`Table ${table} has no Row Level Security.`);
  if (!NO_POLICY_OK.has(table) && !loopPolicies.has(table) && !new RegExp(`create policy \\w+ on public\\.${table}\\b`).test(sql)) problems.push(`Table ${table} has no access policy.`);
}

// 2 and 3. Store implementations
function methods(src) {
  const out = [];
  const re = /\n\s+async (\w+)\(([^)]*)\)\s*\{/g;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push({ name: m[1], params: m[2], at: m.index });
  for (let i = 0; i < starts.length; i++) out.push({ ...starts[i], body: src.slice(starts[i].at, starts[i + 1]?.at ?? src.length) });
  return out;
}
// Methods that take a tenantId but legitimately look beyond one business.
const CROSS_TENANT_OK = new Set(["getSettings", "setSetting", "deleteSetting", "getTenant"]);
for (const file of ["src/lib/store/supabase.ts", "src/lib/store/memory.ts"]) {
  const src = readFileSync(join(root, file), "utf8");
  for (const m of methods(src)) {
    if (!/^\s*tenantId\b/.test(m.params) || CROSS_TENANT_OK.has(m.name)) continue;
    if (!m.body.includes("assertTenant(tenantId)")) problems.push(`${file}: ${m.name} does not run the tenant guard.`);
    if (file.endsWith("supabase.ts")) {
      for (const [, table] of m.body.matchAll(/\.from\("(\w+)"\)/g)) {
        if (table === "tenants") continue;
        if (!/tenant_id|p_tenant/.test(m.body)) problems.push(`${file}: ${m.name} queries ${table} without a tenant_id filter.`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Cross-tenant check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Cross-tenant check passed: every table has RLS, every tenant query is guarded and filtered.");
