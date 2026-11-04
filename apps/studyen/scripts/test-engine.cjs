const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const engine=require('../dist/exam-engine.js');
const data=JSON.parse(fs.readFileSync('dist/data/question-bank.json','utf8'));
for(const q of data.questions)q.passage=q.passageId?data.passages[q.passageId]:(q.passage||'');
const nodes={};const ctx={document:{querySelector:s=>nodes[s]??={innerHTML:'',textContent:'',style:{}}},location:{hash:''},localStorage:{getItem:()=>null,setItem:()=>{}},window:{addEventListener:()=>{}},setTimeout:()=>{},console};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),ctx);
const seeds=vm.runInContext('bank',ctx),bank=[...seeds,...data.questions];
assert.equal(bank.length,10000);assert.equal(new Set(bank.map(q=>q.id)).size,10000);
assert.equal(bank.filter(q=>q.origin==='original-authored').length,12);
assert(!bank.some(q=>q.q.includes('Was participation compulsory or voluntary?')));
assert.equal(new Set(bank.map(q=>q.passage+'\n'+q.q)).size,10000);
for(const q of bank){
  assert(q.q&&q.skill&&q.tag&&q.why,q.id);
  if(q.responseType==='text'){
    assert(q.acceptedAnswers.length,q.id);
    for(const a of q.acceptedAnswers){assert.equal(engine.grade(q,'  '+a.toUpperCase()+'  '),true,q.id);assert(a.split(/\s+/).length<=q.wordLimit,q.id)}
    assert.equal(engine.grade(q,'no-such-answer'),false,q.id);
  }else if(engine.objective(q)){
    assert(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length,q.id);
    assert.equal(new Set(q.options).size,q.options.length,q.id);
    assert.equal(engine.grade(q,q.answer),true,q.id);
    assert.equal(engine.grade(q,(q.answer+1)%q.options.length),false,q.id);
  }else assert.equal(engine.grade(q,'arbitrary words'),null,q.id);
}
let papers=[];
for(let i=0;i<100;i++){
  const qs=engine.assemble(bank,{papers,mode:'adaptive',count:30});
  assert.equal(qs.length,30);assert.equal(new Set(qs.map(q=>q.id)).size,30);
  assert(qs.every(q=>!q.practiceOnly));
  for(const skill of ['语法','阅读','听力'])assert.equal(qs.filter(q=>q.skill===skill).length,10);
  assert(!papers.some(p=>[...p].sort().join('|')===engine.signature(qs)));
  papers.push(qs.map(q=>q.id));
}
const full=engine.assemble(bank,{mode:'full'});
assert.equal(full.length,85);assert.equal(full.filter(engine.objective).length,80);
assert.equal(full.filter(q=>q.skill==='阅读').length,40);assert.equal(full.filter(q=>q.skill==='听力').length,40);
for(const type of ['task-1-table','part-1','part-2','part-3'])assert(full.some(q=>q.taskType===type),type);
assert.throws(()=>engine.assemble(bank,{skills:[]}));
assert.throws(()=>engine.assemble(bank,{count:0}));
assert.throws(()=>engine.assemble(bank.slice(0,1),{count:12}));
const tiny=bank.filter(q=>q.skill==='语法').slice(0,3);assert.throws(()=>engine.assemble(tiny,{count:3,skills:['语法'],papers:[tiny.map(q=>q.id)]}));
// A fixed RNG isolates the effect of recent incorrect answers on tag prioritisation.
const pool=bank.filter(q=>q.skill==='语法');const errors=pool.filter(q=>q.tag==='logic').slice(0,10).map(q=>({id:q.id,ok:false}));
const adaptive=engine.assemble(pool,{count:12,skills:['语法'],attempts:errors,random:()=>.5});
assert(adaptive.filter(q=>q.tag==='logic').length>=4);
console.log('PASS: 10,000 unique records; all answer schemas; text normalization; 100 unique balanced papers; 85-item full workflow; error handling and weakness weighting.');
