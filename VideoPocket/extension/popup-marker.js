import {highlightMedia} from './media-highlight.js';

// A marker belongs to one live popup port. Disconnect is handled by the
// service worker, because popup unload handlers cannot finish async cleanup.
export function createPopupMarkerController(api){
  const inject=(target,options)=>api.scripting.executeScript({target:{tabId:target.tabId,documentIds:[target.documentId]},world:'MAIN',func:highlightMedia,args:[options]});
  const remove=target=>target?inject(target,{clear:true,requestId:target.requestId}).catch(()=>{}):Promise.resolve();
  return {attach(view){
    if(view.sender?.url!==api.runtime.getURL('popup.html'))return;
    let closed=false,revision=0,current=null,queue=Promise.resolve();
    const pending=new Set();
    const enqueue=action=>{queue=queue.catch(()=>{}).then(action);return queue;};
    view.onMessage.addListener(message=>{
      if(closed)return;
      if(message?.action==='renewHighlight'){
        const target=current,turn=revision;
        if(target)void enqueue(async()=>{if(!closed&&turn===revision&&current===target)await inject(target,{renew:true,requestId:target.requestId}).catch(()=>{});});
        return;
      }
      if(message?.action!=='highlightMedia')return;
      const turn=++revision;
      const target=Number.isInteger(message.tabId)&&typeof message.documentId==='string'&&message.mediaKey!=null?{tabId:message.tabId,documentId:message.documentId,mediaKey:message.mediaKey,title:String(message.title||'').slice(0,200),scrollIntoView:message.scrollIntoView===true,requestId:crypto.randomUUID()}:null;
      void enqueue(async()=>{
        if(closed||turn!==revision)return;
        const previous=current;current=null;await remove(previous);
        if(closed||turn!==revision||!target)return;
        current=target;pending.add(target);
        try{await inject(target,{mediaKey:target.mediaKey,title:target.title,scrollIntoView:target.scrollIntoView,requestId:target.requestId});}
        catch{}
        finally{pending.delete(target);if(closed||turn!==revision)await remove(target);else if(typeof message.operationId==='string')try{view.postMessage?.({action:'highlightReady',operationId:message.operationId});}catch{}}
      });
    });
    view.onDisconnect.addListener(()=>{
      closed=true;revision++;
      const targets=new Set([...pending,...(current?[current]:[])]);current=null;
      for(const target of targets)void remove(target);
    });
  }};
}
