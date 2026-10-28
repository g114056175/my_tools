import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceRetention} from '../extension/source-retention.js';
function harness(){
 let time=0,next=0;const sources=new Map(),timers=new Map(),expired=[];
 const retention=createSourceRetention({sources,now:()=>time,setTimer:(fn,ms)=>{timers.set(++next,{fn,at:time+ms});return next;},clearTimer:id=>timers.delete(id),onExpire:entries=>expired.push(...entries.map(([id])=>id))});
 return {sources,timers,expired,retention,add(id,tabId=7,references=0,extra={}){sources.set(id,{id,descriptor:{tabId},references,...extra});retention.refresh();},addRecord(source){sources.set(source.id,source);retention.refresh();},advance(ms){time+=ms;for(const [id,timer]of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}},jumpWithoutTimers(ms){time+=ms;},setTime(value){time=value;retention.refresh();}};
}
const playerSource=(id,inspectionOrder,patch={})=>({id,inspectionOrder,references:0,descriptor:{tabId:7,documentId:'document-a',frameId:0,mediaKey:'player-a',url:`https://cdn.example/${id}.mp4`,title:id,...patch}});
test('the last popup release starts a real 60 second eviction, not the inspection time',()=>{
 const h=harness();h.retention.setActiveTabs([7]);h.add('a');h.advance(300_000);
 assert.equal(h.sources.has('a'),true);assert.equal(h.timers.size,0);
 h.retention.setActiveTabs([]);h.advance(59_999);assert.equal(h.sources.has('a'),true);
 h.advance(1);assert.equal(h.sources.has('a'),false);assert.deepEqual(h.expired,['a']);assert.equal(h.timers.size,0);
});
test('reopening cancels the old deadline; only the next close starts another grace period',()=>{
 const h=harness();h.add('a');h.advance(59_999);h.retention.setActiveTabs([7]);h.advance(600_000);
 assert.equal(h.sources.has('a'),true);h.retention.setActiveTabs([]);h.advance(59_999);assert.equal(h.sources.has('a'),true);h.advance(1);assert.equal(h.sources.size,0);
});
test('a popup reopening at the expired deadline cannot revive data when its timer was delayed',()=>{
 const h=harness();h.add('a');h.jumpWithoutTimers(60_000);h.retention.setActiveTabs([7]);
 assert.equal(h.sources.has('a'),false);assert.deepEqual(h.expired,['a']);assert.equal(h.timers.size,0);
 h.add('fresh');h.advance(120_000);assert.equal(h.sources.has('fresh'),true);
});
test('queued, paused or running jobs retain a source beyond popup closure and release starts its grace',()=>{
 const h=harness();h.retention.setActiveTabs([7]);h.add('a',7,1);h.retention.setActiveTabs([]);h.advance(3_600_000);
 assert.equal(h.sources.has('a'),true);assert.equal(h.timers.size,0);
 h.sources.get('a').references=0;h.retention.refresh();h.advance(59_999);assert.equal(h.sources.has('a'),true);h.advance(1);assert.equal(h.sources.size,0);
});
test('different tabs expire independently and eviction reports the exact source records',()=>{
 const h=harness();h.retention.setActiveTabs([7]);h.add('a',7);h.add('b',8);h.advance(60_000);
 assert.deepEqual([...h.sources.keys()],['a']);assert.deepEqual(h.expired,['b']);
 h.retention.setActiveTabs([]);h.advance(60_000);assert.deepEqual(h.expired,['b','a']);
});
test('an active popup is not evicted by the previous 25 or 100 entry limits',()=>{
 const h=harness();h.retention.setActiveTabs([7]);for(let i=0;i<101;i++)h.add('source-'+i);h.advance(120_000);
 assert.equal(h.sources.size,101);assert.equal(h.timers.size,0);
 h.retention.setActiveTabs([]);assert.equal(h.timers.size,1);h.advance(60_000);assert.equal(h.sources.size,0);assert.equal(h.expired.length,101);
});
test('retaining a different source or finishing one job never releases the other job',()=>{
 const h=harness();h.add('a',7,1);h.add('b',8,1);h.sources.get('a').references=0;h.retention.refresh();h.advance(60_000);
 assert.deepEqual([...h.sources.keys()],['b']);h.sources.get('b').references=0;h.retention.refresh();h.advance(59_999);assert.equal(h.sources.has('b'),true);
});
test('clear removes only timer bookkeeping, and a fresh source gets a fresh deadline',()=>{
 const h=harness();h.add('old');h.sources.clear();h.retention.clear();assert.equal(h.timers.size,0);h.advance(120_000);h.add('new');h.advance(59_999);assert.equal(h.sources.has('new'),true);h.advance(1);assert.equal(h.sources.size,0);
});
test('a clock rollback discards idle data without discarding a retained job',()=>{
 const h=harness();h.setTime(10_000);h.add('idle');h.add('job',7,1);h.setTime(9_000);assert.deepEqual([...h.sources.keys()],['job']);
});

