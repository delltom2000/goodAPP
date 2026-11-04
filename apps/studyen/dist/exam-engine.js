/* Pure assembly/grading core shared by browser, Android WebView and Node tests. */
(function(root){
  const objective=q=>!['essay','speaking'].includes(q.responseType);
  function normalize(value){return String(value??'').normalize('NFKC').trim().toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ')}
  function grade(q,value){
    if(!objective(q))return null;
    if(q.responseType==='text'){
      const normalized=normalize(value);
      if(q.wordLimit&&normalized.split(/\s+/).filter(Boolean).length>q.wordLimit)return false;
      return q.acceptedAnswers.some(a=>normalize(a)===normalized);
    }
    return Number.isInteger(value)&&value===q.answer;
  }
  function signature(qs){return qs.map(q=>q.id).sort().join('|')}
  function assemble(bank,{count=12,mode='adaptive',skills=['语法','阅读','听力'],attempts=[],papers=[],random=Math.random}={}){
    if(!Number.isInteger(count)||count<1||count>100)throw Error('题量应为 1–100 道。');
    const index=new Map(bank.map(q=>[q.id,q]));
    const seen=new Set(attempts.map(a=>a.id));
    const recentIds=new Set(papers.slice(-3).flatMap(p=>Array.isArray(p)?p:p.ids||[]));
    const weaknesses=new Map();
    for(const a of attempts.slice(-100)){const q=index.get(a.id);if(q&&a.ok===false)weaknesses.set(q.tag,(weaknesses.get(q.tag)||0)+1)}
    const selectedSkills=[...new Set(skills)].filter(s=>['语法','阅读','听力','写作','口语'].includes(s));
    if(!selectedSkills.length)throw Error('请至少选择一个科目。');
    let quotas;
    if(mode==='full')quotas=[{skill:'听力',count:40},{skill:'阅读',count:40},{skill:'写作',count:1,type:'task-1-table'},{skill:'写作',count:1,type:'essay-2'},{skill:'口语',count:1,type:'part-1'},{skill:'口语',count:1,type:'part-2'},{skill:'口语',count:1,type:'part-3'}];
    else quotas=selectedSkills.map((skill,i)=>({skill,count:Math.floor(count/selectedSkills.length)+(i<count%selectedSkills.length?1:0)}));
    const history=new Set(papers.map(p=>(Array.isArray(p)?[...p]:[...(p.ids||[])]).sort().join('|')));
    for(let retry=0;retry<30;retry++){
      const result=[],used=new Set(),families=new Map(),groups=new Map(),stems=new Map();
      for(const quota of quotas){
        let pool=bank.filter(q=>!q.practiceOnly&&q.skill===quota.skill&&(!quota.type||(quota.type==='essay-2'?q.responseType==='essay'&&q.taskType!=='task-1-table':q.taskType===quota.type))&&!used.has(q.id));
        if(pool.length<quota.count)throw Error(`${quota.skill}符合条件的题目只有 ${pool.length} 道，无法组成 ${quota.count} 道。`);
        // Prefer unseen content; still allow repeats when selected pools are small.
        pool=pool.map(q=>({q,score:random()*3+(!seen.has(q.id)?4:0)+(!recentIds.has(q.id)?8:0)+(q.origin==='original-authored'?3:0)+(mode==='adaptive'?Math.min(6,weaknesses.get(q.tag)||0):0)})).sort((a,b)=>b.score-a.score);
        let taken=0;
        for(let pass=0;pass<3&&taken<quota.count;pass++){
          for(const {q} of pool){
            if(used.has(q.id))continue;
            const family=q.family||q.tag,group=q.groupId||q.id;
            const stem=q.skill+'|'+normalize(q.q);
            if(pass<2&&(stems.get(stem)||0)>=pass+1)continue;
            if(pass===0&&((families.get(family)||0)>=Math.max(2,Math.ceil(quota.count/5))||(groups.get(group)||0)>=1))continue;
            if(pass===1&&(groups.get(group)||0)>=2)continue;
            result.push(q);used.add(q.id);families.set(family,(families.get(family)||0)+1);groups.set(group,(groups.get(group)||0)+1);taken++;
            stems.set(stem,(stems.get(stem)||0)+1);
            if(taken===quota.count)break;
          }
        }
      }
      if(!history.has(signature(result)))return result;
    }
    throw Error('当前筛选范围内无法生成未使用的组合，请扩大科目或调整题量。');
  }
  const engine={objective,normalize,grade,signature,assemble};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;else root.ExamEngine=engine;
})(typeof window!=='undefined'?window:globalThis);
