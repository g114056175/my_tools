import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {genericPlayerSnapshot} from '../extension/generic-player.js';

class Node {
 constructor(tag,attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.children=[];this.parentElement=null;this.isConnected=true;}
 append(node){this.children.push(node);node.parentElement=this;return node;}
 getAttribute(key){return this.attrs[key] ?? null;}
 contains(node){return this===node||this.children.some(child=>child.contains(node));}
 querySelectorAll(selector){const found=[];const visit=node=>{for(const child of node.children){if(selector==='video'&&child.tagName==='VIDEO'||selector==='script[type="application/ld+json"]'&&child.tagName==='SCRIPT'&&child.attrs.type==='application/ld+json')found.push(child);visit(child);}};visit(this);return found;}
 closest(selector){for(let n=this;n;n=n.parentElement){const classes=(n.attrs.class || '').split(' ');if(selector==='.jwplayer'?classes.includes('jwplayer'):n.tagName==='FIGURE'||classes.includes('video-js')||n.attrs['data-video-id']||n.attrs['data-media-id'])return n;}return null;}
}
function fixture(){
 const document=new Node('document'),wrapper=document.append(new Node('div',{class:'jwplayer',id:'selected'}));
 const video=wrapper.append(new Node('video',{id:'actual-video'}));video.currentSrc='blob:one';video.duration=60;
 const keys=new WeakMap([[video,7]]),window={[Symbol.for('video-pocket.identities')]:{keys}},location={href:'https://unknown.example/watch'};
 let parses=0;
 const context={window,document,location,URL,performance:{now:()=>0},JSON:{stringify:JSON.stringify,parse(){parses++;throw new Error('The old parser must not be invoked');}}};
 const collect=(options={})=>JSON.parse(JSON.stringify(vm.runInNewContext(`(${genericPlayerSnapshot.toString()})(options)`,{...context,options:{mediaKey:7,pageUrl:location.href,...options}})));
 const script=(parent,value)=>{const n=parent.append(new Node('script',{type:'application/ld+json'}));n.textContent=typeof value==='string'?value:JSON.stringify(value);return n;};
 return {document,wrapper,video,keys,window,context,collect,script,get parses(){return parses;}};
}

test('JW Player reads only the selected container and its current item, never a neighbouring ad or playlist entry',()=>{
 const f=fixture(),ad=f.document.append(new Node('div',{class:'jwplayer',id:'advert'}));ad.append(new Node('video'));
 let lookups=0;f.window.jwplayer=id=>{lookups++;assert.equal(id,'selected');return {getContainer:()=>f.wrapper,getPlaylistItem:()=>({mediaid:'movie',title:'ignored',sources:[{file:'/movie.m3u8',type:'application/vnd.apple.mpegurl'},{file:'/movie.mp4',type:'video/mp4'}]}),setup:()=>assert.fail('must not set up a player')};};
 const result=f.collect();assert.equal(result.parser,'jwplayer');assert.deepEqual(result.candidates,[{url:'https://unknown.example/movie.m3u8',kind:'hls'},{url:'https://unknown.example/movie.mp4',kind:'progressive'}]);
 assert.equal(lookups,1);assert.equal(result.title,undefined);assert.equal(f.parses,0);
 assert.equal(result.metadata.title,'ignored');
});

test('JW playlist lookup requires an explicit current index',()=>{
 const f=fixture();f.window.jwplayer=()=>({getContainer:()=>f.wrapper,getPlaylist:()=>[{file:'/ad.mp4'},{file:'/actual.mp4'}],getPlaylistIndex:()=>1});
 assert.equal(f.collect().candidates[0].url,'https://unknown.example/actual.mp4');
 f.window.jwplayer=()=>({getContainer:()=>f.wrapper,getPlaylist:()=>[{file:'/ad.mp4'}]});assert.equal(f.collect().valid,false);
});

