import test from 'node:test';
import assert from 'node:assert/strict';
import {createZipArchive,validateZipArchive} from '../build/package-extension.mjs';

test('release ZIP rejects tests or other excluded files',()=>{
  const expected=new Map([['manifest.json',Buffer.from('{"manifest_version":3}')]]);
  const archive=createZipArchive(new Map([
    ['VideoPocket/manifest.json',expected.get('manifest.json')],
    ['VideoPocket/tests/leaked.test.mjs',Buffer.from('must not ship')],
  ]));
  assert.throws(()=>validateZipArchive(archive,expected),/禁止的檔案/);
});

test('release ZIP rejects content that differs from the extension source',()=>{
  const expected=new Map([['manifest.json',Buffer.from('{"manifest_version":3}')]]);
  const archive=createZipArchive(new Map([['VideoPocket/manifest.json',Buffer.from('{"manifest_version":2}')]]));
  assert.throws(()=>validateZipArchive(archive,expected),/內容與來源不符/);
});
