#!/usr/bin/env bash
# The crawl's memory between nights, kept in a private Supabase Storage bucket.
#
#   scripts/index/state.sh init    create the bucket (once)
#   scripts/index/state.sh push    upload this machine's state
#   scripts/index/state.sh pull    download it (refuses to go on without checks.json)
#
# Why it exists: the nightly refresh moved from a laptop to GitHub Actions on
# 2026-10-19, and a runner starts empty. verify.js is a set difference against
# yesterday -- checks.json holds every posting's first_seen, absences and
# closures -- so a run that starts without it does not just lose history, it
# re-dates every posting as first seen today and pushes those wrong ages into
# job_checks. Hence `pull` FAILS when checks.json is missing rather than letting
# the crawl start a new series by accident.
#
# Why Supabase and not the repo, a release or the Actions cache: the repo is
# public, so the first two would publish the whole liveness record, and the
# cache is evicted after a week unused. The crawl already holds the service
# role for this project; nothing new is trusted.
#
# Files, and what losing each would cost:
#   checks.json                 the liveness series (fatal, see above)
#   jsonld.cache.json           pages already read; without it a night re-reads them
#   sources.json                ATS slugs the harvest has found; the repo copy is the seed
#   probe-boards.results.jsonl  boards already probed; the repo copy is the seed
set -euo pipefail
cd "$(dirname "$0")"
if [ -f ../../supabase/.env ]; then set -a; . ../../supabase/.env; set +a; fi
: "${SUPABASE_URL:?SUPABASE_URL not set}" "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"
B=crawl-state
API="$SUPABASE_URL/storage/v1"
AUTH=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
BIG=(checks.json jsonld.cache.json)                     # stored xz-compressed
SMALL=(sources.json probe-boards.results.jsonl)         # stored as they are

case "${1:-}" in
init)
  curl -sS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "$API/bucket" \
    -d "{\"id\":\"$B\",\"name\":\"$B\",\"public\":false}"; echo ;;
push)
  for f in "${BIG[@]}"; do
    [ -f "$f" ] || { echo "  push: no $f here, skipped"; continue; }
    xz -T0 -6 -c "$f" > "/tmp/$f.xz"
    curl -sS -f "${AUTH[@]}" -H 'x-upsert: true' -H 'Content-Type: application/octet-stream' \
      --data-binary @"/tmp/$f.xz" "$API/object/$B/$f.xz" > /dev/null
    echo "  pushed $f ($(du -h "/tmp/$f.xz" | cut -f1) compressed)"; rm -f "/tmp/$f.xz"
  done
  for f in "${SMALL[@]}"; do
    [ -f "$f" ] || continue
    curl -sS -f "${AUTH[@]}" -H 'x-upsert: true' -H 'Content-Type: application/octet-stream' \
      --data-binary @"$f" "$API/object/$B/$f" > /dev/null
    echo "  pushed $f"
  done ;;
pull)
  for f in "${BIG[@]}"; do
    if curl -sS -f "${AUTH[@]}" "$API/object/$B/$f.xz" -o "/tmp/$f.xz" 2>/dev/null; then
      xz -d -c "/tmp/$f.xz" > "$f"; rm -f "/tmp/$f.xz"; echo "  pulled $f ($(du -h "$f" | cut -f1))"
    elif [ "$f" = checks.json ]; then
      echo "  pull: checks.json is not in the bucket. Refusing to crawl: a run without it re-dates every posting." >&2
      exit 1
    else echo "  pull: no $f in the bucket; starting without it"; fi
  done
  for f in "${SMALL[@]}"; do
    if curl -sS -f "${AUTH[@]}" "$API/object/$B/$f" -o "$f.pulled" 2>/dev/null; then mv "$f.pulled" "$f"; echo "  pulled $f"
    else rm -f "$f.pulled"; echo "  pull: no $f in the bucket; using the repo's copy"; fi
  done ;;
*) echo "usage: $0 init|push|pull" >&2; exit 2 ;;
esac
