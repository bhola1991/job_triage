// Is the app icon still made of the tokens it claims?   node scripts/selfcheck-icon.js
//
// icon.svg is the fourth place a token change has to reach, and the only one
// selfcheck-tokens.js cannot see. Its values are hard-coded on purpose -- an
// icon loads outside the document, so var() never resolves there -- which
// leaves "check that one by eye" as the whole quality bar. This is that check,
// done by machine instead.
//
// It needs a renderer, because two of the things worth checking are properties
// of the rasterised image and not of the file: what colour a pixel actually is
// after compositing, and how far the marks sit from the centre. There is no
// rasteriser in this repo (no build step, no npm at the root) and installing
// one to check a 2KB file is the wrong trade. Obsidian is already on this
// machine and `obs eval` runs in its renderer with both a DOM and require(),
// so it is borrowed here as a canvas. If it is not running, the rendered half
// is skipped loudly and the text half still runs.
//
// Note on the eval channel: it returns small results quickly and gives up on
// long ones, so the scan is dispatched into a setTimeout, writes its answer to
// a temp file, and is collected by polling. Do not "simplify" that into a
// direct return -- a full-resolution pass does not come back.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let bad = 0, skipped = 0;
const fail = m => { console.error(`  FAIL  ${m}`); bad++; };
const ok = m => console.log(`  ok    ${m}`);

const svg = read('icon.svg');
const truth = JSON.parse(read('design/jobtriage.tokens.json')).dark.color;

/* --cold is the one icon colour with no entry in the source of truth: it is
   defined only in index.html's two :root blocks, and is absent from
   design/jobtriage.tokens.json, ui-kit/src/v2/tokens.css and CLAUDE.md's token
   vocabulary. That is a real gap -- a change to --cold has nothing upstream to
   drive it -- so until it is promoted, read it from the app and say where it
   came from. --plot-fade is in the same position but the icon does not use it. */
const appDark = read('index.html').match(/\n {2}:root\{\s*\n\s*color-scheme:dark;([\s\S]*?)\n {2}\}/);
const coldMatch = appDark && appDark[1].match(/--cold\s*:\s*(#[0-9A-Fa-f]{6})/);
const PALETTE = {
  ink:  truth.ink.value,
  line: truth.line.value,
  go:   truth.go.value,
  dim:  truth.dim.value,
  ...(coldMatch ? { cold: coldMatch[1] } : {}),
};
if (!coldMatch) fail('could not read --cold from index.html\'s dark :root — this check needs updating, not ignoring');

const hex = s => s.toUpperCase();
const byValue = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [hex(v), k]));

console.log('icon.svg vs tokens:');

/* ── 1. XML will not tell you about this one ──────────────────────────────
   A "--" inside an XML comment is illegal and turns the whole file into an
   unparseable broken image, silently. Token names get written there without
   their leading dashes for exactly this reason. */
let badComment = false;
for (const c of svg.match(/<!--[\s\S]*?-->/g) || []) {
  if (c.slice(4, -3).includes('--')) { badComment = true; fail(`a comment contains "--", which makes the file unparseable: ${c.slice(0, 60)}…`); }
}
if (!badComment) ok('no "--" inside an XML comment');

/* ── 2. Every literal in the file is a token value ────────────────────────
   This is the drift check: when a token moves and the icon does not, the hex
   left behind stops matching anything in the palette. */
