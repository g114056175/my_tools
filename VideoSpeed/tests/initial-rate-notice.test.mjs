import test from 'node:test';
import assert from 'node:assert/strict';
import {InitialRateNotice} from '../src/initial-rate-notice.js';

class Video extends EventTarget{
 constructor(){super();Object.assign(this,{isConnected:true,paused:false,ended:false,readyState:4,currentTime:0,playbackRate:2,visible:true,callbacks:new Map(),serial:0});}
 getBoundingClientRect(){return {width:640,height:360};}
 checkVisibility(){return this.visible;}
 requestVideoFrameCallback(callback){const id=++this.serial;this.callbacks.set(id,callback);return id;}
 cancelVideoFrameCallback(id){this.callbacks.delete(id);}
 frame(){const callbacks=[...this.callbacks.values()];this.callbacks.clear();for(const callback of callbacks)callback(0,{mediaTime:this.currentTime});}
}
function fixture(t,{video=new Video(),shown={key:null},identity=null}={}){
 let key='yt:clip',selected=true;const values=[];
 const notice=new InitialRateNotice(video,{shown,identity:()=>identity?identity():key,canShow:()=>selected,show:()=>values.push(video.playbackRate)});
 t.after(()=>notice.dispose());return {video,notice,values,shown,setKey:value=>{key=value;},select:value=>{selected=value;}};
}

test('readyState and playing do not show a notice before a rendered frame',t=>{
 const {video,notice,values}=fixture(t);notice.request();video.dispatchEvent(new Event('playing'));
 assert.deepEqual(values,[]);assert.equal(video.callbacks.size,1);
 video.frame();assert.deepEqual(values,[2]);assert.equal(notice.listening,false);
});
test('repeated setup and source changes keep one pending notice and one shown notice',t=>{
 const {video,notice,values}=fixture(t);notice.request();video.currentSrc='blob:changed';notice.request();
 assert.equal(video.callbacks.size,1);video.frame();notice.request();video.frame();
 assert.deepEqual(values,[2]);assert.equal(notice.pending,false);
});
test('replacement elements for one YouTube route share deduplication; a new route can notify',t=>{
 const shown={key:null},first=fixture(t,{shown,identity:()=> 'yt:A'}),second=fixture(t,{shown,identity:()=> 'yt:A'});
 first.notice.request();second.notice.request();first.video.frame();second.video.frame();
 assert.equal(first.values.length+second.values.length,1);
 const next=fixture(t,{shown,identity:()=> 'yt:B'});next.notice.request();next.video.frame();assert.deepEqual(next.values,[2]);
});
test('a hidden or unselected preview waits and notifies after its visible frame',t=>{
 const {video,notice,values,select}=fixture(t,{identity:()=> 'preview:run:1'});
 video.visible=false;notice.request();assert.equal(video.callbacks.size,0);
 video.visible=true;select(false);notice.wake();assert.equal(video.callbacks.size,0);
 select(true);video.dispatchEvent(new Event('timeupdate'));assert.equal(video.callbacks.size,1);
 video.frame();assert.deepEqual(values,[2]);
});
test('leaving a preview cancels its callback; re-entering can show the new playback cycle',t=>{
 const {video,notice,values,setKey}=fixture(t);notice.request();notice.cancel();video.frame();assert.deepEqual(values,[]);
 setKey('preview:run:2');notice.request();video.frame();assert.deepEqual(values,[2]);
 setKey('preview:run:3');notice.request();video.frame();assert.deepEqual(values,[2,2]);
});
test('manual feedback and disposal cancel delayed automatic feedback',t=>{
 const {video,notice,values}=fixture(t);notice.request();notice.cancel();video.playbackRate=1.75;video.frame();assert.deepEqual(values,[]);
 notice.request();notice.dispose();video.frame();assert.deepEqual(values,[]);assert.equal(video.callbacks.size,0);
});
test('fallback waits for playback progress and one animation frame',t=>{
 const video=new Video(),frames=new Map();video.requestVideoFrameCallback=undefined;
 video.ownerDocument={defaultView:{requestAnimationFrame:callback=>{frames.set(1,callback);return 1;},cancelAnimationFrame:id=>frames.delete(id)}};
 const {notice,values}=fixture(t,{video});notice.request();assert.equal(frames.size,0);
 video.currentTime=.1;video.dispatchEvent(new Event('timeupdate'));assert.equal(frames.size,1);assert.deepEqual(values,[]);
 frames.get(1)();assert.deepEqual(values,[2]);
});
