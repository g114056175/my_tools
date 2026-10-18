import test from 'node:test';
import assert from 'node:assert/strict';
import {fileStem,suggestedFilename,filenameHistory,createFilenameRecorder,FILENAME_HISTORY_KEY} from '../extension/filenames.js';

test('Repeated choices use conventional suffixes before the extension, independently per format',()=>{
 const history=['影片.mp4','影片 (1).mp4','影片 (2).mp4','影片.m4a'];
 assert.equal(suggestedFilename('影片','mp4',history),'影片 (3).mp4');
 assert.equal(suggestedFilename('影片','m4a',history),'影片 (1).m4a');
 assert.equal(suggestedFilename('影片','webm',history),'影片.webm');
});
test('Unicode and Windows case-insensitive collisions do not produce indistinguishable names',()=>{
 assert.equal(suggestedFilename('FILM','mp4',['film.MP4','Film (1).mp4']),'FILM (2).mp4');
 assert.equal(suggestedFilename('Café','mp4',['Cafe\u0301.mp4']),'Café (1).mp4');
});
test('A title with an old media extension never acquires duplicate extensions',()=>{
 assert.equal(suggestedFilename('影片.mp4.mp4','mp4'),'影片.mp4');
 assert.equal(suggestedFilename('影片.mp4','m4a'),'影片.m4a');
 assert.equal(fileStem('CON.mp4'),'_CON');
 assert.equal(suggestedFilename('測試 / "影片"','mp4'),'測試 _ _影片_.mp4');
 assert.throws(()=>suggestedFilename('影片','../mp4'));
});
test('History keeps actual user-edited filenames, rejects paths, and stays bounded',()=>{
 assert.deepEqual(filenameHistory(['old.mp4','OLD.MP4',null,'C:\\private\\file.mp4','自訂 (9).mp4']),['OLD.MP4','自訂 (9).mp4']);
 const names=filenameHistory(Array.from({length:2010},(_,i)=>`${i}.mp4`));
 assert.equal(names.length,2000);assert.equal(names[0],'10.mp4');
});
test('Concurrent saves merge and persist choices across recorder restarts, including failed placeholders',async()=>{
 const data={};
 const storage={async get(key){await new Promise(resolve=>setImmediate(resolve));return {[key]:data[key]};},async set(value){Object.assign(data,structuredClone(value));}};
 const record=createFilenameRecorder(storage);
 await Promise.all([record('標題.mp4'),record('標題 (1).mp4'),record('手動改名.mp4')]);
 assert.equal(suggestedFilename('標題','mp4',data[FILENAME_HISTORY_KEY]),'標題 (2).mp4');
 // The picker already created the selected file, even if the network later fails.
 await createFilenameRecorder(storage)('標題 (2).mp4');
 assert.equal(suggestedFilename('標題','mp4',data[FILENAME_HISTORY_KEY]),'標題 (3).mp4');
 assert.ok(data[FILENAME_HISTORY_KEY].includes('手動改名.mp4'));
});
