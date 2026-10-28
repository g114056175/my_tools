/* AVC boundary encoding with explicit avc3 parameter-set changes at IDR joins.
 * The copied GOPs keep their original decode order and presentation timestamps.
 * Unsupported profiles/configurations are left to the ordinary precise cutter.
 */
(function(root){
 'use strict';
 const M=root.VideoPocketMediabunny,disk=root.VideoPocketDiskMedia,active=new Set();
 const unsupported=message=>Object.assign(new Error(message),{code:'RANGE_SMART_UNSUPPORTED'});
 const check=signal=>{if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});};
 const bytes=value=>ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):new Uint8Array(value || 0);
 function configuration(value){
  const data=bytes(value);if(data.length<7||data.length>65536||data[0]!==1)throw unsupported('H.264 缺少有效設定');
  const sets=[],lengthSize=(data[4]&3)+1;let at=6;
  const read=count=>{if(!count)throw unsupported('H.264 缺少參數集');for(let i=0;i<count;i++){
   if(at+2>data.length)throw unsupported('H.264 設定截斷');const size=data[at]*256+data[at+1];at+=2;
   if(!size||at+size>data.length)throw unsupported('H.264 參數集截斷');sets.push(data.slice(at,at+size));at+=size;
  }};
  read(data[5]&31);if(at>=data.length)throw unsupported('H.264 缺少 PPS');read(data[at++]);
  if(!sets.some(n=>(n[0]&31)===7)||!sets.some(n=>(n[0]&31)===8))throw unsupported('H.264 參數集類型無效');
  const description=data.slice();description[4]=(description[4]&252)|3;
  return {data,description,lengthSize,sets,profile:data[1],level:data[3]};
 }
 function units(data,lengthSize){
  const result=[];for(let at=0;at<data.length;){
   if(at+lengthSize>data.length)throw unsupported('H.264 畫格截斷');let size=0;
   for(let n=0;n<lengthSize;n++)size=size*256+data[at++];
   if(!size||size>data.length-at)throw unsupported('H.264 畫格長度無效');
   result.push(data.subarray(at,at+size));at+=size;if(result.length>4096)throw unsupported('H.264 畫格單元過多');
  }return result;
 }
 const isIdr=(packet,config)=>packet?.type==='key'&&units(packet.data,config.lengthSize).some(n=>(n[0]&31)===5);
 function packetData(packet,config,insert){
  const payload=units(packet.data,config.lengthSize),all=insert?[...config.sets,...payload]:payload;
  const out=new Uint8Array(all.reduce((n,b)=>n+4+b.length,0));let at=0;
  for(const nal of all){const n=nal.length;out[at++]=n>>>24;out[at++]=n>>>16;out[at++]=n>>>8;out[at++]=n;out.set(nal,at);at+=n;}return out;
 }
 function compatible(a,b){
  if(a.codedWidth!==b.codedWidth||a.codedHeight!==b.codedHeight)return false;
  const aa=configuration(a.description),bb=configuration(b.description);
  // Some hardware encoders raise the requested level (e.g. 3.1 -> 3.2).
  // The output advertises the head's higher level, which also covers the source.
  if(aa.profile!==bb.profile||aa.data[2]!==bb.data[2]||bb.level<aa.level||bb.level>52)return false;
  for(const key of ['primaries','transfer','matrix','fullRange'])if(a.colorSpace?.[key]!=null&&b.colorSpace?.[key]!=null&&a.colorSpace[key]!==b.colorSpace[key])return false;
  return true;
 }
 async function transformationMetadata(track){
  if(typeof track?.getTransformationMatrix!=='function')return {rotation:await track?.getRotation?.()??0,flip:await track?.getFlip?.()??false};
  let value;try{value=await track.getTransformationMatrix();}catch{throw unsupported('無法讀取 H.264 影片顯示變形');}
  const matrix=Array.from(value||[]);
  if(matrix.length!==9||matrix.some(number=>!Number.isFinite(number)))throw unsupported('H.264 影片顯示變形格式無效');
  return {transformationMatrix:matrix};
 }
 async function plan(track,start,end){
  if(await track.getCodec()!=='avc'||await track.canBeTransparent?.())return null;
  const config=await track.getDecoderConfig();if(!/^avc1\.[0-9a-f]{6}$/i.test(config?.codec||'')||!config.description)return null;
  const avc=configuration(config.description);
  if(![66,77,100].includes(avc.profile)||avc.level>52||avc.lengthSize===3)return null;
  if(await track.getSquarePixelWidth()!==config.codedWidth||await track.getSquarePixelHeight()!==config.codedHeight||config.codedWidth%2||config.codedHeight%2)return null;
  const sink=new M.EncodedPacketSink(track);let key=await sink.getKeyPacket(start,{verifyKeyPackets:true});
  if(!key||Math.abs(key.timestamp-start)<1e-5)return null;
  if(key.timestamp<start)key=await sink.getNextKeyPacket(key,{verifyKeyPackets:true});
  if(!key||!isIdr(key,avc))return null;
  const prefixDuration=key.timestamp-start,duration=end-start;
  const tailKey=await sink.getKeyPacket(end,{verifyKeyPackets:true});
  if(!tailKey||!isIdr(tailKey,avc)||tailKey.timestamp<key.timestamp)return null;
  const tailDuration=Math.max(0,end-tailKey.timestamp),encoded=prefixDuration+tailDuration;
  if(prefixDuration<=0||duration-encoded<1||encoded>duration*.6)return null;
  return {config,avc,sink,key,last:tailKey,prefixDuration,tailDuration};
 }
 const target=(access,signal)=>new M.StreamTarget(new WritableStream({write(chunk){check(signal);if(access.write(chunk.data,{at:chunk.position})!==chunk.data.length)throw unsupported('H.264 寫入不完整');}}),{chunked:true,chunkSize:1024*1024});
 async function convert(input,scope,name,paths,options,signal,progress){
  const writer=await disk.createSyncMediaFile(scope,name);paths.push(writer.path);let conversion,finished=false;
  try{
   const output=new M.Output({format:new M.MkvOutputFormat(),target:target(writer.access,signal)});
   conversion=await M.Conversion.init({input,output,...options,showWarnings:false});
   if(!conversion.isValid||conversion.discardedTracks.some(t=>t.reason!=='discarded_by_user'))throw unsupported('H.264 邊界編碼不可用');
   active.add(conversion);conversion.onProgress=p=>{check(signal);progress(p);};await conversion.execute();check(signal);finished=true;return writer.finish();
  }finally{active.delete(conversion);if(!finished){await conversion?.cancel().catch(()=>{});await Promise.resolve(writer.abort?.()).catch(()=>{});}}
 }
 async function encodePrefix(track,start,end,encode,scope,paths,signal,progress,name='avc-head.mkv'){
  // Conversion's high-level options do not forward fullCodecString. Use the
  // sample encoder directly so the copied GOPs retain the requested AVC profile.
  const writer=await disk.createSyncMediaFile(scope,name);paths.push(writer.path);
  const output=new M.Output({format:new M.MkvOutputFormat(),target:target(writer.access,signal)});
  const source=new M.VideoSampleSource(encode);output.addVideoTrack(source);let finished=false,count=0;
  active.add(output);
  try{await output.start();
   for await(const sample of new M.VideoSampleSink(track).samples(start,end)){
    try{check(signal);const from=Math.max(start,sample.timestamp),to=Math.min(end,sample.timestamp+sample.duration);
     if(to-from<=1e-6)continue;sample.setTimestamp(from-start);sample.setDuration(to-from);
     await source.add(sample,{keyFrame:count===0});count++;progress((to-start)/(end-start));
    }finally{sample.close();}
   }
   if(!count)throw unsupported('H.264 邊界沒有影格');source.close();await output.finalize();check(signal);finished=true;return writer.finish();
  }finally{active.delete(output);if(!finished){await output.cancel().catch(()=>{});await Promise.resolve(writer.abort?.()).catch(()=>{});}}
 }
 async function tryCut({input,start,end,output,scope,kind,expectedAudio,signal,onProgress=()=>{},videoTransform}){
  if(kind!=='video'||!String(output).toLowerCase().endsWith('.mp4'))return null;
  const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();if(!video||expectedAudio&&!audio)return null;
  const selection=await plan(video,start,end);if(!selection)return null;
  const {config,avc,sink,key,last,prefixDuration,tailDuration}=selection,quality=new M.Quality({quality:'high',preferBitrate:true});
  const encode={codec:'avc',fullCodecString:config.codec,quality,forceTranscode:true};
  let supported=false;for(const preference of ['prefer-hardware','no-preference']){
   if(await M.canEncodeVideo('avc',{width:config.codedWidth,height:config.codedHeight,quality,fullCodecString:config.codec,hardwareAcceleration:preference})){encode.hardwareAcceleration=preference;supported=true;break;}
  }
  if(!supported)return null;
  const paths=[],readers=[];let writer,result,completed=false;
  const open=async path=>{const reader=new M.Input({source:new M.BlobSource(await disk.readMediaFile(path)),formats:[M.MATROSKA]});readers.push(reader);return reader;};
  try{
   check(signal);
   const prefix=await encodePrefix(video,start,key.timestamp,encode,scope,paths,signal,p=>onProgress(p*.35));
   const head=await (await open(prefix.path)).getPrimaryVideoTrack(),headConfig=await head.getDecoderConfig();
   if(!compatible(config,headConfig))throw unsupported('H.264 邊界參數不相容');
   const headAvc=configuration(headConfig.description),headSink=new M.EncodedPacketSink(head),headFirst=await headSink.getFirstPacket();
   if(!isIdr(headFirst,headAvc)||Math.abs(headFirst.timestamp)>.05)throw unsupported('H.264 邊界未從 IDR 開始');
   let tailSink,tailAvc;
   if(tailDuration>1e-6){
    const tail=await encodePrefix(video,last.timestamp,end,encode,scope,paths,signal,p=>onProgress(.35+p*.3),'avc-tail.mkv');
    const track=await(await open(tail.path)).getPrimaryVideoTrack(),tailConfig=await track.getDecoderConfig();
    if(!compatible(tailConfig,headConfig))throw unsupported('H.264 尾端參數不相容');
    tailAvc=configuration(tailConfig.description);tailSink=new M.EncodedPacketSink(track);
    if(!isIdr(await tailSink.getFirstPacket(),tailAvc))throw unsupported('H.264 尾端未從 IDR 開始');
   }
   let audioTrack;
   if(audio){const clip=await convert(input,scope,'avc-audio.mkv',paths,{trim:{start:start+1e-6,end:end-1e-6},video:{discard:true},audio:{},copy:{mode:'preferred',shiftTolerance:0,boundaryPolicy:'shrink',boundaryTolerance:.05}},signal,()=>{});audioTrack=await(await open(clip.path)).getPrimaryAudioTrack();}
   if(expectedAudio&&!audioTrack)throw unsupported('H.264 區間缺少音軌');
   const transform=videoTransform?.matrix?{transformationMatrix:videoTransform.matrix.slice()}:await transformationMetadata(video);
   writer=await disk.createSyncMediaFile(scope,output);paths.push(writer.path);let moov;
   const destination=new M.Output({format:new M.Mp4OutputFormat({fastStart:false,onMoov(data,position){moov={data:new Uint8Array(data),position};}}),target:target(writer.access,signal)});
   const videoConfig={...headConfig,codec:headConfig.codec.replace(/^avc1/i,'avc3'),description:headAvc.description};
   const videoSource=new M.EncodedVideoPacketSource('avc');destination.addVideoTrack(videoSource,{decoderConfig:videoConfig,...transform});
   const audioConfig=audioTrack&&await audioTrack.getDecoderConfig(),audioSource=audioTrack&&new M.EncodedAudioPacketSource(await audioTrack.getCodec());
   if(audioSource)destination.addAudioTrack(audioSource,{decoderConfig:audioConfig});
   await destination.start();let copiedPackets=0,copiedBytes=0,prefixPackets=0,pumpFailure;
   try{
    const settled=await Promise.allSettled([
     (async()=>{try{
      for await(const packet of headSink.packets()){
       check(signal);if(pumpFailure)throw pumpFailure;
       if(packet.timestamp>=prefixDuration-1e-6)continue;
       const duration=Math.min(packet.duration,prefixDuration-packet.timestamp);if(duration<=1e-6)continue;
       await videoSource.add(packet.clone({data:packetData(packet,headAvc,packet.type==='key'),duration}),{decoderConfig:videoConfig});prefixPackets++;
      }
      for await(const packet of sink.packets(key,last)){
       check(signal);if(pumpFailure)throw pumpFailure;
       const timestamp=packet.timestamp-start;
       if(timestamp<prefixDuration-.00001)throw unsupported('H.264 IDR 接點包含較早畫格');
       // Every seekable IDR needs its own original parameter sets, not just the
       // first splice: decoders may start at any later GOP after a seek.
       await videoSource.add(packet.clone({data:packetData(packet,avc,packet.type==='key'),timestamp}),{decoderConfig:videoConfig});copiedPackets++;copiedBytes+=packet.data.length;
       onProgress(.65+.35*Math.min(1,Math.max(0,(packet.timestamp-key.timestamp)/(end-key.timestamp))));
      }
      if(tailSink)for await(const packet of tailSink.packets()){
       check(signal);if(pumpFailure)throw pumpFailure;
       const duration=Math.min(packet.duration,tailDuration-packet.timestamp);if(duration<=1e-6)continue;
       await videoSource.add(packet.clone({data:packetData(packet,tailAvc,packet.type==='key'),timestamp:packet.timestamp+last.timestamp-start,duration}),{decoderConfig:videoConfig});
      }
     }catch(error){pumpFailure ||= error;throw error;}finally{videoSource.close();}})(),
     (async()=>{if(!audioSource)return;try{for await(const packet of new M.EncodedPacketSink(audioTrack).packets()){check(signal);if(pumpFailure)throw pumpFailure;await audioSource.add(packet,{decoderConfig:audioConfig});}}catch(error){pumpFailure ||= error;throw error;}finally{audioSource.close();}})()
    ]);
    const rejected=settled.find(s=>s.status==='rejected');if(rejected)throw rejected.reason;
    if(!prefixPackets||!copiedPackets)throw unsupported('H.264 接合區段不完整');
    await destination.finalize();check(signal);
   }catch(error){await destination.cancel().catch(()=>{});throw error;}
   if(!moov||moov.position+moov.data.length!==writer.access.getSize())throw unsupported('H.264 MP4 索引位置不符');
   const capped=root.VideoPocketRangeMp4.capMovieDuration(moov.data,end-start);
   if(writer.access.write(capped.data,{at:moov.position})!==capped.data.length)throw unsupported('H.264 MP4 索引寫入不完整');
   writer.access.truncate(moov.position+capped.data.length);
   result=writer.finish();writer=null;completed=true;onProgress(1);
   return {result,stats:{strategy:'smart-h264',encodedSeconds:prefixDuration+tailDuration,copiedSeconds:last.timestamp-key.timestamp,splices:[prefixDuration,last.timestamp-start],prefixPackets,copiedPackets,copiedBytes,presentationDuration:capped.duration,hardwareRequested:encode.hardwareAcceleration==='prefer-hardware'}};
  }finally{await Promise.resolve(writer?.abort?.()).catch(()=>{});for(const reader of readers)reader.dispose();for(const path of paths)if(!completed||path!==result?.path)await disk.removeMediaFile(path).catch(()=>{});}
 }
 root.VideoPocketRangeH264={configuration,units,isIdr,packetData,compatible,transformationMetadata,plan,tryCut,cancel(){for(const c of active)void c.cancel().catch(()=>{});}};
})(self);
