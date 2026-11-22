"use strict";

const highlightPanel = $("highlight-step");
const workTabs = [$("translation-tab"), $("highlights-tab")];
let highlightJob = null;
let highlightTimer = null;
let highlightEpoch = 0;
let highlightRequest = 0;
let highlightTicket = "";
let highlightSourcesKey = "";
let highlightFilmKey = "";
let highlightState = {};
let highlightSubmitting = false;
let clipPlan = {};
let clipPlanSending = false;
let clipPlanError = "";

function clipPlanMatches() {
  return clipPlan.count===Number($("highlight-count").value) && clipPlan.mode===$("highlight-mode").value;
}

function clipPlanActive() {
  return clipPlanSending || ["queued","working"].includes(clipPlan.status);
}

function renderClipPlan() {
  const turns=$("clip-plan-turns");
  turns.replaceChildren(...(clipPlan.turns || []).map(turn=>{
    const item=el("div",undefined,"clip-plan-turn "+(turn.role==="user"?"user":"agent"));
    item.append(el("strong",turn.role==="user"?"你":"Agent"),el("p",turn.text));
    return item;
  }));
  turns.scrollTop=turns.scrollHeight;
  const list=$("clip-plan-list");
  list.replaceChildren(...(clipPlan.clips || []).map(clip=>{
    const item=el("li");
    const times=clip.ranges.map(part=>time(part.start)+"–"+time(part.end)).join(" → ");
    item.append(el("strong",clip.title),el("span",time(clip.duration)+" · "+times));
    if(clip.idea?.support) item.append(el("span",clip.idea.support));
    if(clip.idea?.subtopics?.length) {
      const topics=el("ul");
      for(const topic of clip.idea.subtopics) topics.append(el("li",topic.label));
      item.append(topics);
    }
    return item;
  }));
  list.hidden=!list.children.length;
}

function highlightCanResume() {
  const state=highlightState;
  return state.canResume && $("highlight-video-source").value===(state.videoSource || "source") &&
    $("highlight-mode").value===(state.mode || "chronological") && Number($("highlight-count").value)===state.count;
}

function syncHighlightControls() {
  const state=highlightState, menu=$("highlight-video-source");
  const active=["queued","working"].includes(state.status);
  const discussion=$("clip-discussion").open;
  const busy=clipPlanActive();
  const pendingMessage=$("clip-plan-message").value.trim();
  const canConfirm=clipPlan.status==="ready" && clipPlanMatches() && clipPlan.clips?.length && !pendingMessage;
  const canResume=highlightCanResume() && (!discussion || state.planTicket===clipPlan.ticket);
  for(const input of [menu,$("highlight-model"),$("highlight-mode"),$("highlight-count")]) {
    input.disabled=active || busy || highlightSubmitting;
  }
  $("highlight-cloud").disabled=active || highlightSubmitting;
  const button=$("highlight-submit");
  const blocked=active || busy || highlightSubmitting || !menu.value;
  button.hidden=discussion;
  button.disabled=blocked || discussion;
  button.textContent=active?"处理中…":canResume?"从断点继续":state.status==="ready"?"重新生成":"生成切片与长帖";
  const confirm=$("clip-plan-confirm");
  confirm.disabled=blocked || !discussion || !canConfirm;
  confirm.textContent=active?"处理中…":canResume?"从断点继续":"确认方案并切片";
  const send=$("clip-plan-send");
  send.disabled=active || highlightSubmitting || busy || Boolean(clipPlan.status==="ready" && clipPlanMatches() && !pendingMessage);
  send.textContent=busy?"Agent 正在整理…":pendingMessage?"发送":clipPlan.status?"更新方案":"让 Agent 先给方案";
  $("clip-plan-message").disabled=active;
  const planNote=clipPlanError || ((clipPlan.status==="ready" && !clipPlanMatches())?"片数或剪辑方式已调整，请更新方案。":
    clipPlan.message || "每片 2–5 分钟。确认方案后才剪辑。");
  if($("clip-plan-note").textContent!==planNote) setNote($("clip-plan-note"),planNote,Boolean(clipPlanError) || clipPlan.status==="error");
  $("highlight-cloud-copy").hidden=!state.cloudSavedAt;
  const cloudNote={pending:"正在备份，完成后可复制跨设备恢复链接。",saved:"云端断点已保存。",
    error:"云端备份暂未同步，服务器上的断点已保留。"}[state.cloudStatus];
  setNote($("highlight-cloud-status"),cloudNote,state.cloudStatus==="error");
}

