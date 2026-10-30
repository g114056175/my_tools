import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoToast} from '../src/video-toast.js';

class Node extends EventTarget{
 constructor(){super();this.children=[];this.style={};this.attributes=new Map();this.writes=0;this._text='';}
 get textContent(){return this._text;}
 set textContent(value){this._text=value;this.writes++;}
 setAttribute(name,value){this.attributes.set(name,value);}
 append(...nodes){for(const node of nodes){node.remove?.();node.parentElement=this;this.children.push(node);}}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
 attachShadow(){return this.shadowRoot=new Node();}
 getBoundingClientRect(){return {left:20,top:30,width:640,height:360};}
}
function fixture(t){
 const document=new EventTarget();document.documentElement=new Node();document.body=new Node();document.createElement=()=>new Node();
 document.defaultView=Object.assign(new EventTarget(),{scrollX:0,scrollY:0,getComputedStyle:()=>({position:'static'})});
 const video=new Node();video.isConnected=true;video.playbackRate=2;
 const toast=new VideoToast(document);t.after(()=>toast.clear());return {video,toast};
}

test('each rapid adjustment updates the same toast immediately',t=>{
 const {video,toast}=fixture(t);toast.show(video,'2×');const host=toast.host,label=toast.label;
 for(const value of ['1.75×','1.5×','1.25×']){
  toast.show(video,value);assert.equal(toast.label.textContent,value);assert.strictEqual(toast.host,host);assert.strictEqual(toast.label,label);
 }
 assert.equal(toast.document.documentElement.children.length,1);
});

test('popup hold reuses an existing transient toast and does not rewrite unchanged text',t=>{
 const {video,toast}=fixture(t);toast.show(video,'2×');const host=toast.host;
 toast.hold(video);assert.strictEqual(toast.host,host);assert.equal(toast.persistent,true);
 const writes=toast.label.writes;toast.paint();toast.paint();assert.equal(toast.label.writes,writes);
 video.playbackRate=1.75;toast.show(video,'1.75×');assert.equal(toast.label.textContent,'1.75×');assert.strictEqual(toast.host,host);
 toast.release();assert.equal(toast.host,null);assert.equal(toast.document.documentElement.children.length,0);
});

test('each adjustment restarts the visible lifetime without remounting the toast',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {video,toast}=fixture(t);
 toast.show(video,'1.5×');const host=toast.host;t.mock.timers.tick(1000);
 toast.show(video,'1.75×');assert.strictEqual(toast.host,host);assert.equal(toast.label.textContent,'1.75×');
 t.mock.timers.tick(1099);assert.strictEqual(toast.host,host);
 assert.equal(toast.document.documentElement.children.length,1);
 t.mock.timers.tick(1);assert.equal(toast.host,null);
});

test('clearing a rapid sequence cannot resurrect an older notice',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {video,toast}=fixture(t);toast.show(video,'1.5×');t.mock.timers.tick(100);
 toast.show(video,'2×');toast.clear();t.mock.timers.tick(2000);
 assert.equal(toast.host,null);assert.equal(toast.document.documentElement.children.length,0);
});

test('detaching the current video removes its notice on the next paint',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const {video,toast}=fixture(t);toast.show(video,'1.5×');video.isConnected=false;
 t.mock.timers.tick(150);assert.equal(toast.host,null);assert.equal(toast.document.documentElement.children.length,0);
});
