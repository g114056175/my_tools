import test from 'node:test';
import assert from 'node:assert/strict';
import {createPopupMarkerController} from '../extension/popup-marker.js';
const flush=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
function runtime(){
 const calls=[],marks=new Map();let blocked=false,release;
 const api={runtime:{getURL:path=>'chrome-extension://test/'+path},scripting:{executeScript:async req=>{
  const options=req.args[0],key=req.target.documentIds[0];calls.push({key,...options});
  if(blocked&&!options.clear&&!options.renew)await new Promise(resolve=>{release=resolve;});
  if(options.clear){if(marks.get(key)===options.requestId)marks.delete(key);}
  else if(!options.renew)marks.set(key,options.requestId);
  return [{result:{highlighted:marks.has(key)}}];
 }}};
 const controller=createPopupMarkerController(api);
 function view(){let message,disconnect;const port={sender:{url:api.runtime.getURL('popup.html')},onMessage:{addListener:fn=>{message=fn;}},onDisconnect:{addListener:fn=>{disconnect=fn;}}};controller.attach(port);return {send:m=>message(m),close:()=>disconnect()};}
 return {calls,marks,view,block(){blocked=true;},release(){blocked=false;release?.();}};
}
const target={action:'highlightMedia',tabId:7,documentId:'doc',mediaKey:22,title:'Current'};
test('popup disconnect removes its marker immediately and ignores later messages',async()=>{
 const rt=runtime(),view=rt.view();view.send(target);await flush();assert.equal(rt.marks.size,1);
 view.send({action:'renewHighlight'});await flush();assert.equal(rt.calls.at(-1).renew,true);
 view.close();assert.equal(rt.marks.size,0);const count=rt.calls.length;view.send(target);await flush();assert.equal(rt.calls.length,count);
});
test('closing during a pending injection removes the late marker too',async()=>{
 const rt=runtime(),view=rt.view();rt.block();view.send(target);await flush();view.close();rt.release();await flush();assert.equal(rt.marks.size,0);assert.equal(rt.calls.at(-1).clear,true);
});
test('an old popup cannot remove a newer popup marker in the same document',async()=>{
 const rt=runtime(),old=rt.view(),current=rt.view();old.send(target);await flush();current.send(target);await flush();const owner=rt.marks.get('doc');old.close();assert.equal(rt.marks.get('doc'),owner);current.close();assert.equal(rt.marks.size,0);
});
test('changing target clears the previous frame and only retains the new frame',async()=>{
 const rt=runtime(),view=rt.view();view.send(target);await flush();view.send({...target,documentId:'child'});await flush();assert.deepEqual([...rt.marks.keys()],['child']);view.close();assert.equal(rt.marks.size,0);
});