$("highlight-form").addEventListener("input",syncHighlightControls);
$("clip-discussion").addEventListener("toggle",syncHighlightControls);

function updateHighlightSources(sources, previous) {
  const menu=$("highlight-video-source"), key=JSON.stringify(sources);
  if(key!==highlightSourcesKey) {
    const wanted=menu.value;
    const options=sources.map(source=>{
      const option=new Option(source.label+(source.ready?"":"（未就绪）"),source.id);
      option.disabled=!source.ready;
      return option;
    });
    menu.replaceChildren(...options);
    const selected=sources.find(source=>source.ready && source.id===wanted);
    menu.value=selected?.id || sources.find(source=>source.ready)?.id || "";
    highlightSourcesKey=key;
  }
  if(previous && sources.some(source=>source.ready && source.id===previous)) menu.value=previous;
}

function selectWorkTab(tab) {
  writePref("xread-work-tab",tab.id);
  for(const item of workTabs) {
    const selected=item===tab;
    item.setAttribute("aria-selected",String(selected));
    item.tabIndex=selected?0:-1;
    $(item.getAttribute("aria-controls")).hidden=!selected;
  }
  if(tab===workTabs[1]) {
    player.pause();
    stopAudition();
  } else {
    for(const video of highlightPanel.querySelectorAll("video")) video.pause();
  }
}

for(const tab of workTabs) {
  tab.onclick=()=>selectWorkTab(tab);
  tab.onkeydown=event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const next=event.key==="Home"?workTabs[0]:event.key==="End"?workTabs[1]:workTabs.find(item=>item!==tab);
    selectWorkTab(next);
    next.focus();
  };
}
if(readPref("xread-work-tab")==="highlights-tab") selectWorkTab(workTabs[1]);

function highlightEndpoint() {
  return jobPath(highlightJob.id)+"/highlights";
}

function highlightLink(label, url) {
  const link=el("a",label,"quiet");
  link.href=url+"?download=1";
  link.download="";
  return link;
}

