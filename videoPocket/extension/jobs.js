export const ACTIVE_STATES=new Set(['queued','paused','interrupted','retrying','choosing','running','processing','converting','saving']);
export const FINISH_VISIBILITY_MS=4000;
export function activeDownloadJob(jobs,key){return key&&jobs.find(job=>job.downloadKey===key&&ACTIVE_STATES.has(job.state));}
export function downloadLocked(jobs,key){return !!activeDownloadJob(jobs,key);}
export function visibleJobs(jobs,openedAt,now=Date.now()){
  const rank={paused:0,interrupted:0,retrying:0,running:0,processing:0,converting:0,saving:0,choosing:1,queued:2};
  return jobs.filter(j=>ACTIVE_STATES.has(j.state)||j.finishedAt>=openedAt&&now-j.finishedAt<FINISH_VISIBILITY_MS).sort((a,b)=>(rank[a.state]??3)-(rank[b.state]??3)||(a.createdAt||0)-(b.createdAt||0));
}
export function jobLabel(job){return ({queued:'等待中',paused:'已暫停',interrupted:'連線中斷',retrying:'重試中',choosing:'選擇位置',running:'正在下載',processing:'處理中',converting:'轉檔中',saving:'儲存中',done:'下載完成',cancelled:'已取消',error:'失敗'})[job.state] || '等待中';}
