import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaChoices} from '../extension/browser-media.js';
import {validateMediaRecovery} from '../extension/media-recovery.js';

function source({duration=60,width=1920,height=1080,codec='h264',ext='mp4',bitrate=1_000_000,audioTrackId='en',filesize=1000,documentId='doc',mediaKey=1,url='https://cdn.test/a?token=old'}={}){
 const value={duration,descriptor:{tabId:2,documentId,mediaKey,frameId:0},formats:[{id:'video',url,kind:'video',width,height,ext,videoCodec:codec,audioCodec:'aac',audioTrackId,bitrate,filesize}],range:{supported:true}};
 value.capability=mediaChoices(value);return value;
}
test('only a new URL with the same selected complete media plan can replace an expired source',()=>{
 const before=source(),after=source({url:'https://cdn2.test/a?token=new'});
 assert.deepEqual(validateMediaRecovery(before,after,{kind:'video',height:1080,range:{start:10,end:15}}),{});
 assert.deepEqual(validateMediaRecovery(before,source({duration:60.01}),{kind:'video',height:1080}),{});
});
test('recovery cannot silently change best quality, codec, audio language, bitrate, file or document',()=>{
 for(const patch of [{width:1280,height:720},{codec:'hevc'},{ext:'webm'},{audioTrackId:'zh'},{bitrate:500000},{filesize:1001},{duration:62},{documentId:'new-document'},{mediaKey:2}]){
  assert.throws(()=>validateMediaRecovery(source(),source(patch),{kind:'video',height:0}),{code:'SOURCE_CHANGED'},JSON.stringify(patch));
 }
});
test('unknown identity/duration, missing selection and an unsupported cut cannot be recovered automatically',()=>{
 const before=source(),unknown=source();delete unknown.descriptor.documentId;
 assert.throws(()=>validateMediaRecovery(unknown,source(),{kind:'video'}),{code:'SOURCE_CHANGED'});
 assert.throws(()=>validateMediaRecovery(before,source({duration:0}),{kind:'video'}),{code:'SOURCE_CHANGED'});
 assert.throws(()=>validateMediaRecovery(before,source(),{kind:'video',height:1440}),{code:'SOURCE_CHANGED'});
 const after=source();after.range.supported=false;
 assert.throws(()=>validateMediaRecovery(before,after,{kind:'video',height:1080,range:{start:10,end:15}}),{code:'SOURCE_CHANGED'});
});
