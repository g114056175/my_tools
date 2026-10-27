import test from 'node:test';
import assert from 'node:assert/strict';
import {isMediaPreview,mediaSignature,mediaCanInitialize} from '../src/media-registry.js';

const target=href=>({location:{href}});
function video(ancestors=[],source=''){
 return {currentSrc:source,src:source,getAttribute:()=>null,
  closest:selector=>selector.split(',').some(value=>ancestors.includes(value))?{}:null,
  querySelectorAll(){assert.fail('Preview exclusion must not explore titles, links or sources');},
 };
}

test('YouTube hover shells are excluded even before a source or video ID exists',()=>{
 for(const shell of ['ytd-video-preview','#inline-preview-player','ytd-moving-thumbnail-renderer','ytd-thumbnail','yt-thumbnail-view-model']){
  const item=video([shell,'.html5-video-player']);
  assert.equal(isMediaPreview(item,target('https://www.youtube.com/watch?v=A')),true,shell);
  assert.equal(mediaCanInitialize(item,target('https://www.youtube.com/watch?v=A')),false,shell);
 }
});

test('Bilibili thumbnail previews are excluded without a BV ID or source',()=>{
 for(const shell of ['bili-video-card','.bili-video-card','.video-card','.video-card-common']){
  const item=video([shell]);
  assert.equal(isMediaPreview(item,target('https://www.bilibili.com/video/BV1main')),true,shell);
  assert.equal(mediaCanInitialize(item,target('https://www.bilibili.com/video/BV1main')),false,shell);
 }
});

test('real YouTube players and Shorts take precedence over generic card ancestors',()=>{
 for(const route of ['watch?v=main','shorts/main','embed/main','live/main']){
  const item=video(['#movie_player','ytd-rich-item-renderer'],'blob:main');
  assert.equal(isMediaPreview(item,target('https://www.youtube.com/'+route)),false,route);
 }
 assert.equal(isMediaPreview(video(['ytd-reel-video-renderer','ytd-reel-item-renderer']),target('https://www.youtube.com/shorts/main')),false);
 assert.equal(isMediaPreview(video(['#movie_player','ytd-video-preview']),target('https://www.youtube.com/watch?v=main')),true,'an explicit preview shell still wins');
 assert.equal(mediaSignature(video(['#movie_player'],'blob:main'),target('https://www.youtube.com/watch?v=main')),'yt:main');
});

test('Bilibili primary and episode players remain media inside generic layout cards',()=>{
 for(const player of ['.bpx-player-container','#bilibili-player','bwp-video']){
  const item=video([player,'.video-card'],'blob:main');
  assert.equal(isMediaPreview(item,target('https://www.bilibili.com/video/BV1main')),false,player);
 }
 assert.equal(mediaSignature(video(['.bpx-player-container'],'blob:main'),target('https://www.bilibili.com/video/BV1main?p=2')),'bili:/video/BV1main:2');
});

test('a preview shell across an open shadow boundary is still excluded',()=>{
 const host=video(['ytd-video-preview']),item=video();item.getRootNode=()=>({host});
 assert.equal(isMediaPreview(item,target('https://www.youtube.com/')),true);
});

test('social feeds and unrelated hosts are never excluded by thumbnail-like classes',()=>{
 for(const host of ['www.facebook.com','www.instagram.com','www.tiktok.com','www.youtube.com.example.test','example.test']){
  const item=video(['.video-card','ytd-video-preview'],'blob:feed');
  assert.equal(isMediaPreview(item,target('https://'+host+'/feed')),false,host);
  assert.equal(mediaCanInitialize(item,target('https://'+host+'/feed')),true,host);
 }
});

test('main YouTube readiness and ad validation still apply independently of previews',()=>{
 const item=video(['#movie_player'],'blob:main'),attrs=new Map();item.getAttribute=name=>attrs.get(name)??null;
 assert.equal(mediaCanInitialize(item,target('https://www.youtube.com/watch?v=A')),false);
 attrs.set('data-video-control-ready','true');attrs.set('data-video-control-ready-key','yt:A');
 assert.equal(mediaCanInitialize(item,target('https://www.youtube.com/watch?v=A')),true);
 attrs.set('data-video-control-ad','true');assert.equal(mediaCanInitialize(item,target('https://www.youtube.com/watch?v=A')),false);
});
