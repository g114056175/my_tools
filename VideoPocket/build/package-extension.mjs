import {build} from 'esbuild';
import {deflateRawSync, inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {copyFile, lstat, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptPath=fileURLToPath(import.meta.url);
const projectRoot=path.resolve(path.dirname(scriptPath),'..');
const extensionRoot=path.join(projectRoot,'extension');
const distRoot=path.join(projectRoot,'dist');
const packageRoot=path.join(distRoot,'VideoPocket');
const zipPath=path.join(distRoot,'VideoPocket.zip');
const blockedSegments=new Set(['research','tests','work','node_modules']);
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const crcTable=Uint32Array.from({length:256},(_,value)=>{let crc=value;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function fail(message){throw new Error(message);}
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
function isBlockedPath(relative){return relative.split(/[\\/]+/).some(segment=>blockedSegments.has(segment.toLowerCase()));}
function normalizeArchivePath(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name))fail(`ZIP 路徑無效：${name}`);
  const segments=name.split('/');
  if(segments.some(segment=>!segment||segment==='.'||segment==='..'))fail(`ZIP 路徑無效：${name}`);
  return name;
}

export function createZipArchive(files){
  const localParts=[],centralParts=[];let offset=0;
  const entries=[...files.entries()].sort(([a],[b])=>a.localeCompare(b,'en'));
  if(entries.length>0xffff)fail('ZIP 檔案數量超出限制');
  for(const [rawName,rawData] of entries){
    const name=normalizeArchivePath(rawName),nameBytes=Buffer.from(encoder.encode(name)),data=Buffer.from(rawData),compressed=deflateRawSync(data),crc=crc32(data);
    if(nameBytes.length>0xffff||data.length>0xffffffff||compressed.length>0xffffffff||offset>0xffffffff)fail(`ZIP 項目超出限制：${name}`);
    const local=Buffer.alloc(30+nameBytes.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(0,10);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBytes.length,26);nameBytes.copy(local,30);
    localParts.push(local,compressed);
    const central=Buffer.alloc(46+nameBytes.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(0,12);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(offset,42);nameBytes.copy(central,46);centralParts.push(central);
    offset+=local.length+compressed.length;
  }
  const centralSize=centralParts.reduce((total,part)=>total+part.length,0);
  if(offset>0xffffffff||centralSize>0xffffffff)fail('ZIP 超出 32 位格式限制');
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...localParts,...centralParts,end]);
}

export function validateZipArchive(zipBytes,expectedFiles,{topLevel='VideoPocket'}={}){
  const bytes=Buffer.from(zipBytes);let endOffset=-1;
  for(let offset=Math.max(0,bytes.length-22-0xffff);offset<=bytes.length-22;offset++)if(bytes.readUInt32LE(offset)===0x06054b50){const commentLength=bytes.readUInt16LE(offset+20);if(offset+22+commentLength===bytes.length){endOffset=offset;break;}}
  if(endOffset<0)fail('ZIP 結尾紀錄無效');
  const disk=bytes.readUInt16LE(endOffset+4),centralDisk=bytes.readUInt16LE(endOffset+6),diskCount=bytes.readUInt16LE(endOffset+8),entryCount=bytes.readUInt16LE(endOffset+10),centralSize=bytes.readUInt32LE(endOffset+12),centralOffset=bytes.readUInt32LE(endOffset+16);
  if(disk||centralDisk||diskCount!==entryCount||entryCount===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff||centralOffset+centralSize>endOffset)fail('ZIP 磁碟或 ZIP64 格式不受支援');
  const seen=new Set(),actual=new Map();let cursor=centralOffset;
  for(let index=0;index<entryCount;index++){
    if(cursor+46>centralOffset+centralSize||bytes.readUInt32LE(cursor)!==0x02014b50)fail('ZIP 中央目錄無效');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),compressedSize=bytes.readUInt32LE(cursor+20),size=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),localOffset=bytes.readUInt32LE(cursor+42);
    const recordEnd=cursor+46+nameLength+extraLength+commentLength;
    if(recordEnd>centralOffset+centralSize||flags&1||!(flags&0x800)||![0,8].includes(method)||compressedSize===0xffffffff||size===0xffffffff||localOffset===0xffffffff)fail('ZIP 項目標頭無效');
    let name;try{name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));}catch{fail('ZIP 檔名不是有效 UTF-8');}
    normalizeArchivePath(name);
    if(!name.startsWith(`${topLevel}/`)||name===`${topLevel}/`||isBlockedPath(name))fail(`ZIP 含有根目錄外或禁止的檔案：${name}`);
    if(seen.has(name))fail(`ZIP 含有重複檔案：${name}`);seen.add(name);
    if(localOffset+30>centralOffset||bytes.readUInt32LE(localOffset)!==0x04034b50)fail(`ZIP 本機檔案標頭無效：${name}`);
    const localNameLength=bytes.readUInt16LE(localOffset+26),localExtraLength=bytes.readUInt16LE(localOffset+28),dataStart=localOffset+30+localNameLength+localExtraLength,dataEnd=dataStart+compressedSize;
    const localNameEnd=localOffset+30+localNameLength;
    let localName;try{localName=decoder.decode(bytes.subarray(localOffset+30,localNameEnd));}catch{fail(`ZIP 本機檔名無效：${name}`);}
    if(dataEnd>centralOffset||bytes.readUInt16LE(localOffset+6)!==flags||bytes.readUInt16LE(localOffset+8)!==method||localName!==name||bytes.readUInt32LE(localOffset+14)!==crc||bytes.readUInt32LE(localOffset+18)!==compressedSize||bytes.readUInt32LE(localOffset+22)!==size)fail(`ZIP 壓縮資料無效：${name}`);
    const compressed=bytes.subarray(dataStart,dataEnd);let content;
    try{content=method===0?Buffer.from(compressed):inflateRawSync(compressed);}catch{fail(`ZIP 解壓失敗：${name}`);}
    if(content.length!==size||crc32(content)!==crc)fail(`ZIP 校驗失敗：${name}`);
    actual.set(name.slice(topLevel.length+1),content);cursor=recordEnd;
  }
  if(cursor!==centralOffset+centralSize)fail('ZIP 中央目錄長度不符');
  const expectedNames=new Set(expectedFiles.keys());
  for(const name of actual.keys())if(!expectedNames.has(name))fail(`ZIP 含有多餘檔案：${name}`);
  for(const name of expectedNames)if(!actual.has(name))fail(`ZIP 缺少檔案：${name}`);
  for(const [name,expected] of expectedFiles)if(!Buffer.from(expected).equals(actual.get(name)))fail(`ZIP 內容與來源不符：${name}`);
  return actual;
}

