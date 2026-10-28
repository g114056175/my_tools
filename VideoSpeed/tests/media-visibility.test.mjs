import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaGeometry,verifyMediaGeometry} from '../src/media-visibility.js';
const view={innerWidth:1000,innerHeight:800};
const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
test('geometry measures visible area, ratio and center instead of playback state',()=>{
 const centered=mediaGeometry(rect(100,100,800,600),view),edge=mediaGeometry(rect(100,-599,800,600),view);
 assert.equal(centered.visibleArea,480000);assert.equal(centered.visibleRatio,1);assert.equal(centered.centrality,1);
 assert.equal(edge.visibleArea,800);assert.ok(edge.visibleRatio<.002);assert.ok(edge.centrality<centered.centrality);
});
test('intersection clipping includes parent overflow and iframe viewport restrictions',()=>{
 const box=rect(0,0,640,360),intersection={boundingClientRect:box,intersectionRect:rect(0,0,640,1)};
 const item=mediaGeometry(box,view,{intersection});assert.equal(item.visibleArea,640);assert.ok(item.visibleRatio<.003);
 assert.equal(mediaGeometry(box,view,{intersection:{...intersection,intersectionRect:rect(0,0,0,0)},waitForIntersection:true}).visible,false);
});
test('a child frame waits for its first intersection and top-frame geometry remains immediate',()=>{
 const box=rect(0,0,640,360);
 assert.equal(mediaGeometry(box,view,{waitForIntersection:true}).visible,false);
 assert.equal(mediaGeometry(box,view).visible,true);
});
test('top-frame scroll ignores a stale intersection rectangle until the browser reports new geometry',()=>{
 const before=rect(0,-400,640,360),after=rect(0,100,640,360);
 const item=mediaGeometry(after,view,{intersection:{boundingClientRect:before,intersectionRect:rect(0,0,0,0)}});
 assert.equal(item.visible,true);assert.equal(item.visibleRatio,1);
});
test('synchronous clipping is bounded and shares ancestor style reads across candidates',()=>{
 let reads=0;const parent={getBoundingClientRect:()=>rect(0,0,640,1)},cache=new WeakMap();
 const localView={...view,getComputedStyle:()=>{reads++;return {overflowX:'hidden',overflowY:'hidden'};}};
 const item=mediaGeometry(rect(0,0,640,360),view),video={parentElement:parent};
 assert.equal(verifyMediaGeometry(video,localView,item,cache).visibleArea,640);
 verifyMediaGeometry(video,localView,item,cache);assert.equal(reads,1);
});
test('transparent or hidden ancestors cannot remain visible in immediate keyboard validation',()=>{
 const item=mediaGeometry(rect(0,0,640,360),view),video={parentElement:{getBoundingClientRect:()=>rect(0,0,640,360)}};
 assert.equal(verifyMediaGeometry(video,{...view,getComputedStyle:()=>({opacity:'0'})},item).visible,false);
});