const literals = [...new Set((svg.match(/#[0-9A-Fa-f]{6}/g) || []).map(hex))];
const strays = literals.filter(h => !byValue[h]);
if (strays.length) fail(`hex not in the palette: ${strays.join(', ')} — a token moved and the icon did not`);
else ok(`${literals.length} hex literals all match tokens (${literals.map(h => byValue[h]).join(', ')})`);

/* ── 3. The rendered checks ───────────────────────────────────────────────
   Two constraints from the icon's own rules, both easy to undo by accident:

   - The rim is load-bearing. The ground is 1.27:1 against a black home screen,
     so without a --line rim the tile has no edge and dissolves into the
     wallpaper. Checked by sampling the centre and the top edge.
   - Every mark must sit inside the maskable safe zone, the centred circle of
     80% width (r = 204.8 of 512), because the manifest declares
     purpose:"any maskable" and Android crops to it.

   The axes are the same colour as the rim, so they cannot be told apart by
   colour alone. They are split by radius instead: the rim ring only exists
   beyond r=245 (a rounded rect's nearest edge is at r=256), so line-coloured
   pixels inside that are axis. A stray axis pixel between 204.8 and 245 is
   still caught -- it lands in the axis set and fails. */
const SAFE_R = 204.8, RIM_MIN_R = 245;
const OUT = path.join(os.tmpdir(), `selfcheck-icon-${process.pid}.json`);

const probe = `(()=>{const fs=require("fs");const out=${JSON.stringify(OUT)};setTimeout(async()=>{try{
const s=fs.readFileSync(${JSON.stringify(path.join(ROOT, 'icon.svg'))},"utf8");
const im=new Image();await new Promise(k=>{im.onload=k;im.onerror=k;im.src="data:image/svg+xml;base64,"+btoa(s)});
if(!im.width){fs.writeFileSync(out,JSON.stringify({error:"the browser refused to decode icon.svg"}));return}
const c=document.createElement("canvas");c.width=c.height=512;const g=c.getContext("2d");g.drawImage(im,0,0,512,512);
const d=g.getImageData(0,0,512,512).data;
const at=(x,y)=>{const i=(y*512+x)*4;return "#"+[d[i],d[i+1],d[i+2]].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()};
const P=${JSON.stringify(PALETTE)};const near=(i,h)=>Math.abs(d[i]-parseInt(h.slice(1,3),16))<=10&&Math.abs(d[i+1]-parseInt(h.slice(3,5),16))<=10&&Math.abs(d[i+2]-parseInt(h.slice(5,7),16))<=10;
const reach={};for(const k of Object.keys(P)){if(k==="ink")continue;const h=P[k];let mx=0,n=0;
for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4;if(d[i+3]<128)continue;if(!near(i,h))continue;
const r=Math.hypot(x-256,y-256);if(k==="line"&&r>${RIM_MIN_R})continue;n++;if(r>mx)mx=r}
reach[k]={px:n,rMax:+mx.toFixed(1)}}
fs.writeFileSync(out,JSON.stringify({centre:at(256,256),rim:at(256,3),reach}))
}catch(e){fs.writeFileSync(out,JSON.stringify({error:String(e)}))}},0);return "dispatched"})()`;

/* "obs" is an ambiguous command name and picking the wrong one is not a
   harmless miss: OBS Studio, the screen recorder, also installs /usr/bin/obs.
   On this machine BOTH exist -- the Obsidian CLI at ~/.local/bin/obs wins only
   because it comes first on PATH. A checked-in script that runs bare `obs`
   would, on any box where /usr/bin sorts first, launch a screen recorder and
   hang. So resolve it by identity rather than by name: walk PATH, skip
   compiled binaries (OBS Studio is an ELF), and require the file to actually
   mention Obsidian. Set OBSIDIAN_CLI to override.
   Spawning is also no help as a probe -- a missing binary does not reliably
   report ENOENT here, so "not installed" and "wedged" look identical. */
function findObsidianCli() {
  if (process.env.OBSIDIAN_CLI) return process.env.OBSIDIAN_CLI;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(dir, 'obs');
    try {
      fs.accessSync(f, fs.constants.X_OK);
      const head = fs.readFileSync(f).subarray(0, 4096);
      if (head.subarray(0, 4).toString('binary') === '\x7fELF') continue;   // OBS Studio
      if (/obsidian/i.test(head.toString('utf8'))) return f;
    } catch { /* unreadable or absent: try the next one */ }
  }
  return null;
}
const onPath = findObsidianCli();

let rendered = onPath ? null : { unavailable: 'no Obsidian CLI on PATH (note: OBS Studio also installs an "obs"; set OBSIDIAN_CLI to point at the right one)' };
if (onPath) try {
  fs.rmSync(OUT, { force: true });
  execFileSync(onPath, ['eval', `code=${probe}`], { stdio: 'pipe', timeout: 15000 });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !fs.existsSync(OUT)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  if (fs.existsSync(OUT)) { rendered = JSON.parse(fs.readFileSync(OUT, 'utf8')); fs.rmSync(OUT, { force: true }); }
} catch (e) {
  rendered = { unavailable: `Obsidian did not answer (${String(e.message || e).split('\n')[0]})` };
}

if (!rendered || rendered.unavailable) {
  console.log(`  SKIP  rendered checks — ${(rendered && rendered.unavailable) || 'no answer from the renderer'}`);
  console.log('        (needs Obsidian running and `obs` on PATH; the geometry and');
  console.log('         composited-colour checks did NOT run)');
  skipped++;
} else if (rendered.error) {
  fail(`renderer: ${rendered.error}`);
} else {
  if (hex(rendered.centre) !== hex(PALETTE.ink)) fail(`the ground renders ${rendered.centre}, tokens say --ink ${PALETTE.ink}`);
  else ok(`ground renders as --ink ${PALETTE.ink}`);

  if (hex(rendered.rim) !== hex(PALETTE.line)) fail(`the rim renders ${rendered.rim}, tokens say --line ${PALETTE.line} — without it the tile dissolves into the wallpaper`);
  else ok(`rim renders as --line ${PALETTE.line}`);

  for (const [name, { px, rMax }] of Object.entries(rendered.reach)) {
    const what = name === 'line' ? 'axes' : `--${name} marks`;
    if (!px) fail(`${what}: nothing rendered in ${PALETTE[name]} — the icon lost a mark`);
    else if (rMax > SAFE_R) fail(`${what} reach r=${rMax}, past the maskable safe zone (${SAFE_R}) — Android will crop them`);
    else ok(`${what} reach r=${rMax} of ${SAFE_R}${rMax > SAFE_R * 0.97 ? '  ← almost no margin' : ''}`);
  }
}

console.log(bad
  ? `\n${bad} problem(s). icon.svg is hard-coded on purpose, so it does not follow a token\nchange on its own — a token edit is four files plus this one.`
  : skipped ? '\nPASS (with skips)' : '\nALL PASS');
process.exit(bad ? 1 : 0);
