/* Precise cutting of already downloaded fragments. No network or whole-file fallback. */
(function(root){
 'use strict';
 const M=root.VideoPocketMediabunny,disk=root.VideoPocketDiskMedia;
 const formats=[M.MP4,M.WEBM,M.MATROSKA,M.MPEG_TS,M.ADTS,M.OGG,M.MP3];
 const failure=(message,code='RANGE_PROCESSING_FAILED')=>Object.assign(new Error(message),{code});
 let activeConversion;
 function check(signal){if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});}
 function outputFormat(ext){switch(ext){case 'mp4':case 'm4a':return new M.Mp4OutputFormat({fastStart:false});case 'webm':return new M.WebMOutputFormat();case 'mkv':return new M.MkvOutputFormat();case 'ogg':return new M.OggOutputFormat();case 'mp3':return new M.Mp3OutputFormat();default:throw failure('此格式不支援精準區間裁切','RANGE_UNSUPPORTED');}}
 function makeTarget(access,signal){return new M.StreamTarget(new WritableStream({write(chunk){check(signal);if(access.write(chunk.data,{at:chunk.position})!==chunk.data.byteLength)throw failure('裁切檔案寫入不完整');}}),{chunked:true,chunkSize:1024*1024});}
 async function entry(item){
  if(!Number.isFinite(item.timelineStart)||item.timelineStart<0)throw failure('缺少來源片段的時間位置');
  const input=new M.Input({source:new M.BlobSource(item.file),formats});
  try{
   const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack(),reference=video||audio;
   if(!reference)throw failure('片段中沒有可用影音軌');
   const first=await new M.EncodedPacketSink(reference).getFirstPacket();
   if(!first)throw failure('片段沒有可讀取的時間戳');
   return {item,input,video,audio,offset:item.timelineStart-first.timestamp};
  }catch(error){input.dispose();throw error;}
 }
 async function trackInfo(source,kind){
  const track=source[kind];if(!track)return null;
  const codec=await track.getCodec(),decoderConfig=await track.getDecoderConfig(),first=await new M.EncodedPacketSink(track).getFirstPacket();
  if(!codec||!decoderConfig||!first)throw failure('無法辨識所選影音片段');
  return {source,track,kind,codec,decoderConfig,first,firstTime:await track.getFirstTimestamp()+source.offset};
 }
 async function packetWindow(info,range){
  const sink=new M.EncodedPacketSink(info.track),start=range.start-info.source.offset,end=range.end-info.source.offset;
  let first,last;
  if(info.kind==='video'){
   // Include the preceding GOP and all dependencies through the ending GOP.
   first=await sink.getKeyPacket(start,{verifyKeyPackets:true})||await sink.getFirstKeyPacket({verifyKeyPackets:true});
   const endingKey=await sink.getKeyPacket(end,{verifyKeyPackets:true});
   last=endingKey&&await sink.getNextKeyPacket(endingKey,{verifyKeyPackets:true});
  }else{
   // Opus needs decoder preroll; audio packets are not presentation frames.
   first=await sink.getPacket(Math.max(0,start-.12))||info.first;
   const ending=await sink.getPacket(end+.12);last=ending&&await sink.getNextPacket(ending);
  }
  if(!first)throw failure('來源片段缺少可解碼的起始影格');
  return {...info,first,firstTime:first.timestamp+info.source.offset,sink,last:last||undefined};
 }
 async function videoOptions(track,format,start){
  const codec=await track.getCodec(),sink=new M.EncodedPacketSink(track),supported=format.getSupportedVideoCodecs();
  let first=await sink.getKeyPacket(start,{verifyKeyPackets:true})||await sink.getFirstKeyPacket({verifyKeyPackets:true});
  if(first&&first.timestamp<start&&first.timestamp+first.duration<=start)first=await sink.getNextKeyPacket(first,{verifyKeyPackets:true});
  // Do not set quality/bitrate here: either field forces Conversion to transcode.
  if(supported.includes(codec)&&first&&(Math.abs(first.timestamp-start)<1e-6||Math.max(first.timestamp,start)-start<=.05&&first.timestamp+first.duration>start))return {};
  const width=Math.ceil(await track.getSquarePixelWidth()/2)*2,height=Math.ceil(await track.getSquarePixelHeight()/2)*2;
  // Probe the same quality/configuration that will actually be used. Bitrate-based
  // high quality permits hardware encoders that cannot accept per-frame quantizers.
  const quality=new M.Quality({quality:'high',preferBitrate:true});
  for(const candidate of supported){
   try{if(await M.canEncodeVideo(candidate,{width,height,quality,hardwareAcceleration:'prefer-hardware'}))return {codec:candidate,quality,hardwareAcceleration:'prefer-hardware',forceTranscode:true};}catch{}
  }
  // Unsupported hardware falls back to the browser's ordinary precise encoder.
  return {forceTranscode:true};
 }
 async function validate(file,wanted,expected){
  const input=new M.Input({source:new M.BlobSource(file),formats});
  try{
   const presentation=expected.presentation?await root.VideoPocketRangeMp4.presentationDuration(file):null;
   if(expected.presentation&&(!Number.isFinite(presentation)||Math.abs(presentation-wanted)>.005))throw failure('MP4 播放長度不符合區間');
   const tracks=[expected.video&&await input.getPrimaryVideoTrack(),expected.audio&&await input.getPrimaryAudioTrack()].filter(Boolean);
   if(tracks.length!==Number(expected.video)+Number(expected.audio))throw failure('區間輸出缺少影音軌');
   const times=await Promise.all(tracks.map(async(track,index)=>{
    const codedStart=await track.getFirstTimestamp(),codedEnd=await track.computeDuration();
    const isVideo=expected.video&&index===0;
    if(isVideo){
     const key=await new M.EncodedPacketSink(track).getFirstKeyPacket({verifyKeyPackets:true});
     if(!key||key.timestamp<-.05||key.timestamp>.05||codedStart<-.05)throw failure('區間影片未從獨立影格開始，未儲存檔案');
     // Metadata alone cannot prove that the first frames or the smart splice
     // decode. Verify actual presentation samples, including contiguous coverage.
     const sink=new M.VideoSampleSink(track),windows=[[0,Math.min(wanted,.5)]];
     if(Number.isFinite(expected.splice)&&expected.splice>0&&expected.splice<wanted)windows.push([Math.max(0,expected.splice-.15),Math.min(wanted,expected.splice+.15)]);
     for(const [from,to] of windows){let covered=from,count=0;
      for await(const sample of sink.samples(from,to)){
       try{if(!Number.isFinite(sample.timestamp)||!Number.isFinite(sample.duration)||sample.duration<=0||sample.timestamp>covered+.05)throw failure('區間影片開頭或接合處缺少可解碼畫格');covered=Math.max(covered,sample.timestamp+sample.duration);count++;}finally{sample.close();}
      }
      if(!count||covered<to-.05)throw failure('區間影片開頭或接合處畫格不完整');
     }
    }
    if(!expected.presentation)return {start:codedStart,end:codedEnd};
    // MP4 edit lists retain negative coded pre-roll. Validate the sample actually
    // presented at zero, rather than treating the earliest decode packet as UI time.
    const sink=isVideo?new M.VideoSampleSink(track):new M.AudioSampleSink(track),sample=await sink.getSample(0);
    try{if(!sample||!Number.isFinite(sample.timestamp)||!Number.isFinite(sample.duration)||sample.duration<=0||sample.timestamp>.1||sample.timestamp+sample.duration<=0)throw failure('MP4 播放起點不符合區間');return {start:Math.max(0,sample.timestamp),codedStart,codedEnd,end:Math.min(codedEnd,presentation)};}finally{sample?.close();}
   }));
   if(times.some(t=>!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<-.05||t.start>.1||Math.abs(t.end-wanted)>.15))throw failure('區間輸出的起點或長度不符，未儲存檔案');
   if(times.length===2&&Math.abs(times[0].start-times[1].start)>.1)throw failure('區間輸出音畫時間不符，未儲存檔案');
   return {duration:Math.max(...times.map(t=>t.end)),tracks:times};
  }finally{input.dispose();}
 }
 async function cutRange({inputs,range,kind='video',expectedAudio=false,output,scope,signal,onProgress=()=>{}}){
  if(!range||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw failure('區間時間無效','RANGE_INVALID');
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>2||!['video','audio'].includes(kind))throw failure('區間輸入格式無效');
  const entries=[],paths=[],began=Date.now();let intermediate,writer,conversionInput,result,completed=false;
  try{
   check(signal);for(const item of inputs)entries.push(await entry(item));
   const videoEntry=entries.find(e=>e.item.name.startsWith('video.'))||entries[0],audioEntry=entries.find(e=>e.item.name.startsWith('audio.'))||videoEntry;
   const video=kind==='video'?await trackInfo(videoEntry,'video'):null,audio=await trackInfo(audioEntry,'audio');
   if(kind==='video'&&!video||expectedAudio&&!audio||kind==='audio'&&!audio)throw failure('來源缺少所選影音軌');
   const tracks=await Promise.all([video,audio].filter(Boolean).map(info=>packetWindow(info,range))),base=Math.min(...tracks.map(t=>t.firstTime));
   if(!Number.isFinite(base)||base>range.start+.1)throw failure('來源片段未覆蓋所選起點');
   intermediate=await disk.createSyncMediaFile(scope,'range-normalized.mkv');paths.push(intermediate.path);
   const aligned=new M.Output({format:new M.MkvOutputFormat(),target:makeTarget(intermediate.access,signal)});
   const sources=tracks.map(info=>{
    const source=info.kind==='video'?new M.EncodedVideoPacketSource(info.codec):new M.EncodedAudioPacketSource(info.codec);
    aligned[info.kind==='video'?'addVideoTrack':'addAudioTrack'](source,{decoderConfig:info.decoderConfig,...(!info.decoderConfig.description?{primingPacket:info.first}:{})});return source;
   });
   await aligned.start();
   try{let pumpFailure;
    const settled=await Promise.allSettled(tracks.map(async(info,i)=>{
     try{let first=true;for await(const packet of info.sink.packets(info.first,info.last)){
      check(signal);if(pumpFailure)throw pumpFailure;const timestamp=packet.timestamp+info.source.offset-base;if(!Number.isFinite(timestamp)||timestamp<-.05)throw failure('來源片段的時間戳不連續');
      await sources[i].add(packet.clone({timestamp:Math.max(0,timestamp)}),first?{decoderConfig:info.decoderConfig}:undefined);first=false;
     }}catch(error){pumpFailure ||= error;throw error;}finally{sources[i].close();}
    }));
    const rejected=settled.find(s=>s.status==='rejected');if(rejected)throw rejected.reason;
    await aligned.finalize();
   }catch(error){await aligned.cancel().catch(()=>{});throw error;}
   intermediate.finish();intermediate=null;check(signal);
   conversionInput=new M.Input({source:new M.BlobSource(await disk.readMediaFile(paths[0])),formats});
   const ext=output.split('.').pop().toLowerCase(),normalizedAt=Date.now();let smart,smartFallback,selectedVideo={};
   for(const helper of [root.VideoPocketRangeMp4,root.VideoPocketRangeSmart].filter(Boolean)){
    try{smart=await helper.tryCut({input:conversionInput,start:range.start-base,end:range.end-base,output,scope,kind,expectedAudio,signal,onProgress});if(smart)break;}catch(error){check(signal);smartFallback=error.message;}
   }
   let smartTiming;
   if(smart){try{smartTiming=await validate(await disk.readMediaFile(smart.result.path),range.end-range.start,{video:!!video,audio:!!audio,presentation:Number.isFinite(smart.stats.presentationDuration),splice:smart.stats.encodedSeconds});}catch(error){check(signal);await disk.removeMediaFile(smart.result.path).catch(()=>{});smartFallback=error.message;smart=null;}}
   if(smart){result=smart.result;paths.push(result.path);}else{
    writer=await disk.createSyncMediaFile(scope,output);paths.push(writer.path);
    const destination=new M.Output({format:outputFormat(ext),target:makeTarget(writer.access,signal)});
    selectedVideo=video?await videoOptions(await conversionInput.getPrimaryVideoTrack(),destination.format,range.start-base):{discard:true};
    // One microsecond only compensates binary float noise at an exact frame end.
    activeConversion=await M.Conversion.init({input:conversionInput,output:destination,trim:{start:range.start-base,end:range.end-base+1e-6},copy:{mode:'preferred',shiftTolerance:0,boundaryPolicy:'shrink',boundaryTolerance:.05},video:selectedVideo,audio:audio?{}:{discard:true},showWarnings:false});
    if(!activeConversion.isValid||activeConversion.discardedTracks.length)throw failure('瀏覽器無法精準裁切此格式，未儲存檔案','RANGE_ENCODER_UNAVAILABLE');
    activeConversion.onProgress=value=>{check(signal);onProgress(value);};
    await activeConversion.execute();check(signal);result=writer.finish();writer=null;
   }
   const convertedAt=Date.now(),timing=smartTiming||await validate(await disk.readMediaFile(result.path),range.end-range.start,{video:!!video,audio:!!audio});
   const processing={normalizeMs:normalizedAt-began,convertMs:convertedAt-normalizedAt,validateMs:Date.now()-convertedAt,hardwareRequested:selectedVideo.hardwareAcceleration==='prefer-hardware',strategy:'copy-or-convert',...(smart?.stats||{}),...(smartFallback?{smartFallback}:{})};
   completed=true;return {...result,timing,processing};
  }catch(error){await activeConversion?.cancel().catch(()=>{});if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});throw error;}
  finally{activeConversion=null;intermediate?.abort();writer?.abort();conversionInput?.dispose();for(const e of entries)e.input.dispose();for(const path of paths)if(!completed||path!==result?.path)await disk.removeMediaFile(path).catch(()=>{});}
 }
 root.VideoPocketRangeCut={cutRange,validate,videoOptions,packetWindow,cancel(){root.VideoPocketRangeMp4?.cancel();root.VideoPocketRangeSmart?.cancel();void activeConversion?.cancel().catch(()=>{});}};
})(self);
