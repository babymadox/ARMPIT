#!/usr/bin/env bash
# Heuristic project scan. Run from anywhere inside the repo. Exit code 1 if any FAIL.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$0"/../../../..)" || exit 2
QUICK=0; [ "${1:-}" = "--quick" ] && QUICK=1
FAILS=0
ok()   { printf '\033[32mPASS\033[0m  %s\n' "$1"; }
warn() { printf '\033[33mWARN\033[0m  %s\n' "$1"; }
bad()  { printf '\033[31mFAIL\033[0m  %s\n' "$1"; FAILS=$((FAILS+1)); }
SRC=(src); TRACKED=$(git ls-files 2>/dev/null)

echo "== Build & tests"
if [ $QUICK = 0 ]; then
  rm -rf .next
  npx tsc --noEmit >/tmp/armpit-tsc.log 2>&1 && ok "typecheck" || { bad "typecheck (see /tmp/armpit-tsc.log)"; head -5 /tmp/armpit-tsc.log; }
  npm test >/tmp/armpit-test.log 2>&1 && ok "tests: $(grep -E '^# pass' /tmp/armpit-test.log)" || { bad "tests"; grep -E "^not ok|^# fail" /tmp/armpit-test.log | head; }
  NEXT_PUBLIC_SUPABASE_URL=http://x NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next build >/tmp/armpit-build.log 2>&1 && ok "production build" || { bad "production build (see /tmp/armpit-build.log)"; }
else echo "(skipped: --quick)"; fi

echo; echo "== Security heuristics"
python3 - "$@" <<'PY'
import re, subprocess, sys, pathlib
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True).stdout
# tracked AND new-but-uncommitted files (a leak is most likely in a file you have not committed yet)
ALL = sh("git ls-files --cached --others --exclude-standard").split()
files = [f for f in ALL if f.startswith("src/") and f.endswith((".ts", ".tsx"))]
G, Y, R, N = "\033[32mPASS\033[0m", "\033[33mWARN\033[0m", "\033[31mFAIL\033[0m", ""
fails = 0

# 1. server actions that never establish a session
# Allowlist (reviewed): login `auth` signs the user in; onboarding `create` runs as the freshly signed-in user and the
# create_organization RPC itself rejects callers without auth.uid().
ALLOW = {("src/app/login/page.tsx", "auth"), ("src/app/onboarding/page.tsx", "create")}
bad = []
for f in files:
    s = pathlib.Path(f).read_text()
    if '"use server"' not in s: continue
    for m in re.finditer(r'async function (\w+)\([^)]*\)\s*\{\s*"use server";(.*?)\n\}', s, re.S):
        body = m.group(2)
        if (f, m.group(1)) in ALLOW: continue
        if not re.search(r'requireSession\(|guard\(', body): bad.append(f"{f}: {m.group(1)}")
print(f"{G}  every server action calls requireSession()/guard()" if not bad else f"{R}  server actions without a session check:\n    " + "\n    ".join(bad)); fails += bool(bad)

# 2. where the service-role client is used (review list)
users = sorted({f for f in files if "supabaseAdmin" in pathlib.Path(f).read_text() and not f.endswith("supabase/admin.ts")})
print(f"{Y}  service-role client used in {len(users)} files (bypasses RLS; confirm each filters by org_id or an RLS-checked id):\n    " + "\n    ".join(users))

# 3. admin client imported into client components
cc = [f for f in files if pathlib.Path(f).read_text().lstrip().startswith('"use client"') and re.search(r'supabase/admin|SERVICE_ROLE', pathlib.Path(f).read_text())]
print(f"{G}  service-role key never reaches a client component" if not cc else f"{R}  client component touches the service role: {cc}"); fails += bool(cc)

# 4. secrets in tracked files
pat = re.compile(r'(sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]+|\b\d{8,10}:[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|service_role["\']?\s*[:=]\s*["\']eyJ)')
hits = []
for f in ALL:
    if f.endswith(("package-lock.json", ".png", ".ico")): continue
    try: t = pathlib.Path(f).read_text()
    except Exception: continue
    for m in pat.finditer(t): hits.append(f"{f}: {m.group(0)[:14]}…")
print(f"{G}  no token-shaped secrets in tracked or new files" if not hits else f"{R}  possible secrets in tracked or new files:\n    " + "\n    ".join(hits)); fails += bool(hits)
envs = [f for f in ALL if re.search(r'(^|/)\.env($|\.(local|production))', f)]
print(f"{G}  no .env files tracked" if not envs else f"{R}  .env files tracked: {envs}"); fails += bool(envs)

