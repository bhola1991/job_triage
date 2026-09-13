// Board search pipeline self-check: node scripts/selfcheck-boards.js
const h=require('fs').readFileSync(require('path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const grab=(re)=>{const m=h.match(re); if(!m) throw new Error('missing '+re); return m[0];};
const src=[
  grab(/const MAX_PER_SEARCH[\s\S]*?\nasync function runBoards/).replace(/async function runBoards$/,''),
  grab(/const TITLE_NOISE[^\n]*\n/), grab(/function roleWords[\s\S]*?\n}\n/),
  grab(/function keyOf[\s\S]*?\n}\n/), grab(/function grabJSON[\s\S]*?\n}\n/),
].join('\n');
let DBJOBS=[{url:'https://x/old'}], AGE={}, CLAUDE=null, FEEDS={};
const P=()=>({jobs:DBJOBS}), ageOf=j=>AGE[j.url]??null, setPosted=(j,d)=>{j.posted=d;};
const ATS={greenhouse:{label:'Greenhouse'},lever:{label:'Lever'},ashby:{label:'Ashby'}};
const atsPull=async(p,s)=>{ const f=FEEDS[p+':'+s]; if(f==='fail') throw new Error('network'); return f||null; };
const claude=async(t)=>CLAUDE(t);
const blank=()=>({title:'',company:'',url:'',location:'',description:''});
eval(src+';globalThis.T={jsearchRow,pickSpread,isPostingUrl,boardFilter,shortlist,fromAts};');

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
 const many=[...Array(20)].map((_,i)=>J('https://z/'+i,'T'+i,'C','Q'+(i%3)));
 CLAUDE=()=> '```json\n{"keep":["5",2,"5","99","0"]}\n```';
 const s=await shortlist(many,{tracks:[]},{titles:[]},14);
 ok(s.map(j=>j.url).join()==='https://z/5,https://z/2,https://z/0','shortlist '+s.map(j=>j.url));
 CLAUDE=()=>{throw new Error('boom');};
 ok((await shortlist(many,{tracks:[]},{titles:[]},4)).length===4,'fallback');
 ok((await shortlist(many.slice(0,3),{},{},4)).length===3,'small skips call');
 FEEDS={'greenhouse:acme':{rows:[{url:'https://boards.greenhouse.io/acme/jobs/1?x',desc:'FULL',location:'Remote',posted:'2026-09-01'}]},'lever:beta':'fail'};
 const r=await fromAts([J('https://boards.greenhouse.io/acme/jobs/1','t','c','q'),J('https://boards.greenhouse.io/acme/jobs/2','t','c','q'),
   J('https://jobs.lever.co/beta/uuid-9','t','c','q'),J('https://www.linkedin.com/jobs/view/5','t','c','q')]);
 ok(r.closed===1 && r.jobs.length===3 && r.jobs[0].description==='FULL' && r.jobs[0].posted==='2026-09-01','ats '+JSON.stringify(r));
 const jr=jsearchRow({title:'Data Engineer',company:'',url:'https://in.indeed.com/applystart?jk=9',description:'x',posted:'2026-09-10',publisher:'Indeed'});
 ok(jr.company.startsWith('[') && jr.query==='Indeed' && jr.posted==='2026-09-10' && isPostingUrl(jr.url),'jsearchRow '+JSON.stringify(jr));
 ok(isPostingUrl('https://www.naukri.com/job-listings-data-engineer-acme-bengaluru-3-to-6-years-100926000001'),'naukri post');
 ok(!isPostingUrl('https://www.google.com/search?q=data+engineer&ibp=htl;jobs'),'google jobs link');
 console.log(process.exitCode?'SOME FAILED':'ALL PASS');
})();
