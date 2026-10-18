import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';
import {saveSuggestion,validateDestination,destinationState,publishDownload} from '../native/save-file.mjs';
import {isInside} from '../native/core.mjs';

test('Suggested extension follows actual video container or extracted audio codec',()=>{
  assert.deepEqual(saveSuggestion({title:'測試影片'},{kind:'video',videoFormat:'auto'},{container:'webm'}),{filename:'測試影片.webm',extension:'webm'});
  assert.equal(saveSuggestion({title:'source-file'},{kind:'video',title:'所選影片標題'},{container:'mp4'}).filename,'所選影片標題.mp4');
  for(const [codec,extension] of [['aac','m4a'],['opus','opus'],['vorbis','ogg'],['mp3','mp3']])assert.equal(saveSuggestion({title:'音訊'},{kind:'audio',audioFormat:'original'},{extract:true,codec}).extension,extension);
  assert.equal(saveSuggestion({title:'音訊'},{kind:'audio',audioFormat:'original'},{extract:false,ext:'webm'}).extension,'webm');
  assert.equal(saveSuggestion({title:'音訊'},{kind:'audio',audioFormat:'mp3'},{ext:'webm'}).extension,'mp3');
  assert.throws(()=>saveSuggestion({title:'影片'},{kind:'video'},{container:undefined}));
});
test('Default filename removes invalid characters and Windows device names',()=>{
  assert.equal(saveSuggestion({title:'CON'},{kind:'video'},{container:'mp4'}).filename,'_CON.mp4');
  assert.equal(saveSuggestion({title:'測試 / "影片"'},{kind:'video'},{container:'mkv'}).filename,'測試 _ _影片_.mkv');
  assert.equal(saveSuggestion({title:'100% 完成'},{kind:'video'},{container:'mp4'}).filename,'100% 完成.mp4');
});
test('Destination validation accepts exact Unicode name, rejects relative/wrong extension',()=>{
  const file=path.resolve('work/我的檔名 100% (1).mp4');assert.equal(validateDestination({path:file,overwrite:false},'mp4').path,file);
  assert.throws(()=>validateDestination({path:'relative.mp4'},'mp4'));assert.throws(()=>validateDestination({path:path.resolve('work/false.mp3')},'mp4'));
});
async function fixture(fn){const root=path.resolve('work');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'save-file-test-'));try{await fn(dir);}finally{if(isInside(root,dir)&&path.basename(dir).startsWith('save-file-test-'))await fs.rm(dir,{recursive:true,force:true});}}
test('Publish keeps exact filename and refuses an unapproved existing file',()=>fixture(async dir=>{
  const source=path.join(dir,'staged.mp4'),target=path.join(dir,'我指定的檔名 100% $(hello).mp4');await fs.writeFile(source,'complete video');
  await publishDownload(source,{path:target,overwrite:false},null);assert.equal(await fs.readFile(target,'utf8'),'complete video');
  await fs.writeFile(source,'another video');await assert.rejects(publishDownload(source,{path:target,overwrite:false},null),/未覆蓋/);assert.equal(await fs.readFile(target,'utf8'),'complete video');
}));
test('Confirmed replacement succeeds; changed existing file is preserved',()=>fixture(async dir=>{
  const source=path.join(dir,'staged.mp4'),target=path.join(dir,'existing.mp4');await fs.writeFile(target,'old');const expected=await destinationState(target);await fs.writeFile(source,'new');await publishDownload(source,{path:target,overwrite:true},expected);assert.equal(await fs.readFile(target,'utf8'),'new');
  const stale=await destinationState(target);await fs.writeFile(target,'changed while downloading');await fs.writeFile(source,'final');await assert.rejects(publishDownload(source,{path:target,overwrite:true},stale),/已變更/);assert.equal(await fs.readFile(target,'utf8'),'changed while downloading');
}));