async function walkFiles(base,relative=''){
  const results=[];
  for(const entry of await readdir(path.join(base,relative),{withFileTypes:true})){
    const child=relative?`${relative}/${entry.name}`:entry.name;
    if(isBlockedPath(child))continue;
    const absolute=path.join(base,...child.split('/'));
    if(entry.isSymbolicLink())fail(`發佈來源不得包含符號連結：${child}`);
    if(entry.isDirectory())results.push(...await walkFiles(base,child));
    else if(entry.isFile())results.push(child);
    else fail(`發佈來源包含非一般檔案：${child}`);
  }
  return results.sort((a,b)=>a.localeCompare(b,'en'));
}

async function fileMap(base){const files=new Map();for(const relative of await walkFiles(base))files.set(relative,await readFile(path.join(base,...relative.split('/'))));return files;}
function assertSameFiles(expected,actual,label){
  for(const name of actual.keys())if(!expected.has(name))fail(`${label} 含有多餘檔案：${name}`);
  for(const name of expected.keys())if(!actual.has(name))fail(`${label} 缺少檔案：${name}`);
  for(const [name,bytes] of expected)if(!Buffer.from(bytes).equals(actual.get(name)))fail(`${label} 內容與來源不符：${name}`);
}

function safeReferencePath(fromFile,value){
  if(typeof value!=='string'||!value.trim()||/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value))return null;
  const clean=decodeURIComponent(value.split(/[?#]/,1)[0]).replace(/\\/g,'/');
  if(!clean)return null;
  const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(fromFile),clean));
  if(resolved==='..'||resolved.startsWith('../')||path.posix.isAbsolute(resolved))fail(`資源路徑離開 extension：${fromFile} → ${value}`);
  return resolved;
}

