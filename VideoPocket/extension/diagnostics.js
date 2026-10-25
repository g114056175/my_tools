// Diagnostics use an allowlist. Raw messages, URLs, titles, paths and tokens
// never become a record or an exported field.
const CATALOG={
 RANGE_PROCESSING_FAILED:['merge','區間裁切失敗，未儲存檔案',true],RANGE_ENCODER_UNAVAILABLE:['source','瀏覽器無法精準裁切此格式',false],
 RANGE_INVALID:['source','區間時間無效，請檢查起點與終點',false],RANGE_UNSUPPORTED:['source','此來源暫不支援區間下載',false],YOUTUBE_RANGE_INCOMPLETE:['integrity','區間影音不完整，未儲存檔案',true],
 CANCELLED:['cancel','已取消',false],SOURCE_CHANGED:['source','影片已變更，請重新整理',true],
 SOURCE_UNAVAILABLE:['source','未取得可用來源，請重新整理',true],DRM_UNSUPPORTED:['source','此影片含 DRM 保護',false],
 HTTP_AUTH:['network','來源拒絕存取，請重新整理影片頁',true],HTTP_RATE_LIMIT:['network','來源暫時限制請求，請稍後重試',true],
 HTTP_NOT_FOUND:['network','來源已失效，請重新整理影片頁',true],HTTP_SERVER:['network','來源伺服器暫時無法回應',true],
 NETWORK_TIMEOUT:['network','下載逾時，請重試',true],NETWORK_FAILURE:['network','網路讀取失敗，請重試',true],
 STREAM_VERIFICATION:['verification','串流驗證被拒絕，請重新整理影片頁',true],INCOMPLETE_MEDIA:['integrity','影音片段不完整，未儲存檔案',true],
 SUBTITLE_SOURCE_UNAVAILABLE:['subtitle','此字幕來源無法讀取，可先在播放器開啟所選字幕再擷取',true],
 SUBTITLE_UNAVAILABLE:['subtitle','無法取得此影片的字幕，請重新整理',true],
 SUBTITLE_MISMATCH:['subtitle','字幕與目前影片的時間不符，請重新整理',true],
 BILI_LIST_HTTP:['subtitle','字幕清單 HTTP 失敗',false],BILI_LIST_API:['subtitle','字幕清單 API 拒絕請求',false],BILI_LIST_NETWORK:['subtitle','字幕清單連線失敗',false],BILI_LIST_INVALID:['subtitle','字幕清單回應格式錯誤',false],
 BILI_IDENTITY_MISMATCH:['subtitle','字幕清單與影片識別不符',false],BILI_TRACK_MISSING:['subtitle','所選字幕已不在目前清單或無法唯一確認',false],BILI_LOGIN_REQUIRED:['subtitle','字幕需要登入 Bilibili',false],
 BILI_FILE_API:['subtitle','字幕檔 API 拒絕請求',false],BILI_FILE_HTTP:['subtitle','字幕檔 HTTP 失敗',false],BILI_FILE_NETWORK:['subtitle','字幕檔連線失敗',false],BILI_FILE_EMPTY:['subtitle','字幕檔內容為空',false],BILI_FILE_INVALID:['subtitle','字幕檔不是可解析的字幕 JSON',false],
 BILI_TIMEOUT:['subtitle','字幕讀取逾時',false],BILI_SOURCE_REJECTED:['subtitle','字幕網址或來源網域不受支援',false],BILI_TIMELINE_INVALID:['subtitle','字幕時間軸異常或超出片長',false],BILI_CONTEXT_LOST:['subtitle','影片頁已重載或無法讀取',false],
 YT_SOURCE_UNAVAILABLE:['subtitle','所選 YouTube 字幕來源無法讀取',false],YT_FILE_HTTP:['subtitle','YouTube 字幕 HTTP 失敗',false],YT_FILE_EMPTY:['subtitle','YouTube 字幕回傳空內容',false],YT_FILE_NETWORK:['subtitle','YouTube 字幕連線失敗',false],YT_TIMEOUT:['subtitle','YouTube 字幕讀取逾時',false],YT_FILE_INVALID:['subtitle','YouTube 字幕回應格式錯誤',false],
 TEMP_STORAGE_FULL:['storage','本機暫存空間不足，請釋放磁碟空間',true],TEMP_STORAGE_UNAVAILABLE:['storage','無法使用本機暫存空間',true],
 MEMORY_LIMIT:['memory','瀏覽器記憶體不足，請降低品質重試',false],MERGE_FAILED:['merge','影音合併失敗，請換品質重試',true],
 SAVE_FAILED:['save','檔案儲存失敗，請重試',true],INTERNAL_ERROR:['internal','處理失敗，請重試',true]
};
export function saveFailureDetails(error={}){
 return {...(['open-temp','read-temp','get-target','open-target','write-target','close-target','save-worker','browser-start','browser-write'].includes(error?.saveStage)?{saveStage:error.saveStage}:{}),...(['permission','blocked','not-found','unreadable','busy','invalid-state','aborted','disk-full','worker-failed','invalid-filename','file-too-large','file-io','unknown'].includes(error?.saveReason)?{saveReason:error.saveReason}:{})};
}
export function classifyFailure(error={},stage='download'){
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
 const [category,message,retryable]=CATALOG[code],apiCode=Number(error?.apiCode),subtitleStage=['list','file','parse','verify','context'].includes(error?.subtitleStage)?error.subtitleStage:undefined;
 const saveDetails=saveFailureDetails(error);
 if(stage==='save'&&code==='SAVE_FAILED'&&!saveDetails.saveReason){
  const reasons={FILE_ACCESS_DENIED:'permission',FILE_NO_SPACE:'disk-full',FILE_NAME_TOO_LONG:'invalid-filename',FILE_TOO_LARGE:'file-too-large',FILE_BLOCKED:'blocked',FILE_SECURITY_CHECK_FAILED:'blocked',FILE_VIRUS_INFECTED:'blocked',FILE_TRANSIENT_ERROR:'busy',FILE_FAILED:'file-io'};
  saveDetails.saveReason=/^Invalid filename\.?$/i.test(raw)?'invalid-filename':reasons[raw] || 'unknown';
 }
 return {code,category,message,retryable,...saveDetails,...(['memory','storage','missing-track','unsupported-format','invalid-input','timestamps','file-io','unknown'].includes(error?.processingReason)?{processingReason:error.processingReason}:{}),...(Number.isInteger(error?.ffmpegExitCode)&&error.ffmpegExitCode>=0&&error.ffmpegExitCode<=255?{ffmpegExitCode:error.ffmpegExitCode}:{}),...(['linked-document','linked-redirect','linked-ambiguous','linked-no-model','dailymotion-metadata','dailymotion-manifest','bilibili-playurl','source-request','source-head','source-probe','stream-manifest','stream-segment'].includes(error?.sourceStage)?{sourceStage:error.sourceStage}:{}),...(Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{}),...(['HEAD','GET','GET RANGE'].includes(requestMethod)?{requestMethod}:{}),...(requestHost&&/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(requestHost)?{requestHost}:{}),...(error?.apiCode!==undefined&&Number.isInteger(apiCode)&&Math.abs(apiCode)<=1000000?{apiCode}:{}),...(subtitleStage?{subtitleStage}:{})};
}
export const ERROR_VISIBILITY_MS=6000;
// A popup can close during a download. Retain one safe failure briefly so the
// next popup can show it, rather than silently discarding a failed job.
export const ERROR_RETENTION_MS=5*60*1000;
export function briefFailure(error){
 const failure=classifyFailure(error);
 if(failure.code==='CANCELLED')return null;
 const bili={BILI_LIST_HTTP:['B01','字幕清單查詢失敗'],BILI_LIST_API:['B01','字幕清單 API 拒絕請求'],BILI_LIST_NETWORK:['B01','字幕清單連線失敗'],BILI_LIST_INVALID:['B01','字幕清單回應格式錯誤'],BILI_IDENTITY_MISMATCH:['B02','字幕清單與影片不符'],BILI_TRACK_MISSING:['B03','所選字幕目前未提供或來源不唯一'],BILI_LOGIN_REQUIRED:['B04','字幕需要登入 Bilibili'],BILI_FILE_API:['B13','字幕檔 API 拒絕請求'],BILI_FILE_HTTP:['B05','字幕檔讀取失敗'],BILI_FILE_NETWORK:['B06','字幕檔連線失敗'],BILI_FILE_EMPTY:['B07','字幕檔內容為空'],BILI_FILE_INVALID:['B08','字幕 JSON 格式錯誤'],BILI_TIMEOUT:['B09','字幕讀取逾時'],BILI_SOURCE_REJECTED:['B10','字幕網址不受支援'],BILI_TIMELINE_INVALID:['B11','字幕時間軸異常'],BILI_CONTEXT_LOST:['B12','影片頁已重載或無法讀取'],YT_SOURCE_UNAVAILABLE:['YT01','所選字幕來源無法讀取'],YT_FILE_HTTP:['YT02','YouTube 字幕讀取失敗'],YT_FILE_EMPTY:['YT03','未取得字幕，請開啟字幕並切換為所選語言'],YT_FILE_NETWORK:['YT04','YouTube 字幕連線失敗'],YT_TIMEOUT:['YT05','YouTube 字幕讀取逾時'],YT_FILE_INVALID:['YT06','YouTube 字幕格式錯誤']};
 if(bili[failure.code]){const [code,label]=bili[failure.code],stage={list:'清單',file:'字幕檔',parse:'解析',verify:'影片確認',context:'影片頁'}[failure.subtitleStage];return {code,message:label+(failure.httpStatus?` · HTTP ${failure.httpStatus}`:failure.apiCode!==undefined?` · API ${failure.apiCode}`:failure.code==='BILI_TIMEOUT'&&stage?` · ${stage}`:'')};}
 const groups={network:['E01','網路讀取失敗'],source:['E02','來源無法下載'],verification:['E02','串流驗證失敗'],storage:['E03','無法使用本機暫存'],memory:['E04','瀏覽器記憶體不足'],integrity:['E05','影音資料不完整'],merge:['E05','影音處理失敗'],save:['E06','檔案儲存失敗'],subtitle:['E07','字幕讀取失敗'],internal:['E99','處理失敗']};
 const [code,label]=groups[failure.category] || groups.internal;
 const labels={TEMP_STORAGE_FULL:'本機暫存空間不足',HTTP_AUTH:'來源拒絕存取',HTTP_NOT_FOUND:'來源已失效',HTTP_RATE_LIMIT:'來源暫時限制請求',NETWORK_TIMEOUT:'網路讀取逾時',SOURCE_CHANGED:'影片已變更',SUBTITLE_MISMATCH:'字幕與影片不符',SUBTITLE_SOURCE_UNAVAILABLE:'請先在播放器開啟所選字幕'};
 const processing={memory:'記憶體不足',storage:'暫存空間不足','missing-track':'缺少所需軌道','unsupported-format':'格式不支援','invalid-input':'輸入影音異常',timestamps:'時間戳異常','file-io':'檔案讀寫異常'}[failure.processingReason];
 const saving={permission:'儲存權限失效',blocked:'儲存遭到封鎖','not-found':'儲存位置失效',unreadable:'儲存位置無法讀取',busy:'檔案正被使用','disk-full':'儲存磁碟空間不足','worker-failed':'儲存程序中斷','invalid-filename':'檔名不受支援','file-too-large':'儲存檔案過大','file-io':'儲存檔案讀寫失敗'}[failure.saveReason];
 return {code,message:(labels[failure.code] || label)+(processing&&failure.code==='MERGE_FAILED'?` · ${processing}`:saving&&failure.code==='SAVE_FAILED'?` · ${saving}`:'')};
}
export function visibleFailure(record,now=Date.now()){return record&&Number.isFinite(record.time)&&now>=record.time&&now-record.time<ERROR_RETENTION_MS?briefFailure(record):null;}
