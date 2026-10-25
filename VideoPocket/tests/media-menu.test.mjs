import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaMenu} from '../extension/media-menu.js';
class Node {
 constructor(doc){this.ownerDocument=doc;this.children=[];this.listeners={};this.classList={add(){}};this.attributes={};}
 append(node){this.children.push(node);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 get options(){return this.children;}
}
function setup(){
 const doc={createElement:()=>new Node(doc)},root=new Node(doc),source={options:[{value:'0',textContent:'影片 1',title:'影片一完整標題'},{value:'1',textContent:'影片 2'}],value:'0',hidden:false,disabled:false};
 const calls=[],api=createMediaMenu(source,root,value=>calls.push(value));api.render();
 return {source,root,api,calls,select:root.children[0]};
}
test('native media menu activates the current item repeatedly without changing backing selection',()=>{
 const s=setup();for(let i=0;i<2;i++){s.select.value='0';s.select.listeners.change();}
 assert.deepEqual(s.calls,['0','0']);assert.equal(s.source.value,'0');assert.equal(s.select.value,'__vp_current__');
 assert.equal(s.select.options[0].hidden,true);assert.equal(s.select.title,'影片一完整標題');
});
test('native menu follows current title and options after feed refresh',()=>{
 const s=setup();assert.equal(s.select.options[1].attributes['data-current'],'true');assert.equal(s.select.options[2].attributes['data-current'],'false');
 s.source.value='1';s.api.render();assert.equal(s.select.options[0].textContent,'影片 2');
 assert.equal(s.select.options[1].attributes['data-current'],'false');assert.equal(s.select.options[2].attributes['data-current'],'true');
 s.select.value='1';s.select.listeners.change();assert.deepEqual(s.calls,['1']);
 const before=s.select.options;s.api.render();assert.equal(s.select.options,before);
});
test('native menu follows empty, disabled and hidden state',()=>{
 const s=setup();s.source.hidden=true;s.source.disabled=true;s.api.render();assert.equal(s.root.hidden,true);assert.equal(s.select.disabled,true);
 s.source.options=[];s.source.value='';s.api.render();assert.equal(s.select.options[0].textContent,'沒有可用影片');assert.equal(s.select.disabled,true);
});
test('disabled options and display-only option never activate a video',()=>{
 const s=setup();s.source.options[1].disabled=true;s.api.render();s.select.value='1';s.select.listeners.change();s.select.listeners.change();
 assert.deepEqual(s.calls,[]);assert.equal(s.select.attributes['aria-label'],'目前影片');
});

test('native option widths follow the rendered field and preserve full source titles after resize',()=>{
 let resize;
 const canvas={font:'',measureText:text=>({width:[...text].reduce((n,c)=>n+(c==='i'?2:c==='…'?6:12),0)})};
 const doc={defaultView:{getComputedStyle:()=>({font:'600 11px sans-serif',paddingLeft:'8px',paddingRight:'8px'}),ResizeObserver:class{constructor(callback){resize=callback;}observe(){}}},createElement:tag=>tag==='canvas'?{getContext:()=>canvas}:Object.assign(new Node(doc),{clientWidth:200})};
 const root=new Node(doc),narrow='i'.repeat(30),wide='長'.repeat(30),source={options:[{value:'0',textContent:narrow,title:narrow},{value:'1',textContent:wide,title:wide}],value:'0',hidden:false,disabled:false};
 const api=createMediaMenu(source,root),select=root.children[0];api.render();
 assert.equal(select.options[1].textContent,narrow,'narrow English glyphs use the available width beyond 24 characters');
 assert.equal(select.options[2].textContent,'長'.repeat(12)+'…');
 assert.equal(select.title,narrow);assert.equal(select.options[2].title,wide);
 select.clientWidth=80;resize();
 assert.equal(select.options[1].textContent,'i'.repeat(13)+'…');
 assert.equal(source.options[0].textContent,narrow);assert.equal(source.options[1].textContent,wide);
 assert.equal(select.value,'__vp_current__');
});
