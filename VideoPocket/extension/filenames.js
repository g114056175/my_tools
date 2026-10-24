import {safeName} from './subtitles.js';

export function fileStem(title){
 let stem=safeName(title).replace(/(?:\.(?:mp4|mkv|webm|mov|m4v|mp3|m4a|aac|opus|ogg|wav|flac|txt|srt|vtt))+$/i,'');
 stem=safeName(stem);
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;
 return stem;
}
// This is only a safe suggestion. The browser owns conflict handling because
// showSaveFilePicker cannot enumerate its parent directory.
export function suggestedFilename(title,extension){
 if(!/^[a-z0-9]{1,8}$/i.test(extension))throw new Error('檔案格式無效');
 return `${fileStem(title)}.${extension.toLowerCase()}`;
}
