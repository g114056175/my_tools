import {safeName} from './subtitles.js';

export const FILENAME_HISTORY_KEY='savedFilenames';
const HISTORY_LIMIT=2000;
const key=name=>name.normalize('NFC').toLocaleLowerCase('en-US');
export function fileStem(title){
 let stem=safeName(title).replace(/(?:\.(?:mp4|mkv|webm|mov|m4v|mp3|m4a|aac|opus|ogg|wav|flac|txt|srt|vtt))+$/i,'');
 stem=safeName(stem);
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;
 return stem;
}
export function filenameHistory(value){
 const names=new Map();
 for(const name of Array.isArray(value)?value:[]){
  if(typeof name!=='string'||!name||name.length>255||/[\x00-\x1f<>:"/\\|?*]/.test(name))continue;
  const id=key(name);names.delete(id);names.set(id,name);
 }
 return [...names.values()].slice(-HISTORY_LIMIT);
}
// This is a suggestion based on our own choices, not an inventory of the disk.
// showSaveFilePicker has no conflictAction or parent-directory enumeration.
export function suggestedFilename(title,extension,history=[]){
 if(!/^[a-z0-9]{1,8}$/i.test(extension))throw new Error('檔案格式無效');
 const stem=fileStem(title),ext=extension.toLowerCase(),used=new Set(filenameHistory(history).map(key));
 let name=`${stem}.${ext}`,index=0;
 while(used.has(key(name)))name=`${stem} (${++index}).${ext}`;
 return name;
}
export function createFilenameRecorder(storage){
 let writes=Promise.resolve();
 return name=>{
  const task=writes.catch(()=>{}).then(async()=>{
   const stored=await storage.get(FILENAME_HISTORY_KEY),names=filenameHistory([...filenameHistory(stored[FILENAME_HISTORY_KEY]),name]);
   await storage.set({[FILENAME_HISTORY_KEY]:names});return names;
  });
  writes=task;return task;
 };
}
