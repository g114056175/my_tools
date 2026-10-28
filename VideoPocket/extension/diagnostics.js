// Diagnostics use an allowlist. Raw messages, URLs, titles, paths and tokens
// never become a record or an exported field.
const CATALOG={
 RANGE_PROCESSING_FAILED:['merge','Range cut failed. No file was saved.',true],RANGE_PROCESSING_TIMEOUT:['merge','Range processing stopped after no progress. No file was saved.',true],RANGE_ENCODER_UNAVAILABLE:['source','This format cannot be cut precisely in the browser.',false],
 RANGE_INVALID:['source','Invalid time range. Check the start and end times.',false],RANGE_UNSUPPORTED:['source','Range downloads are not supported for this source.',false],YOUTUBE_RANGE_INCOMPLETE:['integrity','Range media is incomplete. No file was saved.',true],
 CANCELLED:['cancel','Cancelled',false],SOURCE_CHANGED:['source','The video changed. Refresh the page.',true],
 SOURCE_VERSION_CHANGED:['integrity','The source file changed. Download it again.',false],
 SOURCE_CANDIDATE_MISMATCH:['integrity','The backup source does not match this video version. Download again.',false],
 SOURCE_UNAVAILABLE:['source','No usable source was found. Refresh the page.',true],PAGE_MEDIA_GONE:['source','The original video was removed or changed. Download stopped.',false],DRM_UNSUPPORTED:['source','This video is DRM-protected.',false],
 YOUTUBE_SESSION_UNAVAILABLE:['source','Play the video briefly, then try again.',true],
 HTTP_AUTH:['network','The source denied access. Refresh the video page.',true],HTTP_RATE_LIMIT:['network','The source is temporarily rate-limiting requests. Try again later.',true],
 HTTP_RETRY_AFTER_UNSUPPORTED:['network','The source requested a wait that is too long. Try again later.',false],
 HTTP_RETRY_ADMISSION_BUSY:['network','Too many requests are waiting. Try again later.',false],
 HTTP_NOT_FOUND:['network','The source is no longer available. Refresh the video page.',true],HTTP_SERVER:['network','The source server is temporarily unavailable.',true],
 NETWORK_TIMEOUT:['network','The download timed out. Try again.',true],NETWORK_FAILURE:['network','A network request failed. Try again.',true],
 STREAM_VERIFICATION:['verification','Stream verification failed. Refresh the video page.',true],INCOMPLETE_MEDIA:['integrity','Media data is incomplete. No file was saved.',true],
 SUBTITLE_SOURCE_UNAVAILABLE:['subtitle','This subtitle source is unavailable. Turn on the selected track in the player, then try again.',true],
 SUBTITLE_UNAVAILABLE:['subtitle','Subtitles are unavailable for this video. Refresh the page.',true],
 SUBTITLE_MISMATCH:['subtitle','These subtitles do not match the video. Refresh the page.',true],
 BILI_LIST_HTTP:['subtitle','Could not load the subtitle list.',false],BILI_LIST_API:['subtitle','The subtitle list API rejected the request.',false],BILI_LIST_NETWORK:['subtitle','Could not connect to the subtitle list.',false],BILI_LIST_INVALID:['subtitle','The subtitle list response was invalid.',false],
 BILI_IDENTITY_MISMATCH:['subtitle','The subtitle list does not match this video.',false],BILI_TRACK_MISSING:['subtitle','The selected subtitle is unavailable or ambiguous.',false],BILI_LOGIN_REQUIRED:['subtitle','Sign in to Bilibili to access this subtitle.',false],
 BILI_FILE_API:['subtitle','The subtitle file API rejected the request.',false],BILI_FILE_HTTP:['subtitle','Could not read the subtitle file.',false],BILI_FILE_NETWORK:['subtitle','Could not connect to the subtitle file.',false],BILI_FILE_EMPTY:['subtitle','The subtitle file is empty.',false],BILI_FILE_INVALID:['subtitle','The subtitle file is not valid JSON.',false],
 BILI_TIMEOUT:['subtitle','Reading subtitles timed out.',false],BILI_SOURCE_REJECTED:['subtitle','This subtitle URL or source domain is not supported.',false],BILI_TIMELINE_INVALID:['subtitle','The subtitle timeline is invalid or exceeds the video duration.',false],BILI_CONTEXT_LOST:['subtitle','The video page was reloaded or is unavailable.',false],
 YT_SOURCE_UNAVAILABLE:['subtitle','The selected YouTube subtitle source is unavailable.',false],YT_RECOVERY_UNAVAILABLE:['subtitle','Could not start YouTube subtitle recovery.',false],YT_FILE_HTTP:['subtitle','Could not read YouTube subtitles.',false],YT_FILE_EMPTY:['subtitle','YouTube returned no subtitle data.',false],YT_FILE_NETWORK:['subtitle','Could not connect to YouTube subtitles.',false],YT_TIMEOUT:['subtitle','Reading YouTube subtitles timed out.',false],YT_FILE_INVALID:['subtitle','The YouTube subtitle response was invalid.',false],
 TEMP_STORAGE_FULL:['storage','Temporary storage is full. Free up disk space.',true],TEMP_STORAGE_UNAVAILABLE:['storage','Temporary storage is unavailable.',true],
 MEMORY_LIMIT:['memory','The browser ran out of memory. Try a lower quality.',false],MERGE_FAILED:['merge','Media processing failed. Try another quality.',true],
 SAVE_FAILED:['save','Could not save the file. Try again.',true],INTERNAL_ERROR:['internal','Something went wrong. Try again.',true]
};
export function saveFailureDetails(error={}){
 return {...(['open-temp','read-temp','get-target','open-target','write-target','close-target','save-worker','browser-start','browser-write'].includes(error?.saveStage)?{saveStage:error.saveStage}:{}),...(['permission','blocked','not-found','unreadable','busy','invalid-state','aborted','disk-full','worker-failed','invalid-filename','file-too-large','file-io','unknown'].includes(error?.saveReason)?{saveReason:error.saveReason}:{})};
}
export function classifyFailure(error={},stage='download'){
 // Promise.any can aggregate the same refusal from a primary and its hedge.
 // Retain the useful safe cause across RPC instead of reporting INTERNAL_ERROR.
 const visited=new Set();
 while(Array.isArray(error?.errors)&&error.errors.length&&!visited.has(error)){
  visited.add(error);if(visited.size>8)break;
  const items=error.errors.filter(item=>item&&item!==error);
  if(!items.length)break;
  error=items.find(item=>['SOURCE_VERSION_CHANGED','SOURCE_CANDIDATE_MISMATCH'].includes(item.code)) ||
   items.find(item=>item.code==='HTTP_AUTH'||[401,403].includes(Number(item.status || item.httpStatus))) ||
   items.find(item=>item.code==='HTTP_RATE_LIMIT'||Number(item.status || item.httpStatus)===429) || items.at(-1);
 }
 const raw=String(error?.message || error || ''),status=Number(error?.status || error?.httpStatus)||Number(raw.match(/(?:HTTP|status)\s*[:=(]?\s*(\d{3})/i)?.[1])||undefined;
 const requestMatch=raw.match(/HTTP\s+\d{3}[，,]\s*(HEAD|GET(?:\s+Range)?)[，,]\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[，,）)]|\s|$)/i),requestMethod=String(error?.requestMethod || requestMatch?.[1] || '').toUpperCase(),requestHost=String(error?.requestHost || requestMatch?.[2] || '').toLowerCase();
 let code=Object.hasOwn(CATALOG,error?.code)?error.code:Object.hasOwn(CATALOG,raw)?raw:null;
  if(!code){
  // AbortError is also emitted when a response is interrupted or when a
  // hedge/timeout cleans up a losing request.  Only an explicit cancellation
  // marker is user cancellation; a bare AbortError is a transport failure.
  const explicitCancel=error?.userCancelled===true||/^(?:已取消|cancel(?:led)?|user[_ -]?canceled)$/i.test(raw);
  if(explicitCancel)code='CANCELLED';
  else if(/影片已變更|身份|identity|SOURCE_CHANGED/i.test(raw))code='SOURCE_CHANGED';
  else if(/DRM|ContentProtection/i.test(raw))code='DRM_UNSUPPORTED';
  else if(error.name==='QuotaExceededError'||/quota|空間不足|磁碟.*滿/i.test(raw))code='TEMP_STORAGE_FULL';
  else if(error.name==='TimeoutError'||/timed?\s*out|逾時|timeout/i.test(raw))code='NETWORK_TIMEOUT';
  else if(error.name==='AbortError')code=stage==='save'?'SAVE_FAILED':'NETWORK_FAILURE';
  else if(/attestation|串流驗證|驗證.*拒絕/i.test(raw))code='STREAM_VERIFICATION';
  else if(status===401||status===403)code='HTTP_AUTH';else if(status===429)code='HTTP_RATE_LIMIT';
  else if(status===404||status===410)code='HTTP_NOT_FOUND';else if(status>=500)code='HTTP_SERVER';
  else if(/片段.*不完整|長度不完整|正確的檔案範圍|Content.Range|Incomplete|missing segments/i.test(raw))code='INCOMPLETE_MEDIA';
  else if(/字幕.*(?:時間|長度).*(?:不符|超過)/i.test(raw))code='SUBTITLE_MISMATCH';
  else if(/記憶體|out of memory|memory access|allocation/i.test(raw))code='MEMORY_LIMIT';
  else if(/暫存|OPFS|storage|getDirectory/i.test(raw))code='TEMP_STORAGE_UNAVAILABLE';
  else if(/合併|抽取|ffmpeg|mux/i.test(raw)||stage==='merge')code='MERGE_FAILED';
  else if(/Failed to fetch|network|網路|NETWORK_FAILED|NETWORK_DISCONNECTED/i.test(raw))code='NETWORK_FAILURE';
  else if(stage==='subtitle'||/字幕/i.test(raw))code='SUBTITLE_UNAVAILABLE';
  else if(/來源|重新整理|未取得|無法讀取目前|無法讀取.*網頁/i.test(raw))code='SOURCE_UNAVAILABLE';
  else if(stage==='save')code='SAVE_FAILED';else code='INTERNAL_ERROR';
 }
 const [category,message,retryable]=CATALOG[code],apiCode=Number(error?.apiCode),subtitleStage=['list','file','parse','verify','context'].includes(error?.subtitleStage)?error.subtitleStage:undefined,processingStage=['initializing','normalizing','cutting','validating'].includes(error?.processingStage)?error.processingStage:undefined;
 const saveDetails=saveFailureDetails(error);
 if(stage==='save'&&code==='SAVE_FAILED'&&!saveDetails.saveReason){
  const reasons={FILE_ACCESS_DENIED:'permission',FILE_NO_SPACE:'disk-full',FILE_NAME_TOO_LONG:'invalid-filename',FILE_TOO_LARGE:'file-too-large',FILE_BLOCKED:'blocked',FILE_SECURITY_CHECK_FAILED:'blocked',FILE_VIRUS_INFECTED:'blocked',FILE_TRANSIENT_ERROR:'busy',FILE_FAILED:'file-io'};
  saveDetails.saveReason=/^Invalid filename\.?$/i.test(raw)?'invalid-filename':reasons[raw] || 'unknown';
 }
 return {code,category,message,retryable,...saveDetails,...(['memory','storage','missing-track','unsupported-format','invalid-input','timestamps','file-io','unknown'].includes(error?.processingReason)?{processingReason:error.processingReason}:{}),...(processingStage?{processingStage}:{}),...(Number.isInteger(error?.ffmpegExitCode)&&error.ffmpegExitCode>=0&&error.ffmpegExitCode<=255?{ffmpegExitCode:error.ffmpegExitCode}:{}),...(['linked-document','linked-redirect','linked-ambiguous','linked-no-model','dailymotion-metadata','dailymotion-manifest','bilibili-playurl','source-request','source-head','source-probe','stream-manifest','stream-segment','youtube-session'].includes(error?.sourceStage)?{sourceStage:error.sourceStage}:{}),...(Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{}),...(['HEAD','GET','GET RANGE'].includes(requestMethod)?{requestMethod}:{}),...(requestHost&&/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(requestHost)?{requestHost}:{}),...(error?.apiCode!==undefined&&Number.isInteger(apiCode)&&Math.abs(apiCode)<=1000000?{apiCode}:{}),...(subtitleStage?{subtitleStage}:{})};
}
export const ERROR_VISIBILITY_MS=6000;
// A popup can close during a download. Retain one safe failure briefly so the
// next popup can show it, rather than silently discarding a failed job.
export const ERROR_RETENTION_MS=5*60*1000;
const SUBTITLE_WARNING_MESSAGES=Object.freeze({YT_RESTORE_UNCONFIRMED:'Captured; caption settings may not be restored.'});
export function briefSubtitleWarning(code){return Object.hasOwn(SUBTITLE_WARNING_MESSAGES,code)?{code,message:SUBTITLE_WARNING_MESSAGES[code]}:null;}
export function briefFailure(error){
 const failure=classifyFailure(error);
 if(failure.code==='CANCELLED')return null;
 const bili={BILI_LIST_HTTP:['B01','Could not load the subtitle list'],BILI_LIST_API:['B01','The subtitle list API rejected the request'],BILI_LIST_NETWORK:['B01','Could not connect to the subtitle list'],BILI_LIST_INVALID:['B01','The subtitle list response was invalid'],BILI_IDENTITY_MISMATCH:['B02','The subtitle list does not match this video'],BILI_TRACK_MISSING:['B03','The selected subtitle is unavailable or ambiguous'],BILI_LOGIN_REQUIRED:['B04','Sign in to Bilibili to access this subtitle'],BILI_FILE_API:['B13','The subtitle file API rejected the request'],BILI_FILE_HTTP:['B05','Could not read the subtitle file'],BILI_FILE_NETWORK:['B06','Could not connect to the subtitle file'],BILI_FILE_EMPTY:['B07','The subtitle file is empty'],BILI_FILE_INVALID:['B08','The subtitle file is not valid JSON'],BILI_TIMEOUT:['B09','Reading subtitles timed out'],BILI_SOURCE_REJECTED:['B10','This subtitle URL is not supported'],BILI_TIMELINE_INVALID:['B11','The subtitle timeline is invalid'],BILI_CONTEXT_LOST:['B12','The video page was reloaded or is unavailable'],YT_SOURCE_UNAVAILABLE:['YT01','The selected subtitle source is unavailable'],YT_RECOVERY_UNAVAILABLE:['YT07','Could not start YouTube subtitle recovery'],YT_FILE_HTTP:['YT02','Could not read YouTube subtitles'],YT_FILE_EMPTY:['YT03','YouTube returned no subtitle data'],YT_FILE_NETWORK:['YT04','Could not connect to YouTube subtitles'],YT_TIMEOUT:['YT05','Reading YouTube subtitles timed out'],YT_FILE_INVALID:['YT06','The YouTube subtitle response was invalid']};
 if(bili[failure.code]){const [code,label]=bili[failure.code],stage={list:'list',file:'subtitle file',parse:'parse',verify:'video check',context:'video page'}[failure.subtitleStage];return {code,message:label+(failure.httpStatus?` · HTTP ${failure.httpStatus}`:failure.apiCode!==undefined?` · API ${failure.apiCode}`:failure.code==='BILI_TIMEOUT'&&stage?` · ${stage}`:'')};}
 const groups={network:['E01','Network request failed'],source:['E02','Source unavailable'],verification:['E02','Stream verification failed'],storage:['E03','Temporary storage unavailable'],memory:['E04','The browser ran out of memory'],integrity:['E05','Media data is incomplete'],merge:['E05','Media processing failed'],save:['E06','Could not save the file'],subtitle:['E07','Could not read subtitles'],internal:['E99','Something went wrong']};
 const [code,label]=groups[failure.category] || groups.internal;
 const labels={YOUTUBE_SESSION_UNAVAILABLE:'Play the video briefly, then retry',HTTP_RETRY_AFTER_UNSUPPORTED:'The source requested a long wait. Try again later.',TEMP_STORAGE_FULL:'Temporary storage is full',HTTP_AUTH:'Access denied. Refresh the page and retry.',HTTP_NOT_FOUND:'Source unavailable. Refresh the page and retry.',HTTP_RATE_LIMIT:'The source is temporarily rate-limiting requests',STREAM_VERIFICATION:'Stream verification failed. Refresh the page and retry.',NETWORK_TIMEOUT:'The network request timed out',RANGE_PROCESSING_TIMEOUT:'Media processing timed out',SOURCE_CHANGED:'The video changed',PAGE_MEDIA_GONE:'The original video was removed or changed',SOURCE_VERSION_CHANGED:'The source file changed. Download it again.',SUBTITLE_MISMATCH:'The subtitles do not match the video',SUBTITLE_SOURCE_UNAVAILABLE:'Turn on the selected subtitle in the player, then try again'};
 const processing={memory:'Not enough memory',storage:'Not enough temporary storage','missing-track':'A required track is missing','unsupported-format':'Unsupported format','invalid-input':'Invalid media input',timestamps:'Invalid timestamps','file-io':'File read or write failed'}[failure.processingReason];
 const saving={permission:'Save permission expired',blocked:'Saving was blocked','not-found':'Save location is unavailable',unreadable:'Save location cannot be read',busy:'The file is in use','disk-full':'Not enough disk space','worker-failed':'The save process stopped','invalid-filename':'Unsupported filename','file-too-large':'The file is too large','file-io':'File read or write failed'}[failure.saveReason];
 return {code,message:(labels[failure.code] || label)+(processing&&failure.code==='MERGE_FAILED'?` · ${processing}`:saving&&failure.code==='SAVE_FAILED'?` · ${saving}`:'')};
}
export function visibleFailure(record,now=Date.now()){return record&&Number.isFinite(record.time)&&now>=record.time&&now-record.time<ERROR_RETENTION_MS?briefFailure(record):null;}
