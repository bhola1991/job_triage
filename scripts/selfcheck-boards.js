// Board search pipeline self-check: node scripts/selfcheck-boards.js
const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const grab=(re)=>{const m=h.match(re); if(!m) throw new Error('missing '+re); return m[0];};
const src=[
  grab(/const MAX_AGE_DAYS[\s\S]*?\nasync function runBoards/).replace(/async function runBoards$/,''),
  grab(/const TITLE_NOISE[^\n]*\n/), grab(/function roleWords[\s\S]*?\n}\n/),
  grab(/const ATS = \{[\s\S]*?\n\};\n/), grab(/const stripTags[^\n]*\n/),
  grab(/const httpUrl = [^\n]*\n/),
  grab(/function keyOf[\s\S]*?\n}\n/), grab(/function grabJSON[\s\S]*?\n}\n/),
].join('\n');
let DBJOBS=[{url:'https://x/old'}], AGE={}, CLAUDE=null, FEEDS={};
const P=()=>({jobs:DBJOBS}), ageOf=j=>AGE[j.url]??null, setPosted=(j,d)=>{j.posted=d;};
const atsPull=async(p,s)=>{ const f=FEEDS[p+':'+s]; if(f==='fail') throw new Error('network'); return f||null; };
const claude=async(t)=>CLAUDE(t);
let SCORES=null;
const scoreBatch=async(batch)=>{ if(SCORES==='fail') throw new Error('boom'); const o={}; batch.forEach(b=>{ const v=SCORES(b.j); if(v!=null) o[String(b.i)]={score:v,reach:50,conf:'high',reason:'r',flags:'',posted:null}; }); return o; };
const rankOf=j=>+j.ai_score||0, saneDate=d=>d||'', esc=x=>String(x), $=()=>null, setSearchInfo=()=>{};
const blank=()=>({title:'',company:'',url:'',location:'',description:''});
eval(src+';globalThis.T={atsOfUrl,jsearchRow,isPostingUrl,boardFilter,scoreAndCut,liveBoard,fromAts};');

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
 const many=[...Array(30)].map((_,i)=>J('https://z/'+i,'T'+i,'C','Q'));
 SCORES=j=>{ const i=+j.url.split('/').pop(); return i===29?null:(i%3===0?80:40); };
 const sc=await scoreAndCut(many,{},'t');
 ok(sc.kept.length===10 && sc.below===19 && sc.unscored.length===1 && sc.kept[0].ai_score==='80','scoreAndCut '+sc.kept.length+'/'+sc.below+'/'+sc.unscored.length);
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
 console.log(process.exitCode?'SOME FAILED':'ALL PASS');
})();