test('multiple videos or a mismatched JW container cannot borrow a source',()=>{
 const f=fixture();let calls=0;f.window.jwplayer=()=>{calls++;return {getContainer:()=>new Node('div'),getPlaylistItem:()=>({file:'/wrong.mp4'})};};
 assert.equal(f.collect().valid,false);
 f.wrapper.append(new Node('video'));assert.equal(f.collect().valid,false);assert.equal(calls,1);
});

test('container ownership also checks local videos beyond the page inventory limit',()=>{
 const f=fixture();f.document.children=[];
 for(let n=0;n<255;n++)f.document.append(new Node('video'));
 f.document.append(f.wrapper);f.wrapper.append(new Node('video'));
 f.window.jwplayer=()=>assert.fail('ambiguous container must not be queried');
 assert.equal(f.collect().valid,false);
});

test('Video.js uses existing owned instances and bounded configuration sources without initialization',()=>{
 const f=fixture();f.wrapper.attrs.class='video-js';let initialized=0;
 const api=()=>{initialized++;};api.getAllPlayers=()=>[{el:()=>f.wrapper,options_:{sources:[{src:'/source-without-suffix',type:'video/mp4'}]}}];f.window.videojs=api;
 const result=f.collect();assert.equal(result.parser,'videojs');assert.equal(result.candidates[0].url,'https://unknown.example/source-without-suffix');assert.equal(initialized,0);
 api.getAllPlayers=()=>[{el:()=>new Node('div'),currentSource:()=>({src:'/ad.mp4'})}];assert.equal(f.collect().valid,false);
});

test('element-owned data-setup uses a separate bounded JSON reader and leaves JSON interception untouched',()=>{
 const f=fixture();f.video.attrs['data-setup']='{"sources":[{"src":"https:\\/\\/cdn.test\\/clip\\u002emp4","type":"video/mp4"}],"autoplay":false,"number":1.25e2,"x":null}';
 const result=f.collect();assert.equal(result.parser,'data-setup');assert.equal(result.candidates[0].url,'https://cdn.test/clip.mp4');assert.equal(f.parses,0);
});

test('JSON expressions, malformed strings, excessive depth and oversized configuration are rejected without execution',()=>{
 const f=fixture();f.context.attack=()=>assert.fail('must not execute');
 for(const value of ['{"sources":attack()}','{"file":"/clip.mp4",}', '{"file":"bad\\q.mp4"}', '{"file":"/clip.mp4"} trailing', '['.repeat(20)+'0'+']'.repeat(20), ' '.repeat(65537)]){
  f.video.attrs['data-setup']=value;assert.equal(f.collect().valid,false,value.slice(0,50));
 }
 assert.equal(f.parses,0);
});

test('scoped JSON-LD and exact graph fragment IDs bind to the selected element',()=>{
 const f=fixture();f.wrapper.attrs.class='video-js';
 f.script(f.wrapper,{'@type':'VideoObject',contentUrl:'/local.mp4'});assert.equal(f.collect().candidates[0].url,'https://unknown.example/local.mp4');
 f.wrapper.children=f.wrapper.children.filter(n=>n.tagName!=='SCRIPT');
 f.script(f.document,{'@graph':[{'@type':'VideoObject','@id':'#other',contentUrl:'/ad.mp4'},{'@type':'VideoObject','@id':'https://unknown.example/watch#actual-video',contentUrl:'/real.mp4'}]});
 const result=f.collect();assert.equal(result.parser,'json-ld');assert.equal(result.candidates[0].url,'https://unknown.example/real.mp4');assert.equal(f.parses,0);
});

test('global JSON-LD without an exact element identity is not assigned to a selected player',()=>{
 const f=fixture();f.script(f.document,{'@type':'VideoObject',contentUrl:'/page-default-or-ad.mp4'});assert.equal(f.collect().valid,false);
 const other=f.document.append(new Node('figure'));other.append(new Node('video'));f.script(other,{'@type':'VideoObject',contentUrl:'/neighbour.mp4'});assert.equal(f.collect().valid,false);
});

test('ambiguous scoped VideoObjects are not selected by duration or document order',()=>{
 const f=fixture();f.wrapper.attrs.class='video-js';f.script(f.wrapper,[{'@type':'VideoObject',contentUrl:'/one.mp4',duration:60},{'@type':'VideoObject',contentUrl:'/two.mp4',duration:60}]);assert.equal(f.collect().valid,false);
});

