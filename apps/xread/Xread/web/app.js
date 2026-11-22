"use strict";
const $ = id => document.getElementById(id);
const player = $("player");
const statusNames = {queued:"等待处理",working:"处理中",ready:"已完成",error:"需要重试"};
const sourceNames = {x:"X 视频",file:"本地视频",demo:"内置示例"};
const femaleVoices = {
  female:"自然女声", female_clear:"清亮女声", female_qinghe:"青禾女声",
  female_yunshu:"云舒女声", female_xiaoman:"小满女声"
};
const maleVoices = {male:"男声", male_songyan:"松言男声", male_yunzhou:"云舟男声"};
const fixedVoices = {...femaleVoices,...maleVoices};
const voiceNames = {...fixedVoices,auto:"自动（可随原声变化）",low:"旧版低音",high:"旧版高音"};
const styleNames = {natural:"自然交谈",speech:"演讲",sweet:"甜美讲述"};
const samplePlayer = $("voice-preview");
let sampleOwner = null, sampleAttempt = 0;
let jobs = [], currentId = null, rows = [], cueButtons = [], activeCue = -1;
let readyId = null, selectionVersion = 0, mode = "link", importing = false, saving = false;
let language = readPref("xread-language") === "bilingual" ? "bilingual" : "zh";
let transcriptDual=readPref("xread-transcript-dual")==="true";
let showOverlay = true;
let previewMode="source", lastFilmKey="", sourceRevision=0, submittingDubId=null;
let waitingForCaptionCheck=false, manualPreview=false;
let pendingFiles=[], queueSnapshot="", jobsRequest=0;
let manualScrollUntil = 0, pollDelay = 1800, trackVersion = 0;

