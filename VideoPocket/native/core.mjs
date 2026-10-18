import path from 'node:path';
import {originalTracks,trackIdentity,translated,parameters} from '../extension/tracks.js';
export function validateUrl(value) {
  if(typeof value!=='string'||value.length>8192)throw new Error('影片網址無效');
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('只接受不含帳密的 HTTP／HTTPS 網址');
  return url.href;
}
export function validateRequest(message) {
  if(!message||typeof message.id!=='string'||message.id.length>100)throw new Error('請求識別碼無效');
  const actions=['ping','inspect','prepareDownload','download','subtitle','cancel','folder'];
  if(!actions.includes(message.action))throw new Error('未知操作');
  if(['inspect','prepareDownload','download','subtitle'].includes(message.action))message.url=validateUrl(message.url);
  if(['download','prepareDownload'].includes(message.action)) {
    if(message.title!==undefined&&(typeof message.title!=='string'||message.title.length>8192))throw new Error('影片標題無效');
    message.videoFormat ||= 'auto';message.audioFormat ||= 'original';message.audioQuality ||= 'best';
    if(!['video','audio'].includes(message.kind))throw new Error('下載類型無效');
    if(!Number.isInteger(Number(message.height ?? 0))||Number(message.height ?? 0)<0||Number(message.height ?? 0)>16384)throw new Error('畫質選項無效');
    if(!['original','mp3','m4a'].includes(message.audioFormat || 'original'))throw new Error('音訊格式無效');
    if(!['auto','mp4','mkv'].includes(message.videoFormat || 'auto'))throw new Error('影片格式無效');
    if(!['best','128','192','320'].includes(message.audioQuality || 'best'))throw new Error('音訊品質無效');
  }
  if(message.referer)message.referer=validateUrl(message.referer);
  if(message.action==='subtitle' && (typeof message.language!=='string'||!message.language.match(/^[\w.-]{1,240}$/)))throw new Error('字幕語言無效');
  if(message.trackId!==undefined&&(typeof message.trackId!=='string'||message.trackId.length>8192))throw new Error('字幕識別碼無效');
  if(message.ticket!==undefined&&(typeof message.ticket!=='string'||!/^[\w-]{1,100}$/.test(message.ticket)))throw new Error('下載排程無效');
  return message;
}
export function summarize(info,choices) {
  const formats=(info.formats || []).filter(f=>!f.has_drm);
  const heights=[...new Set(formats.filter(f=>f.vcodec&&f.vcodec!=='none'&&f.height).map(f=>f.height))].sort((a,b)=>b-a);
  const tracks=[];
  for(const [automatic,source] of [[false,info.subtitles],[true,info.automatic_captions]])for(const [language,items] of Object.entries(source || {})) {
    if(language==='live_chat'||!items.length)continue;
    for(const item of items){const actual=parameters(item).get('lang') || language.replace(/-orig$/,'');tracks.push({language:actual,nativeLanguage:language,automatic,name:item.name || actual,url:item.url,source:'native'});}
  }
  return {id:info.id,title:info.title,duration:info.duration,heights,tracks:originalTracks(tracks).map(t=>({...t,source:'native'})),choices,site:info.extractor_key};
}
// Filter a cached metadata file before yt-dlp selects a format. Otherwise its
// language-only selector may choose a different named track from the same key.
export function subtitleInfo(info,request){
  const automatic=!!request.automatic,group=automatic?'automatic_captions':'subtitles';
  const candidates=summarize(info).tracks.filter(t=>t.nativeLanguage===request.language&&t.automatic===automatic&&(!request.trackId || t.trackId===request.trackId));
  if(candidates.length!==1)throw new Error('字幕版本不明確或已變更，請更新資訊後重試。');
  const track=candidates[0],items=(info[group]?.[request.language] || []).filter(item=>!translated(item)&&trackIdentity({language:track.language,nativeLanguage:request.language,automatic,url:item.url,name:item.name || request.language})===track.trackId);
  if(!items.length)throw new Error('找不到指定字幕版本。');
  return {track,info:{...info,subtitles:automatic?{}:{[request.language]:items},automatic_captions:automatic?{[request.language]:items}:{}}};
}
export function downloadArgs(message,outputDir,plan,outputTemplate) {
  // Separate audio intermediate files from video output: extracting audio can
  // otherwise delete a video downloaded previously from the same direct URL.
  const height=plan?.height || Number(message.height || 0);
  const suffix=message.kind==='audio'?' - audio':` - video ${message.videoFormat || 'auto'} ${height?height+'p':'best'}`;
  const template=outputTemplate || `%(title).100B [%(id)s]${suffix} %(autonumber)03d.%(ext)s`;
  const args=['--paths',outputDir,'--output',template,'--windows-filenames','--no-overwrites','--no-post-overwrites','--concurrent-fragments','4','--newline','--progress','--progress-template','download:VP_PROGRESS:%(info.format_id)s|%(progress._percent_str)s','--print','after_move:VP_FILE:%(filepath)s'];
  if(message.kind==='video') {
    if(plan){args.push('-f',plan.selector);if(plan.merged)args.push('--merge-output-format',plan.container);if(message.videoFormat!=='auto'&&message.videoFormat)args.push('--remux-video',message.videoFormat);return args;}
    const height=Number(message.height || 0), filter=height?`[height<=${height}]`:'';
    const format=message.videoFormat || 'auto';
    args.push('-f',`bv*${filter}+ba/b${filter}`,'--merge-output-format',format==='auto'?'mp4/mkv':format);
    if(format!=='auto')args.push('--remux-video',format);
    if(format==='mp4')args.push('-S','vcodec:h264,acodec:aac');
  } else {
    if(plan){args.push('-f',plan.selector);if(message.audioFormat==='original'&&plan.extract)args.push('-x','--audio-format','best');return args;}
    args.push('-f','ba/b');
    if(message.audioFormat==='original'||!message.audioFormat)args.push('-x','--audio-format','best');
    else args.push('-x','--audio-format',message.audioFormat,'--audio-quality',message.audioQuality==='best'?'0':message.audioQuality+'K');
  }
  return args;
}
export function subtitleChunks(cues,maxBytes=500000) {
  const chunks=[];let chunk=[],bytes=2;
  for(const cue of cues) {
    const size=Buffer.byteLength(JSON.stringify(cue),'utf8')+1;
    if(size>maxBytes-1024)throw new Error('單段字幕超過傳輸大小限制。');
    if(bytes+size>maxBytes){chunks.push(chunk);chunk=[];bytes=2;}
    chunk.push(cue);bytes+=size;
  }
  if(chunk.length)chunks.push(chunk);return chunks;
}
export function isInside(root,file) {
  const rel=path.relative(path.resolve(root),path.resolve(file));return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);
}
export function friendlyError(text) {
  if(/sign in to confirm|not a bot|captcha|cloudflare|HTTP Error 429/i.test(text))return '網站要求瀏覽器驗證或限制自動化，下載工具目前無法取得此影片。字幕可改用「讀取頁面字幕」；影片需要另行處理網站相容性。';
  if(/DRM protected|DRM-protected/i.test(text))return '此內容有 DRM 保護，這個版本不支援下載。';
  if(/requested format is not available/i.test(text))return '來源已變更，請更新影片資訊後重試。';
  return text.replace(/https?:\/\/\S+/g,'[網址]').replace(/\x1b\[[0-9;]*m/g,'').trim().slice(-1600)||'下載失敗，請重試或更新工具。';
}
