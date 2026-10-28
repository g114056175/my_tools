// Observation belongs to a live popup or an explicitly requested operation.
// Serialize start/stop per tab so a late disconnect cannot stop a new popup.
export function createDiscoveryIntent({start,stop,renew,intervalMs=5000,setTimer=setInterval,clearTimer=clearInterval}){
  const tabs=new Map();
  const valid=tabId=>Number.isInteger(tabId)&&tabId>=0;
  const enqueue=(state,fn)=>{const task=state.queue.catch(()=>{}).then(fn);state.queue=task.catch(()=>{});return task;};
  const acquire=tabId=>{
    if(!valid(tabId))return {ready:Promise.resolve(),release:async()=>{}};
    let state=tabs.get(tabId);
    if(!state){state={tabId,holders:new Set(),queue:Promise.resolve(),running:false,timer:null};tabs.set(tabId,state);}
    const token={};state.holders.add(token);
    const ready=enqueue(state,async()=>{
      if(!state.holders.size||tabs.get(tabId)!==state)return;
      if(!state.running){state.running=true;try{await start(tabId);}catch(error){await stop(tabId).catch(()=>{});state.running=false;throw error;}}
      if(state.timer==null)state.timer=setTimer(()=>{
        if(!state.holders.size||state.renewPending)return;
        state.renewPending=true;
        void enqueue(state,async()=>{if(state.running&&state.holders.size)await renew(tabId);}).catch(()=>{}).finally(()=>{state.renewPending=false;});
      },intervalMs);
    });
    const release=()=>{
      if(!state.holders.delete(token))return state.queue;
      if(state.holders.size)return state.queue;
      if(state.timer!=null){clearTimer(state.timer);state.timer=null;}
      return enqueue(state,async()=>{
        if(state.holders.size)return;
        try{if(state.running)await stop(tabId);}finally{state.running=false;if(!state.holders.size&&tabs.get(tabId)===state)tabs.delete(tabId);}
      });
    };
    return {ready,release};
  };
  const run=async(tabId,operation)=>{const lease=acquire(tabId);try{await lease.ready;return await operation();}finally{await lease.release();}};
  const clear=async tabId=>{
    const state=tabs.get(tabId);if(!state)return;
    state.holders.clear();if(state.timer!=null){clearTimer(state.timer);state.timer=null;}
    await enqueue(state,async()=>{if(state.holders.size)return;try{if(state.running)await stop(tabId);}finally{state.running=false;if(!state.holders.size&&tabs.get(tabId)===state)tabs.delete(tabId);}});
  };
  const attach=(view,popupUrl)=>{
    if(view.sender?.url!==popupUrl)return;
    let closed=false,current=null,tabId=null;
    view.onMessage.addListener(message=>{
      if(closed||message?.action!=='observeMedia'||!valid(message.tabId)||tabId===message.tabId)return;
      const previous=current;tabId=message.tabId;current=acquire(tabId);
      void current.ready.catch(()=>{});void previous?.release().catch(()=>{});
    });
    view.onDisconnect.addListener(()=>{closed=true;void current?.release().catch(()=>{});current=null;});
  };
  return {acquire,run,attach,clear,clearAll:()=>Promise.all([...tabs.keys()].map(clear)),active:tabId=>!!tabs.get(tabId)?.holders.size};
}

// Read the browser's existing timing buffer only when invoked. These URLs are
// candidates, never evidence that a particular player owns a response.
export function existingMediaResources(){
  const pageUrl=location.href,items=[],seen=new Set();
  if(!/^https?:/i.test(pageUrl))return items;
  const records=performance.getEntriesByType('resource'),timeOrigin=Number(performance.timeOrigin),now=Date.now();
  for(let i=records.length-1;i>=Math.max(0,records.length-200)&&items.length<40;i--){
    const record=records[i],raw=record?.name,timeStamp=timeOrigin+Number(record?.startTime);
    if(typeof raw!=='string'||raw.length>16384||seen.has(raw)||!Number.isFinite(timeStamp)||timeStamp>now+1000||now-timeStamp>=120000)continue;
    try{
      const url=new URL(raw);
      if(!/^https?:$/.test(url.protocol)||url.username||url.password||!(/\.(?:m3u8|mpd|mp4|webm|m4v|mov)(?:[?#]|$)/i.test(url.href)))continue;
      seen.add(raw);items.push({url:url.href,pageUrl,timeStamp});
    }catch{}
  }
  return items.reverse();
}

export function renewPageObservation(){globalThis[Symbol.for('video-pocket.mediaObserver')]?.renew?.();}
export function stopPageObservation(){
  globalThis[Symbol.for('video-pocket.mediaObserver')]?.dispose?.();
  delete globalThis[Symbol.for('video-pocket.selection')];
}
