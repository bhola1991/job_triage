// Board search pipeline self-check: node scripts/selfcheck-boards.js
const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const grab=(re)=>{const m=h.match(re); if(!m) throw new Error('missing '+re); return m[0];};
const src=[
  grab(/const MAX_AGE_DAYS[\s\S]*?\nasync function runBoards/).replace(/async function runBoards$/,''),
  grab(/const TITLE_NOISE[^\n]*\n/), grab(/function roleWords[\s\S]*?\n}\n/),
  grab(/const ATS = \{[\s\S]*?\n\};\n/), grab(/const stripTags[^\n]*\n/),
  grab(/const httpUrl = [^\n]*\n/),
  grab(/function keyOf[\s\S]*?\n}\n/), grab(/function grabJSON[\s\S]*?\n}\n/),
  // What leaves for a model, and what is stripped before it does.
  grab(/const YEAR_RANGE = [\s\S]*?\n  }\);\n/),
  // candidateOf arrives inside the FLAG_CODES..addSpans slice above; grabbing
  // it again is a redeclaration in the same eval.
  // sysPrompt interpolates today(); record-deepseek.js grabs it the same way.
  grab(/const today = [^\n]*\n/),
  /* ageOf and what it needs. freshWeight asks how old a posting is, and with
     saneDate stubbed to d=>d it answered from a raw string -- so every
     freshness assertion passed or failed for the wrong reason. */
  grab(/function saneDate[\s\S]*?\n}\n/),
  /* NOT ageOf: it is stubbed below as a lookup into the AGE map, which is how
     boardFilter's age test is driven. Grabbing the real one shadows that and
     breaks it. Freshness is tested through AGE for the same reason. */
  grab(/const dayDiff = [^\n]*\n/),
  /* The whole intake block in one slice: redLine leans on limitsOf, which is
     declared above AVOID_PATTERNS, so starting at AVOID_PATTERNS compiled to
     a ReferenceError. Ends just before PROF_TEXT. */
  grab(/const INTENTS = \[[\s\S]*?\nconst PROF_TEXT/).replace(/\nconst PROF_TEXT$/,''),
  // The bands and the freshness wrapper. CLOSING_DAYS comes with them.
  grab(/const WORK_FIT=[\s\S]*?\nconst overBar[^\n]*\n/),
  /* fitOf through rankFor in one slice: isStrong needs fitOf, rankFor needs
     rankOf, and rankOf needs confWeight. All sit together, ahead of
     MAX_AGE_DAYS, so this cannot overlap the grabs above. */
  grab(/const fitOf   = [\s\S]*?\nconst rankFor[^\n]*\n/),
  // CLOSING_DAYS arrives inside the WORK_FIT..isStrong slice above.
  grab(/function sysPrompt[\s\S]*?\n}\n/),
  /* scoreAndCut writes flags through these now. It also swallows anything a
     batch throws, by design -- so without them in the slice this file went on
     passing its imports and reported every job unscored instead, which is
     exactly what a missing global looks like from the outside. */
  grab(/const FLAG_CODES = \{[\s\S]*?\nfunction addSpans[\s\S]*?\n}\n/),
].join('\n');
/* Declared in index.html well above the slice grabbed here, so it has to be
   supplied like any other outside-the-slice global. Its value is irrelevant to
   what this checks -- scoreBatch is stubbed -- but its absence is not: an
   undefined name throws inside the batch, and scoreAndCut is built to swallow
   a throwing batch and keep the rows unscored. So a missing global does not
   surface as "TOK_CAP is not defined", it surfaces as every job silently going
   unscored, which is exactly how it would look in production. */
const TOK_CAP = 4000;
let DBJOBS=[{url:'https://x/old'}], AGE={}, CLAUDE=null, FEEDS={};
const P=()=>({jobs:DBJOBS}), ageOf=j=>AGE[j.url]??null, setPosted=(j,d)=>{j.posted=d;};
const atsPull=async(p,s)=>{ const f=FEEDS[p+':'+s]; if(f==='fail') throw new Error('network'); return f||null; };
const claude=async(t)=>CLAUDE(t);
let SCORES=null;
const scoreBatch=async(batch)=>{ if(SCORES==='fail') throw new Error('boom'); const o={}; batch.forEach(b=>{ const v=SCORES(b.j); if(v!=null) o[String(b.i)]={score:v,reach:50,conf:'high',flags:[{code:'fit',fact:'go and postgres'}],posted:null}; }); return o; };
/* scoreAndCut judges what it scores now. Both of these live outside the slice:
   cloudNow gates the call, judgeMany makes it. Neither is what this file
   checks, but leaving them out is not neutral -- cloudNow is read outside the
   try, so its absence is a hard ReferenceError, and judgeMany's would be
   swallowed into "no flags" instead. */