async function assertFileReference(fromFile,value,files){
  const relative=safeReferencePath(fromFile,value);if(relative===null)return;
  if(value.includes('*')){
    const prefix=value.slice(0,value.indexOf('*')).replace(/[^/]*$/,'');
    if(![...files.keys()].some(name=>name.startsWith(path.posix.join(path.posix.dirname(fromFile),prefix))))fail(`找不到資源樣式：${fromFile} → ${value}`);
    return;
  }
  if(!files.has(relative))fail(`找不到資源：${fromFile} → ${value}`);
}

async function assertManifestReferences(files){
  const manifestBytes=files.get('manifest.json');if(!manifestBytes)fail('正式 extension 缺少 manifest.json');
  let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{fail('manifest.json 格式無效');}
  if(manifest.manifest_version!==3)fail('manifest.json 必須使用 Manifest V3');
  const refs=[];
  const add=(origin,value)=>{if(typeof value==='string')refs.push([origin,value]);};
  add('manifest.json',manifest.background?.service_worker);add('manifest.json',manifest.action?.default_popup);add('manifest.json',manifest.options_page);add('manifest.json',manifest.options_ui?.page);add('manifest.json',manifest.side_panel?.default_path);add('manifest.json',manifest.devtools_page);
  for(const icons of [manifest.icons,manifest.action?.default_icon])if(icons&&typeof icons==='object')for(const value of Object.values(icons))add('manifest.json',value);
  for(const script of manifest.content_scripts||[]){for(const value of script.js||[])add('manifest.json',value);for(const value of script.css||[])add('manifest.json',value);}
  for(const resource of manifest.web_accessible_resources||[])for(const value of resource.resources||[])add('manifest.json',value);
  for(const [origin,value] of refs)await assertFileReference(origin,value,files);
  for(const [name,bytes] of files){
    const source=bytes.toString('utf8');
    if(name.endsWith('.html'))for(const match of source.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi))await assertFileReference(name,match[1]||match[2]||match[3],files);
    if(name.endsWith('.css'))for(const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi))await assertFileReference(name,match[1].trim(),files);
    if(name.endsWith('.js')){
      for(const match of source.matchAll(/(?:chrome\.runtime\.)?getURL\(\s*["']([^"']+)["']\s*\)/g))await assertFileReference('',match[1],files);
      for(const match of source.matchAll(/importScripts\s*\(([^)]*)\)/g))for(const resource of match[1].matchAll(/["']([^"']+)["']/g))await assertFileReference(name,resource[1],files);
      for(const match of source.matchAll(/new\s+(?:Shared)?Worker\s*\(\s*["']([^"']+)["']/g))await assertFileReference(name,match[1],files);
    }
  }
  return manifest;
}

async function assertRuntimeModules(manifest){
  const entries=new Set([manifest.background?.service_worker,'popup.js','offscreen.js'].filter(Boolean));
  for(const relative of await walkFiles(extensionRoot)){
    if(!relative.endsWith('.js'))continue;
    const source=await readFile(path.join(extensionRoot,...relative.split('/')),'utf8');
    for(const match of source.matchAll(/(?:chrome\.runtime\.)?getURL\(\s*["']([^"']+\.js)["']\s*\)/g))entries.add(match[1]);
  }
  const entryPoints=[...entries].map(relative=>`./${path.posix.join('extension',relative)}`);
  try{await build({absWorkingDir:projectRoot,entryPoints,bundle:true,write:false,outdir:'./.package-check-tmp',platform:'browser',format:'esm',target:'chrome120',logLevel:'silent'});}
  catch(error){fail(`正式模組引用檢查失敗：${error.errors?.map(item=>item.text).join('\n')||error.message}`);}
}

