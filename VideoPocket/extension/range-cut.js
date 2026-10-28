/* Precise cutting of already downloaded fragments. No network or whole-file fallback. */
(function(root){
 'use strict';
 const M=root.VideoPocketMediabunny,disk=root.VideoPocketDiskMedia;
 const formats=[M.MP4,M.WEBM,M.MATROSKA,M.MPEG_TS,M.ADTS,M.OGG,M.MP3];
 const failure=(message,code='RANGE_PROCESSING_FAILED')=>Object.assign(new Error(message),{code});
 let activeConversion;
 function check(signal){if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});}
 function outputFormat(ext){switch(ext){case 'mp4':case 'm4a':return new M.Mp4OutputFormat({fastStart:false});case 'webm':return new M.WebMOutputFormat();case 'mkv':return new M.MkvOutputFormat();case 'ogg':return new M.OggOutputFormat();case 'mp3':return new M.Mp3OutputFormat();default:throw failure('此格式不支援精準區間裁切','RANGE_UNSUPPORTED');}}
  // Conversion clamps every decoded sample against trim. A sample whose end is
  // only floating-point noise past the trim start can otherwise survive with a
  // sub-microsecond duration and be quantized to a duplicate zero-duration
  // frame by the MP4 muxer. Move the boundaries inward by a tiny amount; this
  // removes numerical slivers at both ends while staying far below the UI's
  // 0.1-second precision.
  const trimBoundary=(start,end)=>({start:start+1e-6,end:end-1e-6});
 async function videoTransform(track){
  if(typeof track?.getTransformationMatrix!=='function')return {matrix:null,rotation:await track?.getRotation?.()??0,flip:await track?.getFlip?.()??false};
  let value;try{value=await track.getTransformationMatrix();}catch{throw failure('無法讀取影片顯示變形','RANGE_TRANSFORM_UNSUPPORTED');}
  const matrix=Array.from(value||[]);
  if(matrix.length!==9||matrix.some(number=>!Number.isFinite(number)))throw failure('影片顯示變形格式無效','RANGE_TRANSFORM_UNSUPPORTED');
  let rotation=0,flip=false;try{rotation=await track.getRotation();flip=await track.getFlip();}catch{}
  return {matrix,rotation,flip};
 }
 function outputTransform(transform){return transform?.matrix?{transformationMatrix:transform.matrix.slice()}:{rotation:transform?.rotation??0,flip:transform?.flip??false};}
 function matroskaTransformRepresentable(transform){
  if(!transform)return true;
  if(!transform.matrix)return [0,90,180,270].includes(transform.rotation)&&typeof transform.flip==='boolean';
  const m=transform.matrix,tolerance=1e-4;
  if(Math.abs(m[2])>tolerance||Math.abs(m[5])>tolerance||Math.abs(m[8]-1)>tolerance)return false;
  const values=[m[0],m[1],m[3],m[4]];
  if(values.some(value=>Math.min(Math.abs(value),Math.abs(Math.abs(value)-1))>tolerance))return false;
  return Math.abs(Math.abs(m[0])+Math.abs(m[1])-1)<tolerance&&Math.abs(Math.abs(m[3])+Math.abs(m[4])-1)<tolerance&&Math.abs(Math.abs(m[0])+Math.abs(m[3])-1)<tolerance&&Math.abs(Math.abs(m[1])+Math.abs(m[4])-1)<tolerance;
 }
 function sameDisplayTransform(expected,actual,exact=false){
  if(!expected||!actual)return true;
  if(expected.matrix&&actual.matrix)return (exact?[0,1,2,3,4,5,6,7,8]:[0,1,2,3,4,5,8]).every(index=>Math.abs(expected.matrix[index]-actual.matrix[index])<=1e-3);
  return expected.rotation===actual.rotation&&expected.flip===actual.flip;
 }
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
  const transform=kind==='video'?await videoTransform(track):null;
  return {source,track,kind,codec,decoderConfig,transform,first,firstTime:await track.getFirstTimestamp()+source.offset};
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
 async function validate(file,wanted,expected,onActivity=()=>{}){
  let sampleProgress=0;onActivity('validating',sampleProgress);
  const input=new M.Input({source:new M.BlobSource(file),formats});
  try{
   const presentation=expected.presentation?await root.VideoPocketRangeMp4.presentationDuration(file):null;
   if(expected.presentation&&(!Number.isFinite(presentation)||Math.abs(presentation-wanted)>.005))throw failure('MP4 播放長度不符合區間');
   const tracks=[expected.video&&await input.getPrimaryVideoTrack(),expected.audio&&await input.getPrimaryAudioTrack()].filter(Boolean);
   if(tracks.length!==Number(expected.video)+Number(expected.audio))throw failure('區間輸出缺少影音軌');
   if(expected.videoTransform&&tracks[0]?.getTransformationMatrix){
    const actual=await videoTransform(tracks[0]);if(!sameDisplayTransform(expected.videoTransform,actual,expected.exactVideoTransform))throw failure('區間輸出的影片方向或顯示變形不符');
   }
   const times=await Promise.all(tracks.map(async(track,index)=>{
    const codedStart=await track.getFirstTimestamp(),codedEnd=await track.computeDuration();
    const isVideo=expected.video&&index===0;
    if(isVideo){
     const key=await new M.EncodedPacketSink(track).getFirstKeyPacket({verifyKeyPackets:true});
     if(!key||key.timestamp<-.05||key.timestamp>.05||codedStart<-.05)throw failure('區間影片未從獨立影格開始，未儲存檔案');
     // Metadata alone cannot prove that the first frames or the smart splice
     // decode. Verify actual presentation samples, including contiguous coverage.
     const sink=new M.VideoSampleSink(track),windows=[[0,Math.min(wanted,.5)],[Math.max(0,wanted-.3),wanted]];
     for(const splice of expected.splices||[expected.splice])if(Number.isFinite(splice)&&splice>0&&splice<wanted)windows.push([Math.max(0,splice-.15),Math.min(wanted,splice+.15)]);
     for(const [from,to] of windows){let covered=from,count=0;
      for await(const sample of sink.samples(from,to)){
       try{if(!Number.isFinite(sample.timestamp)||!Number.isFinite(sample.duration)||sample.duration<=0||sample.timestamp>covered+.05)throw failure('區間影片開頭或接合處缺少可解碼畫格');covered=Math.max(covered,sample.timestamp+sample.duration);count++;}finally{sample.close();}onActivity('validating',++sampleProgress);
      }
      if(!count||covered<to-.05)throw failure('區間影片開頭或接合處畫格不完整');
     }
    }
    if(!expected.presentation)return {start:codedStart,end:codedEnd};
    // MP4 edit lists retain negative coded pre-roll. Validate the sample actually
    // presented at zero, rather than treating the earliest decode packet as UI time.
    const sink=isVideo?new M.VideoSampleSink(track):new M.AudioSampleSink(track);
    // Whole AAC packets may start a few milliseconds after zero. Inspect that
    // actual first sample using the same 100ms tolerance as the precise path.
    const sample=await sink.getSample(0)||(!isVideo&&codedStart>0&&codedStart<=.1?await sink.getSample(codedStart):null);
    try{if(!sample||!Number.isFinite(sample.timestamp)||!Number.isFinite(sample.duration)||sample.duration<=0||sample.timestamp>.1||sample.timestamp+sample.duration<=0)throw failure('MP4 播放起點不符合區間');onActivity('validating',++sampleProgress);return {start:Math.max(0,sample.timestamp),codedStart,codedEnd,end:Math.min(codedEnd,presentation)};}finally{sample?.close();}
   }));
   if(times.some(t=>!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<-.05||t.start>.1||Math.abs(t.end-wanted)>.15))throw failure('區間輸出的起點或長度不符，未儲存檔案');
   if(times.length===2&&Math.abs(times[0].start-times[1].start)>.1)throw failure('區間輸出音畫時間不符，未儲存檔案');
   return {duration:Math.max(...times.map(t=>t.end)),tracks:times};
  }finally{input.dispose();}
 }
 async function cutRange({inputs,range,kind='video',expectedAudio=false,output,scope,signal,onProgress=()=>{},onActivity=()=>{}}){
  if(!range||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start)throw failure('區間時間無效','RANGE_INVALID');
  if(!Array.isArray(inputs)||!inputs.length||inputs.length>2||!['video','audio'].includes(kind))throw failure('區間輸入格式無效');
  const entries=[],paths=[],began=Date.now();let intermediate,writer,conversionInput,result,completed=false,selectedVideo={},validationMs=0,validationSamples=0;
  const activity=(stage,progress)=>onActivity(stage,progress),reportCut=(value,start=0,end=1)=>{check(signal);onProgress(value);if(Number.isFinite(value))activity('cutting',start+(end-start)*Math.max(0,Math.min(1,value)));};
  const validateOutput=(file,wanted,expected)=>{let lastProgress=0;activity('validating',validationSamples);return validate(file,wanted,expected,(stage,progress)=>{if(progress>lastProgress){validationSamples++;lastProgress=progress;}activity(stage,validationSamples);});};
  try{
   check(signal);activity('initializing',0);for(const [index,item] of inputs.entries()){entries.push(await entry(item));activity('initializing',.2+.35*(index+1)/inputs.length);}
   const videoEntry=entries.find(e=>e.item.name.startsWith('video.'))||entries[0],audioEntry=entries.find(e=>e.item.name.startsWith('audio.'))||videoEntry;
   const video=kind==='video'?await trackInfo(videoEntry,'video'):null;activity('initializing',.7);const audio=await trackInfo(audioEntry,'audio');activity('initializing',.9);
   if(kind==='video'&&!video||expectedAudio&&!audio||kind==='audio'&&!audio)throw failure('來源缺少所選影音軌');
   activity('initializing',1);activity('normalizing',0);
   const trackInfos=[video,audio].filter(Boolean),tracks=await Promise.all(trackInfos.map(info=>packetWindow(info,range))),base=Math.min(...tracks.map(t=>t.firstTime));activity('normalizing',.02);
   if(!Number.isFinite(base)||base>range.start+.1)throw failure('來源片段未覆蓋所選起點');
   // Low-I/O fast path: only a single muxed MP4 with an unshifted source and
   // an exact independently decodable keyframe may bypass normalization. Any
   // copy or presentation validation failure falls through to the normal path.
   const fastEligible=kind==='video'&&entries.length===1&&String(entries[0].item.name||'').toLowerCase().endsWith('.mp4')&&entries[0].item.timelineStart===0&&Math.abs(entries[0].offset)<=.001&&!!audio&&String(output||'').toLowerCase().endsWith('.mp4')&&!!root.VideoPocketRangeMp4;
   if(fastEligible){let fastResult,fastPath,fastValidationMs=0;try{
    activity('cutting',0);
    const key=await new M.EncodedPacketSink(video.track).getKeyPacket(range.start,{verifyKeyPackets:true});
    if(key&&Math.abs(key.timestamp-range.start)<=1e-6){
     fastResult=await root.VideoPocketRangeMp4.tryCut({input:videoEntry.input,start:range.start,end:range.end,output,scope,kind:'video',expectedAudio:true,signal,onProgress:value=>reportCut(value)});
     fastPath=fastResult?.result?.path;
     if(fastPath){const validationBegan=Date.now();let timing;try{timing=await validateOutput(await disk.readMediaFile(fastPath),range.end-range.start,{video:true,audio:true,presentation:true,videoTransform:video.transform,exactVideoTransform:true});}finally{fastValidationMs=Date.now()-validationBegan;}
      result=fastResult.result;paths.push(result.path);completed=true;return {...result,timing,processing:{normalizeMs:0,convertMs:Math.max(0,Date.now()-began-fastValidationMs),validateMs:fastValidationMs,hardwareRequested:false,strategy:'mp4-keyframe-copy',...(fastResult.stats||{})}};
     }
    }
   }catch(error){if(fastPath)await disk.removeMediaFile(fastPath).catch(()=>{});if(signal?.aborted||error?.code==='CANCELLED')throw error;check(signal);}
   }
   const extension=String(output||'').split('.').pop().toLowerCase();
   if(video&&!matroskaTransformRepresentable(video.transform)){
    if(entries.length!==1||extension!=='mp4')throw failure('此輸出格式無法保留來源影片的顯示變形','RANGE_TRANSFORM_UNSUPPORTED');
    const sourceStart=range.start-video.source.offset,sourceEnd=range.end-video.source.offset;
    if(!Number.isFinite(sourceStart)||!Number.isFinite(sourceEnd)||sourceStart<0||sourceEnd<=sourceStart)throw failure('影片顯示變形需要直接精準轉碼，但來源時間無效','RANGE_TRANSFORM_UNSUPPORTED');
    writer=await disk.createSyncMediaFile(scope,output);paths.push(writer.path);
    const destination=new M.Output({format:outputFormat(extension),target:makeTarget(writer.access,signal)});
    const sourceVideo=await video.source.input.getPrimaryVideoTrack();
    selectedVideo=await videoOptions(sourceVideo,destination.format,sourceStart);
    activeConversion=await M.Conversion.init({input:video.source.input,output:destination,trim:trimBoundary(sourceStart,sourceEnd),copy:{mode:'preferred',shiftTolerance:0,boundaryPolicy:'shrink',boundaryTolerance:.05},video:selectedVideo,audio:audio?{}:{discard:true},showWarnings:false});
    if(!activeConversion.isValid||activeConversion.discardedTracks.length)throw failure('瀏覽器無法精準保留影片顯示變形','RANGE_ENCODER_UNAVAILABLE');
    activity('cutting',0);activeConversion.onProgress=value=>reportCut(value);const conversionBegan=Date.now();
    await activeConversion.execute();check(signal);result=writer.finish();writer=null;
    const convertMs=Date.now()-conversionBegan,validationBegan=Date.now();let timing;
    try{timing=await validateOutput(await disk.readMediaFile(result.path),range.end-range.start,{video:true,audio:!!audio,presentation:true,videoTransform:video.transform,exactVideoTransform:true});}finally{validationMs+=Date.now()-validationBegan;}
    completed=true;return {...result,timing,processing:{normalizeMs:0,convertMs,validateMs:validationMs,hardwareRequested:selectedVideo.hardwareAcceleration==='prefer-hardware',strategy:'direct-precise-transform'}};
   }
   intermediate=await disk.createSyncMediaFile(scope,'range-normalized.mkv');paths.push(intermediate.path);
   const aligned=new M.Output({format:new M.MkvOutputFormat(),target:makeTarget(intermediate.access,signal)});
   const sources=tracks.map(info=>{
    const source=info.kind==='video'?new M.EncodedVideoPacketSource(info.codec):new M.EncodedAudioPacketSource(info.codec);
    aligned[info.kind==='video'?'addVideoTrack':'addAudioTrack'](source,{decoderConfig:info.decoderConfig,...(info.kind==='video'?outputTransform(info.transform):{}),...(!info.decoderConfig.description?{primingPacket:info.first}:{})});return source;
   });
   await aligned.start();const trackPacketProgress=tracks.map(()=>0),packetWindows=tracks.map(info=>({start:info.first.timestamp,end:info.last?.timestamp??(range.end-info.source.offset)}));
   try{let pumpFailure;
    const settled=await Promise.allSettled(tracks.map(async(info,i)=>{
     try{let first=true;for await(const packet of info.sink.packets(info.first,info.last)){
      check(signal);if(pumpFailure)throw pumpFailure;const timestamp=packet.timestamp+info.source.offset-base;if(!Number.isFinite(timestamp)||timestamp<-.05)throw failure('來源片段的時間戳不連續');
      const packetWindow=packetWindows[i],packetSpan=Math.max(.001,packetWindow.end-packetWindow.start);trackPacketProgress[i]=Math.max(trackPacketProgress[i],Math.max(0,Math.min(1,(packet.timestamp-packetWindow.start)/packetSpan)));activity('normalizing',.05+.9*trackPacketProgress.reduce((sum,value)=>sum+value,0)/trackPacketProgress.length);
      await sources[i].add(packet.clone({timestamp:Math.max(0,timestamp)}),first?{decoderConfig:info.decoderConfig}:undefined);first=false;
     }}catch(error){pumpFailure ||= error;throw error;}finally{sources[i].close();}
    }));
    const rejected=settled.find(s=>s.status==='rejected');if(rejected)throw rejected.reason;
    await aligned.finalize();activity('normalizing',1);
   }catch(error){await aligned.cancel().catch(()=>{});throw error;}
   intermediate.finish();intermediate=null;check(signal);
   conversionInput=new M.Input({source:new M.BlobSource(await disk.readMediaFile(paths[0])),formats});
   const ext=output.split('.').pop().toLowerCase(),normalizedAt=Date.now(),conversionBegan=normalizedAt,helpers=[root.VideoPocketRangeMp4,root.VideoPocketRangeSmart,root.VideoPocketRangeH264].filter(Boolean);let smart,smartFallback;
   for(const [index,helper] of helpers.entries()){
    const start=.05+.55*index/helpers.length,end=.05+.55*(index+1)/helpers.length;activity('cutting',start);
    try{smart=await helper.tryCut({input:conversionInput,start:range.start-base,end:range.end-base,output,scope,kind,expectedAudio,signal,onProgress:value=>reportCut(value,start,end),videoTransform:video?.transform});if(smart)break;}catch(error){check(signal);smartFallback=error.message;}
   }
   let smartTiming;
   if(smart){const validationBegan=Date.now();try{smartTiming=await validateOutput(await disk.readMediaFile(smart.result.path),range.end-range.start,{video:!!video,audio:!!audio,presentation:Number.isFinite(smart.stats.presentationDuration),splice:smart.stats.encodedSeconds,splices:smart.stats.splices,videoTransform:video?.transform,exactVideoTransform:smart.stats.strategy==='smart-h264'});}catch(error){check(signal);await disk.removeMediaFile(smart.result.path).catch(()=>{});smartFallback=error.message;smart=null;}finally{validationMs+=Date.now()-validationBegan;}}
   if(smart){result=smart.result;paths.push(result.path);}else{
    writer=await disk.createSyncMediaFile(scope,output);paths.push(writer.path);
    const destination=new M.Output({format:outputFormat(ext),target:makeTarget(writer.access,signal)});
    selectedVideo=video?await videoOptions(await conversionInput.getPrimaryVideoTrack(),destination.format,range.start-base):{discard:true};
    // One microsecond only compensates binary float noise at an exact frame end.
    const trim=trimBoundary(range.start-base,range.end-base);
    activeConversion=await M.Conversion.init({input:conversionInput,output:destination,trim,copy:{mode:'preferred',shiftTolerance:0,boundaryPolicy:'shrink',boundaryTolerance:.05},video:selectedVideo,audio:audio?{}:{discard:true},showWarnings:false});
    if(!activeConversion.isValid||activeConversion.discardedTracks.length)throw failure('瀏覽器無法精準裁切此格式，未儲存檔案','RANGE_ENCODER_UNAVAILABLE');
    const conversionStart=helpers.length?0.6:0;activity('cutting',conversionStart);activeConversion.onProgress=value=>reportCut(value,conversionStart,1);
    await activeConversion.execute();check(signal);result=writer.finish();writer=null;
   }
   const convertedAt=Date.now(),convertMs=Math.max(0,convertedAt-conversionBegan-validationMs);let timing=smartTiming;
   if(!timing){const validationBegan=Date.now();try{timing=await validateOutput(await disk.readMediaFile(result.path),range.end-range.start,{video:!!video,audio:!!audio,videoTransform:video?.transform});}finally{validationMs+=Date.now()-validationBegan;}}
   const processing={normalizeMs:normalizedAt-began,convertMs,validateMs:validationMs,hardwareRequested:selectedVideo.hardwareAcceleration==='prefer-hardware',strategy:'copy-or-convert',...(smart?.stats||{}),...(smartFallback?{smartFallback}:{})};
   completed=true;return {...result,timing,processing};
  }catch(error){await activeConversion?.cancel().catch(()=>{});if(signal?.aborted)throw Object.assign(new Error('已取消'),{code:'CANCELLED'});throw error;}
  finally{activeConversion=null;await Promise.resolve(intermediate?.abort?.()).catch(()=>{});await Promise.resolve(writer?.abort?.()).catch(()=>{});conversionInput?.dispose();for(const e of entries)e.input.dispose();for(const path of paths)if(!completed||path!==result?.path)await disk.removeMediaFile(path).catch(()=>{});}
 }
 root.VideoPocketRangeCut={cutRange,validate,videoOptions,packetWindow,trimBoundary,videoTransform,outputTransform,matroskaTransformRepresentable,sameDisplayTransform,cancel(){root.VideoPocketRangeMp4?.cancel();root.VideoPocketRangeSmart?.cancel();root.VideoPocketRangeH264?.cancel();void activeConversion?.cancel().catch(()=>{});}};
})(self);
