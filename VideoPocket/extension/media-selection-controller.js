import {startMediaPicker,cancelMediaPicker} from './media-picker.js';
import {stableHash} from './download-identity.js';

export const selectionStorageKey=tabId=>`mediaSelection:${tabId}`;
// Floating and normal Bilibili players represent one route video. Keep the
// visible representative while retaining element keys for an explicit picker.
export function collapseBilibiliPlayers(videos){
  const groups=new Map(),result=[];
  for(const video of videos){
    if(!video.bilibiliMain||!String(video.mediaIdentity||'').startsWith('bilibili:')){result.push(video);continue;}
    const key=JSON.stringify([video.frameId,video.documentId,video.mediaIdentity]),group=groups.get(key);
    if(!group){const item={...video,aliasMediaKeys:[video.mediaKey]};groups.set(key,item);result.push(item);continue;}
    const keys=[...group.aliasMediaKeys,video.mediaKey];
    if(Number(video.bilibiliRank)>Number(group.bilibiliRank))Object.assign(group,video);
    group.aliasMediaKeys=[...new Set(keys)];
  }
  return result;
}
export function recoverBilibiliRoute(videos,top,frame){
  const context=top?.bilibiliContext;
  if(!context||context.site!=='bilibili'||!context.bvid||!(Number(context.cid)>0))return videos;
  let url;try{url=new URL(top.url);}catch{return videos;}
  const id=url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || url.searchParams.get('bvid'),part=Math.max(1,Number(url.searchParams.get('p'))||1);
  if(!/(^|\.)bilibili\.com$/.test(url.hostname)||id!==context.bvid||part!==Number(context.page))return videos;
  const identity=`bilibili:${id}:${part}`;
  if(videos.some(v=>v.bilibiliMain&&v.mediaIdentity===identity))return videos;
  // This is the watch-page target, not a guessed association with an unknown
  // blob/ad element. Keep independently downloadable items available separately.
  const candidate={title:context.title,url:top.url,downloadUrl:top.url,referer:top.url,bilibiliMain:true,routeOnly:true,mediaIdentity:identity,mediaContentId:identity,mediaKey:'route:'+identity,frameId:frame?.frameId??0,documentId:frame?.documentId,localMediaIndex:0};
  return [candidate,...videos.filter(v=>v.downloadUrl||v.linkedMedia)];
}
export function selectedMediaIndex(videos,selection,pageUrl){
  if(!selection || selection.pageToken!==stableHash(pageUrl))return -1;
  return videos.findIndex(video=>{
    const sameVod=String(video.mediaIdentity||'').startsWith('twitch-vod:')&&selection.modelToken===stableHash(video.mediaIdentity);
    const sameBili=video.bilibiliMain&&String(video.mediaIdentity||'').startsWith('bilibili:')&&selection.modelToken===stableHash(video.mediaIdentity);
    const sameElement=String(video.mediaKey)===String(selection.mediaKey)||sameBili&&video.aliasMediaKeys?.some(key=>String(key)===String(selection.mediaKey));
    return String(video.documentId ?? '')===String(selection.documentId ?? '') && Number(video.frameId)===Number(selection.frameId) && (sameVod||sameBili||sameElement) && (!selection.modelToken || stableHash(video.mediaIdentity || '')===selection.modelToken) && (sameVod||sameBili||!selection.sourceToken || stableHash(video.url || '')===selection.sourceToken);
  });
}

export function createMediaSelectionController(api){
  const active=new Map(),selectionWrites=new Map(),latestRequests=new Map();
  const stop=async(tabId,requestId)=>{
    if(!requestId)latestRequests.delete(tabId);
    const current=active.get(tabId);
    if(current && (!requestId || current.requestId===requestId))active.delete(tabId);
    try{await api.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:cancelMediaPicker,args:[{requestId}]});}catch{}
  };
  const begin=async tabId=>{
    const requestId=crypto.randomUUID();
    latestRequests.set(tabId,requestId);
    const previous=active.get(tabId);
    // Claim the tab before any await. A second begin therefore invalidates
    // this request immediately; its late frame results cannot clear the new
    // request's selection.
    active.set(tabId,{requestId,complete:false});
    if(previous)void stop(tabId,previous.requestId);
    let frames;
    try{frames=await api.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:()=>({url:location.href})});}
    catch(error){if(active.get(tabId)?.requestId===requestId)active.delete(tabId);throw error;}
    if(active.get(tabId)?.requestId!==requestId)return {started:false};
    const top=frames.find(frame=>frame.frameId===0);
    if(!top?.result?.url || !/^https?:/i.test(top.result.url)){active.delete(tabId);throw new Error('請在影片網頁使用選取功能');}
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
          if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);}
          return;
        }
        finally{if(selectionWrites.get(tabId)===write)selectionWrites.delete(tabId);}
        if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);}
        await reopenPopupIfStillFocused(tabId,requestId,current);
      }else if(result?.reason==='cancelled'){
        current.complete=true;if(active.get(tabId)?.requestId===requestId){active.delete(tabId);await stop(tabId,requestId);}
      }else if(--remaining===0 && active.get(tabId)?.requestId===requestId)active.delete(tabId);
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
  const reopenPopupIfStillFocused=async(tabId,requestId,current)=>{
    if(!api.action?.openPopup||typeof api.tabs?.query!=='function'||typeof api.windows?.get!=='function'||current.opened||latestRequests.get(tabId)!==requestId)return;
    if(active.has(tabId))return;
    current.opened=true;active.set(tabId,current);
    try{
      const [tab]=await api.tabs.query({active:true,lastFocusedWindow:true});
      if(active.get(tabId)!==current||latestRequests.get(tabId)!==requestId||Number(tab?.id)!==Number(tabId))return;
      const window=await api.windows.get(tab.windowId);
      if(!window?.focused||active.get(tabId)!==current||latestRequests.get(tabId)!==requestId)return;
      await api.action.openPopup({windowId:tab.windowId});
    }catch{}finally{if(active.get(tabId)===current)active.delete(tabId);}
  };
  return {begin,stop,clear};
}
