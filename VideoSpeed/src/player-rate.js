function parents(video){
 const result=[],seen=new Set();let node=video;
 while(node&&result.length<24&&!seen.has(node)){seen.add(node);result.push(node);node=node.parentElement||node.getRootNode?.()?.host;}
 return result;
}
function owns(owner,video){
 try{return owner===video||owner?.contains?.(video)===true;}catch{return false;}
}
function settle(result){if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});}
// Use a verified owner API so its own menu/state can follow the new speed.
// Unsupported values keep the HTMLMediaElement fallback; never fake menu text.
export function syncPlayerRate(video,rate,target=globalThis){
 if(!video||!Number.isFinite(rate)||rate<0.0625||rate>16)return {status:'invalid'};
 try{
  const owner=parents(video).find(node=>node!==video&&typeof node.setPlaybackRate==='function'&&owns(node,video));
  if(owner){
   const available=typeof owner.getAvailablePlaybackRates==='function'?owner.getAvailablePlaybackRates():null;
   if(Array.isArray(available)&&available.length&&!available.some(value=>Math.abs(Number(value)-rate)<1e-6))return {status:'unsupported-rate'};
   settle(owner.setPlaybackRate(rate));return {status:'requested',adapter:'player-api'};
  }
  const candidates=[video.player,video._player,target.player].filter(Boolean);
  for(const player of candidates){
   const media=player.getVideoElement?.()||player.getMediaElement?.()||player.media||player.video;
   if(media===video&&typeof player.setPlaybackRate==='function'){settle(player.setPlaybackRate(rate));return {status:'requested',adapter:'bound-player-api'};}
  }
 }catch{return {status:'failed'};}
 return {status:'unsupported'};
}