function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writePref(key,value) { try { localStorage.setItem(key,value); } catch {} }
function time(seconds) {
  const n = Math.max(0,Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(n/60)%60,n%60].map(x=>String(x).padStart(2,"0"));
  if(n >= 3600) parts.unshift(String(Math.floor(n/3600)));
  return parts.join(":");
}
function setNote(el,text="",error=false) {
  el.textContent = text; el.hidden = !text; el.classList.toggle("error-note",error);
}
function el(tag,text,className) {
  const node = document.createElement(tag);
  if(text !== undefined) node.textContent = text;
  if(className) node.className = className;
  return node;
}
function savedVoice() {
  const voice=readPref("xread-preferred-voice");
  return Object.hasOwn(fixedVoices,voice) || voice==="auto" ? voice : "female";
}
function savedAudioMode(){
  const mode=readPref("xread-audio-mode");
  return ["original","dubbed","both"].includes(mode)?mode:"original";
}
function outputMode(scope) {
  const original=$(scope+"-out-original").checked, dubbed=$(scope+"-out-dubbed").checked;
  if(original && dubbed) return "both";
  return original?"original":dubbed?"dubbed":"";
}
function setOutputs(scope,mode){
  $(scope+"-out-original").checked=mode==="both" || mode==="original";
  $(scope+"-out-dubbed").checked=mode==="both" || mode==="dubbed";
  updateOutputButton(scope);
}
function updateOutputButton(scope) {
  const empty=!outputMode(scope), busy=scope==="import"?importing:$("job-out-original").disabled;
  $(scope+"-output-note").hidden=!empty;
  $(scope==="import"?"submit-import":"request-dub").disabled=empty || busy;
}
function savedStyle() {
  const style=readPref("xread-reading-style");
  return Object.hasOwn(styleNames,style)?style:"natural";
}
function soundSettings(scope) {
  const audioMode=outputMode(scope);
  return audioMode==="original"?{audioMode}:{audioMode,voice:$(scope+"-voice").value,style:$(scope+"-style").value,quality:$(scope+"-quality").value};
}
function filmName(dub) { return dub?.audioMode==="both"?"两版成片":dub?.audioMode==="original"?"原声字幕版":"中文配音版"; }
function availableFilms(dub={}) {
  const ready=dub.status==="ready";
  return {
    original:dub.audioMode==="both"?dub.originalReady===true:dub.audioMode==="original" && ready,
    dub:dub.audioMode!=="original" && ready
  };
}
function filmFile(which,download=false) {
  if(which==="source") return "video.mp4";
  if(which==="original" && jobNow()?.dub?.audioMode==="both") return download?"original-film-download.mp4":"original-film.mp4";
  return download?"dub-download.mp4":"dubbed.mp4";
}
function fillVoices(scope,requestedVoice) {
  const menu=$(scope+"-voice");
  menu.replaceChildren();
  for(const [title,voices] of [["女声",femaleVoices],["男声",maleVoices]]) {
    const group=el("optgroup");
    group.label=title;
    for(const [value,label] of Object.entries(voices)) group.append(new Option(label,value));
    menu.append(group);
  }
  menu.append(new Option(voiceNames.auto,"auto"));
  if(scope==="job" && ["low","high"].includes(requestedVoice)) menu.append(new Option(voiceNames[requestedVoice],requestedVoice));
  menu.value=Array.from(menu.options).some(o=>o.value===requestedVoice)?requestedVoice:savedVoice();
  updateAudition(scope);
}
function updateAudition(scope) {
  const voice=$(scope+"-voice").value, fixed=Object.hasOwn(fixedVoices,voice);
  const button=$(scope+"-audition"), playing=sampleOwner===scope;
  button.disabled=!fixed || $(scope+"-voice").disabled;
  button.setAttribute("aria-pressed",String(playing));
  button.textContent=playing?"停止":"试听";
  button.setAttribute("aria-label",(playing?"停止":"试听")+(scope==="job"?"下次配音":"导入配音")+"音色");
  for(const preset of $(scope+"-presets").querySelectorAll("button")){
    preset.disabled=$(scope+"-voice").disabled;
    preset.setAttribute("aria-pressed",String(preset.dataset.voice===voice && preset.dataset.style===$(scope+"-style").value));
  }
  $(scope+"-voice-hint").textContent=fixed?"可先试听不同风格的停顿和语气。选定的音色用于中文配音版。":voice==="auto"?"自动音色随原声选择，整片可能包含不同声音。":"沿用此历史任务的旧版音色。";
}
function stopAudition() {
  if(!sampleOwner) return;
  const scope=sampleOwner;
  sampleOwner=null; sampleAttempt++;
  samplePlayer.pause();
  samplePlayer.removeAttribute("src"); samplePlayer.load();
  updateAudition(scope);
}
async function playAudition(scope) {
  const voice=$(scope+"-voice").value, quality=$(scope+"-quality").value, style=$(scope+"-style").value;
  const toggleOff=sampleOwner===scope;
  stopAudition();
  if(toggleOff || !Object.hasOwn(fixedVoices,voice)) return;
  const error=$(scope+"-audio-error");
  setNote(error);
  player.pause();
  const attempt=++sampleAttempt;
  sampleOwner=scope; updateAudition(scope);
  const styleSuffix=style==="natural"?"":"-"+style;
  samplePlayer.src="/static/voice-"+voice+"-"+quality+styleSuffix+".mp3";
  try { await samplePlayer.play(); }
  catch { if(attempt===sampleAttempt){ stopAudition(); setNote(error,"试听未能播放，请重试。",true); } }
}
samplePlayer.addEventListener("ended",stopAudition);
samplePlayer.addEventListener("error",()=>{
  if(!sampleOwner || !samplePlayer.error) return;
  const scope=sampleOwner; stopAudition(); setNote($(scope+"-audio-error"),"试听音频暂时不可用。",true);
});
player.addEventListener("play",stopAudition);
document.addEventListener("visibilitychange",()=>{if(document.hidden) stopAudition();});
window.addEventListener("pagehide",stopAudition);
for(const scope of ["import","job"]) {
  setOutputs(scope,savedAudioMode());
  $(scope+"-style").value=savedStyle();
  $(scope+"-audition").onclick=()=>playAudition(scope);
  for(const preset of $(scope+"-presets").querySelectorAll("button")) preset.onclick=()=>{
    for(const setting of ["voice","style"]){
      const select=$(scope+"-"+setting);
      select.value=preset.dataset[setting];
      select.dispatchEvent(new Event("change"));
    }
  };
  for(const kind of ["original","dubbed"]) $(scope+"-out-"+kind).onchange=()=>{
    stopAudition();
    const choice=outputMode(scope);
    if(choice) writePref("xread-audio-mode",choice);
    updateOutputButton(scope);
  };
  for(const setting of ["voice","style","quality"]) $(scope+"-"+setting).addEventListener("change",()=>{
    stopAudition();
    setNote($(scope+"-audio-error"));
    const voice=$(scope+"-voice").value;
    if(setting==="voice" && (Object.hasOwn(fixedVoices,voice) || voice==="auto")){
      writePref("xread-preferred-voice",voice);
      if(scope==="job" && !importing){
        $("import-voice").value=voice; updateAudition("import");
      }
    }
    if(setting==="style"){
      const choice=$(scope+"-style").value;
      writePref("xread-reading-style",choice);
      if(scope==="job" && !importing){ $("import-style").value=choice; updateAudition("import"); }
    }
    updateAudition(scope);
  });
}
fillVoices("import",savedVoice());
fillVoices("job",savedVoice());
function jobNow() { return jobs.find(j=>j.id === currentId); }
function asset(name,id=currentId) { return "/media/"+encodeURIComponent(id)+"/"+name; }
function jobPath(id=currentId) { return "/api/jobs/"+encodeURIComponent(id); }
async function api(url,body) {
  const options = {cache:"no-store"};
  if(body !== undefined) Object.assign(options,{method:"POST",headers:{"Content-Type":"application/json","X-Xread":"1"},body:JSON.stringify(body)});
  const resp = await fetch(url,options);
  const data = await resp.json().catch(()=>null);
  if(!resp.ok) throw new Error(data?.error || data?.message || "请求失败（"+resp.status+"）");
  return data;
}
function selectMethod(next) {
  mode = next;
  const local = next === "file";
  $("source-url").hidden = local; $("source-url").required = !local;
  $("entry-prefix").textContent = local ? "＋" : "𝕏";
  $("choose-file").hidden = !local;
  for(const [id,on] of [["tab-link",!local],["tab-file",local]]) {
    $(id).classList.toggle("selected",on); $(id).setAttribute("aria-pressed",String(on));
  }
  setNote($("import-note"));
}
$("tab-link").onclick = ()=>selectMethod("link");
$("tab-file").onclick = ()=>selectMethod("file");
$("choose-file").onclick = ()=>$("source-file").click();
$("source-file").onchange = ()=>{
  pendingFiles=Array.from($("source-file").files);
  updateFileLabel();
  setNote($("import-note"));
};
function updateFileLabel() {
  $("choose-file").textContent=pendingFiles.length>1?"已选择 "+pendingFiles.length+" 个视频":pendingFiles[0]?.name || "选择本地视频，可多选…";
}
function sendFile(file,sound,captionMode,onProgress) {
  return new Promise((resolve,reject)=>{
    const xhr = new XMLHttpRequest();
    xhr.open("POST","/api/upload");
    xhr.setRequestHeader("X-Xread","1");
    xhr.setRequestHeader("X-Filename",encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Audio-Mode",sound.audioMode);
    if(sound.audioMode!=="original"){
      xhr.setRequestHeader("X-Voice",sound.voice);
      xhr.setRequestHeader("X-Quality",sound.quality);
      xhr.setRequestHeader("X-Style",sound.style);
    }
    xhr.setRequestHeader("X-Caption-Mode",captionMode);
    xhr.setRequestHeader("Content-Type","application/octet-stream");
    xhr.upload.onprogress = e=>{
      if(e.lengthComputable) onProgress("上传 "+Math.floor(100*e.loaded/e.total)+"%");
    };
    xhr.onerror = ()=>reject(new Error("导入连接中断，请确认本机服务仍在运行。"));
    xhr.onload = ()=>{
      let data;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if(xhr.status>=200 && xhr.status<300 && data?.id) resolve(data);
      else reject(new Error(data?.error || data?.message || "文件导入失败（"+xhr.status+"）"));
    };
    xhr.send(file);
  });
}
$("import-form").onsubmit = async e=>{
  e.preventDefault();
  if(importing || !outputMode("import")) return;
  const local=mode==="file", sound=soundSettings("import");
  const captionMode=$("import-captions").value;
  const items=local?[...pendingFiles]:$("source-url").value.trim().split(/\s+/u).filter(Boolean);
  if(!items.length) { if(local) $("source-file").click(); else $("source-url").focus(); return; }
  importing = true;
  if(sampleOwner==="import") stopAudition();
  const controls=["submit-import","tab-link","tab-file","choose-file","source-url","import-out-original","import-out-dubbed","import-voice","import-style","import-quality","import-captions"];
  for(const id of controls) $(id).disabled=true;
  updateAudition("import");
  const list=$("batch-result"), failed=[];
  list.replaceChildren(); list.hidden=false;
  const initialId=currentId;
  let firstJob=null;
  try {
    for(const [i,item] of items.entries()) {
      const entry=el("li"), state=el("b","提交中"), name=local?item.name:item;
      entry.append(state,el("span",name)); list.append(entry);
      setNote($("import-note"),"正在导入 "+(i+1)+" / "+items.length);
      try {
        if(!local && !/^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/(?:[A-Za-z_0-9]+\/status|i\/web\/status)\/\d+(?:[/?#].*)?$/i.test(item)) throw new Error("请输入有效的 X 帖子链接");
        const job=local?await sendFile(item,sound,captionMode,text=>state.textContent=text):await api("/api/jobs",{url:item,...sound,captionMode});
        addJob(job); firstJob ||= job; state.textContent="已加入";
      } catch(err) {
        failed.push(item); state.textContent="未加入"; entry.classList.add("error-note");
        entry.lastChild.textContent=name+" · "+err.message;
      }
    }
    if(local){ pendingFiles=failed; $("source-file").value=""; updateFileLabel(); }
    else $("source-url").value=failed.join("\n");
    setNote($("import-note"),"已加入 "+(items.length-failed.length)+" 个任务"+(failed.length?"，"+failed.length+" 个未加入，可修正后重试。":"。"),failed.length>0);
    if(firstJob && currentId===initialId) await selectJob(firstJob.id);
    if(firstJob) await loadJobs();
  } catch(err) { showWorkError(err); }
  finally {
    importing=false;
    for(const id of controls) $(id).disabled=false;
    updateAudition("import");
    updateOutputButton("import");
  }
};
function addJob(job) { jobs = [job,...jobs.filter(j=>j.id!==job.id)]; jobsRequest++; updateCount(); renderHistory(); }
function updateCount() { $("job-count").textContent=String(jobs.length); $("queue-count").textContent=jobs.length+" 项"; }
function filmStatus(dub) {
  const type=filmName(dub);
  return {none:"待生成成片",queued:type+"排队中",working:"正在制作"+type,ready:type+"已就绪",error:type+"制作失败",stale:"字幕已更新，等待重新生成"}[dub.status || "none"];
}
function phase(job) {
  const dub=job.dub || {}, subtitles=job.status!=="ready", state=subtitles?job.status:dub.status || "none";
  const active=state==="queued" || state==="working";
  const group=active?"active":state==="error" || state==="stale"?"issue":"ready";
  const value=subtitles?job.progress:dub.progress;
  const pct=Number.isFinite(value)?Math.round(Math.max(0,Math.min(100,value))):null;
  const text=subtitles?(state==="working"?"字幕处理中":state==="error"?"字幕处理失败":"字幕排队"):state==="none"?"字幕已就绪":filmStatus(dub);
  return {state,active,group,pct,text,detail:subtitles?job.message:dub.message};
}
function positionText(job) { return job.queuePosition>0?"队列第 "+job.queuePosition+" 位":""; }
function renderHistory() {
  const filter=$("queue-filter").value;
  const snapshot=JSON.stringify([currentId,filter,jobs]);
  if(queueSnapshot===snapshot) return;
  queueSnapshot=snapshot;
  const focused=document.activeElement?.dataset.job;
  const list = $("history-list"); list.replaceChildren();
  for(const job of jobs) {
    const p=phase(job); if(filter!=="all" && p.group!==filter) continue;
    const b=el("button",undefined,"history-item"+(job.id===currentId?" current":""));
    b.dataset.job=job.id; b.setAttribute("aria-current",String(job.id===currentId));
    b.title=job.title || "视频任务";
    const meta=el("span",undefined,"history-meta");
    meta.append(el("small",[sourceNames[job.source],job.duration?time(job.duration):""].filter(Boolean).join(" · ")));
    if(job.created) {
      const date=new Date(job.created*1000);
      if(!Number.isNaN(date.getTime())) meta.append(el("small",date.toLocaleDateString("zh-CN",{month:"numeric",day:"numeric"})));
    }
    b.append(el("b",b.title),meta,el("small",[p.text,positionText(job),p.active && p.pct!==null?p.pct+"%":""].filter(Boolean).join(" · "),"job-phase "+p.group));
    if(p.active && p.detail) b.append(el("small",p.detail));
    if(p.active && p.pct!==null){const bar=el("progress");bar.max=100;bar.value=p.pct;bar.setAttribute("aria-label","任务进度");b.append(bar);}
    b.onclick=()=>{ if($("library").open) $("library").close(); if(currentId!==job.id) selectJob(job.id).catch(showWorkError); };
    list.append(b);
    if(focused===job.id) b.focus({preventScroll:true});
  }
  if(!list.childElementCount) list.append(el("p",jobs.length?"当前筛选下没有任务。":"还没有任务。","dialog-sub"));
}
$("queue-filter").onchange=renderHistory;
$("open-library").onclick=()=>{$("mobile-queue").append($("queue-panel"));renderHistory();$("library").showModal();};
$("library").addEventListener("close",()=>$("rail").append($("queue-panel")));
matchMedia("(min-width:981px)").addEventListener("change",e=>{if(e.matches && $("library").open) $("library").close();});
for(const button of document.querySelectorAll("[data-close]")) button.onclick=()=>{
  if(button.dataset.close==="editor" && saving) return;
  $(button.dataset.close).close();
};
for(const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click",e=>{
  if(e.target!==dialog || (dialog.id==="editor" && saving)) return;
  const r=dialog.getBoundingClientRect();
  if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close();
});
function showWorkError(err) { setNote($("work-note"),err.message || "无法载入任务。",true); }
function showStatus(title,description,working,retry=false) {
  $("workspace").hidden=true; $("highlight-step").hidden=true; $("status-card").hidden=false;
  $("status-card").classList.toggle("working",working);
  $("status-title").textContent=title; $("status-text").textContent=description;
  $("retry").hidden=!retry; $("work").setAttribute("aria-busy",String(working));
  $("status-progress").hidden=true;
}
async function selectJob(id) {
  stopAudition();
  setNote($("job-audio-error"));
  currentId=id; writePref("xread-current",id);
  history.replaceState(null,"","#job="+encodeURIComponent(id));
  ++selectionVersion; ++sourceRevision; readyId=null; rows=[]; cueButtons=[]; activeCue=-1;
  previewMode="source"; manualPreview=false; lastFilmKey=""; renderHistory();
  player.pause(); player.removeAttribute("src"); player.replaceChildren(); player.load();
  setNote($("work-note")); await displayJob();
}
async function displayJob() {
  const job=jobNow(); if(!job) return;
  if(job.status!=="ready"){
    const p=phase(job), note=[job.message || statusNames[job.status],positionText(job),p.pct!==null?p.pct+"%":""].filter(Boolean).join(" · ");
    showStatus(job.title || "视频任务",note,job.status!=="error",job.status==="error");
    if(p.pct!==null){$("status-progress").value=p.pct; $("status-progress").hidden=false;}
    return;
  }
  if(readyId===job.id) { syncDub(job); return; }
  const version=selectionVersion;
  showStatus("正在打开视频","载入字幕和预览…",true);
  const loaded=await api(jobPath()+"/cues");
  if(version!==selectionVersion) return;
  if(!Array.isArray(loaded)) throw new Error("字幕文稿格式不正确。");
  rows=loaded; readyId=job.id;
  $("status-card").hidden=true; $("workspace").hidden=false; $("highlight-step").hidden=rows.length===0;
  $("work").setAttribute("aria-busy","false");
  $("source-label").textContent=sourceNames[job.source] || "视频";
  $("video-title").textContent=job.title || "视频";
  const baked=knownCaptions(job) || job.burnedCaptions===true;
  $("video-meta").textContent=[job.duration?time(job.duration):"",rows.length+" 条字幕",baked?"原画已含中文字幕":""].filter(Boolean).join("  ·  ");
  if(job.id==="demo") player.setAttribute("poster","/static/poster.jpg"); else player.removeAttribute("poster");
  const hasFilmSettings=job.dub?.status && job.dub.status!=="none";
  fillVoices("job",hasFilmSettings && job.dub.audioMode!=="original"?job.dub.voice:savedVoice());
  setOutputs("job",hasFilmSettings?(job.dub.audioMode || "dubbed"):savedAudioMode());
  $("job-style").value=hasFilmSettings && job.dub.audioMode!=="original"?(job.dub.style || "natural"):savedStyle();
  $("job-quality").value=job.dub?.quality || "standard";
  $("job-captions").value=baked?"keep":job.dub?.captionMode || job.captionMode || "auto";
  waitingForCaptionCheck=awaitingDetection(job);
  showOverlay=!protectPicture(job) && !waitingForCaptionCheck;
  renderCues(); syncDub(job,true); highlightCue();
  $("edit").disabled=rows.length===0;
}
function knownCaptions(job=jobNow()) { return job?.id==="demo" || job?.detectedCaptions===true || (job?.detectedCaptions===undefined && job?.burnedCaptions===true); }
function awaitingDetection(job=jobNow()) { return job?.captionsChecked===false && !knownCaptions(job); }
function protectPicture(job=jobNow()) {
  return knownCaptions(job) || job?.burnedCaptions===true || job?.captionMode==="keep" || job?.dub?.captionMode==="keep" || $("job-captions").value==="keep";
}
function updateSubtitleControls() {
  const film=previewMode!=="source", keep=protectPicture(), pending=awaitingDetection();
  $("subtitle-switch").hidden=film || keep || pending;
  $("dub-caption").hidden=!film && !keep && !pending;
  const sound=previewMode==="dub"?"中文配音":"原音轨";
  $("dub-caption").textContent=film?sound+(keep?" · 沿用原画字幕":" · 内嵌中文字幕"):keep?"沿用原画中文字幕":"尚未检测画面字幕，当前显示原画";
}
$("job-captions").onchange=()=>{updateSubtitleControls();attachTracks();applyLanguage();};
function setPreview(next,preserve=true) {
  stopAudition();
  const revision=++sourceRevision;
  const position=preserve?player.currentTime:0, playing=preserve && !player.paused;
  previewMode=next;
  for(const kind of ["source","original","dub"]) {
    const button=$("variant-"+kind), on=kind===next;
    button.classList.toggle("active",on); button.setAttribute("aria-pressed",String(on));
  }
  updateSubtitleControls();
  player.onloadedmetadata=()=>{
    if(revision!==sourceRevision) return;
    if(position>0) player.currentTime=Math.min(position,Number.isFinite(player.duration)?player.duration:position);
    if(playing) player.play().catch(()=>{});
  };
  player.src=asset(filmFile(next))+(next!=="source"?"?v="+Date.now():"");
  attachTracks(); applyLanguage();
}
function syncDub(job,initial=false) {
  const dub=job.dub || {}, state=dub.status || "none", active=["queued","working"].includes(state), available=state==="ready";
  const filmKey=JSON.stringify([dub.audioMode || "dubbed",dub.voice,dub.style || "natural",dub.quality,dub.captionMode]);
  const films=availableFilms(dub);
  for(const kind of ["original","dub"]){
    $("variant-"+kind).hidden=!films[kind];
    const download=$(kind==="original"?"download-original-film":"download-dub");
    download.hidden=!films[kind]; download.href=asset(filmFile(kind,true));
  }
  const preferred=films.dub?"dub":films.original?"original":"source";
  if(initial) setPreview(preferred,false);
  else if(previewMode!=="source" && !films[previewMode]) setPreview(preferred);
  else if(!manualPreview && preferred!==previewMode) setPreview(preferred);
  else if(previewMode!=="source" && filmKey!==lastFilmKey) setPreview(previewMode);
  lastFilmKey=filmKey;
  $("dub-title").textContent=filmStatus(dub) || "成片制作";
  const actual=$("current-voice"), label=voiceNames[dub.voice] || "音色未记录";
  actual.hidden=!available && !active;
  actual.textContent=dub.audioMode==="original"?(available?"当前成片使用原音轨":"本次任务保留原音轨"):(available?"当前成片音色　":"本次任务音色　")+label+" · "+(styleNames[dub.style] || styleNames.natural);
  const pct=phase(job).pct, message=state==="none"?"选择声音后即可用当前字幕生成成片。":dub.message;
  // Historical fast renders can contain the former 8 kHz voice.
  const qualityText=dub.audioMode!=="original" && dub.quality?dub.quality==="fast"?"快速":"标准 · 24 kHz":"";
  const partial=dub.audioMode==="both" && films.original && !films.dub?"原声字幕版已可下载":"";
  $("dub-message").textContent=[message,partial,state!=="none"?qualityText:"",positionText(job),active && pct!==null?pct+"%":""].filter(Boolean).join(" · ");
  const bar=$("dub-progress"); bar.hidden=!(active && pct!==null); if(!bar.hidden) bar.value=pct;
  $("request-dub").textContent=active?"处理中":state==="error"?"重试生成":["stale","ready"].includes(state)?"重新生成":"开始翻译";
  $("job-voice").disabled=active || submittingDubId===job.id;
  $("job-style").disabled=active || submittingDubId===job.id;
  $("job-out-original").disabled=active || submittingDubId===job.id;
  $("job-out-dubbed").disabled=active || submittingDubId===job.id;
  updateOutputButton("job");
  updateAudition("job");
  $("job-quality").disabled=active || submittingDubId===job.id;
  const known=knownCaptions(job);
  $("job-captions").querySelector('option[value="burn"]').disabled=known;
  if(known) $("job-captions").value="keep";
  $("job-captions").disabled=active || submittingDubId===job.id || known;
  if((protectPicture(job) || awaitingDetection(job)) && player.querySelector("track")) attachTracks();
  const pending=awaitingDetection(job);
  if(waitingForCaptionCheck && !pending && !protectPicture(job)){ showOverlay=true; attachTracks(); applyLanguage(); }
  waitingForCaptionCheck=pending;
  updateSubtitleControls();
  if($("exports").open) updateFilmExports(dub);
}
for(const kind of ["source","original","dub"]) $("variant-"+kind).onclick=()=>{
  if(kind!=="source" && !availableFilms(jobNow()?.dub)[kind]) return;
  manualPreview=true;
  if(previewMode!==kind) setPreview(kind);
};
$("request-dub").onclick=async()=>{
  const job=jobNow(); if(!job || job.status!=="ready" || !outputMode("job")) return;
  if(sampleOwner==="job") stopAudition();
  manualPreview=false; submittingDubId=job.id; syncDub(job);
  try{
    await api(jobPath(job.id)+"/dub",{...soundSettings("job"),captionMode:knownCaptions(job)?"keep":$("job-captions").value});
    await loadJobs();
  } catch(err){ if(currentId===job.id) showWorkError(err); }
  finally { if(submittingDubId===job.id) submittingDubId=null; if(currentId===job.id) syncDub(jobNow()); }
};
function attachTracks() {
  trackVersion++;
  player.querySelectorAll("track").forEach(t=>{ t.track.mode="disabled"; t.remove(); });
  if(!showOverlay || previewMode!=="source" || protectPicture() || awaitingDetection()){ applyTracks(); return; }
  const t=el("track");
  t.kind="subtitles"; t.srclang="zh-CN"; t.label=language==="zh"?"简体中文":"中英双语"; t.dataset.mode=language;
  t.default=true; t.src=asset(language+".vtt")+"?v="+trackVersion;
  player.append(t);
  applyTracks();
}
function applyTracks() {
  const wanted=previewMode!=="source" || protectPicture() || awaitingDetection()?null:player.querySelector('track[data-mode="'+language+'"]')?.track;
  for(const track of player.textTracks) track.mode=track===wanted?"showing":"disabled";
}
player.addEventListener("loadedmetadata",applyTracks);
player.textTracks.addEventListener("addtrack",applyTracks);
player.addEventListener("error",()=>{
  if(player.getAttribute("src") && jobNow()?.status==="ready") setNote($("work-note"),"浏览器无法播放此视频。可使用「导出」保存到本地播放器观看。",true);
});
function applyLanguage() {
  const dual=language==="bilingual";
  for(const [id,on] of [["lang-original",!showOverlay],["lang-zh",showOverlay && !dual],["lang-bi",showOverlay && dual]]) {
    $(id).classList.toggle("active",on); $(id).setAttribute("aria-pressed",String(on));
  }
  applyTracks();
  $("transcript-bi").setAttribute("aria-pressed",String(transcriptDual));
  for(const b of cueButtons) { const english=b.querySelector("small"); if(english) english.hidden=!transcriptDual; }
}
$("transcript-bi").onclick=()=>{transcriptDual=!transcriptDual;writePref("xread-transcript-dual",String(transcriptDual));applyLanguage();};
for(const [id,lang] of [["lang-zh","zh"],["lang-bi","bilingual"]]) $(id).onclick=()=>{
  if(language!==lang || !showOverlay){ language=lang; showOverlay=true; writePref("xread-language",lang); attachTracks(); }
  transcriptDual=lang==="bilingual";writePref("xread-transcript-dual",String(transcriptDual));
  applyLanguage();
};
$("lang-original").onclick=()=>{showOverlay=false;attachTracks();applyLanguage();};
function renderCues() {
  const frag=document.createDocumentFragment(); cueButtons=[]; activeCue=-1;
  rows.forEach((r,i)=>{
    const b=el("button",undefined,"cue"), words=el("span");
    b.type="button"; b.dataset.index=String(i); b.append(el("time",time(r.start)));
    words.append(el("strong",r.zh || r.en || "…"));
    if(r.en && r.zh) { const en=el("small",r.en); en.hidden=!transcriptDual; words.append(en); }
    b.append(words); frag.append(b); cueButtons.push(b);
  });
  if(!rows.length) frag.append(el("p","这段视频没有可显示的字幕。","dialog-sub"));
  $("cues").replaceChildren(frag); $("cue-count").textContent=rows.length+" 条字幕";
}
$("cues").onclick=e=>{
  const b=e.target.closest("button.cue"); if(!b) return;
  const row=rows[Number(b.dataset.index)]; if(!row) return;
  player.currentTime=row.start; highlightCue();
};
function highlightCue() {
  const t=player.currentTime; let lo=0,hi=rows.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(rows[mid].start<=t)lo=mid+1;else hi=mid;}
  const n=lo>0 && t<rows[lo-1].end?lo-1:-1;
  if(n===activeCue) return;
  cueButtons[activeCue]?.classList.remove("active"); cueButtons[activeCue]?.removeAttribute("aria-current");
  activeCue=n; const b=cueButtons[n]; if(!b) return;
  b.classList.add("active"); b.setAttribute("aria-current","true");
  if(!player.paused && Date.now()>manualScrollUntil) {
    const sc=$("cue-scroll"),br=b.getBoundingClientRect(),sr=sc.getBoundingClientRect();
    if(br.top<sr.top || br.bottom>sr.bottom) sc.scrollTop+=br.top-sr.top-8;
  }
}
player.addEventListener("timeupdate",highlightCue);
for(const ev of ["wheel","touchstart","keydown"]) $("cue-scroll").addEventListener(ev,()=>manualScrollUntil=Date.now()+4500,{passive:true});
$("retry").onclick=async()=>{
  const id=currentId; $("retry").disabled=true;
  try { await api(jobPath(id)+"/retry",{}); await loadJobs(); }
  catch(err) { showWorkError(err); } finally { $("retry").disabled=false; }
};
$("edit").onclick=()=>{
  if(!rows.length) return;
  $("edit-scope").hidden=!protectPicture();
  const frag=document.createDocumentFragment();
  for(const row of rows) {
    const label=el("label",undefined,"edit-item");
    const input=el("textarea"); input.value=row.zh || ""; input.rows=1;
    label.append(el("time",time(row.start)),el("span",row.en || ""),input); frag.append(label);
  }
  $("edit-body").replaceChildren(frag); $("edit-note").textContent=""; $("editor").showModal();
};
$("editor").addEventListener("cancel",e=>{if(saving)e.preventDefault();});
$("save-cues").onclick=async()=>{
  const inputs=[...$("edit-body").querySelectorAll("textarea")];
  const updated=rows.map((r,i)=>({...r,zh:inputs[i].value.trim()}));
  if(updated.some(r=>!r.zh)){ $("edit-note").textContent="请补全空白的中文字幕。"; return; }
  if(updated.every((r,i)=>r.zh===rows[i].zh)){ $("editor").close(); return; }
  saving=true; $("save-cues").disabled=true;
  try {
    await api(jobPath()+"/cues",{rows:updated}); rows=updated;
    renderCues(); attachTracks(); highlightCue(); $("editor").close();
    setNote($("work-note"),protectPicture()?"译文修改用于配音和独立字幕文件，原画文字保留。":"文稿和字幕已保存。重新生成可使用更新后的字幕。");
    await loadJobs();
  } catch(err) { $("edit-note").textContent=err.message; }
  finally { saving=false; $("save-cues").disabled=false; }
};
function updateFilmExports(dub={}) {
  const films=availableFilms(dub), dubbed=$("export-dub"), original=$("export-original-film");
  dubbed.hidden=!films.dub; original.hidden=!films.original;
  dubbed.querySelector("b").textContent="中文配音版 MP4";
  dubbed.querySelector("small").textContent=[voiceNames[dub.voice] || "音色未记录",styleNames[dub.style] || styleNames.natural].join(" · ");
  dubbed.href=asset(filmFile("dub",true)); original.href=asset(filmFile("original",true));
  const dual=$("export-dual-audio");
  dual.hidden=!(dub.audioMode==="both" && dub.status==="ready" && films.original);
  dual.href=asset("dual-audio.mp4");
}
$("export-button").onclick=()=>{
  const dual=transcriptDual;
  $("export-title").textContent=jobNow()?.title || "当前视频";
  $("export-mp4").href=asset("zh.mp4"); $("export-burn").href=asset("burn.mp4"); $("export-srt").href=asset(dual?"bilingual.srt":"zh.srt");
  $("export-original").href=asset("original");
  const original=$("export-original"), baked=protectPicture();
  const confirmedKeep=jobNow()?.burnedCaptions===true;
  const mp4=$("export-mp4"), omitAdditional=baked || awaitingDetection();
  $("export-burn").hidden=omitAdditional; mp4.hidden=omitAdditional && !confirmedKeep;
  mp4.querySelector("b").textContent=confirmedKeep?"原声字幕视频 MP4":"字幕视频 MP4";
  mp4.querySelector("small").textContent=confirmedKeep?"保留原声，仅显示画面中已有的字幕":"播放时可切换中文和中英双语字幕";
  original.querySelector("small").textContent="保存导入时的原始视频文件";
  original.parentElement.append(original);
  updateFilmExports(jobNow()?.dub);
  $("srt-name").textContent=dual?"中英双语 SRT":"中文字幕 SRT";
  setNote($("download-status")); $("exports").showModal();
};
for(const link of document.querySelectorAll(".export-list a")) link.onclick=()=>setNote($("download-status"),"文件准备好后将由浏览器下载。");
async function loadJobs() {
  const version=selectionVersion, request=++jobsRequest, data=await api("/api/jobs");
  if(!Array.isArray(data)) throw new Error("无法读取任务列表。");
  if(version!==selectionVersion || request!==jobsRequest) return;
  jobs=data; updateCount(); renderHistory();
  if(!jobNow()) {
    const saved=readPref("xread-current");
    const requested=new URLSearchParams(location.hash.slice(1)).get("job");
    const id=jobs.find(j=>j.id===requested)?.id || jobs.find(j=>j.id===saved)?.id || jobs.find(j=>j.id==="demo")?.id || jobs[0]?.id;
    if(id) { await selectJob(id); return; }
    showStatus("尚无视频","粘贴链接或导入本地视频即可开始。",false);
  } else await displayJob();
}
window.addEventListener("hashchange",()=>{
  const id=new URLSearchParams(location.hash.slice(1)).get("job");
  if(id!==currentId && jobs.some(j=>j.id===id)) selectJob(id).catch(showWorkError);
});
async function poll() {
  try {
    await loadJobs(); pollDelay=jobs.some(job=>phase(job).active)?1250:4800;
    if($("work-note").dataset.connection==="failed"){setNote($("work-note"));delete $("work-note").dataset.connection;}
  } catch(err) {
    $("work-note").dataset.connection="failed";
    setNote($("work-note"),"连接本机服务失败，将自动重试。"+err.message,true); pollDelay=4500;
    if(!readyId) showStatus("正在连接工作台","请保持 Xread 启动窗口运行。",true);
  }
  setTimeout(poll,pollDelay);
}
showStatus("正在打开工作台","载入本机任务…",true);
poll();