function showHighlightResults(state) {
  const results=$("highlight-results"), zip=$("highlight-zip");
  const parts=(state.clips || []).filter(clip=>clip.videoReady || clip.ready);
  zip.hidden=state.status!=="ready";
  if(!zip.hidden) zip.href="/clips/"+highlightJob.id+"/"+state.ticket+"/highlights.zip?download=1";
  if(state.ticket!==highlightTicket) {
    highlightTicket=state.ticket;
    results.replaceChildren();
  }
  for(const clip of parts) {
    const base="/clips/"+highlightJob.id+"/"+state.ticket+"/clip-"+String(clip.id).padStart(2,"0")+"/";
    let article=results.querySelector('article[data-clip="'+clip.id+'"]');
    if(!article) {
      article=el("article",undefined,"highlight-card");
      article.dataset.clip=clip.id;
      article.append(el("h3",clip.title),el("p","","meta"));
      if(clip.ranges?.length>1) {
        const timeline=el("p",clip.ranges.map(r=>time(r.start)+"–"+time(r.end)).join(" → "),"highlight-source-times");
        timeline.title="片段在原视频中的时间，按成片播放顺序";
        article.append(timeline);
      }
      const actions=el("div",undefined,"highlight-actions");
      const preview=el("button","预览","quiet");
      preview.type="button";
      preview.onclick=()=>{
        const prior=article.querySelector("video");
        if(prior){prior.remove();preview.textContent="预览";return;}
        const video=el("video");
        video.controls=true;
        video.preload="metadata";
        video.playsInline=true;
        video.src=base+"clip.mp4";
        actions.after(video);
        preview.textContent="收起预览";
      };
      actions.append(preview,highlightLink("MP4",base+"clip.mp4"),highlightLink("SRT",base+"zh.srt"));
      article.append(actions);
      results.append(article);
    }
    const draftState=clip.ready?"长帖已就绪 · "+clip.length+" 字":
      clip.postError || state.status==="error"?"长帖待补写":"长帖待生成";
    const runtime=time(clip.duration ?? (clip.end-clip.start));
    article.querySelector(".meta").textContent=runtime+" · "+draftState;
    const error=article.querySelector(".highlight-post-error");
    if(error && error.textContent!==(clip.postError || "")) setNote(error,clip.postError,true);
    const existing=article.querySelector("textarea");
    if(existing) {
      if(clip.ready && existing.dataset.generated!=="1") {
        existing.dispatchEvent(new CustomEvent("xread-draft-ready",{detail:clip.post}));
      }
      continue;
    }
    const issue=el("p",undefined,"dialog-sub highlight-post-error");
    issue.setAttribute("role","status");
    setNote(issue,clip.postError,true);
    const editor=el("div",undefined,"highlight-editor");
    const draftId="xread-post:"+highlightJob.id+":"+state.ticket+":"+clip.id;
    const label=el("label","X 长帖草稿");
    const draft=el("textarea");
    draft.id="highlight-draft-"+clip.id;
    label.htmlFor=draft.id;
    const saved=readPref(draftId);
    let edited=saved!==null;
    draft.value=saved ?? (clip.ready?clip.post:"");
    draft.placeholder="可先写草稿，AI 长帖就绪后也可查看原稿。";
    draft.rows=5;
    const controls=el("div",undefined,"highlight-actions");
    const counter=el("span",undefined,"highlight-count");
    const previewBox=el("pre",undefined,"highlight-post-preview");
    previewBox.hidden=true;
    const preview=el("button","预览长帖","quiet");
    const original=el("button","查看 AI 原稿","quiet");
    preview.type=original.type="button";
    const copy=el("button","复制长帖","quiet");
    copy.type="button";
    copy.onclick=async()=>{
      try{await navigator.clipboard.writeText(draft.value);copy.textContent="已复制";}
      catch{draft.focus();draft.select();}
    };
    const download=highlightLink("下载当前 TXT",base+"post.txt");
    let generated=clip.ready?clip.post:"";
    let previewMode="";
    function showPreview(mode) {
      previewMode=mode;
      previewBox.hidden=!mode;
      previewBox.textContent=mode==="ai"?generated:mode==="draft"?draft.value:"";
      preview.textContent=mode==="draft"?"收起长帖预览":"预览长帖";
      original.textContent=mode==="ai"?"收起 AI 原稿":"查看 AI 原稿";
    }
    function syncDraft() {
      const empty=!draft.value.trim();
      preview.disabled=copy.disabled=empty;
      download.hidden=empty;
      original.hidden=!generated || generated===draft.value;
      counter.textContent=Array.from(draft.value.replace(/\s/g,"")).length+" 字";
      if((previewMode==="draft" && empty) || (previewMode==="ai" && original.hidden)) showPreview("");
      else if(previewMode) showPreview(previewMode);
    }
    preview.onclick=()=>showPreview(previewMode==="draft"?"":"draft");
    original.onclick=()=>showPreview(previewMode==="ai"?"":"ai");
    draft.addEventListener("input",()=>{
      edited=true;
      writePref(draftId,draft.value);
      syncDraft();
      copy.textContent="复制长帖";
    });
    draft.addEventListener("xread-draft-ready",event=>{
      generated=event.detail;
      draft.dataset.generated="1";
      if(!edited) draft.value=generated;
      syncDraft();
    });
    draft.dataset.generated=clip.ready?"1":"0";
    syncDraft();
    download.download="clip-"+String(clip.id).padStart(2,"0")+"-post.txt";
    download.onclick=()=>{
      const url=URL.createObjectURL(new Blob([draft.value],{type:"text/plain;charset=utf-8"}));
      download.href=url;
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    };
    controls.append(preview,original,copy,download,counter);
    editor.append(label,draft,controls,previewBox);
    article.append(issue,editor);
  }
}