test('element source changes, playlist changes, navigation and disconnected players invalidate the binding',()=>{
 const f=fixture();let file='/one.mp4';f.window.jwplayer=()=>({getContainer:()=>f.wrapper,getPlaylistItem:()=>({file})});
 const binding=f.collect().binding;assert.equal(f.collect({binding}).valid,true);
 file='/two.mp4';assert.equal(f.collect({binding}).valid,false);file='/one.mp4';
 f.video.currentSrc='blob:replacement';assert.equal(f.collect({binding}).valid,false);f.video.currentSrc='blob:one';
 f.context.location.href='https://unknown.example/next';assert.equal(f.collect({pageUrl:binding.pageUrl,binding}).valid,false);
 f.context.location.href=binding.pageUrl;f.video.isConnected=false;assert.equal(f.collect({binding}).valid,false);
});

test('bounded candidates and elapsed-time checks cannot return a partial timed-out scan',()=>{
 const f=fixture();f.video.attrs['data-setup']=JSON.stringify({sources:Array.from({length:40},(_,i)=>({src:`/${i}.mp4`}))});assert.equal(f.collect().candidates.length,6);
 let elapsed=0;f.context.performance.now=()=>elapsed+=100;assert.equal(f.collect().valid,false);
});

test('DRM and oversized source identities are rejected before reading player APIs',()=>{
 const f=fixture();f.window.jwplayer=()=>assert.fail('must not query');f.video.mediaKeys={};assert.equal(f.collect().valid,false);
 f.video.mediaKeys=null;f.video.currentSrc='data:'.padEnd(20000,'x');assert.equal(f.collect().valid,false);
});

test('prototype-shaped JSON keys do not mutate page objects or the shared observer',()=>{
 const f=fixture();f.video.attrs['data-setup']='{"__proto__":{"polluted":true},"file":"/real.mp4"}';
 assert.equal(f.collect().candidates[0].url,'https://unknown.example/real.mp4');assert.equal({}.polluted,undefined);assert.equal(f.parses,0);
});

test('only element-owned embed metadata is returned for later provider delegation',()=>{
 const f=fixture();f.video.attrs['data-setup']=JSON.stringify({sources:[{src:'https://player.twitch.tv/?video=v123',type:'video/twitch'}]});
 assert.deepEqual(f.collect().candidates,[{embedUrl:'https://player.twitch.tv/?video=v123'}]);
});

test('early collection queries selected JW data but does not enumerate Video.js or parse arbitrary data-setup',()=>{
 const f=fixture();f.window.jwplayer=()=>({getContainer:()=>f.wrapper,getPlaylistItem:()=>({mediaid:'one',file:'/master.m3u8'})});
 const p=f.collect({mode:'early'});assert.equal(p.parser,'jwplayer');assert.equal(f.collect({mode:'early',binding:p.binding}).valid,true);
 delete f.window.jwplayer;f.window.videojs={getAllPlayers:()=>assert.fail('Video.js must retain its normal order')};f.video.attrs['data-setup']='{"sources":[{"src":"/other.mp4"}]}';
 assert.equal(f.collect({mode:'early'}).valid,false);assert.equal(f.parses,0);
});

test('Video.js active VHS source outranks stale currentSources and a different tech element cannot lend its source',()=>{
 const f=fixture();f.wrapper.attrs.class='video-js';
 const p={el:()=>f.wrapper,tech_:{el:()=>f.video,vhs:{source_:{src:'/active.m3u8'}}},currentSource:()=>({src:'/advert.m3u8'}),currentSources:()=>[{src:'/advert.m3u8'}]};
 f.window.videojs={getAllPlayers:()=>[p]};
 assert.deepEqual(f.collect().candidates,[{url:'https://unknown.example/active.m3u8',kind:'hls'}]);
 p.tech_.el=()=>new Node('video');assert.equal(f.collect().valid,false);
});