test('accepting a refreshed source supersedes the same player source even while its tab stays active',()=>{
 const h=harness();h.retention.setActiveTabs([7]);
 const first=playerSource('first',1),second=playerSource('second',2,{url:'https://cdn.example/rotated.mp4',title:'Updated title'});
 h.addRecord(first);assert.equal(h.retention.accept(first.id,'popup-a'),true);
 h.addRecord(second);assert.equal(h.retention.accept(second.id,'popup-a'),true);
 assert.deepEqual([...h.sources.keys()],[second.id]);assert.deepEqual(h.expired,[first.id]);
 assert.equal(h.timers.size,0,'the active latest source is retained without an idle timer');
});

test('a production-shaped superseded source without references is removed immediately',()=>{
 const h=harness(),old=playerSource('old-without-reference-field',1),fresh=playerSource('fresh-without-reference-field',2);
 delete old.references;delete fresh.references;h.retention.setActiveTabs([7]);
 h.addRecord(old);h.retention.accept(old.id,'popup-a');h.addRecord(fresh);
 assert.equal(h.retention.accept(fresh.id,'popup-a'),true);
 assert.equal(h.sources.has(old.id),false);assert.deepEqual(h.expired,[old.id]);
});

test('a superseded source stays until its download reference is released',()=>{
 const h=harness(),old=playerSource('job-old',10),fresh=playerSource('job-new',11);
 h.addRecord(old);h.retention.accept(old.id,'popup-a');old.references=1;
 h.addRecord(fresh);h.retention.accept(fresh.id,'popup-a');
 assert.equal(h.sources.has(old.id),true);assert.equal(h.expired.includes(old.id),false);
 old.references=0;h.retention.refresh();
 assert.equal(h.sources.has(old.id),false);assert.ok(h.sources.has(fresh.id));assert.deepEqual(h.expired,[old.id]);
});

test('accepting the same cached source adds a second popup owner lease',()=>{
 const h=harness(),cached=playerSource('cached-for-two-popups',12),fresh=playerSource('newer-source',13);
 h.addRecord(cached);assert.equal(h.retention.accept(cached.id,'popup-a'),true);
 assert.equal(h.retention.accept(cached.id,'popup-b'),true);
 h.addRecord(fresh);h.retention.accept(fresh.id,'popup-c');
 assert.equal(h.sources.has(cached.id),true);
 h.retention.releaseOwner('popup-a');assert.equal(h.sources.has(cached.id),true,'the cache-hit owner still holds the source');
 h.retention.releaseOwner('popup-b');assert.equal(h.sources.has(cached.id),false);
});

test('another popup owner keeps its older version until that owner releases it',()=>{
 const h=harness(),old=playerSource('popup-old',20),fresh=playerSource('popup-new',21);
 h.addRecord(old);assert.equal(h.retention.accept(old.id,'popup-a'),true);
 h.addRecord(fresh);assert.equal(h.retention.accept(fresh.id,'popup-b'),true);
 assert.equal(h.sources.has(old.id),true,'switching a different popup does not release the first popup owner');
 h.retention.releaseOwner('popup-a');
 assert.equal(h.sources.has(old.id),false);assert.ok(h.sources.has(fresh.id));
});

test('strict player scope separates tabs, documents, frames and media keys',()=>{
 const h=harness(),base=playerSource('base',1);h.addRecord(base);h.retention.accept(base.id,'base-owner');
 const separate=[
  playerSource('other-tab',2,{tabId:8}),
  playerSource('other-document',3,{documentId:'document-b'}),
  playerSource('other-frame',4,{frameId:1}),
  playerSource('other-player',5,{mediaKey:'player-b'}),
 ];
 for(let i=0;i<separate.length;i++){h.addRecord(separate[i]);h.retention.accept(separate[i].id,`owner-${i}`);}
 h.retention.releaseOwner('base-owner');
 assert.equal(h.sources.has(base.id),true,'a different tab/document/frame/player must not supersede the base');
 assert.equal(h.timers.size,1,'the unsuperseded base enters normal idle retention after its owner releases');
 assert.equal(h.expired.includes(base.id),false);
});

