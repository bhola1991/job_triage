// Save/load cycle self-check: node scripts/selfcheck-sync.js
//
// selfcheck-rows.js proves one job survives the trip to a typed row and back.
// This runs the actual cycle -- save, load, migrate, two tabs -- against a
// stand-in for PostgREST, because the claims worth making about this change
// are all about sequences rather than values:
//
//   * a migration that reports success without running loses everything
//   * a diffing save that gets the diff wrong deletes rows nobody deleted
//   * the whole point of the change is that two tabs stop overwriting one another
//
// None of those are visible in a single function. The stand-in below enforces
// the one database rule that actually bites here: an upsert may not touch the
// same key twice in a batch.
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = re => { const m = h.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };

const NUL = String.fromCharCode(0);

function fakeSupabase(){
  const T = { profiles: [], jobs: [] };
  let seq = 0;
  const match = (row, filters) => filters.every(([c, op, v]) =>
    op === 'eq' ? row[c] === v : v.indexOf(row[c]) > -1);

  function run(st){
    const rows = T[st.table];
    if(st.ins){
      const keys = st.ins.opt.onConflict.split(',');
      const seen = new Set();
      const out = [];
      for(const r of st.ins.rows){
        const sig = keys.map(k => r[k]).join(NUL);
        /* Postgres refuses this outright -- "ON CONFLICT DO UPDATE command
           cannot affect row a second time" -- so a list holding the same
           posting twice would fail the entire save, not just that row. */
        if(seen.has(sig)) throw new Error('ON CONFLICT cannot affect row a second time');
        seen.add(sig);
        const at = rows.findIndex(x => keys.map(k => x[k]).join(NUL) === sig);
        if(at > -1){ rows[at] = Object.assign({}, rows[at], r); out.push(rows[at]); }
        else { const n = Object.assign({ id: st.table[0] + (++seq) }, r); rows.push(n); out.push(n); }
      }
      return { data: st.sel ? JSON.parse(JSON.stringify(out)) : null, error: null };
    }
    if(st.upd){
      rows.forEach((r, i) => { if(match(r, st.filters)) rows[i] = Object.assign({}, r, st.upd); });
      return { data: null, error: null };
    }
    const hit = rows.filter(r => match(r, st.filters));
    if(st.count) return { count: hit.length, error: null };
    return { data: JSON.parse(JSON.stringify(hit)), error: null };
  }

  function from(table){
    const st = { table, filters: [], ins: null, upd: null, sel: null, count: false };
    const api = {
      upsert(rows, opt){ st.ins = { rows, opt }; return api; },
      update(patch){ st.upd = patch; return api; },
      select(cols, opt){ st.sel = cols || '*'; if(opt && opt.count) st.count = true; return api; },
      eq(c, v){ st.filters.push([c, 'eq', v]); return api; },
      in(c, v){ st.filters.push([c, 'in', v]); return api; },
      then(res){ try{ res(run(st)); }catch(e){ res({ error: e }); } },
    };
    return api;
  }
  return { from, _t: T };
}

/* One browser. Two of these share a fakeSupabase and a key/value store the way
   two tabs share an account, which is the whole scenario under test. */
function newTab(SB, KV){
  const src = [
    grab(/const COLS = \[[\s\S]*?\];\n/),
    grab(/function keyOf[\s\S]*?\n}\n/),
    grab(/const usable = [^\n]*\n/),
    grab(/function blank\(\)[^\n]*\n/),
    grab(/const JOB_INT[\s\S]*?\nasync function load\(\)[\s\S]*?\n}\n/),
  ].join('\n');

  const harness = `
    let DB = { profiles: {}, current: null };
    let KEY='', PROV='', APIFY='', AUTO=true, THEME='dark';
    const THEMES = ['dark'];
    const applyTheme = () => {};
    const today = () => '2026-09-22';
    const USER = { id: 'user-1' };
    const READ_MS = 8000, WRITE_MS = 45000;
    let CLOUD_DOWN = false;
    const cloudDown = () => {};
    const cloudNow = () => !CLOUD_DOWN;
    const withTimeout = p => p;
    const syncNote = () => {};
    const putLocal = async (k, v) => { LOCAL[k] = v; };
    const getLocal = async k => (k in LOCAL ? LOCAL[k] : null);
    const put = async (k, v) => { LOCAL[k] = v; KV[k] = v; };
    const get = async k => (k in KV ? KV[k] : null);
  `;
  const LOCAL = {};
  const api = new Function('SB', 'KV', 'LOCAL',
    harness + src + ';return {save,load,migrateRows,saveRows,loadRows,' +
    'getDB:()=>DB,setDB:d=>{DB=d;},isMigrated:()=>MIGRATED,' +
    'reset:()=>{LAST_SAVED=null;PROFILE_IDS={};MIGRATED=false;DB={profiles:{},current:null};}};'
  )(SB, KV, LOCAL);
  api.LOCAL = LOCAL;
  return api;
}

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } };

