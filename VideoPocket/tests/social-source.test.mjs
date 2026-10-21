import test from 'node:test';
import assert from 'node:assert/strict';
import {attachSocialSources,verifiedSocialSource} from '../extension/social-source.js';

const page=(extra={})=>({url:'https://www.tiktok.com/zh-Hant-TW/',videos:[{url:'blob:local',mediaIdentity:'post'}],media:{duration:12},mediaIndex:0,tabId:1,documentId:'current',frameId:0,...extra});
const record=(url,extra={})=>({url,mime:'video/mp4',service:'tiktok',tabId:1,documentId:'current',frameId:0,time:100,method:'GET',...extra});

test('preserves working non-FB/TikTok platforms and stale or DRM selections verbatim',()=>{
 for(const url of ['https://www.youtube.com/watch?v=test','https://www.bilibili.com/video/BV1','https://anime1.me/12','https://example.com/watch']){
  const original=page({url,platform:{site:'youtube'}});assert.equal(attachSocialSources(original,[record('https://v16.tiktokcdn.com/a.mp4')]),original);
 }
 for(const original of [page({selectionExpired:true}),page({media:{drm:true}})])assert.equal(attachSocialSources(original,[record('https://v16.tiktokcdn.com/a.mp4')]),original);
});

test('prioritizes the actually observed CDN URL for the exact known resource',()=>{
 const old='https://v16.tiktokcdn.com/video/tos/long-opaque-object-id/?token=old',fresh='https://v19.tiktokcdn.com/video/tos/long-opaque-object-id/?token=fresh';
 const result=attachSocialSources(page({platform:{site:'embedded',id:'post',versions:[{url:old}]} }),[record(fresh),record('https://v19.tiktokcdn.com/video/tos/different-opaque-object/?token=other')]);
 assert.equal(result.platform.id,'post');assert.equal(result.platform.versions[0].url,fresh);assert.equal(result.platform.versions.length,2);
});

test('shared playback endpoints require the same explicit media query identity',()=>{
 const original=page({platform:{site:'embedded',versions:[{url:'https://www.tiktok.com/api/play?video_id=one&sig=old'}]}});
 assert.equal(attachSocialSources(original,[record('https://www.tiktok.com/api/play?video_id=two&sig=new')]),original);
 assert.equal(attachSocialSources(original,[record('https://www.tiktok.com/api/play?video_id=one&sig=new')]).platform.versions[0].url,'https://www.tiktok.com/api/play?video_id=one&sig=new');
});

test('long shared API paths without an explicit media ID never cross-bind',()=>{
 const path='/api/v1/really-long-shared-playback-endpoint';
 const known=`https://www.tiktok.com${path}?sig=old`;
 const other=`https://www.tiktok.com${path}?sig=other`;
 const original=page({videos:[{downloadUrl:known}],platform:{site:'embedded',versions:[{url:known}]}});
 assert.equal(attachSocialSources(original,[record(other)]),original);
 const emptyIdPath='/api/v1/really-long-shared-playback-endpoint';
 const emptyOld=`https://www.tiktok.com${emptyIdPath}?video_id=&sig=old`;
 const emptyNew=`https://www.tiktok.com${emptyIdPath}?video_id=&sig=new`;
 const emptyPage=page({videos:[{downloadUrl:emptyOld}],platform:{site:'embedded',versions:[{url:emptyOld}]}});
 assert.equal(attachSocialSources(emptyPage,[record(emptyNew)]),emptyPage);
});

test('Facebook shared API paths require an explicit ID and TikTok empty opaque paths stay unbound',()=>{
 const fbPath='/api/v1/really-long-shared-playback-endpoint';
 const fbKnown=`https://www.facebook.com${fbPath}?sig=old`;
 const fbOther=`https://www.facebook.com${fbPath}?sig=other`;
 const fbPage=page({url:'https://www.facebook.com/reel/one',videos:[{downloadUrl:fbKnown}],platform:{site:'embedded',versions:[{url:fbKnown}]}});
 assert.equal(attachSocialSources(fbPage,[record(fbOther,{service:'facebook'})]),fbPage);
 const emptyOld='https://v19.tiktokcdn.com/video/tos/?sig=old',emptyNew='https://v19.tiktokcdn.com/video/tos/?sig=new';
 const ttPage=page({videos:[{downloadUrl:emptyOld}],platform:{site:'embedded',versions:[{url:emptyOld}]}});
 assert.equal(attachSocialSources(ttPage,[record(emptyNew)]),ttPage);
});

