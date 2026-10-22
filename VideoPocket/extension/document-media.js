import {networkHttpUrl,networkMediaKind} from './network-media.js';
import {mediaElementSource} from './media-evidence.js';
import {stableHash} from './download-identity.js';

const MAX_SCRIPTS=32,MAX_CANDIDATES=12;
const sourceOf=video=>video?.currentSrc || mediaElementSource(video);
function candidatesOf(models, sourcePrefix=''){
  const candidates=new Map();
  const add=(raw,declared,group)=>{
    const url=networkHttpUrl(raw);if(!url)return;
    const detected=networkMediaKind({url});
    if(detected==='audio')return;
    const kind=detected || (['hls','dash'].includes(declared)?declared:'');
    if(!['hls','dash','progressive'].includes(kind))return;
    const item={url,kind,sourceGroup:group};
    const previous=candidates.get(url);
    if(!previous)candidates.set(url,item);
    else if(previous.sourceGroup!==item.sourceGroup)candidates.set(url,{...previous,sourceGroup:null});
  };
  for(const [modelIndex,model] of (models || []).entries()){
    const group=stableHash(['document-model',sourcePrefix,modelIndex]);
    add(model.manifestUrl,model.manifestType,group);
    for(const version of model.versions || [])add(version.url,'',group);
    if(candidates.size>MAX_CANDIDATES)break;
  }
  return [...candidates.values()].slice(0,MAX_CANDIDATES+1);
}

// A live document's JSON is a source of hypotheses, not an element binding.
// Keep its original page/player/blob generation; a cached model pool alone
// cannot participate in this fallback. Actual media must be probed later.
export function createDocumentMediaCandidates(){
  const cache=new WeakMap(),diagnostics=new WeakMap(),plans=new Map(),scriptIds=new WeakMap();
  let nextScriptId=0;
  let context,entries=[],overflow=false,tokenPrefix,tokenNumber=0;
  const begin=(document,pageUrl,videos)=>{
    for(const [token,plan] of plans)if(Date.now()-plan.at>120000||!plan.player.deref())plans.delete(token);
    const players=videos || [...(document?.querySelectorAll?.('video') || [])];
    const player=players.length===1?players[0]:null;
    context={document,pageUrl,playerCount:players.length,player:player?new WeakRef(player):null,source:sourceOf(player)};
    entries=[];overflow=false;
  };
  const observe=(script,fingerprint,models)=>{
    if(!context)return;
    let entry=cache.get(script);
    if(!entry || entry.fingerprint!==fingerprint){
      if(!models)return;
      if(!scriptIds.has(script))scriptIds.set(script,++nextScriptId);
      const versions=candidatesOf(models,`${scriptIds.get(script)}:${fingerprint}`);
      entry={fingerprint,versions,hasModels:models.length>0,context:{...context},script:new WeakRef(script)};
      cache.set(script,entry);
    }else if(!entry.context.source&&context.source&&entry.context.document===context.document&&entry.context.pageUrl===context.pageUrl&&
        (entry.context.playerCount===0 || (entry.context.playerCount===1&&entry.context.player?.deref()===context.player?.deref()))){
      // The first load may not have assigned its blob yet. Bind that initial
      // transition once, never an old nonempty blob to a replacement video.
      entry.context={...context};
    }
    if(!entry.hasModels)return;
    if(entries.length>=MAX_SCRIPTS){overflow=true;return;}
    entries.push(entry);
  };
  const proposalFor=(video,{pageUrl,videos,hasIdentity=false}={})=>{
    const finish=(reason,versions=[])=>{
      diagnostics.set(video,{metadataCandidates:versions.length,metadataReason:reason});
      return {reason,versions,expectedDuration:Number(video.duration)};
    };
    if(video.mediaKeys)return finish('protected');
    if(hasIdentity)return finish('explicit-identity');
    const players=videos || [...(video.ownerDocument?.querySelectorAll?.('video') || [])];
    if(players.length!==1||players[0]!==video)return finish('multiple-players');
    if(!Number.isFinite(video.duration)||video.duration<=0)return finish('missing-duration');
    const source=sourceOf(video);
    if(!/^blob:/i.test(source || ''))return finish('not-blob');
    if(!context||context.document!==video.ownerDocument||context.pageUrl!==pageUrl||!entries.length)return finish('no-live-metadata');
    if(overflow)return finish('too-many-candidates');
    const eligible=entries.filter(entry=>{
      const original=entry.context,script=entry.script.deref();
      return script&&script.isConnected!==false&&original.document===video.ownerDocument&&original.pageUrl===pageUrl&&
        original.playerCount===1&&original.player?.deref()===video&&original.source===source;
    });
    if(!eligible.length)return finish('stale-metadata');
    const byUrl=new Map();
    for(const item of eligible.flatMap(entry=>entry.versions)) {
      const previous=byUrl.get(item.url);
      if(!previous)byUrl.set(item.url,item);
      else if(previous.sourceGroup!==item.sourceGroup)byUrl.set(item.url,{...previous,sourceGroup:null});
    }
    const versions=[...byUrl.values()];
    if(versions.length>MAX_CANDIDATES)return finish('too-many-candidates');
    if(!versions.length)return finish('unknown-source-kind');
    return {...finish('verification-required',versions),entries:eligible,source,pageUrl};
  };
  const planFor=(video,options)=>{
    const {entries,...plan}=proposalFor(video,options);
    if(entries){
      // getRandomValues is also available on ordinary HTTP pages.
      tokenPrefix ||= [...crypto.getRandomValues(new Uint32Array(4))].map(value=>value.toString(36)).join('-');
      const token=tokenPrefix+'-'+(++tokenNumber);
      plans.set(token,{...plan,entries,player:new WeakRef(video),at:Date.now()});
      while(plans.size>16)plans.delete(plans.keys().next().value);
      const bindingKey=stableHash([plan.pageUrl,plan.source,plan.versions]);
      return {reason:plan.reason,versions:plan.versions,expectedDuration:plan.expectedDuration,token,bindingKey};
    }
    return plan;
  };
  const validate=(token,video,options)=>{
    const original=plans.get(token);
    if(!original||Date.now()-original.at>120000||original.player.deref()!==video||video.isConnected===false)return false;
    const current=proposalFor(video,options);
    return !!current.entries&&original.source===current.source&&original.pageUrl===current.pageUrl&&
      Math.abs(original.expectedDuration-current.expectedDuration)<0.1&&original.entries.length===current.entries.length&&
      original.entries.every((entry,index)=>entry===current.entries[index]);
  };
  return {begin,observe,planFor,validate,diagnosticsFor:video=>diagnostics.get(video) || {}};
}

// Serialized into the same MAIN-world document before and after probing.
// Only return a boolean; page URLs, blob IDs and JSON remain in that page.
export function validateDocumentMediaPlan({token,mediaKey}={}){
  const observer=window[Symbol.for('video-pocket.mediaObserver')],keys=window[Symbol.for('video-pocket.identities')]?.keys;
  if(!observer?.validateMetadataPlan||!keys||typeof token!=='string')return {valid:false};
  const roots=[document];for(let i=0;i<roots.length;i++)for(const node of roots[i].querySelectorAll('*'))if(node.shadowRoot)roots.push(node.shadowRoot);
  const raw=roots.flatMap(root=>[...root.querySelectorAll('video')]),available=new Set(raw);
  const videos=[...new Set(raw.map(video=>{const active=observer.canonicalVideo?.(video);return available.has(active)?active:video;}))];
  const video=videos.find(item=>keys.get(item)===mediaKey);
  return {valid:!!video&&observer.validateMetadataPlan(token,video,videos)};
}