let CLOUD=false, JUDGED=async()=>[];
const cloudNow=()=>CLOUD;
const judgeMany=async(postings, cand)=>JUDGED(postings, cand);
/* rankOf is no longer stubbed here: the real one is sliced in above, with
   confWeight and fitOf, because the freshness assertions need the actual
   ranking rather than a stand-in. Keeping the stub made the eval fail with
   "Identifier 'rankOf' has already been declared". */
const esc=x=>String(x), $=()=>null, setSearchInfo=()=>{};
const blank=()=>({title:'',company:'',url:'',location:'',description:''});
eval(src+';globalThis.T={atsOfUrl,jsearchRow,isPostingUrl,boardFilter,scoreAndCut,liveBoard,fromAts,tcKey,redactCV,candidateOf,sysPrompt,redLine,statedPayMonthly,barsFor,freshWeight,isStrong,overBar,rankFor,rankOf};');

const ok=(c,m)=>{ if(!c){console.error('FAIL',m); process.exitCode=1;} };
(async()=>{
 // A scheme esc() cannot neutralise. These reach an href and window.open.
 ok(!isPostingUrl('javascript:alert(1)'),'javascript: rejected');
 ok(!isPostingUrl('data:text/html,<script>alert(1)</script>'),'data: rejected');
 ok(!isPostingUrl('JavaScript:alert(1)'),'JavaScript: rejected (case)');
 ok(!isPostingUrl('vbscript:msgbox(1)'),'vbscript: rejected');
 ok(!isPostingUrl('file:///etc/passwd'),'file: rejected');
 ok(isPostingUrl('https://www.linkedin.com/jobs/view/123'),'li post');
 ok(!isPostingUrl('https://www.linkedin.com/jobs/data-engineer-jobs'),'li listing');
 ok(isPostingUrl('https://www.glassdoor.co.in/job-listing/x-JV_1.htm'),'gd post');
 ok(!isPostingUrl('https://www.glassdoor.com/Job/bangalore-data-jobs-SRCH_IL.0.htm'),'gd listing');
 ok(!isPostingUrl('https://in.indeed.com/q-data-engineer-jobs.html'),'indeed listing');
 ok(isPostingUrl('https://in.indeed.com/viewjob?jk=abc'),'indeed post');
 ok(isPostingUrl('https://wellfound.com/jobs/123-data-engineer'),'wf post');
 ok(!isPostingUrl('https://wellfound.com/role/l/data-engineer/bangalore'),'wf listing');
 ok(isPostingUrl('https://boards.greenhouse.io/acme/jobs/4455'),'gh post');
 ok(!isPostingUrl('https://boards.greenhouse.io/acme/jobs'),'gh board');
 const J=(url,title,company,query)=>({url,title,company,query,description:'d'});
 AGE={'https://a/3':45};
 const f=boardFilter([
  J('https://a/1','Data Engineer','Acme','A'), J('https://www.linkedin.com/jobs/search?q=x','Data Engineer','Acme','A'),
  J('https://a/3','Data Engineer','Beta','B'),
  J('https://b/1','Data Engineer','Acme','B'), J('https://x/old','Data Engineer','Gamma','B'),
  J('https://a/4','Senior Data Analyst','[from search — verify]','B')],{titles:['Data Engineer','Data Analyst']});
 ok(f.jobs.map(j=>j.url).join()==='https://a/1,https://a/4', 'filter '+f.jobs.map(j=>j.url));
 ok(JSON.stringify(f.dropped)==='{"listing":1,"old":1,"dupe":2}','dropped '+JSON.stringify(f.dropped));

 /* The second identity key, and the reason it is one shared function.
    boardFilter and the yield counter each had their own spelling and the two
    disagreed: boardFilter rejected only a BRACKETED company, so a posting whose
    company was the empty string got the key "tc:<title>|" -- which matches every
    unattributed posting sharing that title, so the first through would drop the
    rest as duplicates. An empty company is not an identity. */
 ok(tcKey({title:'Data Engineer',company:'Acme'})==='tc:data engineer|acme','tcKey normal '+tcKey({title:'Data Engineer',company:'Acme'}));
 ok(tcKey({title:'Data Engineer',company:''})==='','an empty company yields no second key');
 ok(tcKey({title:'Data Engineer',company:'   '})==='','a whitespace company yields no second key');
 ok(tcKey({title:'Data Engineer',company:'[from search — verify]'})==='','a placeholder company yields no second key');
 ok(tcKey({})==='' && tcKey(null)==='','a missing company does not throw');
 // Two blank-company postings sharing a title are two jobs, not a duplicate.
 const blankco=T.boardFilter([
   J('https://n/1','Data Engineer','','Q'), J('https://n/2','Data Engineer','','Q')],
   {titles:['Data Engineer']});
 ok(blankco.jobs.length===2 && !blankco.dropped.dupe,
   'two blank-company postings with one title both survive '+JSON.stringify(blankco.dropped));
 // But a real shared company still dedupes, which is what the key is for.
 const sameco=T.boardFilter([
   J('https://m/1','Data Engineer','Acme','Q'), J('https://m/2','Data Engineer','Acme','Q')],
   {titles:['Data Engineer']});
 ok(sameco.jobs.length===1 && sameco.dropped.dupe===1,
   'the same role at the same company still dedupes '+JSON.stringify(sameco.dropped));
 const many=[...Array(30)].map((_,i)=>J('https://z/'+i,'T'+i,'C','Q'));
 SCORES=j=>{ const i=+j.url.split('/').pop(); return i===29?null:(i%3===0?80:40); };
 const sc=await scoreAndCut(many,{},'t');
 ok(sc.kept.length===10 && sc.below===19 && sc.unscored.length===1 && sc.kept[0].ai_score==='80','scoreAndCut '+sc.kept.length+'/'+sc.below+'/'+sc.unscored.length);
 // What actually lands on the row: flags as JSON, each with its fact, and no
 // sentence anywhere. ai_reason is never written again.
 const kf=JSON.parse(sc.kept[0].ai_flags);
 ok(Array.isArray(kf) && kf[0].code==='fit' && kf[0].fact==='go and postgres','ai_flags carries code and fact '+sc.kept[0].ai_flags);
 ok(!sc.kept[0].ai_reason,'no prose is written to the row');

 /* Judging at intake. The point of doing it after the scoring loop rather than
    inside it is that a search pays once for the whole list instead of once per
    batch of twelve, so the call count is the assertion that matters most. */
 const mk=n=>[...Array(n)].map((_,i)=>J('https://j/'+i,'T'+i,'C','Q'));
 CLOUD=true; SCORES=()=>60;
 let calls=0, sizes=[];
 JUDGED=async(postings)=>{ calls++; sizes.push(postings.length);
   return postings.map(p=>({ok:true, confidence:'high', _title:p.title,
     flags:[{code:'loc',probability:0.9},{code:'fit',probability:0.1}]})); };
 const jg=await scoreAndCut(mk(20),{},'t');
 ok(calls===1 && sizes[0]===20,'the whole intake is judged in one pass, got '+calls+' call(s) of '+sizes.join('/'));
 const jf=JSON.parse(jg.kept[0].ai_flags);
 ok(jf.length===1 && jf[0].code==='loc','Jev decides which flags fire at intake, got '+jg.kept[0].ai_flags);
 ok(JSON.parse(jg.kept[0].ai_judgment)._title===jg.kept[0].title,'each judgement lands on the posting it was asked about');
 // A judgement that fails costs the flags, never the scoring already paid for.
 JUDGED=async()=>{ throw new Error('typesafe down'); };
 const jd=await scoreAndCut(mk(3),{},'t');
 ok(jd.kept.length===3 && jd.kept[0].ai_score==='60' && !jd.kept[0].ai_judgment,'a failed judgement keeps the scoring it already paid for');
 calls=0; CLOUD=false;
 const jo=await scoreAndCut(mk(3),{},'t');
 ok(calls===0 && jo.kept.length===3,'with no cloud session nothing is judged and the scoring still lands');
 CLOUD=false;

 SCORES='fail';
 const sf=await scoreAndCut(many.slice(0,3),{},'t');
 ok(sf.kept.length===0 && sf.unscored.length===3,'scoring failure keeps batch unscored');
 SCORES=j=>({'https://a/10':90,'https://a/11':30,'https://a/12':60})[j.url];
 DBJOBS=[]; AGE={}; FEEDS={};
 const lb=liveBoard({titles:['Data Engineer']},{},'t');
 await lb.add([J('https://a/10','Data Engineer I','Acme','LinkedIn'),J('https://a/11','Data Engineer II','Beta','Indeed'),J('https://a/12','Data Engineer III','Gamma','Naukri')]);
 await lb.add([J('https://a/10','Data Engineer I','Acme','Indeed')]);   // same link from another source
 ok(lb.st.kept.map(j=>j.url).join()==='https://a/10,https://a/12' && lb.st.below===1 && lb.st.dropped.dupe===1 && lb.st.found===4,'liveBoard '+JSON.stringify({kept:lb.st.kept.map(j=>j.url),below:lb.st.below,d:lb.st.dropped}));
 SCORES=j=>({'https://y/1':80,'https://y/2':70,'https://y/3':20})[j.url];
 DBJOBS=[]; AGE={}; FEEDS={};
 const yb=liveBoard({titles:['Data Engineer']},{},'t');
 const JO=(url,title,company,origin)=>({...J(url,title,company,origin),origin});
 await yb.add([JO('https://y/1','Data Engineer','Acme','naukri'),JO('https://y/2','Data Engineer Lead','Beta','naukri'),JO('https://y/3','Data Engineer Intern','Zeta','naukri')]);
 await yb.add([JO('https://li/9','Data Engineer','Acme','linkedin')]);  // same role via another site: not exclusive
 const rep=yb.report();
 ok(JSON.stringify(rep)==='{"naukri":{"found":3,"unique_new":3,"kept_50":2,"exclusive_50":1},"linkedin":{"found":1,"unique_new":0,"kept_50":0,"exclusive_50":0}}','yield '+JSON.stringify(rep));
 FEEDS={'greenhouse:acme':{rows:[{url:'https://boards.greenhouse.io/acme/jobs/1?x',desc:'FULL',location:'Remote',posted:'2026-09-01'}]},'lever:beta':'fail'};
 const r=await fromAts([J('https://boards.greenhouse.io/acme/jobs/1','t','c','q'),J('https://boards.greenhouse.io/acme/jobs/2','t','c','q'),
   J('https://jobs.lever.co/beta/uuid-9','t','c','q'),J('https://www.linkedin.com/jobs/view/5','t','c','q')]);
 ok(r.closed===1 && r.jobs.length===3 && r.jobs[0].description==='FULL' && r.jobs[0].posted==='2026-09-01','ats '+JSON.stringify(r));
 const jr=jsearchRow({title:'Data Engineer',company:'',url:'https://in.indeed.com/applystart?jk=9',description:'x',posted:'2026-09-10',publisher:'Indeed'});
 ok(jr.company.startsWith('[') && jr.query==='Indeed' && jr.posted==='2026-09-10' && isPostingUrl(jr.url),'jsearchRow '+JSON.stringify(jr));
 ok(isPostingUrl('https://www.naukri.com/job-listings-data-engineer-acme-bengaluru-3-to-6-years-100926000001'),'naukri post');
 ok(!isPostingUrl('https://www.google.com/search?q=data+engineer&ibp=htl;jobs'),'google jobs link');
 ok(!isPostingUrl('https://news.ycombinator.com/item?id=41234567'),'HN thread');
 ok(isPostingUrl('https://www.ycombinator.com/companies/acme/jobs/AbC123-founding-engineer'),'YC job');
 ok(!isPostingUrl('https://www.reddit.com/r/nocode/comments/abc/code_vs_nocode/'),'reddit');
 ok(!isPostingUrl('not a url'),'bad url');
 const A=u=>JSON.stringify(atsOfUrl(u));
 ok(A('https://boards.greenhouse.io/acme/jobs/4455')==='{"platform":"greenhouse","slug":"acme","id":"4455"}','gh '+A('https://boards.greenhouse.io/acme/jobs/4455'));
 ok(A('https://jobs.lever.co/beta/uuid-9/apply')==='{"platform":"lever","slug":"beta","id":"uuid-9"}','lever apply');
 ok(A('https://apply.workable.com/acme/j/AB12CD/')==='{"platform":"workable","slug":"acme","id":"AB12CD"}','workable '+A('https://apply.workable.com/acme/j/AB12CD/'));
 ok(A('https://jobs.smartrecruiters.com/Acme/744000012345678-data-engineer')==='{"platform":"smartrecruiters","slug":"Acme","id":"744000012345678-data-engineer"}','sr');
 ok(A('https://acme.recruitee.com/o/data-engineer')==='{"platform":"recruitee","slug":"acme","id":"data-engineer"}','recruitee '+A('https://acme.recruitee.com/o/data-engineer'));
 ok(atsOfUrl('https://www.linkedin.com/jobs/view/5')===null,'non-ats');
 FEEDS={'smartrecruiters:Acme':{rows:[{url:'https://jobs.smartrecruiters.com/Acme/744000012345678',desc:'SR FULL'}]}};
 const sr=await fromAts([J('https://jobs.smartrecruiters.com/Acme/744000012345678-data-engineer','t','c','q')]);
 ok(sr.closed===0 && sr.jobs[0].description==='SR FULL','sr match '+JSON.stringify(sr));

 /* ── what leaves this browser for a model ─────────────────────────────────
    Checked 2026-10-08, after reading the four vendors' own policies. DeepSeek
    stores inputs in the PRC, keeps them "for as long as you have an account"
    and trains on them unless you opt out, with no API/consumer distinction --
    and profile extraction sends it the whole CV. So what goes, and what has
    been taken out first, is a property worth asserting rather than reviewing.

    The name is the one identifier that was crossing the wire on EVERY batch.
    It decides nothing about whether a posting fits, so scoring, judging and
    track assessment no longer send it. The two drafters still do, because a
    message you send is signed by you -- that is not leakage, it is the point. */
 {
  const CV = [
    'Priya Rao', 'priya.rao+jobs@example.co.in', '+91 98765 43210',
    'linkedin.com/in/priyarao', 'https://github.com/priyarao/thing',
    'Senior Engineer 2019-2023, led a team of 12',
    'Grew ARR from 1.2M to 4.5M across 2021 and 2022',
  ].join('\n');
  const red = T.redactCV(CV);
  ok(!/priya\.rao\+jobs@/.test(red), 'redactCV removes the email: '+red);
  ok(!/98765/.test(red), 'redactCV removes a dialable number');
  ok(!/in\/priyarao/.test(red) && /linkedin\.com/.test(red), 'redactCV drops a url path but keeps the host');
  ok(!/priyarao\/thing/.test(red) && /github\.com/.test(red), 'redactCV drops a github handle, keeps the host');
  // Dates and quantities are what the extraction reads seniority from. An
  // earlier version of the phone rule ate "2019-2023" -- eight digits.
  ok(/2019-2023/.test(red), 'redactCV keeps a year range');
  ok(/1\.2M to 4\.5M/.test(red) && /2021 and 2022/.test(red), 'redactCV keeps quantities and single years');
  ok(/led a team of 12/.test(red), 'redactCV keeps prose');

  const prof = { name:'Priya Rao', location:'Delhi, India', seniority:'senior',
    headline:'Payments engineer', strengths:['Go','Postgres'], gaps:['k8s'],
    wrong_shapes:['frontend only'], unusual_combination:'payments + linguistics',
    tracks:[{id:'t1', label:'Payments', titles:['Backend Engineer']}] };

  const cand = T.candidateOf(prof, 't1');
  ok(!('name' in cand), 'candidateOf sends no name to TypeSafe: '+Object.keys(cand).join(','));
  ok(cand.strengths && cand.targeting, 'candidateOf still sends what the judgement needs');
  ok(!JSON.stringify(cand).includes('Priya'), 'the name is nowhere in the TypeSafe payload');

  const sp = T.sysPrompt(prof, 't1');
  ok(!/Priya/.test(sp), 'sysPrompt sends no name to DeepSeek');
  ok(/Payments engineer/.test(sp) && /Go/.test(sp), 'sysPrompt still carries the headline and strengths');
 }

 /* ── red lines: the ones that must NOT fire matter most ───────────────────
    A limit excludes a posting outright, so a false positive silently removes
    real work. The pay rule is the dangerous one: most postings name no salary,
    and treating silence as "under your floor" would quietly delete most of the
    market. Every "KEPT" case below is guarding that. */
 console.log('red lines');
 {
   const prof = lim => ({ location: 'Delhi, India', limits: lim });
   const J = o => Object.assign({ title:'Video Editor', company:'Acme',
     location:'Delhi, India', description:'Edit videos.' }, o);
   const kept  = (n, j, l) => ok(T.redLine(j, prof(l)) === null, 'kept: ' + n + ' — ' + T.redLine(j, prof(l)));
   const gated = (n, j, l) => ok(T.redLine(j, prof(l)) !== null, 'gated: ' + n);

   // Defaults must gate nothing, for every profile that predates the field.
   kept('default limits gate nothing', J({ location:'Mumbai' }), {});

   // Pay: a figure the posting actually states, or no gate at all.
   kept('no pay mentioned',        J({ description:'Great role.' }),            { min_pay:50000 });
   kept('"competitive salary"',    J({ description:'Competitive salary.' }),    { min_pay:50000 });
   kept('a bare number',           J({ description:'Team of 40000 users.' }),   { min_pay:50000 });
   kept('ambiguous figure, no period', J({ description:'₹60000' }),             { min_pay:50000 });
   kept('Rs 80,000 per month',     J({ description:'Rs 80,000 per month' }),    { min_pay:50000 });
   kept('12 LPA',                  J({ description:'12 LPA' }),                 { min_pay:60000 });
   kept('₹900000 per annum',       J({ description:'₹900000 per annum' }),      { min_pay:60000 });
   gated('Rs 30,000 per month',    J({ description:'Rs 30,000 per month' }),    { min_pay:50000 });
   gated('6 LPA under a 60k floor',J({ description:'6 LPA' }),                  { min_pay:60000 });
   ok(T.statedPayMonthly('6 lpa') === 50000, '6 LPA reads as 50,000 a month: ' + T.statedPayMonthly('6 lpa'));
   ok(T.statedPayMonthly('competitive') === null, 'unparseable pay is null, not 0');

   // Relocation, and remote as the escape hatch.
   kept('same city',               J({ location:'Delhi, India' }),              { relocate:false });
   kept('other city but remote',   J({ location:'Mumbai (remote)' }),           { relocate:false });
   kept('other city, will move',   J({ location:'Mumbai, India' }),             { relocate:true });
   gated('other city, will not move', J({ location:'Mumbai, India' }),          { relocate:false });

   // On-site only when the posting says so.
   kept('silent on working mode',  J({ description:'Edit videos.' }),           { onsite_ok:false });
   kept('fully remote',            J({ description:'Fully remote team.', location:'Remote' }), { onsite_ok:false });
   gated('on-site stated',         J({ description:'This is an on-site role.' }), { onsite_ok:false });
   gated('hybrid',                 J({ description:'Hybrid, 3 days in office.' }), { onsite_ok:false });

   // avoid: the offered labels are patterns; anything else is a word match.
   kept('unrelated job, avoid set',J({ description:'Edit videos.' }),           { avoid:['night shift'] });
   gated('staffing agency',        J({ description:'Leading staffing partner.' }), { avoid:['agency or consultancy'] });
   gated('night shift',            J({ description:'US shift, night shift work.' }), { avoid:['night shift'] });
   gated('unpaid',                 J({ description:'Unpaid internship for exposure.' }), { avoid:['unpaid or equity-only'] });
   gated('a custom term, matched literally', J({ description:'Door to door sales.' }), { avoid:['sales'] });

   // A reason, never a bare boolean: a row removed without one cannot be told
   // apart from a row that was never found.
   const why = T.redLine(J({ location:'Mumbai, India' }), prof({ relocate:false }));
   ok(typeof why === 'string' && why.length > 10, 'a gate explains itself: ' + JSON.stringify(why));
 }

 /* ── intent and strict ───────────────────────────────────────────────────
    Both are dials over data that is already on the row: nothing here re-scores,
    re-fetches or discards, so every assertion is about the DEFAULT being
    today's behaviour and the ends of the dial moving in the right direction. */
 console.log('intent and strict');
 {
   /* Age is supplied through the AGE map, not a `posted` date: ageOf is stubbed
      in this file as AGE[j.url], which is how boardFilter's own age test works.
      Giving these jobs a date instead silently made every one of them undated,
      so freshWeight returned 1 and three assertions passed for the wrong
      reason until the url was added. */
   let seq = 0;
   const J = (fit, reach, age) => {
     const url = 'https://fresh/' + (seq++);
     AGE[url] = age;            // null = no stated date
     return { url, ai_score:String(fit), ai_reachability:String(reach), ai_confidence:'high' };
   };

   // strict: absent must be the baseline the app was tuned at.
   const base = T.barsFor(null);
   ok(base.workFit===65 && base.workReach===45 && base.strongFit===75 && base.strongReach===55,
     'no profile = the baseline bands, unchanged: ' + JSON.stringify(base));
   ok(JSON.stringify(T.barsFor({strict:2}))===JSON.stringify(base), 'strict 2 IS the baseline');
   const loose = T.barsFor({strict:1}), tight = T.barsFor({strict:3});
   ok(loose.workFit===55 && loose.strongFit===65, 'strict 1 lowers the fit bands: ' + JSON.stringify(loose));
   ok(tight.workFit===75 && tight.strongFit===85, 'strict 3 raises them: ' + JSON.stringify(tight));
   ok(tight.strongReach-base.strongReach < tight.strongFit-base.strongFit,
     'reach shifts LESS than fit, because reachability is the noisier axis');
   /* 99 CLAMPS to 3 rather than falling back: selfcheck-rows already asserts
      that, and a person who stored 99 meant "as strict as possible". A
      non-numeric value is the one that falls back. */
   ok(T.barsFor({strict:99}).workFit===75, 'an out-of-range strict clamps to the tightest band');
   ok(T.barsFor({strict:'x'}).workFit===65, 'a non-numeric strict falls back to the baseline');

   // The bands decide sections, so a row can move between them and nothing else.
   const mid = J(70,50,3);
   ok(!T.isStrong(mid) && T.overBar(mid), 'a fit-70 row is "worth a shot" at the baseline');
   ok(T.isStrong(mid,{strict:1}), 'and becomes strong at strict 1');
   ok(!T.overBar(mid,{strict:3}), 'and falls below the bar at strict 3');

   // intent: freshness, and the row that must never be penalised for it.
   ok(T.freshWeight(J(80,50,0), {intent:'browsing'})===1, 'browsing applies no freshness at all');
   ok(T.freshWeight(J(80,50,30),{intent:'browsing'})===1, 'browsing: even a 30-day-old row is untouched');
   ok(T.freshWeight(J(80,50,0), {intent:'now'})===1, 'now: a posting from today is unpenalised');
   ok(T.freshWeight(J(80,50,30),{intent:'now'})<1,    'now: an old posting is penalised');
   ok(T.freshWeight(J(80,50,30),{intent:'now'})<T.freshWeight(J(80,50,30),{intent:'soon'}),
     'now penalises age harder than soon');
   /* The rule that is already load-bearing elsewhere: ageOf returns null for a
      posting with no date, and NOT KNOWING when something was posted is not
      the same as it being old. */
   ok(T.freshWeight(J(80,50,null),{intent:'now'})===1,
     'an undated posting is never penalised for age');
   // Flat after CLOSING_DAYS, or a very old row would sort below an unscored one.
   ok(T.freshWeight(J(80,50,21),{intent:'now'})===T.freshWeight(J(80,50,200),{intent:'now'}),
     'the penalty stops at CLOSING_DAYS instead of growing without bound');
   // And the ordering it exists to change.
   const fresh=J(72,50,1), stale=J(78,50,28);
   ok(T.rankFor(stale,{intent:'browsing'})>T.rankFor(fresh,{intent:'browsing'}),
     'browsing: the better score leads');
   ok(T.rankFor(fresh,{intent:'now'})>T.rankFor(stale,{intent:'now'}),
     'now: the fresher posting leads instead');
 }

 console.log(process.exitCode?'SOME FAILED':'ALL PASS');
})();
