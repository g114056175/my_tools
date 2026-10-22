import {verifiedNetworkSource} from './network-source.js';
import {networkHttpUrl} from './network-media.js';
import {classifyFailure} from './diagnostics.js';

// Keep the first (often already playing) source, then prioritize distinct
// higher qualities before filling remaining slots with same-quality backups.
// This bound applies to known versions of one media item, not unbound URLs.
export function prioritizeMediaVersions(versions=[],limit=6){
 const byUrl=new Map();for(const item of versions)if(networkHttpUrl(item?.url)&&!byUrl.has(item.url))byUrl.set(item.url,item);
 const unique=[...byUrl.values()];
 if(!unique.length)return [];
 const height=item=>Number.isFinite(Number(item.height))&&Number(item.height)>0?Number(item.height):0;
 const quality=item=>height(item)?`${Number(item.width)||0}x${height(item)}`:item.url;
 const first=unique.shift(),primary=[first],backup=[],seen=new Set([quality(first)]);
 unique.sort((a,b)=>height(b)-height(a));
 for(const item of unique){const key=quality(item);if(seen.has(key))backup.push(item);else{primary.push(item);seen.add(key);}}
 return [...primary,...backup].slice(0,limit);
}

function scopeOf(value) {
 const group=value?.candidateGroup;
 const scope=group?.scope || value?.scope || {};
 const keys=['tabId','frameId','documentId'];
 if (!Number.isInteger(scope?.tabId) || scope.tabId<0 || !Number.isInteger(scope?.frameId) || scope.frameId<0 || typeof scope.documentId!=='string' || !scope.documentId) return null;
 return Object.fromEntries(keys.map(key=>[key,scope[key]]));
}

// A group is an identity assertion supplied by the player/manifest resolver.
// URL shape, duration and dimensions intentionally never participate here.
function groupOf(value) {
 const raw=value?.candidateGroup;
 if (!raw || (raw.kind!=='manifest' && raw.kind!=='player') || raw.id == null || raw.id === '') return null;
 const scope=scopeOf(value);
 const completeScope=scope && Number.isInteger(scope.tabId) && scope.tabId>=0 && Number.isInteger(scope.frameId) && scope.frameId>=0 && typeof scope.documentId==='string' && scope.documentId.length>0;
 // A manifest group must identify the complete master playlist, or carry a
 // complete browser scope proving where that playlist came from.
 if (raw.kind==='manifest' && !completeScope && !networkHttpUrl(raw.id)) return null;
 if (raw.kind==='player' && !completeScope) return null;
 return {kind:raw.kind,id:String(raw.id),scope:scope || null};
}

function sameGroup(a,b) {
 if (!a || !b || a.kind!==b.kind || a.id!==b.id) return false;
 // Player IDs are meaningful only inside one browser scope. Missing scope is
 // deliberately not treated as equal to an observed scope.
 if (a.kind==='player' || !networkHttpUrl(a.id)) {
  if (!a.scope || !b.scope) return false;
  return ['tabId','frameId','documentId'].every(key=>a.scope[key]===b.scope[key]);
 }
 return true;
}

function mergeSources(sources) {
 const merged=[],seen=new Set();
 for (const [sourceIndex,source] of sources.entries()) {
  const items=Array.isArray(source?.formats)?source.formats:[];
  const ids=[...new Set(items.map(format=>format?.audioGroup).filter(value=>value != null).map(String))];
  const groupIds=new Map(ids.map(id=>[id,`${sourceIndex}:${id}`]));
  for (const original of items) {
   const format={...original};
   if (format.audioGroup != null && groupIds.has(String(format.audioGroup))) format.audioGroup=groupIds.get(String(format.audioGroup));
   if (format.id != null) format.id=`${sourceIndex}:${String(format.id)}`;
   const url=networkHttpUrl(format?.url || format?.videoUrl || format?.audioUrl) || String(format?.url || format?.videoUrl || format?.audioUrl || '');
   const kind=String(format?.kind || '');
   const key=`${kind}|${url}|${format?.videoCodec || ''}|${format?.audioCodec || ''}|${format?.audioGroupId || format?.audioGroup || ''}`;
   if (!seen.has(key)) { seen.add(key); merged.push(format); }
  }
 }
 return {formats:merged};
}

// Unbound URLs are only hints. Probe a bounded scope and require one verified
// match; do not assume a frame's last request belongs to the selected player.
export async function resolveNetworkCandidates(platform,{signal,probe,timeoutMs=8000,totalTimeoutMs=12000,maxCandidates=12}={}) {
  const versions=(platform?.versions || []).filter(v=>networkHttpUrl(v?.url)&&(!v.kind||['hls','dash','progressive'].includes(v.kind)));
  const candidates=prioritizeMediaVersions(versions,Math.max(1,Math.min(Number(maxCandidates)||12,12))).map(v=>({...v,kind:v.kind || 'progressive'}));
  const verified=[],batch=new AbortController();let cursor=0,firstError,fatal,readable=false,deadlineExceeded=false;
  const deadline=Date.now()+Math.max(1,Math.min(Number(totalTimeoutMs)||12000,30000));
  await Promise.all(Array.from({length:Math.min(2,candidates.length)},async()=>{
    while(cursor<candidates.length&&!fatal){
      const remaining=deadline-Date.now();if(remaining<=0){deadlineExceeded=true;break;}
      signal?.throwIfAborted();const variant=candidates[cursor++];
      const probeSignal=AbortSignal.any([batch.signal,...(signal?[signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(timeoutMs,remaining)))]);
      try{
        const candidate=await probe(variant,probeSignal);probeSignal.throwIfAborted();readable=true;
        if(verifiedNetworkSource(candidate,platform.expectedDuration))verified.push({variant,source:candidate});
      }catch(error){
        signal?.throwIfAborted();
        if (Date.now() >= deadline) deadlineExceeded=true;
        if(classifyFailure(error).code==='DRM_UNSUPPORTED'){fatal ||= error;batch.abort(error);}
        firstError ||= error;
      }
    }
  }));
  signal?.throwIfAborted();if(fatal)throw fatal;
  const groups=verified.map(item=>({source:item.source,variant:item.variant,group:groupOf(item.variant)||groupOf(item.source)}));
  let selected;
  if (groups.length===1) selected=groups[0].source;
  else if (groups.length>1 && groups.every(entry=>sameGroup(entry.group,groups[0].group))) {
    selected={...groups[0].source,...mergeSources(groups.map(entry=>entry.source))};
  }
  const allSameTrustedGroup=groups.length>0 && groups.every(entry=>sameGroup(entry.group,groups[0].group)) &&
    candidates.every(candidate=>sameGroup(groupOf(candidate),groups[0].group));
  if(deadlineExceeded && !allSameTrustedGroup) selected=null;
  if(!selected){
    if(!verified.length&&!readable&&firstError)throw firstError;
    throw Object.assign(new Error('網路來源無法唯一對應目前影片'),{code:'SOURCE_UNAVAILABLE'});
  }
  return {...selected,requiresAudio:true};
}