test('late earlier inspection cannot move one popup owner back or replace the newest scope version',()=>{
 const h=harness(),latest=playerSource('latest',30),lateSameOwner=playerSource('late-same-owner',20),lateOtherOwner=playerSource('late-other-owner',19),middle=playerSource('middle',25);
 h.addRecord(latest);assert.equal(h.retention.accept(latest.id,'popup-a'),true);
 h.addRecord(lateSameOwner);assert.equal(h.retention.accept(lateSameOwner.id,'popup-a'),false);
 assert.equal(h.sources.has(latest.id),true);assert.equal(h.sources.has(lateSameOwner.id),false);
 h.addRecord(lateOtherOwner);assert.equal(h.retention.accept(lateOtherOwner.id,'popup-b'),true,'a different popup may keep its earlier result');
 h.addRecord(middle);assert.equal(h.retention.accept(middle.id),false,'the earlier accepted result cannot become current after a newer one');
 assert.equal(h.sources.has(latest.id),true);assert.equal(h.sources.has(lateOtherOwner.id),true);assert.equal(h.sources.has(middle.id),false);
 h.retention.releaseOwner('popup-b');assert.equal(h.sources.has(lateOtherOwner.id),false);
});

test('owner request order lets a popup switch cached sources without a late response switching it back',()=>{
 const h=harness(),a=playerSource('player-a-old',1,{mediaKey:'player-a'}),b=playerSource('player-b',2,{mediaKey:'player-b'}),c=playerSource('player-a-new',3,{mediaKey:'player-a'});
 h.addRecord(a);h.retention.accept(a.id,'popup-x',1);
 h.addRecord(b);h.retention.accept(b.id,'popup-x',2);
 assert.equal(h.retention.accept(a.id,'popup-x',3),true,'a later request may select an older cached source');
 h.addRecord(c);h.retention.accept(c.id,'popup-y',4);
 assert.equal(h.sources.has(a.id),true,'the refreshed player-A source is superseded but still owned by popup-x');
 assert.equal(h.retention.accept(b.id,'popup-x',2),true,'a late request is harmless while its source remains cached');
 assert.equal(h.sources.has(a.id),true,'the late request-2 result cannot revoke popup-x request-3 ownership');
 h.retention.releaseOwner('popup-x');assert.equal(h.sources.has(a.id),false,'the request-3 owner release retires the superseded player-A source');
});

test('failed unaccepted candidates can be discarded without touching the accepted source',()=>{
 const h=harness(),current=playerSource('current',40),failed=playerSource('failed-candidate',41);
 h.addRecord(current);h.retention.accept(current.id,'popup-a');h.addRecord(failed);
 assert.equal(h.retention.discard(failed.id),true);
 assert.equal(h.sources.has(current.id),true);assert.equal(h.sources.has(failed.id),false);
 assert.deepEqual(h.expired,[failed.id]);assert.equal(h.retention.discard(current.id),false,'accepted sources are not candidates');
});

test('isAccepted reports only live accepted sources across discard and external removal',()=>{
 const h=harness(),candidate=playerSource('candidate-state',53),accepted=playerSource('accepted-state',54);
 h.addRecord(candidate);assert.equal(h.retention.isAccepted(candidate.id),false);
 assert.equal(h.retention.discard(candidate.id),true);assert.equal(h.retention.isAccepted(candidate.id),false);
 h.addRecord(accepted);assert.equal(h.retention.isAccepted(accepted.id),false);
 assert.equal(h.retention.accept(accepted.id,'popup-a'),true);assert.equal(h.retention.isAccepted(accepted.id),true);
 h.sources.delete(accepted.id);h.retention.refresh();assert.equal(h.retention.isAccepted(accepted.id),false);
});

test('discard never removes a candidate with a download reference and orphan owners are cleaned',()=>{
 const h=harness(),candidate=playerSource('candidate',50),owned=playerSource('owned',51);
 h.addRecord(candidate);candidate.references=1;assert.equal(h.retention.discard(candidate.id),false);assert.equal(h.sources.has(candidate.id),true);
 candidate.references=0;assert.equal(h.retention.discard(candidate.id),true);
 h.addRecord(owned);h.retention.accept(owned.id,'popup-orphan');
 h.sources.delete(owned.id);h.retention.refresh();h.retention.releaseOwner('popup-orphan');
 const fresh=playerSource('after-orphan',52);h.addRecord(fresh);
 assert.equal(h.timers.size,1,'a deleted source owner does not pin the next source or leave a stale timer');
 h.advance(60_000);assert.equal(h.sources.has(fresh.id),false);
});

test('externally deleted sources leave no accepted or superseded marker behind',()=>{
 const h=harness(),old=playerSource('reused-id',60),latest=playerSource('latest-after-reuse',61);
 old.references=1;h.addRecord(old);h.retention.accept(old.id,'popup-old');
 h.addRecord(latest);h.retention.accept(latest.id,'popup-latest');
 assert.equal(h.sources.has(old.id),true,'the download reference keeps the superseded record until external deletion');
 h.sources.delete(old.id);h.retention.refresh();
 const candidate=playerSource(old.id,62);h.addRecord(candidate);
 assert.equal(h.sources.has(candidate.id),true,'an orphan superseded marker must not delete a fresh candidate with the same key');
 assert.equal(h.retention.discard(candidate.id),true,'an orphan accepted marker must not block discarding a fresh candidate');
});
