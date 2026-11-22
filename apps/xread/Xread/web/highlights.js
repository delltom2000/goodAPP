"use strict";

const highlightDialog = $("highlights");
let highlightJob = null;
let highlightTimer = null;
let highlightEpoch = 0;
let highlightTicket = "";

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
    const draftState=clip.ready?clip.length+" 字":state.status==="error"?"长帖待重试":"长帖生成中";
    const runtime=time(clip.duration ?? (clip.end-clip.start));
    article.querySelector(".meta").textContent=runtime+" · "+draftState;
    if(!clip.ready || article.querySelector("details")) continue;
    article.querySelector(".highlight-actions").append(highlightLink("长帖 TXT",base+"post.txt"));
    const detail=el("details"), summary=el("summary","查看与复制 X 长帖");
    const draft=el("textarea");
    draft.value=clip.post;
    draft.readOnly=true;
    draft.rows=8;
    draft.setAttribute("aria-label","X 长帖草稿");
    const copy=el("button","复制长帖","quiet");
    copy.type="button";
    copy.onclick=async()=>{
      try{await navigator.clipboard.writeText(draft.value);copy.textContent="已复制";}
      catch{draft.focus();draft.select();}
    };
    detail.append(summary,draft,copy);
    article.append(detail);
  }
}

async function refreshHighlights(initial=false) {
  clearTimeout(highlightTimer);
  const epoch=highlightEpoch;
  try {
    const data=await api(highlightEndpoint());
    if(epoch!==highlightEpoch || !highlightDialog.open) return;
    const {state,requiresLogin,hasKey,models}=data;
    $("highlight-login").hidden=!requiresLogin;
    $("highlight-form").hidden=Boolean(requiresLogin);
    $("highlight-key-label").hidden=Boolean(requiresLogin || hasKey);
    const menu=$("highlight-model");
    if(!menu.options.length) menu.replaceChildren(...models.map(model=>new Option(model,model)));
    if(initial && state.model) menu.value=state.model;
    if(initial && state.count) $("highlight-count").value=state.count;
    if(initial && state.mode) $("highlight-mode").value=state.mode;
    const active=["queued","working"].includes(state.status);
    $("highlight-submit").disabled=active;
    $("highlight-submit").textContent=active?"处理中…":state.status==="error"?"重试":state.status==="ready"?"重新生成":"生成切片与长帖";
    $("highlight-progress").hidden=!active;
    if(active) $("highlight-progress").value=state.progress;
    setNote($("highlight-message"),state.message,state.status==="error");
    showHighlightResults(requiresLogin?{}:state);
    if(active && !requiresLogin) highlightTimer=setTimeout(refreshHighlights,1000);
  } catch(error) {
    if(epoch===highlightEpoch) setNote($("highlight-message"),error.message,true);
  }
}

$("open-highlights").onclick=()=>{
  highlightJob=jobNow();
  if(highlightJob?.status!=="ready") return;
  player.pause();
  stopAudition();
  $("highlight-source").textContent=highlightJob.title;
  $("highlight-login").hidden=true;
  $("highlight-form").hidden=true;
  $("highlight-results").replaceChildren();
  $("highlight-zip").hidden=true;
  $("highlight-progress").hidden=true;
  $("highlight-model").replaceChildren();
  $("highlight-count").value=highlightJob.duration>=45*60?"10":"3";
  $("highlight-mode").value=highlightJob.duration>=150?"montage":"chronological";
  highlightTicket="";
  setNote($("highlight-message"),"正在读取切片任务…");
  highlightDialog.showModal();
  refreshHighlights(true);
};

highlightDialog.addEventListener("close",()=>{
  ++highlightEpoch;
  clearTimeout(highlightTimer);
  $("highlight-code").value="";
  $("highlight-key").value="";
  for(const video of $("highlight-results").querySelectorAll("video")) video.pause();
});

$("highlight-login").onsubmit=async event=>{
  event.preventDefault();
  const epoch=highlightEpoch, button=event.currentTarget.querySelector("button[type=submit]");
  button.disabled=true;
  try {
    await api("/api/highlights/login",{phone:$("highlight-phone").value,code:$("highlight-code").value});
    if(epoch===highlightEpoch) await refreshHighlights(true);
  } catch(error) {
    if(epoch===highlightEpoch) setNote($("highlight-message"),error.message,true);
  } finally {
    $("highlight-code").value="";
    button.disabled=false;
  }
};

$("highlight-form").onsubmit=async event=>{
  event.preventDefault();
  const epoch=highlightEpoch, button=$("highlight-submit");
  button.disabled=true;
  try {
    await api(highlightEndpoint(),{model:$("highlight-model").value,count:Number($("highlight-count").value),
      mode:$("highlight-mode").value,key:$("highlight-key").value});
    $("highlight-key").value="";
    if(epoch===highlightEpoch) await refreshHighlights();
  } catch(error) {
    if(epoch===highlightEpoch){setNote($("highlight-message"),error.message,true);button.disabled=false;}
  }
};
