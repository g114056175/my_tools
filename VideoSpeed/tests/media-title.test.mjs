import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaTitle,cleanMediaTitle} from '../src/media-title.js';

const element=(attributes={},textContent='')=>({getAttribute:name=>attributes[name]??null,textContent});
function document(title='',entries={},url='https://example.test/'){
  return {title,location:{href:url},querySelector:selector=>entries[selector]||null};
}
function video(attributes={},owners={},ownerDocument=document()){
  return {ownerDocument,getAttribute:name=>attributes[name]??null,
    closest:selectors=>selectors.split(',').map(selector=>owners[selector.trim()]).find(Boolean)||null};
}

test('YouTube generic aria label never outranks the real page title',()=>{
  const doc=document('A real clip - YouTube',{},'https://www.youtube.com/watch?v=abc');
  assert.equal(mediaTitle(video({'aria-label':'YouTube 影片播放器'}, {}, doc)),'A real clip');
});
test('platform names, translated player labels and controls are generic',()=>{
  for(const name of ['Video','YouTube','YouTube video player','YouTube 影片播放器','Twitch 影片播放器','Embedded video','嵌入式影片','影片 2','Video 2','播放','Bilibili'])assert.equal(cleanMediaTitle(name),'',name);
});
test('bound YouTube titles require current media identity',()=>{
  const attrs={'data-video-control-title':'Current title','data-video-control-title-id':'yt:abc','data-video-control-content-id':'yt:abc'};
  const doc=document('Fallback',{},'https://www.youtube.com/watch?v=abc');
  assert.equal(mediaTitle(video(attrs,{},doc)),'Current title');
  attrs['data-video-control-content-id']='yt:other';assert.equal(mediaTitle(video(attrs,{},doc)),'Fallback');
});
test('SPA route updates reject stale bound title before the player finishes switching',()=>{
  const attrs={'data-video-control-title':'Old clip','data-video-control-title-id':'yt:old','data-video-control-content-id':'yt:old'};
  const doc=document('New clip - YouTube',{},'https://www.youtube.com/watch?v=new');
  assert.equal(mediaTitle(video(attrs,{},doc)),'New clip');
});
test('main YouTube and Bilibili headings are usable when other videos are present',()=>{
  const yt=document('YouTube',{'ytd-watch-metadata h1':element({},'Main YouTube clip')});
  assert.equal(mediaTitle(video({}, {'#movie_player':{}},yt),{document:yt,total:3}),'Main YouTube clip');
  const bili=document('Bilibili',{'h1.video-title':element({title:'Bilibili episode'})});
  assert.equal(mediaTitle(video({}, {'.bpx-player-container':{}},bili),{document:bili,total:2}),'Bilibili episode');
});
test('social post copy is not used as a media title',()=>{
  const doc=document('Unrelated feed');
  for(const title of ['First post','Second post']){
    const article={querySelector:selector=>selector==='[data-testid="tweetText"]'?element({},title):null};
    assert.equal(mediaTitle(video({'aria-label':'Embedded video'},{article},doc),{document:doc,total:2,index:0}),'Video 1');
  }
});
test('social copy, replies, and translations never become media titles',()=>{
 const doc=document('Unrelated feed');
 const article={querySelector:selector=>selector==='[data-testid="tweetText"]'?element({},'Here’s what we’re cooking with Codex: 以下是...'):null};
 assert.equal(mediaTitle(video({'aria-label':'Embedded video'},{article},doc),{document:doc,total:2,index:0}),'Video 1');
 const card={querySelector:selector=>selector==='[data-testid="video-title"]'?element({},'COOKED: Ep. 1'):null};
 assert.equal(mediaTitle(video({}, {'article':card}, doc),{document:doc,total:2,index:0}),'Video 1');
});
test('X broadcast card aria title is scoped to the owning article',()=>{
 const doc=document('Unrelated feed');
 const card={querySelector:selector=>selector==='a[href][aria-label]'?element({href:'/i/broadcasts/1RKZzBELBbXKB','aria-label':'Open broadcast: COOKED: Ep. 1 🧑‍🍳'}):null};
 const item=video({}, {'article':card}, doc);item.parentElement=card;card.querySelectorAll=selector=>selector==='video'?[item]:selector==='a[href][aria-label]'?[card.querySelector(selector)]:[];
 assert.equal(mediaTitle(item,{document:doc,total:2,index:0}),'COOKED: Ep. 1 🧑‍🍳');
});
test('X broadcast cards in one article keep titles bound to their own video',()=>{
 const doc=document('Feed');
 const a=element({href:'/i/broadcasts/a111','aria-label':'Open broadcast: Card A'}),b=element({href:'/i/broadcasts/b222','aria-label':'Open broadcast: Card B'});
 const cardA={querySelectorAll:selector=>selector==='video'?[videoA]:selector==='a[href][aria-label]'?[a]:[]};
 const cardB={querySelectorAll:selector=>selector==='video'?[videoB]:selector==='a[href][aria-label]'?[b]:[]};
 const videoA=video({}, {'article':cardA}, doc),videoB=video({}, {'article':cardB}, doc);
 videoA.parentElement=cardA;videoB.parentElement=cardB;
 assert.equal(mediaTitle(videoA,{document:doc,total:2,index:0}),'Card A');
 assert.equal(mediaTitle(videoB,{document:doc,total:2,index:1}),'Card B');
});
test('explicit card titles stay bound to each video in a multi-video article',()=>{
 const doc=document('Feed');
 const cardA=element({'data-video-title':'Card A'}),cardB=element({'data-video-title':'Card B'});
 const videoA=video({}, {'article':cardA}, doc),videoB=video({}, {'article':cardB}, doc);
 cardA.querySelectorAll=selector=>selector==='video'?[videoA]:[];cardB.querySelectorAll=selector=>selector==='video'?[videoB]:[];
 cardA.querySelector=selector=>cardA.querySelectorAll(selector)[0]||null;cardB.querySelector=selector=>cardB.querySelectorAll(selector)[0]||null;
 videoA.parentElement=cardA;videoB.parentElement=cardB;
 assert.equal(mediaTitle(videoA,{document:doc,total:2,index:0}),'Card A');
 assert.equal(mediaTitle(videoB,{document:doc,total:2,index:1}),'Card B');
});
test('a sibling-only card title is ignored',()=>{
 const doc=document('Feed');const sibling=element({'data-video-title':'Other card'}),videoItem=video({}, {'article':sibling}, doc);
 const article={tagName:'ARTICLE',querySelectorAll:selector=>selector==='video'?[videoItem]:[]};videoItem.parentElement=article;
 assert.equal(mediaTitle(videoItem,{document:doc,total:1,index:0}),'Video 1');
});
test('player control labels cannot become titles or escape into another post',()=>{
  const player={querySelector:selector=>['[aria-label]','[title]','[data-title]'].includes(selector)?element({'aria-label':'Play',title:'Fullscreen','data-title':'Mute'}):null};
  const doc=document('Global title');
  assert.equal(mediaTitle(video({'aria-label':'Video'},{'[data-player]':player},doc),{document:doc,total:3,index:1}),'Video 2');
});
test('explicit data title is read as an attribute',()=>{
  const doc=document('Fallback');
  assert.equal(mediaTitle(video({'data-video-title':'A direct title'}, {},doc)),'A direct title');
  const player={...element({'data-title':'Player title'}),querySelector:()=>null};
  assert.equal(mediaTitle(video({}, {'[data-player]':player},doc),{document:doc,total:2}),'Player title');
});
test('generic OG metadata is skipped and unknown media is numbered',()=>{
  const entries={'meta[property="og:title"]':element({content:'YouTube video player'})};
  const doc=document('Actual page title',entries);
  assert.equal(mediaTitle(video({}, {},doc)),'Actual page title');
  doc.title='YouTube';assert.equal(mediaTitle(video({}, {},doc)),'Video 1');
});
test('an empty post does not inherit an unrelated page heading',()=>{
  const doc=document('Other title',{'h1.video-title':element({},'Other main video')});
  const article={querySelector:()=>null};
  assert.equal(mediaTitle(video({'aria-label':'Video'},{article},doc)),'Video 1');
});
test('page titles are read again after generic single-player SPA navigation',()=>{
  const doc=document('First route');const item=video({}, {},doc);
  assert.equal(mediaTitle(item),'First route');doc.title='Second route';assert.equal(mediaTitle(item),'Second route');
});
