import {verifiedNetworkSource} from './network-source.js';
import {networkHttpUrl} from './network-media.js';
import {classifyFailure} from './diagnostics.js';

// Unbound URLs are only hints. Probe a bounded scope and require one verified
// match; do not assume a frame's last request belongs to the selected player.
export async function resolveNetworkCandidates(platform,{signal,probe,timeoutMs=8000}={}) {
  const candidates=[...new Map((platform?.versions || []).filter(v=>networkHttpUrl(v.url)&&(!v.kind||['hls','dash','progressive'].includes(v.kind))).map(v=>[v.url,{...v,kind:v.kind || 'progressive'}])).values()].slice(0,6);
  const verified=[],batch=new AbortController();let cursor=0,firstError,fatal,readable=false;
  await Promise.all(Array.from({length:Math.min(2,candidates.length)},async()=>{
    while(cursor<candidates.length&&!fatal){
      signal?.throwIfAborted();const variant=candidates[cursor++];
      const probeSignal=AbortSignal.any([batch.signal,...(signal?[signal]:[]),AbortSignal.timeout(timeoutMs)]);
      try{
        const candidate=await probe(variant,probeSignal);probeSignal.throwIfAborted();readable=true;
        if(verifiedNetworkSource(candidate,platform.expectedDuration))verified.push(candidate);
      }catch(error){
        signal?.throwIfAborted();
        if(classifyFailure(error).code==='DRM_UNSUPPORTED'){fatal ||= error;batch.abort(error);}
        firstError ||= error;
      }
    }
  }));
  signal?.throwIfAborted();if(fatal)throw fatal;
  if(verified.length!==1){
    if(!verified.length&&!readable&&firstError)throw firstError;
    throw Object.assign(new Error('網路來源無法唯一對應目前影片'),{code:'SOURCE_UNAVAILABLE'});
  }
  return {...verified[0],requiresAudio:true};
}