# 5. tables without RLS
mig = sorted(pathlib.Path("supabase/migrations").glob("*.sql")); allsql = "\n".join(p.read_text() for p in mig)
tables = re.findall(r'create table (\w+)', allsql)
norls = [t for t in tables if not re.search(rf"alter table {t} enable row level security|'{t}'", allsql)]
print(f"{G}  all {len(tables)} tables have RLS enabled" if not norls else f"{R}  tables without RLS: {norls}"); fails += bool(norls)

# 6. SECURITY DEFINER functions exposed to anon
sd = re.findall(r'create or replace function public\.(\w+)[^;]*?security definer', allsql, re.S) + re.findall(r'create function public\.(\w+)[^;]*?security definer', allsql, re.S)
unrev = [f for f in set(sd) if not re.search(rf'revoke[^;]*\b{f}\b[^;]*from[^;]*(anon|public)', allsql, re.S)]
print(f"{G}  every SECURITY DEFINER function revokes anon/public" if not unrev else f"{Y}  SECURITY DEFINER functions without an anon revoke: {unrev}")

# 7. migration numbering
seq = [int(p.name.split("_")[0]) for p in mig]          # 20261114000001, 20261114000002, ...
gaps = [(a, b) for a, b in zip(seq, seq[1:]) if b != a + 1]
print(f"{G}  {len(mig)} migrations, numbered without gaps" if not gaps else f"{Y}  migration number gaps: {gaps} (a missing file means an unapplied or lost migration)")

# 8. webhook routes verify before ingesting
w = pathlib.Path("src/app/api/webhooks/[channel]/route.ts")
if w.exists():
    s = w.read_text(); i, j = s.find("parseWebhook("), s.find("ingestMessages(db")
    print(f"{G}  webhook verifies the provider secret before ingesting" if 0 <= i < j else f"{R}  webhook may ingest before verifying"); fails += not (0 <= i < j)

# 9. cron endpoints require the secret
for c in pathlib.Path("src/app/api/cron").rglob("route.ts"):
    ok = "CRON_SECRET" in c.read_text()
    print(f"{G}  {c.parent.name} requires CRON_SECRET" if ok else f"{R}  {c} has no CRON_SECRET check"); fails += not ok

# 10. database writes whose result is thrown away (a failed write would still look like success).
#     Mark deliberate ones with a "best effort" comment on the same line.
disc = []
wr = re.compile(r'(^\s*|\)\s*|\{\s*|;\s*)await [^=;]*?\.(insert|upsert|update|delete)\(')
for f in files:
    for n, line in enumerate(pathlib.Path(f).read_text().split("\n"), 1):
        if wr.search(line) and "best effort" not in line and "supabaseAdmin()" not in line.split("await")[0]:
            disc.append(f"{f}:{n}: {line.strip()[:110]}")
print(f"{G}  no unreviewed discarded database writes" if not disc else f"{R}  database writes with the result ignored (check the error, or add a 'best effort' comment if deliberate):\n    " + "\n    ".join(disc)); fails += bool(disc)

# 11. user-triggered syncs must be scoped to a workspace; credentials must be read per workspace
bare = [f"{f}" for f in files if re.search(r'syncConnection\(\s*(?!\{ orgId|"all-orgs"|scope)', pathlib.Path(f).read_text()) and not f.endswith("lib/sync.ts")]
print(f"{G}  every syncConnection call names its scope (workspace or all-orgs)" if not bare else f"{R}  syncConnection called without a scope: {bare}"); fails += bool(bare)
old = [f for f in files if re.search(r'readCreds\([^,()]*\)', pathlib.Path(f).read_text())]
print(f"{G}  readCreds always receives a workspace id" if not old else f"{R}  readCreds called without a workspace id: {old}"); fails += bool(old)

# 12. leftovers
todo = sh(r"grep -rnE 'TODO|FIXME|VERIFY|XXX' src supabase --include=*.ts --include=*.tsx --include=*.sql | wc -l").strip()
print(f"{Y}  {todo} TODO/FIXME/VERIFY markers (list: grep -rnE 'TODO|FIXME|VERIFY' src supabase)")
stubs = sh(r"grep -rlE 'not implemented yet|is not set up yet' src | wc -l").strip()
print(f"{Y}  {stubs} adapter stub files (expected until those channels/trackers are built)")
print(f"{Y}  tests: {len(list(pathlib.Path('tests').glob('*.test.ts')))} files")
sys.exit(1 if fails else 0)
PY
RC=$?; [ $RC -ne 0 ] && FAILS=$((FAILS+1))
echo; [ $FAILS -eq 0 ] && echo "Scan finished with no FAIL." || echo "Scan finished with failures."
exit $([ $FAILS -eq 0 ] && echo 0 || echo 1)
