let bankInfo=null,bankStatus='loading',bankError='',bankIndex=new Map(bank.map(q=>[q.id,q]));
let apkReady=false;
let librarySkill='全部',libraryType='全部',libraryQuery='',libraryPage=0;
state.sessions??=[];
navs.push(['library','▦','题库与来源']);
const skillLabel=q=>lessons.find(l=>l.id===q.tag)?.name||({writing:'写作表达',speaking:'口语表达'}[q.tag])||q.taskType||q.skill;
const qualityLabel=q=>q.quality==='authored-unreviewed'?'独立编写 · 待教师审核':q.quality==='generated-unreviewed'?'原创生成变式 · 待审核':'原型种子题 · 未校准';
function latestIndex(){const map=new Map();for(const a of state.attempts)map.set(a.id,a);return map}
function latest(id){return latestIndex().get(id)}
function mistakes(){return [...latestIndex()].filter(([id,a])=>a.ok===false&&bankIndex.has(id)).map(([id])=>bankIndex.get(id))}
function rate(skill){let a=state.attempts.filter(x=>typeof x.ok==='boolean'&&bankIndex.get(x.id)?.skill===skill);return a.length?Math.round(a.filter(x=>x.ok).length/a.length*100):null}
function bankSummary(){return bankStatus==='ready'?`${bank.length.toLocaleString()} 道 / 项 · 含训练变式和写作口语任务`:bankStatus==='loading'?'正在加载扩展题库…':`扩展题库加载失败，暂用 ${bank.length} 道种子题`}
function go(p){location.hash='#'+p;render()}
function render(){
  page=location.hash.slice(1)||'home';
  if(page!=='practice'&&!navs.some(n=>n[0]===page))page='home';
  if(page==='practice'&&!quiz)page='train';
  $('#nav').innerHTML=navs.map(([id,i,t])=>`<a href="#${id}" class="${id===page?'active':''}"><span>${i}</span>${t}${id==='errors'?`<em>${mistakes().length}</em>`:''}</a>`).join('');
  $('#breadcrumb').textContent='学习空间 / '+(page==='practice'?'正在作答':navs.find(n=>n[0]===page)[2]);
  if(page==='practice'){drawQuiz();return}
  stopSpeech();
  ({home,learn,train,errors,exam,report,library}[page])();
  if(page==='home')$('#app').insertAdjacentHTML('afterbegin',`<div class="bank-strip"><a href="#library">▦ ${bankSummary()}　↗</a><span>参考窗口 2025.11–2026.11</span></div>`);
  if(quiz)$('#app').insertAdjacentHTML('afterbegin',`<div class="bank-strip"><div><b>有一组练习尚未完成</b><br>第 ${quiz.index+1} / ${quiz.qs.length} 题 · 已保留当前答案${quiz.deadline?' · 切换页面后计时继续':''}</div>${btn('继续作答 →',"go('practice')")}</div>`);
}
let pendingQuizAction=null;
function guardNewQuiz(action){
  if(!quiz)return false;
  pendingQuizAction=action;
  modal(`<h2>已有一组未完成的练习</h2><p>可以继续原来的进度，或交卷后开始新练习。浏览其他页面不需要结束当前练习。</p><div class="actions">${btn('继续原来的练习',"pendingQuizAction=null;closeModal();go('practice')")}${btn('交卷并开始新练习','replaceQuiz()','light')}${btn('取消','pendingQuizAction=null;closeModal()','light')}</div>`);
  return true;
}
function replaceQuiz(){const action=pendingQuizAction;pendingQuizAction=null;closeModal();finish();if(action)action()}
async function loadBank(){
  bankStatus='loading';
  try{apkReady=(await (await fetch('downloads/status.json')).json()).ready===true}catch{}
  try{
    const response=await fetch('data/question-bank.json');if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();if(data.questions?.length!==9976)throw Error('题库数量校验失败');
    const known=new Set(bank.map(q=>q.id));
    for(const q of data.questions){if(!q.id||!q.q||!q.skill||known.has(q.id))throw Error('题库含无效或重复记录');if(q.passageId&&!data.passages[q.passageId])throw Error('题库缺少材料');q.passage=q.passageId?data.passages[q.passageId]:(q.passage||'');known.add(q.id)}
    bank.push(...data.questions);bankInfo=data;bankIndex=new Map(bank.map(q=>[q.id,q]));bankStatus='ready';
  }catch(e){bankStatus='error';bankError=e.message}
  if(page!=='practice')render();
}
function exam(){
  $('#app').innerHTML=heading('PERSONALIZED PAPER BUILDER','一万道训练题，组出你的下一步。','按科目与近期错误自动组卷，优先选择未做题和最近三套未出现的题。')+`<div class="content-grid"><section class="card"><div class="section-head"><h2>配置我的练习卷</h2><span class="pill">${bankStatus==='ready'?'题库已就绪':'题库加载中'}</span></div><label for="paperMode">组卷模式</label><select id="paperMode" onchange="updatePaperOptions()"><option value="adaptive">短板优先 · 最近错误考点加权</option><option value="balanced">均衡练习 · 各选定科目平均分配</option><option value="full">全科流程 · 听40 / 读40 / 写2 / 口语3</option></select><div id="customPaperOptions"><label for="paperCount">总题量</label><select id="paperCount"><option>12</option><option>30</option><option>60</option></select><label>练习科目</label><div class="skill-checks">${['语法','阅读','听力'].map(s=>`<label><input type="checkbox" name="paperSkill" value="${s}" checked> ${s}</label>`).join('')}</div></div><label for="paperFeedback">答案反馈</label><select id="paperFeedback"><option value="test">交卷后统一查看答案</option><option value="practice">每题提交后立即解析</option></select><p class="muted">全科流程用于熟悉答题顺序。当前阅读为短篇材料、听力为合成语音，不能替代正式等难度模考；写作口语保留待评分状态。</p><div class="actions">${btn('生成试卷并开始 →','startConfigured()')}${bankStatus==='error'?btn('重新加载题库','loadBank()','light'):''}</div></section><section class="card"><h2>让练习有依据</h2><p>${bankSummary()}</p><div class="skill-row"><h3>少重复</h3><p>优先未做题，限制同一材料与模板在单套中的占比，并检查历史试卷组合。</p></div><div class="skill-row"><h3>可追溯</h3><p>逐题显示题型、主题和来源类别。近期考生回忆仅作话题参考，不标为官方真题。</p></div><div class="skill-row"><h3>如实评分</h3><p>客观题自动判分；写作口语不使用字数换算雅思分数。</p></div><a class="text-btn" href="#library">查看题库与参考来源 ↗</a></section></div><div class="card" style="margin-top:22px"><h2>最近完成的试卷</h2>${state.sessions.slice(-5).reverse().map(s=>`<div class="timeline"><span>${new Date(s.at).toLocaleString()} · ${s.label}</span><span>${s.correct}/${s.objective} 客观题答对 · ${s.pending} 待评分</span></div>`).join('')||'<p>生成一套试卷，开始记录学习变化。</p>'}</div>`;
}
function updatePaperOptions(){$('#customPaperOptions').hidden=$('#paperMode').value==='full'}
function startConfigured(){const mode=$('#paperMode').value;const skills=[...document.querySelectorAll('input[name="paperSkill"]:checked')].map(x=>x.value);launchPaper({mode,count:Number($('#paperCount').value),skills,feedback:$('#paperFeedback').value})}
function launchPaper(options){
  if(guardNewQuiz(()=>launchPaper(options)))return;
  if(bankStatus!=='ready'){toast(bankStatus==='loading'?'题库还在加载，请稍后开始。':'请先重新加载扩展题库。');return}
  try{
    const qs=ExamEngine.assemble(bank,{...options,attempts:state.attempts,papers:state.papers});
    state.papers.push(qs.map(q=>q.id));save();
    beginQuiz(qs,options.mode,options.feedback||'test',options.mode==='full'?164:Math.max(15,Math.ceil(qs.length*1.5)));
  }catch(e){toast(e.message)}
}
function start(kind){
  if(guardNewQuiz(()=>start(kind)))return;
  if(kind==='adaptive'){launchPaper({mode:'adaptive',count:12,skills:['语法','阅读','听力'],feedback:'test'});return}
  if((kind==='写作'||kind==='口语')&&bankStatus!=='ready'){toast('扩展题库尚未加载，请稍候。');return}
  let qs=kind==='errors'?mistakes():kind.startsWith('id:')?[bankIndex.get(kind.slice(3))].filter(Boolean):kind.startsWith('tag:')?bank.filter(q=>q.tag===kind.slice(4)):bank.filter(q=>q.skill===kind);
  if(kind==='阅读'){const authored=qs.filter(q=>q.origin==='original-authored');if(authored.length)qs=authored;}
  qs=shuffle(qs).slice(0,kind==='写作'||kind==='口语'?1:kind==='errors'?50:6);
  if(!qs.length){toast('暂无符合条件的题目。');return}
  beginQuiz(qs,kind,'practice',null);
}
function beginQuiz(qs,kind,feedback,minutes){
  clearInterval(timer);stopSpeech();
  quiz={kind,qs,index:0,selected:null,submitted:false,results:[],feedback,deadline:minutes?Date.now()+minutes*60000:null};go('practice');
  if(quiz.deadline)timer=setInterval(()=>{if(!quiz)return;if($('#time'))$('#time').textContent=timeRemaining();if(Date.now()>=quiz.deadline)finish()},1000);
  window.scrollTo({top:0,behavior:'smooth'});
}
function timeRemaining(){if(!quiz?.deadline)return '不限时';const seconds=Math.max(0,Math.ceil((quiz.deadline-Date.now())/1000));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')}
function correctText(q){return q.responseType==='text'?q.acceptedAnswers.join(' / '):q.options?.[q.answer]||'人工评分'}
function feedbackHtml(q,a){return `<div class="feedback ${a.ok===false?'wrong':''}"><b>${a.ok===null?'已保存 · 待评分':a.ok?'回答正确 ✓':'正确答案：'+esc(correctText(q))}</b><p>${esc(q.why)}</p></div>`}
function drawQuiz(){
  const q=quiz.qs[quiz.index],productive=['essay','speaking'].includes(q.responseType),answered=quiz.results.find(a=>a.id===q.id),show=quiz.submitted&&quiz.feedback==='practice';
  $('#app').innerHTML=heading(quiz.feedback==='test'?'MOCK WORKFLOW':'FOCUSED PRACTICE',quiz.kind==='full'?'全科流程练习':q.skill+' · '+(quiz.feedback==='test'?'试卷作答':'专项训练'),qualityLabel(q),btn('结束 / 交卷','exitQuiz()','light'))+`<div class="card"><div class="quiz-head"><span>${q.skill} · ${esc(skillLabel(q))}</span><span>${quiz.index+1} / ${quiz.qs.length}　<b id="time">${timeRemaining()}</b></span></div><div class="track" style="margin-bottom:24px"><i style="width:${quiz.index/quiz.qs.length*100}%"></i></div><div class="question-meta"><span class="pill">${esc(q.taskType||'选择题')}</span>${q.topic?`<span class="pill">${esc(q.topic)}</span>`:''}<button class="text-btn" onclick="questionSource('${q.id}')">来源说明 ↗</button></div>${q.skill==='听力'?`<div class="reading">${btn('▶ 播放听力','speakCurrent()','light')} ${btn('■ 停止','stopSpeech()','light')}<p class="muted">合成语音 · 可重听 · 非正式考场录音</p>${show?'<p>'+esc(q.passage)+'</p>':''}</div>`:q.passage?`<div class="reading">${esc(q.passage)}</div>`:''}<h2 class="question-title">${esc(q.q)}</h2>${productive?`<p>${q.skill==='写作'?`建议至少 ${q.wordTarget||250} 词 · ${q.timeMinutes||40} 分钟`:'按提示练习表达，可在下方记录准备笔记。当前不采集录音。'}</p><label for="answerText">${q.skill==='写作'?'英文作答':'口语准备笔记'}</label><textarea id="answerText" ${quiz.submitted?'disabled':''} oninput="captureText()">${esc(quiz.selected??state.drafts[q.id]??'')}</textarea><p id="answerWords" class="muted"></p>`:q.responseType==='text'?`<label for="answerText">填写答案 · 最多 ${q.wordLimit||1} 词</label><input id="answerText" autocomplete="off" value="${esc(quiz.selected??'')}" ${quiz.submitted?'disabled':''} oninput="captureText()" onkeydown="if(event.key==='Enter')submitAnswer()">`:`<div class="options">${q.options.map((o,i)=>`<button class="option ${quiz.selected===i?'selected':''}" ${quiz.submitted?'disabled':''} onclick="choose(${i})">${String.fromCharCode(65+i)}. ${esc(o)}</button>`).join('')}</div>`}${show?feedbackHtml(q,answered):''}<div class="actions" style="margin-top:22px">${quiz.submitted?btn(quiz.index===quiz.qs.length-1?'查看结果 →':'下一题 →','nextQuestion()'):`<button class="button" id="submitButton" onclick="submitAnswer()" ${quiz.selected===null||String(quiz.selected).trim()===''?'disabled':''}>${quiz.feedback==='test'?(quiz.index===quiz.qs.length-1?'保存并交卷':'保存并进入下一题'):'确认答案'}</button>`}${!quiz.submitted?btn(productive?'跳过（保留待评分）':'跳过（计未作答）','skipQuestion()','light'):''}</div></div>`;
  if(productive&&quiz.selected===null&&state.drafts[q.id]){quiz.selected=state.drafts[q.id];$('#submitButton')?.removeAttribute('disabled')}
  if(productive)updateWordCount();
}
function captureText(){const q=quiz.qs[quiz.index];quiz.selected=$('#answerText').value;if(['essay','speaking'].includes(q.responseType)){state.drafts[q.id]=quiz.selected;save();updateWordCount()}$('#submitButton').disabled=!quiz.selected.trim()}
function updateWordCount(){if($('#answerWords'))$('#answerWords').textContent=String(quiz.selected||'').trim().split(/\s+/).filter(Boolean).length+' words · 草稿自动保存在本机'}
function choose(i){if(!quiz||quiz.submitted)return;quiz.selected=i;drawQuiz()}
function submitAnswer(){
  if(!quiz||quiz.submitted||quiz.selected===null||String(quiz.selected).trim()==='')return;
  const q=quiz.qs[quiz.index];const a={id:q.id,choice:quiz.selected,ok:ExamEngine.grade(q,quiz.selected),at:Date.now(),mode:quiz.kind};
  state.attempts.push(a);quiz.results.push(a);quiz.submitted=true;save();
  if(quiz.feedback==='test')nextQuestion();else drawQuiz();
}
function skipQuestion(){if(!quiz||quiz.submitted)return;quiz.results.push({id:quiz.qs[quiz.index].id,choice:null,ok:ExamEngine.objective(quiz.qs[quiz.index])?false:null,skipped:true,at:Date.now()});nextQuestion()}
function nextQuestion(){stopSpeech();if(quiz.index===quiz.qs.length-1){finish();return}quiz.index++;quiz.selected=null;quiz.submitted=false;drawQuiz();window.scrollTo({top:0,behavior:'smooth'})}
function exitQuiz(){modal(`<h2>提交当前试卷？</h2><p>已提交答案与写作笔记会保留。未提交客观题按未作答计入本卷；写作口语不会自动评分。</p><div class="actions">${btn('确认交卷','closeModal();finish()')}${btn('继续作答','closeModal()','light')}</div>`)}
function finish(){
  if(!quiz)return;const showingQuiz=page==='practice';clearInterval(timer);stopSpeech();
  const old=quiz,qs=old.qs,results=old.results,objective=qs.filter(ExamEngine.objective).length,correct=results.filter(a=>a.ok===true).length,pending=qs.length-objective;
  state.sessions.push({at:Date.now(),label:old.kind==='full'?'全科流程':old.kind==='adaptive'?'自适应诊断':'专项练习',total:qs.length,objective,correct,pending,completed:results.filter(a=>!a.skipped).length});save();quiz=null;
  if(!showingQuiz){render();toast('练习已交卷，结果已保存到自适应模考的历史记录。');return}
  $('#app').innerHTML=heading('PAPER COMPLETE','这一次练习，为下一次指明方向。','客观题即时统计，写作与口语任务保留为待评分。')+`<div class="card empty"><div class="eyebrow">本卷客观题正确率（未作答计入总数）</div><div class="score">${objective?Math.round(correct/objective*100)+'%':'待人工评分'}</div><p>客观题答对 ${correct} / ${objective} · 写作口语待评分 ${pending} 项<br>已提交 ${results.filter(a=>!a.skipped).length} / ${qs.length} 项</p><p>本结果不换算雅思 Band 分数。</p><div class="actions" style="justify-content:center">${btn('能力报告',"go('report');render()")}${btn('复习错题',"go('errors');render()",'light')}${btn('再组一套',"go('exam');render()",'light')}</div></div><div class="card" style="margin-top:22px"><h2>逐题复盘</h2>${qs.map((q,i)=>{const a=results.find(a=>a.id===q.id);return `<details class="review-item"><summary>${i+1}. ${esc(q.q.split('\n')[0])} <b>${!a||a.skipped?'未提交':a.ok===null?'待评分':a.ok?'✓':'✗'}</b></summary><p>${esc(q.passage)}</p><p>你的作答：${a?.choice===null||a?.choice===undefined?'未作答':esc(q.options?.length?q.options[a.choice]:a.choice)}</p><p>参考答案：${esc(correctText(q))}</p><p>${esc(q.why)}</p></details>`}).join('')}</div>`;
  window.scrollTo({top:0,behavior:'smooth'});
}
function stopSpeech(){window.speechSynthesis?.cancel();window.AndroidSpeech?.stop()}
function speakCurrent(){
  if(!quiz)return;const text=quiz.qs[quiz.index].passage;stopSpeech();
  if(window.AndroidSpeech){if(!AndroidSpeech.available()){toast('请先在安卓系统的文字转语音设置中安装英语语音包。');return}AndroidSpeech.speak(text);return}
  if(!window.speechSynthesis){toast('当前浏览器没有语音合成功能。');return}
  const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-GB';utterance.rate=.9;utterance.onerror=()=>toast('语音播放失败，请检查系统英语语音。');speechSynthesis.speak(utterance);
}
function errors(){const qs=mistakes();$('#app').innerHTML=heading('LEARN FROM MISTAKES','错题，是下一步的线索。',`${qs.length} 道待巩固 · 最近作答正确后自动移出`,qs.length?btn('开始复习（最多50题）',"start('errors')"):'')+`<div class="card">${qs.length?qs.slice(0,100).map(q=>`<div class="task"><div class="task-info"><b>${esc(q.q)}</b><p>${q.skill} · ${esc(skillLabel(q))}</p></div>${btn('再练一次',`start('id:${q.id}')`,'light')}</div>`).join(''):'<div class="empty"><h2>暂无待复习错题</h2><p>作答后错误会自动收录。</p>'+btn('去练习',"go('train')")+'</div>'}${qs.length>100?'<p>此处显示最近索引中的前 100 道，复习会从全部错题随机抽取。</p>':''}</div>`}
function library(){
  const pool=bank.filter(q=>(librarySkill==='全部'||q.skill===librarySkill)&&(libraryType==='全部'||(libraryType==='客观题'?ExamEngine.objective(q):!ExamEngine.objective(q)))&&(!libraryQuery||`${q.q} ${q.topic||''} ${q.id}`.toLowerCase().includes(libraryQuery.toLowerCase())));
  const totalPages=Math.max(1,Math.ceil(pool.length/20));libraryPage=Math.min(libraryPage,totalPages-1);
  $('#app').innerHTML=heading('QUESTION LIBRARY & REFERENCES','题目有来源，练习有边界。',bankSummary())+`<div class="card"><div class="library-controls"><select id="librarySkill" aria-label="题库科目" onchange="librarySkill=this.value;libraryPage=0;library()">${['全部','语法','阅读','听力','写作','口语'].map(s=>`<option ${s===librarySkill?'selected':''}>${s}</option>`).join('')}</select><select aria-label="题目类型" onchange="libraryType=this.value;libraryPage=0;library()">${['全部','客观题','写作口语任务'].map(s=>`<option ${s===libraryType?'selected':''}>${s}</option>`).join('')}</select><input id="librarySearch" aria-label="搜索题库" placeholder="搜索题目、英文话题或题号" value="${esc(libraryQuery)}" onkeydown="if(event.key==='Enter')searchLibrary()">${btn('搜索','searchLibrary()','light')}</div><p class="muted">${bankInfo?.qualityNotice||'种子题库未校准。'} 同一材料的多个小题分别计数；规则生成题包含训练变式，数量不代表独立实考试题数量。</p><div class="count-chips">${['语法','阅读','听力','写作','口语'].map(s=>`<span class="pill">${s} ${bank.filter(q=>q.skill===s).length}</span>`).join('')}</div>${pool.slice(libraryPage*20,libraryPage*20+20).map(q=>`<div class="task"><div class="task-info"><b>${esc(q.q.split('\n')[0])}</b><p>${q.id} · ${q.skill} · ${esc(q.taskType||'种子选择题')} · ${qualityLabel(q)}</p></div>${btn('练习',`start('id:${q.id}')`,'light')}</div>`).join('')||'<p>没有匹配的题目。</p>'}<div class="actions" style="margin-top:22px"><button class="button light" ${libraryPage===0?'disabled':''} onclick="libraryPage--;library()">上一页</button><span>${libraryPage+1} / ${totalPages} 页 · ${pool.length} 项</span><button class="button light" ${libraryPage>=totalPages-1?'disabled':''} onclick="libraryPage++;library()">下一页</button></div></div><div class="card" style="margin-top:22px"><h2>近一年参考资料</h2><p>参考窗口：2025-11-04 至 2026-11-04。出版日期、考生报告日期、真实考试日期分别记录，不互相替代。</p>${(bankInfo?.sources||[]).map(s=>`<div class="source-item"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a><p>${esc(s.note)}<br>类别：${esc(s.kind)} · 考试日期：${esc(s.exam_date||'未公开 / 不适用')} · 核验日期：${s.checked}</p></div>`).join('')}<p>当前没有取得近一年完整实考试卷的复制授权。所有扩充题目均为原创生成内容，尚未经过教师逐题审核和难度校准。</p></div><div class="card" style="margin-top:22px"><h2>安卓离线版</h2><p>内置同一题库，在手机本地保存作答；与电脑浏览器记录暂不自动同步。</p>${window.AndroidSpeech?'<p>你正在使用安卓离线版。</p>':apkReady?'<a class="button light" href="downloads/jianjin-ielts-debug.apk">下载安卓体验 APK</a><p class="muted">调试版仅用于体验，暂未进行真机验证。</p>':'<p class="muted">安卓项目已生成，安装包尚未编译完成。</p>'}</div>`;
}
function searchLibrary(){libraryQuery=$('#librarySearch').value.trim();libraryPage=0;library()}
function questionSource(id){const q=bankIndex.get(id);modal(`<h2>题目来源说明</h2><p>${esc(q.id)} · ${qualityLabel(q)}</p><p>主题：${esc(q.topic||'基础训练')}<br>题型：${esc(q.taskType||'选择题')}<br>难度：未校准</p><p>题型参照公开官方备考说明；规则生成题并非真题，也未经过教师逐题审核。回忆信息仅提供话题线索。</p>${(q.sourceIds||[]).map(id=>bankInfo?.sources.find(s=>s.id===id)).filter(Boolean).map(s=>`<p><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a></p>`).join('')}${btn('返回作答','closeModal()','light')}`)}
window.handleAndroidBack=()=>{if($('#modal').open){closeModal();return true}if(quiz&&page==='practice'){go('train');return true}if(page!=='home'){go('home');return true}return false};
render();loadBank();