async function refreshHighlights(initial=false) {
  clearTimeout(highlightTimer);
  if(!highlightJob) return;
  const epoch=highlightEpoch;
  const request=++highlightRequest;
  try {
    const data=await api(highlightEndpoint());
    if(epoch!==highlightEpoch || request!==highlightRequest) return;
    const {state,plan={},requiresLogin,hasKey,models,sources=[{id:"source",label:"原始视频",ready:true}]}=data;
    $("highlight-login").hidden=!requiresLogin;
    $("highlight-form").hidden=Boolean(requiresLogin);
    $("highlight-key-label").hidden=Boolean(requiresLogin || hasKey);
    $("highlight-cloud-label").hidden=!data.cloudAvailable;
    if(initial) $("highlight-cloud").checked=Boolean(state.cloudToken);
    const menu=$("highlight-model");
    if(!menu.options.length) menu.replaceChildren(...models.map(model=>new Option(model==="auto"?"自动选择（失败自动换模型）":model,model)));
    if(initial && state.status!=="error" && models.includes(state.model)) menu.value=state.model;
    if(initial && state.count) $("highlight-count").value=state.count;
    if(initial && state.mode) $("highlight-mode").value=state.mode;
    const active=["queued","working"].includes(state.status);
    if(initial && plan.ticket && !active && !state.canResume) {
      $("clip-discussion").open=true;
      $("highlight-count").value=plan.count;
      $("highlight-mode").value=plan.mode;
    }
    const newPlan=plan.ticket!==clipPlan.ticket || plan.status!==clipPlan.status;
    if(newPlan && plan.status==="ready" && $("clip-discussion").open && !active) {
      $("highlight-count").value=plan.count;
      $("highlight-mode").value=plan.mode;
    }
    updateHighlightSources(sources, (initial || active)?state.videoSource:null);
    highlightState=state;
    if(newPlan) {
      clipPlan=plan;
      renderClipPlan();
    }
    clipPlan=plan;
    syncHighlightControls();
    const showProgress=active || state.canResume && state.progress>0;
    $("highlight-progress").hidden=!showProgress;
    if(showProgress) $("highlight-progress").value=state.progress;
    const note=showProgress?[state.message,state.progress+"%"].filter(Boolean).join(" · "):state.message;
    if($("highlight-message").textContent!==(note || "")) {
      setNote($("highlight-message"),note,state.status==="error");
    }
    const route=state.modelNotice || (state.actualModel?"实际模型 · "+state.actualModel:"");
    if($("highlight-model-note").textContent!==route) setNote($("highlight-model-note"),route);
    const selectedSource=state.status!=="stale" && state.ticket && sources.find(source=>source.id===(state.videoSource || "source"));
    const sourceNote=selectedSource?"本批切片来源 · "+selectedSource.label:"";
    if($("highlight-source-note").textContent!==sourceNote) setNote($("highlight-source-note"),sourceNote);
    showHighlightResults(requiresLogin?{}:state);
    if((active || clipPlanActive()) && !requiresLogin) highlightTimer=setTimeout(refreshHighlights,1000);
  } catch(error) {
    if(epoch!==highlightEpoch || request!==highlightRequest) return;
    const active=["queued","working"].includes(highlightState.status);
    setNote($("highlight-message"),active?"连接中断，正在重新连接并读取切片进度。":error.message,true);
    highlightTimer=setTimeout(()=>refreshHighlights(initial),3000);
  }
}

function showHighlightsFor(job) {
  const dub=job?.dub;
  const filmKey=JSON.stringify([dub?.status,dub?.audioMode,dub?.originalReady,dub?.voice,dub?.quality,dub?.style,dub?.captionMode]);
  if(highlightJob?.id===job?.id) {
    if(job && highlightFilmKey!==filmKey) {
      highlightFilmKey=filmKey;
      refreshHighlights();
    }
    return;
  }
  ++highlightEpoch;
  clearTimeout(highlightTimer);
  highlightJob=job;
  highlightFilmKey=filmKey;
  highlightSourcesKey="";
  highlightState={};
  highlightSubmitting=false;
  clipPlan={};
  clipPlanSending=false;
  clipPlanError="";
  $("clip-discussion").open=false;
  $("clip-plan-message").value="";
  renderClipPlan();
  highlightPanel.hidden=!job;
  $("highlight-empty").hidden=Boolean(job);
  $("highlight-phone").value="";
  $("highlight-key").value="";
  $("highlight-cloud").checked=false;
  $("highlight-cloud-copy").hidden=true;
  setNote($("highlight-cloud-status"));
  $("highlight-login").hidden=true;
  $("highlight-form").hidden=true;
  $("highlight-results").replaceChildren();
  $("highlight-zip").hidden=true;
  $("highlight-progress").hidden=true;
  setNote($("highlight-model-note"));
  setNote($("highlight-source-note"));
  $("highlight-model").replaceChildren();
  $("highlight-video-source").replaceChildren();
  highlightTicket="";
  if(!job) return;
  $("highlight-source").textContent=job.title;
  $("highlight-count").value=job.duration>=45*60?"10":"3";
  $("highlight-mode").value=job.duration>=120?"montage":"chronological";
  setNote($("highlight-message"),"正在读取切片任务…");
  refreshHighlights(true);
}

