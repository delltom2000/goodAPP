const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const nodes={};
const context={console,location:{hash:'#train'},localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},ExamEngine:require('../dist/exam-engine.js'),document:{querySelector:s=>nodes[s]??={innerHTML:'',textContent:'',style:{},insertAdjacentHTML(_,s){this.innerHTML=s+this.innerHTML},showModal(){this.open=true},close(){this.open=false}}},window:{addEventListener:()=>{},scrollTo:()=>{}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
vm.runInContext(fs.readFileSync('dist/upgrade.js','utf8').replace('render();loadBank();',''),context);
function run(code){return vm.runInContext(code,context)}
run("bankStatus='ready';start('语法');choose(1)");
assert.equal(run('page'),'practice');
const id=run('quiz.qs[0].id');
for(const route of ['home','learn','train','errors','exam','report','library']){
  run(`go('${route}')`);
  assert.equal(run('page'),route);
  assert(nodes['#app'].innerHTML.includes('继续作答'));
  assert.equal(run('quiz.selected'),1);assert.equal(run('quiz.qs[0].id'),id);
}
run("go('practice')");assert(nodes['#app'].innerHTML.includes('selected'));
run("go('train');start('阅读')");assert.equal(run('quiz.qs[0].id'),id);assert.equal(nodes['#modal'].open,true);
run('pendingQuizAction=null;closeModal()');
run("go('practice');quiz.selected='draft text';go('learn');go('practice')");assert.equal(run('quiz.selected'),'draft text');
run("go('home');finish()");assert.equal(run('quiz'),null);assert.equal(run('page'),'home');assert(nodes['#app'].innerHTML.includes('YOUR LEARNING JOURNEY'));
run("start('语法');window.handleAndroidBack()");assert.equal(run('page'),'train');assert(run('quiz!==null'));
run("start('阅读');replaceQuiz()");assert.equal(run('quiz.qs[0].skill'),'阅读');assert.equal(run('page'),'practice');
console.log('PASS: all seven pages accessible mid-quiz; selection and drafts preserved; new quiz guarded; background submission stays on current page; Android back leaves quiz without submitting.');