async function assertObserverBundle(){
  const entry=path.join(projectRoot,'build','media-observer-entry.js');
  const checkedIn=path.join(extensionRoot,'media-observer.js');
  let output;
  try{
    const result=await build({entryPoints:[entry],outfile:checkedIn,bundle:true,format:'iife',platform:'browser',target:'chrome120',minify:true,legalComments:'eof',write:false,logLevel:'silent'});
    output=result.outputFiles[0]?.contents;
  }catch(error){fail(`observer bundle 無法重建檢查：${error.errors?.map(item=>item.text).join('\n')||error.message}`);}
  if(!output)fail('observer bundle 檢查沒有產生輸出');
  const current=await readFile(checkedIn);
  if(!Buffer.from(output).equals(current))fail('extension/media-observer.js 與目前來源不一致；請先執行 npm run build:observer');
}

async function assertNoSymlink(target){
  try{if((await lstat(target)).isSymbolicLink())fail(`發佈輸出路徑不得為符號連結：${target}`);}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function assertExists(target){try{await lstat(target);}catch(error){if(error.code==='ENOENT')fail(`缺少 ${path.relative(projectRoot,target)}；請先執行 npm run package`);throw error;}}
async function assertSafeOutputRoots(){
  await assertNoSymlink(distRoot);await mkdir(distRoot,{recursive:true});
  const resolvedDist=await import('node:fs/promises').then(fs=>fs.realpath(distRoot));
  if(!resolvedDist.toLowerCase().startsWith(`${projectRoot.toLowerCase()}${path.sep}`))fail('dist 輸出路徑離開專案');
  for(const target of [packageRoot,zipPath]){
    const resolved=path.resolve(target);
    if(!resolved.toLowerCase().startsWith(`${resolvedDist.toLowerCase()}${path.sep}`))fail(`發佈輸出路徑離開 dist：${target}`);
    await assertNoSymlink(target);
  }
}

async function collectReleaseSource(){
  const files=await fileMap(extensionRoot);
  await assertManifestReferences(files);
  return files;
}

export async function checkPackage(){
  for(const target of [distRoot,packageRoot,zipPath])await assertNoSymlink(target);
  await assertExists(packageRoot);await assertExists(zipPath);
  const source=await collectReleaseSource();
  const manifest=JSON.parse(source.get('manifest.json').toString('utf8'));
  await assertRuntimeModules(manifest);await assertObserverBundle();
  const folder=await fileMap(packageRoot);assertSameFiles(source,folder,'dist/VideoPocket');
  const zip=await readFile(zipPath);validateZipArchive(zip,source);
  for(const [name,bytes] of source)if(hash(bytes)!==hash(folder.get(name)))fail(`SHA-256 不符：${name}`);
  return {files:source.size,zipBytes:zip.length,sha256:hash(zip)};
}

export async function packageExtension(){
  const source=await collectReleaseSource();
  const manifest=JSON.parse(source.get('manifest.json').toString('utf8'));
  await assertRuntimeModules(manifest);await assertObserverBundle();await assertSafeOutputRoots();
  await rm(packageRoot,{recursive:true,force:true});await mkdir(packageRoot,{recursive:true});
  for(const [relative,bytes] of source){const target=path.join(packageRoot,...relative.split('/'));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  const archiveFiles=new Map([...source].map(([relative,bytes])=>[`VideoPocket/${relative}`,bytes]));
  await writeFile(zipPath,createZipArchive(archiveFiles));
  return await checkPackage();
}

if(process.argv[1]&&path.resolve(process.argv[1])===scriptPath){
  try{
    const mode=process.argv[2];
    if(mode==='package'){const result=await packageExtension();process.stdout.write(`已封裝 dist/VideoPocket.zip（${result.files} 個檔案，${result.zipBytes} bytes，SHA-256 ${result.sha256}）\n`);}
    else if(mode==='check'){const result=await checkPackage();process.stdout.write(`套件檢查通過（${result.files} 個檔案，${result.zipBytes} bytes，SHA-256 ${result.sha256}）\n`);}
    else fail('用法：node build/package-extension.mjs <package|check>');
  }catch(error){process.stderr.write(`套件檢查失敗：${error.message}\n`);process.exitCode=1;}
}
