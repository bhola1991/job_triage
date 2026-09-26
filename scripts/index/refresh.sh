#!/usr/bin/env bash
# One pass of the whole corpus pipeline:
#
#   crawl -> deposit -> verify
#
# Everything here is free and keyless except the two Supabase writes, which use
# the service role from supabase/.env. Run it daily. The value is in the SERIES,
# not in any single run: liveness is a set difference, so run one closes nothing
# and every run after it closes what left the boards since.
#
#   ./scripts/index/refresh.sh              full pass
#   ./scripts/index/refresh.sh --no-push    crawl and diff locally, send nothing
#
# Deliberately a shell script and not a node one. Each step is already a program
# with its own flags and its own failure mode; wrapping them in an orchestrator
# would add a layer that can fail in ways none of them can, to save typing five
# lines. `set -e` means a failed step stops the pass rather than pushing a
# half-built corpus over a good one.
set -euo pipefail
cd "$(dirname "$0")/../.."

# The two writers spell it differently: push-index.js sends unless --dry,
# verify.js sends only with --push. One flag here, translated for each.
PUSH=--push
DRY=""
if [ "${1:-}" = "--no-push" ]; then PUSH=""; DRY=--dry; fi

# Server secrets. Absent, the pushes no-op with a message and the crawl still
# runs -- which is the right behaviour on a machine that only wants the data.
if [ -f supabase/.env ]; then set -a; . ./supabase/.env; set +a; fi

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

say "1/5  Naukri: every city sitemap plus the latest-jd feed"
# One index, followed. ~350k urls: nine named cities, OtherCities-1..6 which is
# everywhere else in India, and latest-jd which is a day old at the head.
node scripts/index/sitemap-jobs.js \
  "https://www.naukri.com/sitemap/sitemap.xml" \
  --out scripts/index/naukri.jsonl

say "2/5  Naukri: the postings it says are expired"
# A board publishing its own dead list is a better closure signal than absence
# from a snapshot, which carries rotation noise. Kept separate so verify.js can
# record WHICH kind of closure it was.
node scripts/index/sitemap-jobs.js \
  "https://www.naukri.com/sitemap/sitemap-expired-jd-pages.xml" \
  --out scripts/index/expired.jsonl

say "3/5  ATS boards and the keyless APIs"
# Greenhouse/Lever/Ashby from sources.json, plus Remotive, RemoteOK, Arbeitnow,
# Himalayas and Singapore's MyCareersFuture. These are the FULL rows -- the ones
# carrying a real description, so the only ones a judge can read.
node scripts/index/ingest.js scripts/index/index.jsonl

say "4/5  Deposit into the shared corpus"
node scripts/index/push-index.js \
  scripts/index/naukri.jsonl scripts/index/index.jsonl $DRY

say "5/5  What is still real"
# --expired marks declared closures; absence from today's snapshot marks
# inferred ones. Both land in job_checks with closed_src saying which.
node --max-old-space-size=4096 scripts/index/verify.js \
  scripts/index/naukri.jsonl scripts/index/index.jsonl \
  --expired scripts/index/expired.jsonl $PUSH

say "done"