$("highlight-login").onsubmit=async event=>{
  event.preventDefault();
  const epoch=highlightEpoch, button=event.currentTarget.querySelector("button[type=submit]");
  button.disabled=true;
  const phone=$("highlight-phone").value;
  try {
    await api("/api/highlights/login",{phone});
    if(epoch===highlightEpoch) await refreshHighlights(true);
  } catch(error) {
    if(epoch===highlightEpoch) setNote($("highlight-message"),error.message,true);
  } finally {
    button.disabled=false;
  }
};

$("highlight-form").onsubmit=async event=>{
  event.preventDefault();
  if(!highlightJob) return;
  const discussion=$("clip-discussion").open;
  if(highlightSubmitting || $(discussion?"clip-plan-confirm":"highlight-submit").disabled) return;
  const epoch=highlightEpoch;
  highlightSubmitting=true;
  syncHighlightControls();
  const key=$("highlight-key").value;
  const planTicket=discussion?clipPlan.ticket:highlightCanResume()?highlightState.planTicket:undefined;
  $("highlight-key").value="";
  try {
    await api(highlightEndpoint(),{model:$("highlight-model").value,count:Number($("highlight-count").value),
      mode:$("highlight-mode").value,videoSource:$("highlight-video-source").value,key,planTicket,
      cloud:!$("highlight-cloud-label").hidden && $("highlight-cloud").checked});
    if(epoch===highlightEpoch) await refreshHighlights();
  } catch(error) {
    if(epoch===highlightEpoch){
      if($("highlight-key").value==="") $("highlight-key").value=key;
      setNote($("highlight-message"),error.message,true);
    }
  } finally {
    if(epoch===highlightEpoch) {
      highlightSubmitting=false;
      syncHighlightControls();
    }
  }
};

$("clip-plan-send").onclick=async()=>{
  if(!highlightJob || $("clip-plan-send").disabled) return;
  const epoch=highlightEpoch;
  const input=$("clip-plan-message");
  const draft=input.value;
  const message=draft.trim();
  clipPlanSending=true;
  clipPlanError="";
  syncHighlightControls();
  try {
    await api(jobPath(highlightJob.id)+"/clip-plan",{message,model:$("highlight-model").value,
      mode:$("highlight-mode").value,count:Number($("highlight-count").value),key:$("highlight-key").value});
    if(epoch===highlightEpoch) {
      if(input.value===draft) input.value="";
      await refreshHighlights();
    }
  } catch(error) {
    if(epoch===highlightEpoch) clipPlanError=error.message;
  } finally {
    if(epoch===highlightEpoch) {
      clipPlanSending=false;
      syncHighlightControls();
    }
  }
};

$("clip-plan-message").addEventListener("keydown",event=>{
  if(event.key!=="Enter" || event.shiftKey || event.isComposing || event.keyCode===229) return;
  event.preventDefault();
  if(event.currentTarget.value.trim()) $("clip-plan-send").click();
});

$("highlight-cloud-copy").onclick=async()=>{
  const url=new URL("/",location.href);
  url.hash=new URLSearchParams({restore:highlightState.cloudToken});
  try {
    await navigator.clipboard.writeText(url.href);
    setNote($("highlight-cloud-status"),"已复制恢复链接。持有此链接即可读取备份。");
  } catch {
    window.prompt("复制跨设备恢复链接",url.href);
  }
};

async function restoreFromLink() {
  const code=new URLSearchParams(location.hash.slice(1)).get("restore");
  if(!code) return;
  try {
    const job=await api("/api/cloud/restore",{code});
    window.history.replaceState(null,"","#job="+job.id);
    await loadJobs();
    if(jobs.some(item=>item.id===job.id)) await selectJob(job.id);
    selectWorkTab(workTabs[1]);
  } catch(error) {
    showWorkError(error);
  }
}

document.addEventListener("DOMContentLoaded",restoreFromLink);
window.addEventListener("hashchange",restoreFromLink);
