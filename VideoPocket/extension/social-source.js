import {serviceForPage,serviceForCdn} from './social-sites.js';
import {networkMediaKind} from './network-media.js';
import {verifiedNetworkSource} from './network-source.js';

function resourceKey(raw){
  try{
    const u=new URL(raw);
    if(!/^https?:$/.test(u.protocol))return '';
    // Shared API endpoints need their explicit post identity; an opaque CDN
    // file path can be matched across the service's alternate CDN hosts.
    const ids=['video_id','videoId','item_id','aweme_id','id','vid','v'].map(k=>[k,u.searchParams.get(k)]).filter(([,value])=>String(value||'').trim());
    if(!ids.length){
      // A long shared API pathname is not a media identity. TikTok's opaque
      // CDN objects are the one known exception; Facebook CDN paths remain
      // eligible because their file/manifest paths are opaque by design.
      const service=serviceForCdn(raw);
      const host=u.hostname.toLowerCase();
      if(service==='tiktok'&&(!/\/video\/tos\//i.test(u.pathname)||!u.pathname.match(/\/video\/tos\/([^/].*)$/i)?.[1]))return '';
      const trustedFacebook=(host==='fbcdn.net'||host.endsWith('.fbcdn.net')||host==='fbsbx.com'||host.endsWith('.fbsbx.com'))&&u.pathname.length>=24;
      if(service==='facebook'&&!trustedFacebook)return '';
      if(service!=='facebook'&&service!=='tiktok')return '';
    }
    return serviceForCdn(raw)+':'+u.pathname+JSON.stringify(ids);
  }catch{return '';}
}

function mediaKind(record){
 const mime=String(record?.mime||'').split(';')[0].trim().toLowerCase();
 if(mime&&!/mpegurl|application\/dash\+xml|^video\/(?:mp4|webm|quicktime|x-matroska)$/.test(mime))return '';
 const kind=networkMediaKind({url:record?.url,mime});
 return kind==='audio'?'':kind;
}

function sameContext(page,record){
 const pageFull=Number.isInteger(page?.tabId)&&page.tabId>=0&&Number.isInteger(page?.frameId)&&page.frameId>=0&&typeof page?.documentId==='string'&&!!page.documentId;
 const recordFull=Number.isInteger(record?.tabId)&&record.tabId>=0&&Number.isInteger(record?.frameId)&&record.frameId>=0&&typeof record?.documentId==='string'&&!!record.documentId;
 if(recordFull!==pageFull)return false;
 for(const [field,valid] of [['tabId',Number.isInteger],['frameId',Number.isInteger],['documentId',value=>typeof value==='string'&&!!value]]){
  if(valid(record?.[field])&&valid(page?.[field])&&record[field]!==page[field])return false;
 }
 return !recordFull|| (record.tabId===page.tabId&&record.frameId===page.frameId&&record.documentId===page.documentId);
}

// Called only after a fresh all-frame snapshot. Network observations are not
// enough to bind one of many social-feed videos without additional evidence.
export function attachSocialSources(page,records=[]){
 const service=serviceForPage(page?.url);
 if(!service||page.selectionExpired||page.media?.drm)return page;
 const selected=page.videos?.[page.mediaIndex || 0];if(!selected)return page;
 const known=[selected.downloadUrl,selected.url,page.platform?.manifestUrl,...(page.platform?.versions || []).map(v=>v.url)].filter(u=>serviceForCdn(u)===service);
 const keys=new Set(known.map(resourceKey).filter(Boolean));
 const candidates=[...new Map(records.filter(r=>r.service===service&&mediaKind(r)&&(!r.method||r.method==='GET')&&sameContext(page,r)).sort((a,b)=>b.time-a.time).map(r=>[r.url,r])).values()];
 const matched=candidates.filter(r=>known.includes(r.url)||known.includes(r.originalUrl)||keys.has(resourceKey(r.url)));
 if(matched.length){
   const platform={...(page.platform || {}),site:'embedded',networkService:service};
   const manifest=matched.find(r=>mediaKind(r)!=='progressive');
   if(manifest){platform.manifestUrl=manifest.url;platform.manifestType=mediaKind(manifest);delete platform.manifestXml;}
   platform.versions=[...matched.filter(r=>mediaKind(r)==='progressive').map(r=>({url:r.url})),...(platform.versions || [])].filter((v,i,all)=>all.findIndex(x=>x.url===v.url)===i).slice(0,32);
   return {...page,platform};
 }
 // A single-player page may expose no metadata at all. Probe observed media
 // and verify actual duration before presenting it; never assume a feed's
 // last media request belongs to whichever element the user selected.
 const local=candidates.slice(0,20);
 const pageFull=Number.isInteger(page.tabId)&&page.tabId>=0&&Number.isInteger(page.frameId)&&page.frameId>=0&&typeof page.documentId==='string'&&!!page.documentId;
 if(!page.platform&&pageFull&&page.videos.length===1&&Number(page.media?.duration)>0&&local.length){
   return {...page,platform:{site:'social-network',networkService:service,expectedDuration:Number(page.media.duration),versions:local.slice(0,6).map(r=>({url:r.url,kind:mediaKind(r)}))}};
 }
 return page;
}

export function verifiedSocialSource(source,expectedDuration){
 return verifiedNetworkSource(source,expectedDuration);
}
