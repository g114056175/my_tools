import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaTitle,cleanMediaTitle} from '../src/media-title.js';

const element=(attributes={},textContent='')=>({getAttribute:name=>attributes[name]??null,textContent});
function document(title='',entries={},url='https://example.test/'){
  return {title,location:{href:url},querySelector:selector=>entries[selector]||null};
}
function video(attributes={},owners={},ownerDocument=document()){
  return {tagName:'VIDEO',ownerDocument,getAttribute:name=>attributes[name]??null,
    closest:selectors=>selectors.split(',').map(selector=>owners[selector.trim()]).find(Boolean)||null};
}
function cardDocument(nodes,title='Feed'){
  const doc=document(title);
  doc.createTreeWalker=root=>{
    assert.equal(root.tagName,'YTD-VIDEO-RENDERER');
    let index=0;
    return {nextNode:()=>nodes[index++]||null};
  };
  return doc;
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
  const yt=document('YouTube',{[MAIN_HEADING] : element({},'Main YouTube clip')});
  assert.equal(mediaTitle(video({}, {'#movie_player':{}},yt),{document:yt,total:3}),'Main YouTube clip');
  const bili=document('Bilibili',{[MAIN_HEADING] : element({title:'Bilibili episode'})});
  assert.equal(mediaTitle(video({}, {'.bpx-player-container':{}},bili),{document:bili,total:2}),'Bilibili episode');
});
test('social post copy and broadcast links never become media titles',()=>{
  const doc=document('Unrelated feed - X',{},'https://x.com/home');
  const article={tagName:'ARTICLE',querySelector:()=>element({},'First post'),querySelectorAll:()=>{throw new Error('unbounded scan');}};
  for(const index of [0,1]){
    const item=video({'aria-label':'Embedded video'},{article},doc);
    Object.defineProperty(item,'parentElement',{get(){throw new Error('ancestor walk');}});
    assert.equal(mediaTitle(item,{document:doc,total:2,index}),`Video ${index+1}`);
  }
});
test('a bounded trusted card title is read only when the card contains this one video',()=>{
  const target=video();
  const card={tagName:'YTD-VIDEO-RENDERER',getAttribute:()=>null,
    querySelector:selector=>selector===CARD_TITLE?element({},'Trusted card title'):null};
  const doc=cardDocument([target,element({},'bounded child')]);
  target.ownerDocument=doc;
  target.closest=selectors=>selectors.split(',').map(selector=>selector.trim()==='ytd-video-renderer'?card:null).find(Boolean)||null;
  assert.equal(mediaTitle(target,{document:doc,total:4,index:2}),'Trusted card title');
});
test('a trusted card with another video cannot cross-assign its title',()=>{
  const target=video(),other=video();
  let titleReads=0;
  const card={tagName:'YTD-VIDEO-RENDERER',getAttribute:()=>null,querySelector:()=>{titleReads++;return element({},'Other video title');}};
  const doc=cardDocument([target,other]);target.ownerDocument=doc;
  target.closest=selectors=>selectors.includes('ytd-video-renderer')?card:null;
  assert.equal(mediaTitle(target,{document:doc,total:2,index:0}),'Video 1');
  assert.equal(titleReads,0);
});
test('large cards stop at the traversal cap and do not query card title slots',()=>{
  const target=video();let titleReads=0;
  const card={tagName:'YTD-VIDEO-RENDERER',getAttribute:()=>null,querySelector:()=>{titleReads++;return element({},'Deep title');}};
  const doc=cardDocument([target,...Array.from({length:MAX_CARD_LIMIT},()=>element())]);target.ownerDocument=doc;
  target.closest=selectors=>selectors.includes('ytd-video-renderer')?card:null;
  assert.equal(mediaTitle(target,{document:doc,total:2,index:1}),'Video 2');
  assert.equal(titleReads,0);
});
test('player controls and generic labels are not used as titles',()=>{
  const player={getAttribute:()=>null,querySelector:()=>null};
  const doc=document('Global title');
  assert.equal(mediaTitle(video({'aria-label':'Video'},{'[data-player]':player},doc),{document:doc,total:3,index:1}),'Video 2');
});
test('explicit video and player data titles are preferred',()=>{
  const doc=document('Fallback');
  assert.equal(mediaTitle(video({'data-video-title':'A direct title'}, {},doc)),'A direct title');
  const player={...element({'data-title':'Player title'}),querySelector:()=>null};
  assert.equal(mediaTitle(video({}, {'[data-player]':player},doc),{document:doc,total:2}),'Player title');
});
test('generic metadata is skipped and unknown media is numbered',()=>{
  const entries={'meta[property="og:title"]':element({content:'YouTube video player'})};
  const doc=document('Actual page title',entries);
  assert.equal(mediaTitle(video({}, {},doc)),'Actual page title');
  doc.title='YouTube';assert.equal(mediaTitle(video({}, {},doc)),'Video 1');
});
test('page title is not inherited by a media item inside a social post',()=>{
  const doc=document('Other title');
  const article={tagName:'ARTICLE'};
  assert.equal(mediaTitle(video({'aria-label':'Video'},{article},doc)),'Video 1');
});
test('page titles are read again after generic single-player SPA navigation',()=>{
  const doc=document('First route');const item=video({}, {},doc);
  assert.equal(mediaTitle(item),'First route');doc.title='Second route';assert.equal(mediaTitle(item),'Second route');
});
test('unknown media title lookup does not enumerate ancestor videos or descendants',()=>{
  const doc=document('Feed',{},'https://example.test/feed');
  doc.querySelectorAll=()=>{throw new Error('full descendant scan');};
  const item=video({'aria-label':'Embedded video'}, {},doc);
  Object.defineProperty(item,'parentElement',{get(){throw new Error('ancestor census');}});
  assert.equal(mediaTitle(item,{document:doc,total:64,index:63}),'Video 64');
});

const MAIN_HEADING='ytd-watch-metadata h1 yt-formatted-string,ytd-watch-metadata h1,#title h1,h1.video-title,.video-info-title';
const CARD_TITLE='[data-e2e="video-title"],[data-e2e="browse-video-card-title"],[data-video-title],.video-title,#video-title,[itemprop="name"]';
const MAX_CARD_LIMIT=96;