const job = (title, extra) => Object.assign({
  title, company: 'Acme', location: 'Remote', url: 'https://x/' + title.toLowerCase(),
  description: 'd', status: 'New', date_applied: '', follow_up_date: '', pitch_sent: 'No',
  notes: '', source: '', query: '', ai_score: '', ai_reason: '', ai_flags: '',
  ai_confidence: '', ai_reachability: '', channel: 'posted', stage: 'new', last_touch: '',
  contacts: '[]', events: '[]', added: '2026-09-01', posted: '', posted_lo: '',
  posted_hi: '', posted_src: '',
}, extra || {});

const profileRec = jobs => ({
  profile: { name: 'Alex', location: 'Bengaluru', country_code: 'in', domains: [],
             strengths: [], hard_skills: [], gaps: [], wrong_shapes: [],
             tracks: [{ id: 'be', label: 'Backend', titles: [], boards: [] }] },
  raw: 'cv', track: 'be', jobs, created: '2026-08-01',
});

(async () => {
  // ---- migration -------------------------------------------------------
  let SB = fakeSupabase(), KV = {};
  let a = newTab(SB, KV);
  a.setDB({ profiles: { p_1: profileRec([job('Alpha'), job('Beta')]) }, current: 'p_1' });
  KV['triage:db'] = JSON.stringify(a.getDB());

  await a.migrateRows();
  ok(a.isMigrated(), 'migration completes and sets the migrated flag');
  ok(SB._t.profiles.length === 1, 'one profile row written');
  ok(SB._t.jobs.length === 2, 'both jobs written as rows, got ' + SB._t.jobs.length);
  ok(KV['triage:current'] === 'p_1', 'the open profile is stored outside the blob');

  // A second run must not duplicate anything or re-announce success.
  await a.migrateRows();
  ok(SB._t.jobs.length === 2, 'migrating twice is a no-op');

  // ---- a migration that did not land must not be declared done ---------
  {
    const SB2 = fakeSupabase(), KV2 = {};
    const b = newTab(SB2, KV2);
    b.setDB({ profiles: { p_1: profileRec([job('Alpha')]) }, current: 'p_1' });
    // A row silently vanishing between write and count is exactly the failure
    // the count-back exists to catch.
    const realFrom = SB2.from;
    SB2.from = t => { const q = realFrom(t); if (t === 'jobs') SB2._t.jobs.length = 0; return q; };
    // It is supposed to complain. Muffle it so a passing run reads as passing.
    const warn = console.warn; console.warn = () => {};
    await b.migrateRows();
    console.warn = warn;
    ok(!b.isMigrated(), 'a short count leaves the account on the blob rather than claiming success');
    ok(KV2['triage:migrated'] === undefined, 'the migrated flag is not set when the count disagrees');
  }

  // ---- a brand-new account, with nothing anywhere -----------------------
  /* The first cloud sign-in: no blob to take apart and no rows to find. It
     must still come out the far side migrated, or every save afterwards keeps
     writing only the blob and none of this does anything. */
  {
    const SB3 = fakeSupabase(), KV3 = {};
    const n = newTab(SB3, KV3);
    await n.load();
    await n.migrateRows();
    ok(n.isMigrated(), 'an empty account migrates rather than getting stuck on a blob it does not have');
    n.setDB({ profiles: { p_9: profileRec([job('First')]) }, current: 'p_9' });
    await n.save();
    const back = newTab(SB3, KV3);
    await back.load();
    ok(back.getDB().profiles.p_9 && back.getDB().profiles.p_9.jobs.length === 1,
       'the first job saved after that comes back as a row');
    ok(back.getDB().current === 'p_9', 'and so does the profile it belongs to');
  }

  // ---- load reassembles what save wrote --------------------------------
  const c = newTab(SB, KV);
  await c.load();
  const got = c.getDB();
  ok(got.current === 'p_1', 'the open profile survives a reload');
  ok(Object.keys(got.profiles).length === 1, 'the profile comes back');
  ok(got.profiles.p_1.jobs.length === 2, 'both jobs come back, got ' + got.profiles.p_1.jobs.length);
  ok(JSON.stringify(got) === JSON.stringify(a.getDB()), 'the whole DB is identical after a round trip');

  // ---- the two-tab case, which is the reason for all of this -----------
  const t1 = newTab(SB, KV), t2 = newTab(SB, KV);
  await t1.load(); await t2.load();
  t1.getDB().profiles.p_1.jobs[0].notes = 'tab one was here';
  t2.getDB().profiles.p_1.jobs[1].notes = 'tab two was here';
  await t1.save();
  await t2.save();
  const after = newTab(SB, KV);
  await after.load();
  const byTitle = {};
  after.getDB().profiles.p_1.jobs.forEach(j => byTitle[j.title] = j);
  ok(byTitle.Alpha.notes === 'tab one was here', 'tab one’s edit survived the other tab saving after it');
  ok(byTitle.Beta.notes === 'tab two was here', 'tab two’s edit survived too');

  // The same job in both tabs: the later write wins, and only that field.
  const u1 = newTab(SB, KV), u2 = newTab(SB, KV);
  await u1.load(); await u2.load();
  u1.getDB().profiles.p_1.jobs[0].notes = 'first';
  u2.getDB().profiles.p_1.jobs[0].notes = 'second';
  await u1.save(); await u2.save();
  const u3 = newTab(SB, KV); await u3.load();
  const alpha = u3.getDB().profiles.p_1.jobs.filter(j => j.title === 'Alpha')[0];
  ok(alpha.notes === 'second', 'same job in two tabs: last writer wins, as decided');
  ok(u3.getDB().profiles.p_1.jobs.length === 2, 'and nothing else was lost to it');

  // ---- adding and deleting --------------------------------------------
  const d = newTab(SB, KV);
  await d.load();
  d.getDB().profiles.p_1.jobs.push(job('Gamma'));
  await d.save();
  ok(SB._t.jobs.filter(r => !r.deleted).length === 3, 'a new job is one new row');

  d.getDB().profiles.p_1.jobs = d.getDB().profiles.p_1.jobs.filter(j => j.title !== 'Beta');
  await d.save();
  ok(SB._t.jobs.length === 3, 'a deleted job is marked, not removed');
  ok(SB._t.jobs.filter(r => r.job_key === 'u:https://x/beta')[0].deleted === true, 'the tombstone is set');
  const e = newTab(SB, KV); await e.load();
  ok(e.getDB().profiles.p_1.jobs.length === 2, 'a tombstoned job does not come back on load');

  // Re-adding the same posting clears the tombstone rather than colliding.
  e.getDB().profiles.p_1.jobs.push(job('Beta'));
  await e.save();
  const f = newTab(SB, KV); await f.load();
  ok(f.getDB().profiles.p_1.jobs.filter(j => j.title === 'Beta').length === 1, 'a re-added job comes back exactly once');

  // ---- save sends the difference, not everything -----------------------
  const g = newTab(SB, KV);
  await g.load();
  let wrote = 0;
  const realFrom2 = SB.from;
  SB.from = t => { const q = realFrom2(t); const up = q.upsert; q.upsert = (rows, o) => { wrote += rows.length; return up(rows, o); }; return q; };
  await g.save();
  ok(wrote === 0, 'saving with nothing changed writes no rows, got ' + wrote);
  g.getDB().profiles.p_1.jobs[0].notes = 'one field';
  await g.save();
  ok(wrote === 1, 'changing one job writes exactly one row, got ' + wrote);
  SB.from = realFrom2;

  // ---- a list holding the same posting twice ---------------------------
  /* importBackup merges profiles wholesale and does not go through addJobs, so
     a duplicate key can reach here. Postgres would reject the whole batch. */
  const dup = newTab(SB, KV);
  await dup.load();
  dup.getDB().profiles.p_1.jobs.push(job('Alpha'));
  let threw = null;
  try { await dup.save(); } catch (err) { threw = err; }
  ok(!threw, 'a duplicated posting does not blow up the save: ' + (threw && threw.message));

  console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS');
})();
