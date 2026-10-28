import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaModelStore} from '../extension/media-models.js';

const FEED='https://www.facebook.com/kfctaiwan/';
const FIRST='1129269426460957';
const SECOND='1044927658301122';
const manifestFor=id=>`<MPD id="fixture-${id}">${'<Period/>'.repeat(1817)}</MPD>`;
const playerProps=id=>({
  coreVideoPlayerMetaData:{videoFBID:id},
  manifest:manifestFor(id),
  manifestUrl:`https://cdn.example/${id}.mpd`,
});

function hostFor(videos){
  return {nodeType:1,querySelectorAll:selector=>selector==='video'?videos:[]};
}

function player(id,{parentFiber=null,parentHost}={}){
  const video={
    nodeType:1,
    currentSrc:`blob:https://www.facebook.com/fixture-${id}`,
    src:'',
    parentElement:null,
    closest:()=>null,
    getAttribute:()=>'',
  };
  const current={memoizedProps:{videoID:id},stateNode:video,return:null};
  const owner={memoizedProps:playerProps(id),stateNode:parentHost||hostFor([video]),return:parentFiber};
  current.return=owner;
  Object.defineProperty(video,'__reactFiber$fixture',{value:current});
  return {video,current,owner};
}

function feed(ids=[FIRST,SECOND]){
  const players=ids.map(id=>player(id));
  const videos=players.map(item=>item.video);
  const doc={querySelectorAll:selector=>selector==='video'?videos:[]};
  for(const video of videos)video.ownerDocument=doc;
  const shared={memoizedProps:{},stateNode:hostFor(videos),return:null};
  for(const item of players)item.owner.return=shared;
  return {players,videos,doc};
}

test('Facebook player Fiber props restore each feed model across selection changes and a fresh store',()=>{
  const {videos}=feed(),store=createMediaModelStore();
  for(const video of [videos[0],videos[1],videos[0],videos[1]]){
    const model=store.modelFor(video,FEED);
    const id=video===videos[0]?FIRST:SECOND;
    assert.equal(model?.id,id);
    assert.ok(model?.aliases.includes(id));
    if(model?.manifestUrl)assert.equal(model.manifestUrl,`https://cdn.example/${id}.mpd`);
    assert.ok(model?.manifestXml?.startsWith(`<MPD id="fixture-${id}">`));
    assert.ok(model.manifestXml.length>14_500);
    assert.ok(!model.manifestXml.includes(`fixture-${id===FIRST?SECOND:FIRST}`));
  }

  // A disposed observer is replaced with a new model store; the live player
  // Fiber still owns the selected metadata and can repopulate that store.
  const reinstalled=createMediaModelStore();
  assert.ok(reinstalled.modelFor(videos[0],FEED)?.manifestXml?.includes(`fixture-${FIRST}`));
  assert.ok(reinstalled.modelFor(videos[1],FEED)?.manifestXml?.includes(`fixture-${SECOND}`));
});

test('Facebook player metadata above a shared multi-video host is not inherited',()=>{
  const firstVideo={nodeType:1,currentSrc:'blob:https://www.facebook.com/first',src:'',closest:()=>null,getAttribute:()=>''};
  const secondVideo={nodeType:1,currentSrc:'blob:https://www.facebook.com/second',src:'',closest:()=>null,getAttribute:()=>''};
  const doc={querySelectorAll:selector=>selector==='video'?[firstVideo,secondVideo]:[]};
  firstVideo.ownerDocument=secondVideo.ownerDocument=doc;
  const shared={memoizedProps:playerProps(FIRST),stateNode:hostFor([firstVideo,secondVideo]),return:null};
  const firstFiber={memoizedProps:{videoID:FIRST},stateNode:firstVideo,return:shared};
  const secondFiber={memoizedProps:{videoID:SECOND},stateNode:secondVideo,return:shared};
  Object.defineProperty(firstVideo,'__reactFiber$fixture',{value:firstFiber});
  Object.defineProperty(secondVideo,'__reactFiber$fixture',{value:secondFiber});
  const store=createMediaModelStore();

  assert.equal(store.modelFor(firstVideo,FEED),null);
  assert.equal(store.modelFor(secondVideo,FEED),null);
});

test('Facebook player ID conflicts and neighbouring payloads do not bind',()=>{
  const conflicting=player(FIRST);
  conflicting.owner.memoizedProps=playerProps(SECOND);
  const neighbor=player(SECOND);
  const videos=[conflicting.video,neighbor.video];
  const doc={querySelectorAll:selector=>selector==='video'?videos:[]};
  for(const video of videos)video.ownerDocument=doc;
  const shared={memoizedProps:{},stateNode:hostFor(videos),return:null};
  conflicting.owner.return=shared;neighbor.owner.return=shared;
  const store=createMediaModelStore();

  assert.equal(store.modelFor(conflicting.video,FEED),null);
  const selected=store.modelFor(neighbor.video,FEED);
  assert.equal(selected?.id,SECOND);
  assert.ok(selected?.manifestXml?.includes(`fixture-${SECOND}`));
  assert.ok(!selected?.manifestXml.includes(`fixture-${FIRST}`));
});

test('reused Facebook video reads the new player props instead of its prior manifest',()=>{
  const reused=player(FIRST),videos=[reused.video];
  reused.video.ownerDocument={querySelectorAll:selector=>selector==='video'?videos:[]};
  const store=createMediaModelStore();
  const original=store.modelFor(reused.video,FEED);
  assert.ok(original?.manifestXml?.includes(`fixture-${FIRST}`));

  reused.video.currentSrc=`blob:https://www.facebook.com/fixture-${SECOND}`;
  reused.current.memoizedProps={videoID:SECOND};
  reused.owner.memoizedProps=playerProps(SECOND);
  const replacement=store.modelFor(reused.video,FEED);
  assert.equal(replacement?.id,SECOND);
  if(replacement?.manifestUrl)assert.equal(replacement.manifestUrl,`https://cdn.example/${SECOND}.mpd`);
  assert.ok(replacement?.manifestXml?.startsWith(`<MPD id="fixture-${SECOND}">`));
  assert.ok(!replacement?.manifestXml?.includes(`fixture-${FIRST}`));
});

test('Facebook core player metadata shape is not normalized on Instagram or TikTok',()=>{
  for(const host of ['www.instagram.com','www.tiktok.com']){
    const target=player(FIRST);
    target.video.ownerDocument={querySelectorAll:selector=>selector==='video'?[target.video]:[]};
    const model=createMediaModelStore().modelFor(target.video,`https://${host}/feed/`);
    assert.equal(model,null,host);
  }
});
