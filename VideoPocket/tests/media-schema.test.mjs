import test from 'node:test';
import assert from 'node:assert/strict';
import {hasMediaPayload,isMediaPayloadText,isMediaField,isMediaIdentityField,isMediaShapeField} from '../extension/media-schema.js';
import {extractMediaModels} from '../extension/media-models.js';

const base='https://page.example/watch';

test('shared media gate accepts common playback shapes but rejects arbitrary URLs',()=>{
  assert.equal(isMediaPayloadText('{"play":{"hls":{"link":"https://cdn.example/master.m3u8"}}}'),true);
  assert.equal(isMediaPayloadText('{"videoUrl":"https://cdn.example/video.mp4"}'),true);
  assert.equal(isMediaPayloadText('{"manifestUrl":"https://cdn.example/no-extension"}'),true);
  assert.equal(isMediaPayloadText('{"videoQualities":[{"sourceURL":"https://cdn.example/no-extension"}]}'),true);
  assert.equal(isMediaPayloadText('{"broadcast_by_rest_id":{"id":"b1"}}'),true);
  assert.equal(isMediaPayloadText('{"foo":{"url":"https://cdn.example/not-media.jpg"}}'),false);
  assert.equal(isMediaField('manifestUrl'),true);
  assert.equal(isMediaField('sources'),true);
  assert.equal(isMediaShapeField('src'),true);
  assert.equal(isMediaIdentityField('broadcast_id'),true);
  assert.equal(isMediaIdentityField('tweet_result'),true);
  assert.equal(isMediaIdentityField('id'),false);
  assert.equal(isMediaPayloadText('{"broadcast_id":"b1","broadcast_url":"https://x.com/i/broadcasts/b1"}'),true);
});

test('bounded deferred admission rejects incidental fields and accepts explicit media envelopes',()=>{
  assert.equal(hasMediaPayload({id:'event',title:'analytics',duration:3,url:'https://analytics.example/pixel'}),false);
  assert.equal(hasMediaPayload({video_info:{variants:[{url:'https://cdn.example/video.m3u8'}]}}),true);
  assert.equal(hasMediaPayload({source:{noRedirectPlaybackUrl:'https://video.twimg.example/live.m3u8'}}),true);
  assert.equal(hasMediaPayload({source:{location:'https://video.twimg.example/live.m3u8'}}),true);
  assert.equal(hasMediaPayload({broadcast_by_rest_id:{broadcast_id:'b1',media_key:'7_key'}}),true);
  assert.equal(hasMediaPayload({card:{legacy:{binding_values:[{key:'broadcast_id',value:{string_value:'b1'}}]}}}),true);
});

test('deferred admission never invokes accessors in source or broadcast bindings',()=>{
 let reads=0;const hostile={};for(const key of ['key','value','url','videoUrl'])Object.defineProperty(hostile,key,{enumerable:true,get(){reads++;throw Error('getter');}});
 assert.equal(hasMediaPayload({sources:[hostile],card:{binding_values:[hostile]}}),false);assert.equal(reads,0);
});

test('retained parser attributes do not admit analytics or application settings',()=>{
 const settings={id:'preferences',title:'Options',status:'ready',text:'Status',format:'json',video_duration:42,original_width:1920,contentType:'text/plain'};
 assert.equal(isMediaPayloadText(JSON.stringify(settings)),false);
 assert.equal(hasMediaPayload(settings),false);
});

test('non-extension MIME sources classify consistently as video candidates',()=>{
  const [model]=extractMediaModels({id:'mime-1',sources:[
    {src:'https://cdn.example/progressive',type:'video/mp4'},
    {src:'https://cdn.example/playlist',type:'application/vnd.apple.mpegurl'},
  ]},{baseUrl:base});
  assert.equal(model.manifestUrl,'https://cdn.example/playlist');
  assert.equal(model.manifestType,'hls');
  assert.deepEqual(model.versions.map(v=>v.url),['https://cdn.example/progressive']);
});

test('generic aliases produce one model with progressive and manifest candidates',()=>{
  const models=extractMediaModels({
    videoId:'episode-7',
    videoUrl:'https://cdn.example/video.mp4',
    sources:[{src:'https://cdn.example/720.mp4',type:'video/mp4',width:1280}],
    manifestUrl:'https://cdn.example/master.m3u8',
    title:'Episode 7',
  },{baseUrl:base});
  assert.equal(models.length,1);
  assert.equal(models[0].id,'episode-7');
  assert.equal(models[0].manifestUrl,'https://cdn.example/master.m3u8');
  assert.deepEqual(models[0].versions.map(v=>v.url),[
    'https://cdn.example/video.mp4','https://cdn.example/720.mp4',
  ]);
});

test('nested ad and main media retain separate identities',()=>{
  const models=extractMediaModels({items:[
    {videoId:'main',video:{video_url:'https://cdn.example/main.mp4'}},
    {videoId:'ad',video:{video_url:'https://ads.example/ad.mp4'}},
  ]},{baseUrl:base});
  assert.deepEqual(models.map(model=>model.id),['main','ad']);
});
