/* GOP-aware VP9 boundary encoding. Original middle packets are never split. */
(function(root){
 'use strict';
 const M=root.VideoPocketMediabunny,disk=root.VideoPocketDiskMedia,active=new Set();
 const failure=message=>Object.assign(new Error(message),{code:'RANGE_SMART_UNSUPPORTED'});
 function check(signal){if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});}
 function target(access,signal){return new M.StreamTarget(new WritableStream({write(chunk){check(signal);if(access.write(chunk.data,{at:chunk.position})!==chunk.data.length)throw failure('Smart Cut 寫入不完整');}}),{chunked:true,chunkSize:1024*1024});}
 function sameConfig(a,b){
  const profile=c=>String(c?.codec||'').split('.').filter((_,i)=>i!==2).join('.');
  if(profile(a)!==profile(b)||Number(String(b?.codec||'').split('.')[2])>Number(String(a?.codec||'').split('.')[2])||a.codedWidth!==b.codedWidth||a.codedHeight!==b.codedHeight)return false;
  const bytes=v=>v==null?new Uint8Array():ArrayBuffer.isView(v)?new Uint8Array(v.buffer,v.byteOffset,v.byteLength):new Uint8Array(v);
  const aa=bytes(a.description),bb=bytes(b.description);
  if(aa.length!==bb.length||aa.some((v,i)=>v!==bb[i]))return false;
  for(const key of ['primaries','transfer','matrix','fullRange'])if(a.colorSpace?.[key]!=null&&b.colorSpace?.[key]!=null&&a.colorSpace[key]!==b.colorSpace[key])return false;
  return true;
 }
 async function plan(track,start,end){
  if(await track.getCodec()!=='vp9')return null;
  if(await track.canBeTransparent?.())return null;
  const config=await track.getDecoderConfig();
  if(!/^vp09\.00\.[\d]{2}\.08(?:\.|$)/.test(config?.codec||''))return null;
  if(await track.getSquarePixelWidth()!==config.codedWidth||await track.getSquarePixelHeight()!==config.codedHeight)return null;
  const sink=new M.EncodedPacketSink(track);let key=await sink.getKeyPacket(start,{verifyKeyPackets:true})||await sink.getFirstKeyPacket({verifyKeyPackets:true});
  if(!key)return null;
  if(Math.abs(key.timestamp-start)<1e-5)return null; // Existing stream-copy path is already optimal.
  if(key.timestamp<start)key=await sink.getNextKeyPacket(key,{verifyKeyPackets:true});
  if(!key||key.timestamp<=start||key.timestamp>=end-.1)return null;
  return {sink,key,config,start,end,prefixDuration:key.timestamp-start};
 }
 async function convert(input,scope,name,paths,options,signal,onProgress){
  check(signal);const writer=await disk.createSyncMediaFile(scope,name);paths.push(writer.path);let conversion,finished=false;
  try{
   const output=new M.Output({format:new M.MkvOutputFormat(),target:target(writer.access,signal)});
   conversion=await M.Conversion.init({input,output,...options,showWarnings:false});
   if(!conversion.isValid||conversion.discardedTracks.some(t=>t.reason!=='discarded_by_user'))throw failure('瀏覽器無法處理 Smart Cut 邊界');
   active.add(conversion);conversion.onProgress=p=>{check(signal);onProgress(p);};await conversion.execute();check(signal);finished=true;return writer.finish();
  }finally{active.delete(conversion);if(!finished){await conversion?.cancel().catch(()=>{});writer.abort();}}
 }
 async function tryCut({input,start,end,output,scope,kind,expectedAudio,signal,onProgress=()=>{}}){
  if(kind!=='video'||!['webm','mkv'].includes(output.split('.').pop().toLowerCase()))return null;
  const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();if(!video)return null;
  const selection=await plan(video,start,end);if(!selection)return null;
  const paths=[],readers=[],report=onProgress;let writer,result,completed=false,lastProgress=0;
  onProgress=value=>{if(Date.now()-lastProgress>100||value>=1){lastProgress=Date.now();report(value);}};
  try{
   const {config,key,sink}=selection,quality=new M.Quality({quality:'high',preferBitrate:true});
   const encode={codec:'vp9',quality,forceTranscode:true};
   if(await M.canEncodeVideo('vp9',{width:config.codedWidth,height:config.codedHeight,quality,hardwareAcceleration:'prefer-hardware'}))encode.hardwareAcceleration='prefer-hardware';
   const prefix=await convert(input,scope,'smart-head.mkv',paths,{trim:{start,end:key.timestamp},video:encode,audio:{discard:true}},signal,p=>onProgress(p*.75));
   const open=async path=>{const reader=new M.Input({source:new M.BlobSource(await disk.readMediaFile(path)),formats:[M.MATROSKA]});readers.push(reader);return reader;};
   const prefixInput=await open(prefix.path),prefixTrack=await prefixInput.getPrimaryVideoTrack();
   if(!prefixTrack||!sameConfig(config,await prefixTrack.getDecoderConfig()))throw failure('邊界編碼與原始影片參數不相容');
   let audioTrack;
   if(audio){
    const audioResult=await convert(input,scope,'smart-audio.mkv',paths,{trim:{start,end:end+1e-6},video:{discard:true},audio:{},copy:{mode:'preferred',shiftTolerance:0,boundaryPolicy:'shrink',boundaryTolerance:.05}},signal,()=>{});
    audioTrack=await(await open(audioResult.path)).getPrimaryAudioTrack();
   }
   if(expectedAudio&&!audioTrack)throw failure('Smart Cut 輸出缺少音軌');
   check(signal);writer=await disk.createSyncMediaFile(scope,output);paths.push(writer.path);
   const destination=new M.Output({format:output.endsWith('.webm')?new M.WebMOutputFormat():new M.MkvOutputFormat(),target:target(writer.access,signal)});
   const videoSource=new M.EncodedVideoPacketSource('vp9');destination.addVideoTrack(videoSource,{decoderConfig:config});
   const audioConfig=audioTrack&&await audioTrack.getDecoderConfig(),audioSource=audioTrack&&new M.EncodedAudioPacketSource(await audioTrack.getCodec());
   if(audioSource)destination.addAudioTrack(audioSource,{decoderConfig:audioConfig});
   await destination.start();let copiedPackets=0,copiedBytes=0,prefixPackets=0;
   try{let pumpFailure;
    const settled=await Promise.allSettled([
     (async()=>{try{
      let last=-Infinity;
      const append=async(packet,timestamp,duration)=>{
       check(signal);if(pumpFailure)throw pumpFailure;
       if(timestamp<last-1e-6||timestamp<-.001)throw failure('Smart Cut 不支援此影片的畫格重排');
       if(duration<=0)throw failure('來源缺少可靠的畫格時間');last=timestamp;
       await videoSource.add(packet.clone({timestamp:Math.max(0,timestamp),duration}),{decoderConfig:config});
      };
      const prefixSink=new M.EncodedPacketSink(prefixTrack);
      for await(const packet of prefixSink.packets()){
       if(packet.timestamp>=key.timestamp-start-1e-6)break;
       const next=packet.duration>0?null:await prefixSink.getNextPacket(packet),duration=packet.duration||((next?.timestamp??key.timestamp-start)-packet.timestamp);
       await append(packet,packet.timestamp,Math.min(duration,key.timestamp-start-packet.timestamp));prefixPackets++;
      }
      if(!prefixPackets)throw failure('邊界沒有可用影格');
      // Copy whole demux packets, including intact VP9 superframes. A verified
      // source key packet resets reference state after the re-encoded prefix.
      for await(const packet of sink.packets(key)){
       if(packet.timestamp>=end-1e-6)break;
       const next=packet.duration>0?null:await sink.getNextPacket(packet),duration=packet.duration||((next?.timestamp??end)-packet.timestamp);
       await append(packet,packet.timestamp-start,Math.min(duration,end-packet.timestamp));copiedPackets++;copiedBytes+=packet.data.length;
       onProgress(.75+.25*(packet.timestamp-key.timestamp)/(end-key.timestamp));
      }
     }catch(error){pumpFailure ||= error;throw error;}finally{videoSource.close();}})(),
     (async()=>{if(!audioSource)return;try{for await(const packet of new M.EncodedPacketSink(audioTrack).packets()){check(signal);if(pumpFailure)throw pumpFailure;await audioSource.add(packet,{decoderConfig:audioConfig});}}catch(error){pumpFailure ||= error;throw error;}finally{audioSource.close();}})()
    ]);
    const rejected=settled.find(x=>x.status==='rejected');if(rejected)throw rejected.reason;
    if(!copiedPackets)throw failure('Smart Cut 沒有可直接複製的影片區段');
    await destination.finalize();
   }catch(error){await destination.cancel().catch(()=>{});throw error;}
   result=writer.finish();writer=null;completed=true;onProgress(1);
   return {result,stats:{strategy:'smart-vp9',encodedSeconds:selection.prefixDuration,copiedSeconds:end-key.timestamp,prefixPackets,copiedPackets,copiedBytes,hardwareRequested:encode.hardwareAcceleration==='prefer-hardware'}};
  }finally{writer?.abort();for(const reader of readers)reader.dispose();for(const path of paths)if(!completed||path!==result.path)await disk.removeMediaFile(path).catch(()=>{});}
 }
 root.VideoPocketRangeSmart={plan,sameConfig,tryCut,cancel(){for(const conversion of active)void conversion.cancel().catch(()=>{});}};
})(self);
