import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {safeName} from '../extension/subtitles.js';

export function saveSuggestion(info,message,plan){
  const extracted={aac:'m4a',alac:'m4a',mp3:'mp3',opus:'opus',vorbis:'ogg',flac:'flac',ac3:'ac3'};
  const extension=message.kind==='video'?plan.container:message.audioFormat==='original'?(plan.extract?extracted[plan.codec]:plan.ext):message.audioFormat;
  if(!/^[a-z0-9]{1,8}$/i.test(extension || ''))throw new Error('無法確認下載檔案格式，請更新影片資訊');
  let stem=safeName(message.title || info.title || 'video');if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;
  return {extension:extension.toLowerCase(),filename:stem+'.'+extension.toLowerCase()};
}
export function validateDestination(selection,extension){
  if(!selection || typeof selection.path!=='string'||!path.isAbsolute(selection.path)||path.extname(selection.path).toLowerCase()!=='.'+extension.toLowerCase())throw new Error('儲存檔名或副檔名無效');
  return {path:path.resolve(selection.path),overwrite:selection.overwrite===true};
}
export async function destinationState(file){
  try{const s=await fs.lstat(file);if(!s.isFile())throw new Error('儲存位置不是一般檔案');return {ino:s.ino,size:s.size,mtimeMs:s.mtimeMs,birthtimeMs:s.birthtimeMs};}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function publishDownload(source,selection,expected){
  if(selection.overwrite&&expected){
    const current=await destinationState(selection.path);
    if(JSON.stringify(current)!==JSON.stringify(expected))throw new Error('同名檔案在下載期間已變更，未覆蓋；請重新選擇儲存位置');
    await fs.rename(source,selection.path);return;
  }
  // A same-volume hard link publishes the completed file without copying it,
  // and refuses a filename created by another process after the save dialog.
  try{await fs.link(source,selection.path);}catch(e){
    if(e.code==='EEXIST')throw new Error('同名檔案已存在，未覆蓋；請重新選擇儲存位置');
    if(!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS'].includes(e.code))throw e;
    await fs.copyFile(source,selection.path,constants.COPYFILE_EXCL);
  }
  await fs.unlink(source);
}
