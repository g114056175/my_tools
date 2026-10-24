import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pageSnapshot} from '../extension/page.js';

function node({tag='div', attrs={}, children=[], rect={left:0,top:0,right:640,bottom:360,width:640,height:360}, paused=true}={}) {
  const item={tagName:tag.toUpperCase(), children, parentElement:null, ownerDocument:null, src:'', currentSrc:'', textTracks:[], paused, readyState:4,
    getAttribute(name){return attrs[name] ?? null;},
    hasAttribute(name){return Object.prototype.hasOwnProperty.call(attrs,name);},
    querySelectorAll(selector){
      const out=[]; const visit=child=>{if(selector==='video'&&child.tagName==='VIDEO'||selector==='a[href]'&&child.tagName==='A'&&child.getAttribute('href'))out.push(child);for(const nested of child.children||[])visit(nested);};
      for(const child of item.children||[])visit(child); return out;
    },
    querySelector(selector){return item.querySelectorAll(selector)[0]||null;},
    getBoundingClientRect(){return rect;},
    getRootNode(){return {host:null};},
    closest(){return null;},
  };
  for(const child of children)child.parentElement=item;
  return item;
}

function context({url, videos}) {
  const document={title:'X',scripts:[],documentElement:{lang:'en'},querySelector:()=>null,querySelectorAll:selector=>selector==='video'?videos:[]};
  for(const video of videos)video.ownerDocument=document;
  const value={URL,URLSearchParams,Symbol,WeakMap,AbortSignal,setTimeout,location:new URL(url),navigator:{languages:['en-US']},performance:{now:()=>0,getEntriesByType:()=>[]},innerWidth:1200,innerHeight:900,document};
  value.window=value;
  value[Symbol.for('video-pocket.mediaObserver')]={scanDocument(){},modelFor(){return null;},sourcesFor(){return {candidates:[]};},titleFor(){return '';},isGenericTitle(){return false;}};
  return value;
}

async function snapshot(url, videos, index=0, mode='summary') {
  return vm.runInNewContext(`(${pageSnapshot.toString()})(${index},${JSON.stringify(mode)})`, context({url,videos}));
}

test('current X post permalink beats an earlier comment GIF while preserving slots', async()=>{
  const commentLink=node({tag:'a',attrs:{href:'https://x.com/other/status/9'}});
  const mainLink=node({tag:'a',attrs:{href:'https://x.com/OpenAIDevs/status/2112242739198959913'}});
  const commentArticle=node({tag:'article',children:[commentLink]});
  const mainArticle=node({tag:'article',children:[mainLink]});
  const gif=node({attrs:{src:'https://video.example/bored-eminem.gif'},children:[]}); gif.tagName='VIDEO'; gif.src='https://video.example/bored-eminem.gif'; gif.parentElement=commentArticle; commentArticle.children.push(gif);
  const main=node({children:[] ,paused:false}); main.tagName='VIDEO'; main.parentElement=mainArticle; mainArticle.children.push(main);
  // Model a nested reply/card inside the current post. The reply must not
  // inherit the outer post's permalink match.
  commentArticle.parentElement=mainArticle; mainArticle.children.push(commentArticle);
  const page=await snapshot('https://x.com/OpenAIDevs/status/2112242739198959913',[gif,main]);
  assert.equal(page.preferredMediaIndex,1);
  assert.equal(page.mediaIndex,0);
  assert.equal(page.videos[0].url,'https://video.example/bored-eminem.gif');
  assert.equal(page.videos[1].url,'');
});

test('a different status permalink cannot claim the current post player', async()=>{
  const wrongLink=node({tag:'a',attrs:{href:'https://x.com/other/status/9'}});
  const currentLink=node({tag:'a',attrs:{href:'https://x.com/OpenAIDevs/status/2112242739198959913'}});
  const wrong=node({tag:'video',children:[wrongLink],paused:false});
  const current=node({tag:'video',children:[currentLink],paused:true});
  const page=await snapshot('https://x.com/OpenAIDevs/status/2112242739198959913',[wrong,current]);
  assert.equal(page.preferredMediaIndex,1);
});

test('explicit media index remains unchanged when preferred index differs in summary and deep snapshots', async()=>{
  const link=node({tag:'a',attrs:{href:'https://x.com/OpenAIDevs/status/2112242739198959913'}});
  const main=node({tag:'video',children:[link],paused:false});
  const comment=node({tag:'video',paused:true});
  for(const mode of ['summary','deep']){
    const page=await snapshot('https://x.com/OpenAIDevs/status/2112242739198959913',[comment,main],0,mode);
    assert.equal(page.mediaIndex,0); assert.equal(page.preferredMediaIndex,1);
  }
});

test('one video and an iframe-like isolated document return a safe zero preference', async()=>{
  const page=await snapshot('https://x.com/i/broadcasts/broadcast-123',[node({tag:'video'})]);
  assert.equal(page.preferredMediaIndex,0); assert.equal(page.mediaIndex,0);
});
