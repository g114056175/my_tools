import {startMediaPicker,cancelMediaPicker} from './media-picker.js';
import {stableHash} from './download-identity.js';

export const selectionStorageKey=tabId=>`mediaSelection:${tabId}`;
export function selectedMediaIndex(videos,selection,pageUrl){
  if(!selection || selection.pageToken!==stableHash(pageUrl))return -1;
  return videos.findIndex(video=>{
    const sameVod=String(video.mediaIdentity||'').startsWith('twitch-vod:')&&selection.modelToken===stableHash(video.mediaIdentity);
    return String(video.documentId ?? '')===String(selection.documentId ?? '') && Number(video.frameId)===Number(selection.frameId) && (sameVod||String(video.mediaKey)===String(selection.mediaKey)) && (!selection.modelToken || stableHash(video.mediaIdentity || '')===selection.modelToken) && (sameVod||!selection.sourceToken || stableHash(video.url || '')===selection.sourceToken);
  });
}

export function createMediaSelectionController(api){
  const active=new Map(),selectionWrites=new Map();
  const stop=async(tabId,requestId)=>{
    const current=active.get(tabId);
    if(current && (!requestId || current.requestId===requestId))active.delete(tabId);
    try{await api.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:cancelMediaPicker,args:[{requestId}]});}catch{}
  };
  const begin=async tabId=>{
    const requestId=crypto.randomUUID();
    const previous=active.get(tabId);
    // Claim the tab before any await. A second begin therefore invalidates
    // this request immediately; its late frame results cannot clear the new
    // request's badge or selection.
    active.set(tabId,{requestId,complete:false});
    if(previous)void stop(tabId,previous.requestId);
    let frames;
    try{frames=await api.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:()=>({url:location.href})});}
    catch(error){if(active.get(tabId)?.requestId===requestId)active.delete(tabId);throw error;}
    if(active.get(tabId)?.requestId!==requestId)return {started:false};
    const top=frames.find(frame=>frame.frameId===0);
    if(!top?.result?.url || !/^https?:/i.test(top.result.url)){active.delete(tabId);throw new Error('請在影片網頁使用選取功能');}
    void api.action?.setBadgeText({tabId,text:'◎'}).catch(()=>{});
    let remaining=frames.length;
    const finish=async(result,frame)=>{
      const current=active.get(tabId);
      if(!current || current.requestId!==requestId || current.complete)return;
      if(result?.requestId!==requestId || (result?.frameId!=null && Number(result.frameId)!==Number(frame.frameId)) || (result?.documentId!=null && String(result.documentId)!==String(frame.documentId)))result=null;
      if(result?.ok){
        current.complete=true;
        const selection={mediaKey:result.mediaKey,frameId:frame.frameId,documentId:frame.documentId,pageToken:stableHash(top.result.url),sourceToken:result.url?stableHash(result.url):null,modelToken:result.mediaIdentity?stableHash(result.mediaIdentity):null,time:Date.now()};
        // Do not let a previous request's awaited storage operation touch a
        // newer request. The request remains the owner until this write ends.
        if(active.get(tabId)?.requestId!==requestId)return;
        const write=(selectionWrites.get(tabId)||Promise.resolve()).catch(()=>{}).then(async()=>{if(active.get(tabId)?.requestId===requestId)await api.storage.session.set({[selectionStorageKey(tabId)]:selection});});selectionWrites.set(tabId,write);
        try{await write;}
        catch{
          // A rejected session write must release this request. Otherwise
          // current.complete leaves the picker permanently active and the
          // next popup cannot start a fresh selection.
          if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);if(!active.has(tabId))void api.action?.setBadgeText({tabId,text:''}).catch(()=>{});}
          return;
        }
        finally{if(selectionWrites.get(tabId)===write)selectionWrites.delete(tabId);}
        if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);if(!active.has(tabId))void api.action?.setBadgeText({tabId,text:'✓'}).catch(()=>{});}
      }else if(result?.reason==='cancelled'){
        current.complete=true;if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);if(!active.has(tabId))void api.action?.setBadgeText({tabId,text:''}).catch(()=>{});}
      }else if(--remaining===0 && active.get(tabId)?.requestId===requestId){active.delete(tabId);void api.action?.setBadgeText({tabId,text:''}).catch(()=>{});}
    };
    for(const frame of frames){
      void api.scripting.executeScript({target:{tabId,documentIds:[frame.documentId]},world:'MAIN',func:startMediaPicker,args:[{requestId,frameId:frame.frameId,documentId:frame.documentId,timeoutMs:30000}]}).then(results=>finish(results[0]?.result,frame)).catch(()=>finish(null,frame));
    }
    return {started:true};
  };
  const clear=async tabId=>{
    await stop(tabId);
    await selectionWrites.get(tabId)?.catch(()=>{});
    await api.storage.session.remove(selectionStorageKey(tabId));
  };
  return {begin,stop,clear};
}
