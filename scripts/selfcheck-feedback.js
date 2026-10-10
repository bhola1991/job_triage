// When the app asks for feedback: node scripts/selfcheck-feedback.js
// Pulls the two pure functions out of index.html and walks the schedule.
const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const m=h.match(/const FB_BASE[\s\S]*?\nfunction fbNext[\s\S]*?\n}\n/);
if(!m) throw new Error('fbDue/fbNext not found in index.html');
const {fbDue,fbNext,FB_BASE,FB_MAX,FB_ERR}=new Function(m[0]+'return {fbDue,fbNext,FB_BASE,FB_MAX,FB_ERR};')();
let bad=0; const ok=(name,c)=>{ console.log((c?'  ok  ':'  FAIL ')+name); if(!c) bad++; };
const MIN=6e4, T=1e12;
let s={last:0,gap:FB_BASE};
ok('the first moment of a first session asks', fbDue(s,'search',T));
s=fbNext(s,'asked',T);
ok('and the next one, seconds later, does not', !fbDue(s,'score',T+5e3));
ok('nor does a failure inside its own floor', !fbDue(s,'error',T+FB_ERR-1));
ok('but a failure asks once that floor has passed', fbDue(s,'error',T+FB_ERR));
ok('an ordinary moment waits the whole gap', !fbDue(s,'search',T+FB_BASE-1) && fbDue(s,'search',T+FB_BASE));
s=fbNext(s,'ignored',T+25e3);
ok('ignoring an ask doubles the wait', s.gap===FB_BASE*2 && !fbDue(s,'search',T+FB_BASE) && fbDue(s,'search',T+FB_BASE*2));
ok('measured from the ask, not from the shrug', s.last===T);
for(let i=0;i<10;i++) s=fbNext(s,'ignored',T);
ok('the wait is capped', s.gap===FB_MAX);
ok('a failure still asks at full back-off', fbDue(s,'error',T+FB_ERR));
s=fbNext(s,'gave',T+90*MIN);
ok('any report resets the wait and restarts the clock', s.gap===FB_BASE && s.last===T+90*MIN);
ok('so nobody is asked straight after volunteering', !fbDue(s,'search',T+91*MIN));
console.log(bad?`${bad} FAILED`:'ALL PASS'); process.exit(bad?1:0);
