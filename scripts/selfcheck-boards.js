// Board search pipeline self-check: node scripts/selfcheck-boards.js
const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const grab=(re)=>{const m=h.match(re); if(!m) throw new Error('missing '+re); return m[0];};
const src=[
  grab(/const MAX_PER_SEARCH[\s\S]*?\nasync function runBoards/).replace(/async function runBoards$/,''),
  grab(/const TITLE_NOISE[^\n]*\n/), grab(/function roleWords[\s\S]*?\n}\n/),
  grab(/const ATS = \{[\s\S]*?\n\};\n/), grab(/const stripTags[^\n]*\n/),
  grab(/function keyOf[\s\S]*?\n}\n/), grab(/function grabJSON[\s\S]*?\n}\n/),
].join('\n');
let DBJOBS=[{url:'https://x/old'}], AGE={}, CLAUDE=null, FEEDS={};
const P=()=>({jobs:DBJOBS}), ageOf=j=>AGE[j.url]??null, setPosted=(j,d)=>{j.posted=d;};
const atsPull=async(p,s)=>{ const f=FEEDS[p+':'+s]; if(f==='fail') throw new Error('network'); return f||null; };
const claude=async(t)=>CLAUDE(t);
const esc=x=>String(x), $=()=>null, setSearchInfo=()=>{};
const blank=()=>({title:'',company:'',url:'',location:'',description:''});
eval(src+';globalThis.T={atsOfUrl,jsearchRow,isPostingUrl,boardFilter,judge,liveBoard,fromAts};');

const ok=(c,m)=>{ if(!c){console.error('FAIL',m); process.exitCode=1;} };
(async()=>{
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
  J('https://a/2','Chef','Food','A'), J('https://a/3','Data Engineer','Beta','B'),
  J('https://b/1','Data Engineer','Acme','B'), J('https://x/old','Data Engineer','Gamma','B'),
  J('https://a/4','Senior Data Analyst','[from search — verify]','B')],{titles:['Data Engineer','Data Analyst']});
 ok(f.jobs.map(j=>j.url).join()==='https://a/1,https://a/4', 'filter '+f.jobs.map(j=>j.url));
 ok(JSON.stringify(f.dropped)==='{"listing":1,"offTopic":1,"old":1,"dupe":2}','dropped '+JSON.stringify(f.dropped));
 const many=[...Array(50)].map((_,i)=>J('https://z/'+i,'T'+i,'C','Q'));
 let calls=0;
 CLAUDE=(t)=>{ calls++; const n=(t.match(/"id":"/g)||[]).length; return '```json\n{"r":['+[...Array(n)].map((_,k)=>'{"id":"'+k+'","v":"'+(k%2?'reject':'accept')+'","match":'+(k%7*10)+'}').join(',')+']}\n```'; };
 const jr1=await judge(many,{tracks:[]},{titles:[]});
 ok(calls===2 && jr1.kept.length===25 && jr1.rejected===25, 'judge batches '+calls+' '+jr1.kept.length+' '+jr1.rejected);
 CLAUDE=()=>{throw new Error('boom');};
 const jr2=await judge(many.slice(0,3),{tracks:[]},{titles:[]});
 ok(jr2.kept.length===3 && jr2.kept.every(k=>k.match===40) && jr2.rejected===0,'judge failure keeps batch');
 CLAUDE=(t)=>'{"r":[{"id":"0","v":"accept","match":90},{"id":"1","v":"accept","match":30},{"id":"2","v":"reject","match":99}]}';
 DBJOBS=[]; AGE={};
 const lb=liveBoard({titles:['Data Engineer']},{tracks:[]});
 await lb.add([J('https://a/10','Data Engineer I','Acme','LinkedIn'),J('https://a/11','Data Engineer II','Beta','Indeed'),J('https://a/12','Data Engineer III','Gamma','Naukri')]);
 await lb.add([J('https://a/10','Data Engineer I','Acme','Indeed')]);   // same link from another source
 ok(lb.top(10).map(j=>j.url).join()==='https://a/10,https://a/11' && lb.st.rejected===1 && lb.st.dropped.dupe===1 && lb.st.found===4,'liveBoard '+JSON.stringify(lb.st));
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
