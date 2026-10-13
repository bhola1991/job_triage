#!/usr/bin/env bash
# The morning look, so nobody has to remember it: is the live system healthy,
# did a tester say anything since yesterday, and what did they all do. Run by a systemd user timer
# (jobtriage-morning.timer, outside this repo like the refresh units); the full
# output is in `journalctl --user -u jobtriage-morning`, the summary is a
# desktop notification.
#
# Not set -e: a failing heartbeat is a result to report, not a reason to stop
# before the feedback is read.
cd "$(dirname "$0")/.."

health=$(node scripts/heartbeat.js 2>&1); hs=$?
echo "$health"
node scripts/read-feedback.js --since 1
n=$(node scripts/read-feedback.js --since 1 --json 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch(e){console.log("?")}})')

# What testers did, and what it says. Kept as a dated file as well as printed:
# the journal is the wrong place to read a table, and yesterday's is worth
# having beside today's.
out="${XDG_STATE_HOME:-$HOME/.local/state}/jobtriage"; mkdir -p "$out"
report="$out/insights-$(date +%F).txt"
node scripts/insights.js > "$report" 2>&1 || echo "insights failed — see $report"
cat "$report"
summary=$(grep '^SUMMARY: ' "$report" | tail -1 | sed 's/^SUMMARY: //')

if [ "$hs" -ne 0 ]; then
  title="Job Triage: PROBLEM"; urgency=critical
  body=$(echo "$health" | grep FAIL | sed 's/^ *FAIL *//')
else
  title="Job Triage: healthy"; urgency=normal; body=""
fi
[ "$n" != "0" ] && { body="${body:+$body
}$n new feedback — node scripts/read-feedback.js --since 1"; urgency=critical; }
# critical does not expire, so anything worth acting on is still there when
# the screen is next looked at; an all-clear is allowed to fade.
body="${body:+$body
}${summary:-no insights this morning}
Full report: $report"
notify-send -u "$urgency" -a "Job Triage" "$title" "$body" || true
exit "$hs"
