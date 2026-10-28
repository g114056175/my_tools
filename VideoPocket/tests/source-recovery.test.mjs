import test from 'node:test';
import assert from 'node:assert/strict';
import {isExpiredSourceAuth,matchesRecoverySelection,refreshedSourceDescriptor,sourceContentIdentity,sourceRecoveryTarget} from '../extension/source-recovery.js';

test('expired source recovery is limited to HTTP_AUTH 401/403 during download',()=>{
 for(const status of [401,403])assert.equal(isExpiredSourceAuth({code:'HTTP_AUTH',httpStatus:status},'download'),true);
 assert.equal(isExpiredSourceAuth({code:'HTTP_AUTH',status:401},'download'),true);
 assert.equal(isExpiredSourceAuth({code:'HTTP_AUTH',httpStatus:404},'download'),false);
 assert.equal(isExpiredSourceAuth({code:'HTTP_AUTH',httpStatus:403},'save'),false);
 assert.equal(isExpiredSourceAuth({code:'SAVE_FAILED',httpStatus:403},'download'),false);
});

test('recovery requires document, media, content, and selected-player identity',()=>{
 const descriptor={tabId:7,frameId:2,documentId:'doc-1',mediaKey:13,recoveryIdentity:true,mediaContentId:'episode-9',selectionIdentity:'player-13'};
 assert.deepEqual(sourceRecoveryTarget(descriptor),{frameId:2,documentId:'doc-1',mediaKey:13,mediaContentId:'episode-9',selectionIdentity:'player-13',requiresBound:true});
 assert.equal(sourceRecoveryTarget({...descriptor,selectionIdentity:''}),null);
 assert.equal(sourceRecoveryTarget({...descriptor,mediaContentId:undefined}),null);
 assert.equal(sourceContentIdentity({linkedMedia:{id:'linked-9'}}),'linked-9');
});

test('refreshed descriptor follows only the exact selected source identity',()=>{
 const target={frameId:2,documentId:'doc-1',mediaKey:13,recoveryIdentity:true,mediaContentId:'episode-9',selectionIdentity:'player-13'};
 const page={url:'https://site.test/watch',mediaIndex:0,media:{duration:90},platform:{site:'sample'},videos:[{...target,mediaIdentity:'episode-9',url:'blob:player',downloadUrl:'https://cdn.test/video.m3u8?sig=fresh',sourceType:'hls',title:'Episode'}]};
 assert.equal(matchesRecoverySelection(target,page),true);
 const descriptor=refreshedSourceDescriptor({tabId:7,url:'https://cdn.test/video.m3u8?sig=old',title:'old title'},page,target);
 assert.equal(descriptor.url,'https://cdn.test/video.m3u8?sig=fresh');
 assert.equal(descriptor.playerUrl,'blob:player');
 assert.equal(descriptor.selectionIdentity,'player-13');
 assert.equal(descriptor.duration,90);
 assert.throws(()=>refreshedSourceDescriptor({}, {...page,videos:[{...page.videos[0],selectionIdentity:'other-player'}]},target),{code:'SOURCE_CHANGED'});
 assert.equal(matchesRecoverySelection(target,{...page,selectionExpired:true}),false);
});

test('an unknown page route alone cannot authorize replacing the selected video',()=>{
 const descriptor={tabId:7,frameId:0,documentId:'doc',mediaKey:1,referer:'https://unknown.test/watch?v=route-id',selectionIdentity:'unknown.test:route-id',mediaContentId:'route-id'};
 assert.equal(sourceRecoveryTarget(descriptor),null);
 const bound=sourceRecoveryTarget({...descriptor,recoveryIdentity:true});assert.ok(bound);
 assert.equal(matchesRecoverySelection(bound,{mediaIndex:0,videos:[{...descriptor,recoveryIdentity:false}]}),false);
});