test('follows observed redirect identity and never binds unrelated feed media',()=>{
 const original=page({videos:[{downloadUrl:'https://v16.tiktokcdn.com/original'},{}],platform:{site:'embedded',id:'one',versions:[]}});
 const target='https://v19.tiktokcdn.com/video/tos/redirect-target-file/';
 assert.equal(attachSocialSources(original,[record(target)]),original);
 assert.equal(attachSocialSources(original,[record(target,{originalUrl:'https://v16.tiktokcdn.com/original'})]).platform.versions[0].url,target);
});

test('unbound fallback requires one player, finite duration and the exact document/frame',()=>{
 const candidate=record('https://video.xx.fbcdn.net/full.mp4',{service:'facebook'});
 const original=page({url:'https://www.facebook.com/reel/123'});
 assert.equal(attachSocialSources(original,[candidate]).platform.site,'social-network');
 for(const other of [page({url:original.url,videos:[{},{}]}),page({url:original.url,media:{duration:0}})])assert.equal(attachSocialSources(other,[candidate]),other);
 for(const other of [{...candidate,documentId:'old'},{...candidate,frameId:2},{...candidate,mime:'video/mp2t'},{...candidate,url:'https://video.xx.fbcdn.net/fragment.m4s'},{...candidate,service:'tiktok'}])assert.equal(attachSocialSources(original,[other]),original);
});

test('partial contexts still reject a known tab/document conflict',()=>{
 const original=page({tabId:7,frameId:0,documentId:'doc'});
 const conflicting={url:'https://v19.tiktokcdn.com/video/tos/opaque/file',mime:'video/mp4',service:'tiktok',tabId:8,time:100,method:'GET'};
 assert.equal(attachSocialSources(original,[conflicting]),original);
});

test('matching HLS response replaces only the selected known manifest',()=>{
 const url='https://cdn.fbcdn.net/long-opaque-manifest-path/master.m3u8';
 const original=page({url:'https://www.facebook.com/reel/123',platform:{site:'embedded',manifestUrl:url,manifestXml:'old'}});
 const result=attachSocialSources(original,[record(url+'?fresh=1',{service:'facebook',mime:'application/vnd.apple.mpegurl'})]);
 assert.equal(result.platform.manifestType,'hls');assert.equal(result.platform.manifestUrl,url+'?fresh=1');assert.equal(result.platform.manifestXml,undefined);
});

test('exact selected resources survive a noisy request list beyond the recent cap',()=>{
 const old='https://v16.tiktokcdn.com/video/tos/opaque/file?token=old';
 const fresh='https://v19.tiktokcdn.com/video/tos/opaque/file?token=fresh';
 const original=page({videos:[{downloadUrl:fresh}],platform:{site:'embedded',versions:[{url:old}]}});
 const noisy=Array.from({length:20},(_,i)=>record(`https://v19.tiktokcdn.com/video/tos/other-${i}?token=x`,{time:200+i}));
 noisy.push(record(fresh,{time:100}));
 const result=attachSocialSources(original,noisy);
 assert.equal(result.platform.versions[0].url,fresh);
});

test('unbound media must have real video codecs and a tightly matching actual duration',()=>{
 const video={duration:26.26,formats:[{videoCodec:'h264',kind:'video'}]};
 assert.equal(verifiedSocialSource(video,26.25),true);
 assert.equal(verifiedSocialSource({...video,duration:15},26.25),false);
 assert.equal(verifiedSocialSource({...video,duration:0},26.25),false);
 assert.equal(verifiedSocialSource({...video,formats:[{audioCodec:'aac',kind:'audio'}]},26.25),false);
 assert.equal(verifiedSocialSource(video,0),false);
});
