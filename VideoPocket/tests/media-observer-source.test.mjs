import test from "node:test";
import assert from "node:assert/strict";
import {
  installMediaObserver,
  OBSERVER_SYMBOL,
  mediaModelsFromText,
  shouldInstallMediaObserver,
} from "../extension/media-observer-source.js";

function browser() {
  let serial = 0;
  class FakeResponse {
    constructor(url, value, type = "", status = 200) {
      this.url = url;
      this.value = value;
      this.status = status;
      this.ok = status >= 200 && status < 300;
      this.headers = {
        get: (key) => (key.toLowerCase() === "content-type" ? type : ""),
      };
    }
    arrayBuffer() {
      return Promise.resolve(this.value);
    }
    blob() {
      return Promise.resolve(this.value);
    }
    text() {
      return Promise.resolve(this.value);
    }
  }
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.responseType = "arraybuffer";
    }
    addEventListener(name, cb) {
      this.listeners[name] = cb;
    }
    open(method, url) {
      this.url = url;
    }
    send() {
      this.response = new ArrayBuffer(4);
      this.listeners.load?.();
    }
  }
  class FakeSourceBuffer {
    appendBuffer(value) {
      this.value = value;
    }
  }
  class FakeMediaSource {
    addSourceBuffer() {
      return new FakeSourceBuffer();
    }
  }
  const blobs = new Map();
  const URLApi = {
    createObjectURL(value) {
      const url = `blob:test/${++serial}`;
      blobs.set(url, value);
      return url;
    },
    revokeObjectURL(url) {
      blobs.delete(url);
    },
  };
  return {
    Response: FakeResponse,
    XMLHttpRequest: FakeXHR,
    MediaSource: FakeMediaSource,
    SourceBuffer: FakeSourceBuffer,
    URL: URLApi,
    location: { href: "https://social.example/reel/post" },
    blobs,
  };
}

test('FB worker metadata binds only to the exact rendered player identity',()=>{
 const target=browser();target.location={href:'https://www.facebook.com/feed',hostname:'www.facebook.com'};
 target.Worker=class{
  addEventListener(type,fn){if(type==='message')this.receive=data=>fn({data});}
  removeEventListener(){this.receive=()=>{};}
  postMessage(){}
 };
 const nativeWorker=target.Worker,observer=installMediaObserver(target),worker=new target.Worker('worker.js');
 const makeVideo=id=>({currentSrc:'',src:'',nodeType:1,getAttribute:()=>'',closest:()=>null,__reactProps$test:{videoID:id}});
 const first=makeVideo('fb-one'),second=makeVideo('fb-two');
 first.ownerDocument=second.ownerDocument={querySelectorAll:()=>[first,second]};
 try{
  worker.postMessage({__typename:'Video',id:'fb-two',videoDeliveryLegacyFields:{browser_native_hd_url:'https://video.fbcdn.net/two.mp4'}});
  assert.equal(observer.modelFor(first),null);
  worker.receive({__typename:'Video',id:'fb-one',videoDeliveryLegacyFields:{browser_native_hd_url:'https://video.fbcdn.net/one.mp4'}});
  assert.equal(observer.modelFor(first).versions[0].url,'https://video.fbcdn.net/one.mp4');
  assert.equal(observer.modelFor(second).versions[0].url,'https://video.fbcdn.net/two.mp4');
  assert.ok(observer.sourcesFor(first).candidates.some(candidate=>candidate.url==='https://video.fbcdn.net/one.mp4'));
  assert.ok(observer.sourcesFor(first).candidates.every(candidate=>candidate.url!=='https://video.fbcdn.net/two.mp4'));
 }finally{observer.dispose();}
 assert.equal(target.Worker,nativeWorker);
});

test('working TikTok pages keep their original Worker constructor and transport',()=>{
 const target=browser();target.location={href:'https://www.tiktok.com/',hostname:'www.tiktok.com'};
 target.Worker=class{};const native=target.Worker,observer=installMediaObserver(target);
 assert.equal(target.Worker,native);observer.dispose();
});

test('observer does not install in Cloudflare challenge frames',()=>{
 const target=browser();
 target.location={href:'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate',hostname:'challenges.cloudflare.com'};
 assert.equal(shouldInstallMediaObserver(target),false);
 const observer=installMediaObserver(target);
 assert.deepEqual(observer.diagnosticsFor(),{excluded:true});
 assert.equal(observer.sourcesFor({}).reason,'excluded-context');
 assert.equal(target.fetch,undefined);
});

test('observer installation never performs a network request',()=>{
 const target=browser();let calls=0;
 target.fetch=async()=>{calls++;throw new Error('observer must not fetch');};
 const observer=installMediaObserver(target);
 assert.equal(calls,0);
 observer.dispose();
});

test('application JSON.parse results retain ID-bound media without retaining the application object',()=>{
 const target=browser();target.location={href:'https://www.facebook.com/feed',hostname:'www.facebook.com'};
 target.JSON={parse:JSON.parse};const native=target.JSON.parse,observer=installMediaObserver(target);
 const first={currentSrc:'',src:'',getAttribute:()=>'',closest:()=>null,__reactProps$test:{videoID:'first'}},second={...first,__reactProps$test:{videoID:'second'}};
 first.ownerDocument=second.ownerDocument={querySelectorAll:selector=>selector==='video'?[first,second]:[]};
 try{
  const original=target.JSON.parse(JSON.stringify({__typename:'Video',id:'second',videoDeliveryLegacyFields:{browser_native_sd_url:'https://video.fbcdn.net/second.mp4'}}));
  assert.equal(observer.modelFor(first),null);
  original.videoDeliveryLegacyFields.browser_native_sd_url='https://video.fbcdn.net/changed.mp4';
  assert.equal(observer.modelFor(second).versions[0].url,'https://video.fbcdn.net/second.mp4');
  target.JSON.parse(JSON.stringify({__typename:'Video',id:'first',videoDeliveryLegacyFields:{browser_native_hd_url:'https://video.fbcdn.net/first.mp4'}}));
  assert.equal(observer.modelFor(first).versions[0].url,'https://video.fbcdn.net/first.mp4');
  const diagnostics=observer.diagnosticsFor(first);assert.equal(diagnostics.json.observed,2);assert.equal(diagnostics.models,2);assert.equal(diagnostics.matches,1);
 }finally{observer.dispose();}
 assert.equal(target.JSON.parse,native);
});

test('the same JSON hook handles a qualities schema on a previously unnamed website',()=>{
 const target=browser();target.location={href:'https://unseen.example/video/selected',hostname:'unseen.example'};target.JSON={parse:JSON.parse};
 const observer=installMediaObserver(target),video={currentSrc:'blob:active',src:'',getAttribute:()=>'',closest:()=>null};
 video.ownerDocument={querySelectorAll:selector=>selector==='video'?[video]:[]};
 try{
  target.JSON.parse(JSON.stringify({id:'selected',qualities:{auto:[{type:'application/x-mpegURL',url:'https://cdn.example/main.m3u8'}]}}));
  const model=observer.modelFor(video);assert.equal(model.id,'selected');assert.equal(model.manifestType,'hls');
  assert.equal(observer.sourcesFor(video).candidates[0].url,'https://cdn.example/main.m3u8');
 }finally{observer.dispose();}
});

test("MSE playlist parents stay associated per MediaSource and segments are excluded", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const body1 = new ArrayBuffer(4),
    body2 = new ArrayBuffer(4);
  const hls1 = new target.Response(
    "https://cdn.example/a/master.m3u8",
    "video/a.m3u8\n",
  );
  const hls2 = new target.Response(
    "https://cdn.example/b/master.m3u8",
    "video/b.m3u8\n",
  );
  await hls1.text();
  await hls2.text();
  const a = new Uint8Array(
    await new target.Response(
      "https://cdn.example/a/video.m3u8",
      body1,
    ).arrayBuffer(),
  );
  const b = new Uint8Array(
    await new target.Response(
      "https://cdn.example/b/video.m3u8",
      body2,
    ).arrayBuffer(),
  );
  const ms1 = new target.MediaSource(),
    ms2 = new target.MediaSource();
  const sb1 = ms1.addSourceBuffer("video/mp4"),
    sb2 = ms2.addSourceBuffer("video/mp4");
  const url1 = target.URL.createObjectURL(ms1),
    url2 = target.URL.createObjectURL(ms2);
  sb1.appendBuffer(a);
  sb2.appendBuffer(b);
  const one = observer.sourcesFor({ currentSrc: url1 });
  const two = observer.sourcesFor({ currentSrc: url2 });
  assert.deepEqual(
    one.candidates.map((c) => c.url),
    ["https://cdn.example/a/video.m3u8"],
  );
  assert.deepEqual(
    two.candidates.map((c) => c.url),
    ["https://cdn.example/b/video.m3u8"],
  );
  observer.dispose();
});

test("observed manifest text builds playlist parent graph without fetching", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const response = new target.Response(
    "https://cdn.example/master.m3u8",
    "child.m3u8\n",
  );
  await response.text();
  // Child response is never observed, so it cannot be mistaken for a complete source.
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/segment.ts" })
      .candidates.length,
    0,
  );
  observer.dispose();
});

test("object URL of a page-read Blob resolves to its original HTTP media", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const bytes = new ArrayBuffer(8);
  const response = new target.Response("https://cdn.example/video.mp4", bytes);
  const blob = await response.blob();
  const url = target.URL.createObjectURL(blob);
  assert.equal(
    observer.sourcesFor({ currentSrc: url }).candidates[0].url,
    "https://cdn.example/video.mp4",
  );
  target.URL.revokeObjectURL(url);
  assert.equal(observer.sourcesFor({ currentSrc: url }).pending, false);
  observer.dispose();
});

test("observer is idempotent and preserves original method errors", () => {
  const target = browser();
  const original = target.Response.prototype.text;
  const first = installMediaObserver(target);
  const second = installMediaObserver(target);
  assert.equal(first, second);
  assert.equal(typeof target[OBSERVER_SYMBOL].sourcesFor, "function");
  target.Response.prototype.text = function () {
    throw new Error("page error");
  };
  assert.throws(
    () => new target.Response("https://cdn.example/a.m3u8", "").text(),
    /page error/,
  );
  first.dispose();
  assert.equal(target.Response.prototype.text !== original, true); // test replacement is external and must survive disposal
});

test("content type identifies suffixless manifests and cleanup permits reinstall", async () => {
  const target = browser();
  const first = installMediaObserver(target);
  await new target.Response(
    "https://cdn.example/master",
    "#EXTM3U\nchild\n",
    "application/vnd.apple.mpegurl",
  ).text();
  await new target.Response(
    "https://cdn.example/child",
    new ArrayBuffer(3),
    "video/mp2t",
  ).arrayBuffer();
  assert.deepEqual(
    first
      .sourcesFor({ currentSrc: "https://cdn.example/child" })
      .candidates.map((c) => c.url),
    ["https://cdn.example/master"],
  );
  first.dispose();
  const second = installMediaObserver(target);
  assert.notEqual(second, first);
  second.dispose();
});

test("suffixless Blob media uses Content-Type and a typed append keeps its body URL", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  const bytes = await new target.Response(
    "https://cdn.example/media",
    new ArrayBuffer(8),
    "video/mp4",
  ).blob();
  const url = target.URL.createObjectURL(bytes);
  assert.equal(
    observer.sourcesFor({ currentSrc: url }).candidates[0].url,
    "https://cdn.example/media",
  );
  const response = new target.Response(
    "https://cdn.example/track",
    new ArrayBuffer(8),
    "video/mp4",
  );
  const view = new Uint8Array(await response.arrayBuffer());
  const ms = new target.MediaSource(),
    sb = ms.addSourceBuffer("video/mp4");
  const mseUrl = target.URL.createObjectURL(ms);
  sb.appendBuffer(view);
  assert.equal(
    observer.sourcesFor({ currentSrc: mseUrl }).candidates[0].url,
    'https://cdn.example/track',
  );
  observer.dispose();
});

test("text/plain manifest bodies are sniffed and DASH templates remain scoped to their parent", async () => {
  const target = browser();
  const observer = installMediaObserver(target);
  await new target.Response(
    "https://cdn.example/master",
    '<MPD><Period><AdaptationSet><Representation id="v"><SegmentTemplate media="v-$Number$.m4s" /></Representation></AdaptationSet></Period></MPD>',
    "text/plain",
  ).text();
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/v-4.m4s" })
      .candidates.length,
    0,
  );
  assert.equal(
    observer.sourcesFor({ currentSrc: "https://cdn.example/other.m4s" })
      .candidates.length,
    0,
  );
  observer.dispose();
});

test('incremental GraphQL records and multipart wrappers produce ID-bound models without evaluating text',()=>{
 const first=JSON.stringify({data:{video:{__typename:'Video',id:'a',videoDeliveryResponseFragment:{videoDeliveryResponseResult:{progressive_urls:[{progressive_url:'https://cdn.example/a.mp4'}]}}}}});
 const second=JSON.stringify({data:{video:{id:'b',playAddr:'https://cdn.example/b.mp4'}}});
 assert.deepEqual(mediaModelsFromText('for (;;);'+first+'\n'+second).map(m=>m.id),['a','b']);
 assert.deepEqual(mediaModelsFromText('--boundary\r\nContent-Type: application/json\r\n\r\n'+first+'\r\n--boundary--').map(m=>m.id),['a']);
 assert.equal(mediaModelsFromText('window.secret='+first).length,0);
 assert.equal(mediaModelsFromText(' '.repeat(512*1024+1)+first).length,0);
});

test('fetch metadata clone observes streamed responses while leaving the original body readable',async()=>{
 const payload={data:{video:{__typename:'Video',id:'post',videoDeliveryResponseFragment:{videoDeliveryResponseResult:{progressive_urls:[{progressive_url:'https://cdn.example/current.mp4'}]}}}}};
 const text=JSON.stringify(payload,null,2);let clones=0;
 const target=browser();
 target.location.href='https://social.example/feed';
 target.fetch=async()=>({url:'https://social.example/api/graphql/',headers:{get:k=>k==='content-type'?'application/json':null},body:{},text:async()=>text,clone(){clones++;return new Response(text);}});
 const original=target.fetch,observer=installMediaObserver(target);
 const response=await target.fetch('/api/graphql/');
 assert.equal(await response.text(),text);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(clones,1);
 assert.equal(observer.modelFor({closest:()=>null},'https://social.example/reel/post'),null); // modelFor uses target route
 target.location.href='https://social.example/reel/post';
 assert.equal(observer.modelFor({closest:()=>null})?.versions[0].url,'https://cdn.example/current.mp4');
 observer.dispose();assert.equal(target.fetch,original);
});

test('metadata observer never clones media, foreign JSON or oversized responses',async()=>{
 const target=browser();let clones=0;
 const responses=[
  {url:'https://social.example/file.mp4',type:'video/mp4'},
  {url:'https://foreign.example/data',type:'application/json'},
  {url:'https://social.example/data',type:'application/json',length:600000},
 ];
 target.fetch=async()=>{const r=responses.shift();return {url:r.url,headers:{get:k=>k==='content-type'?r.type:k==='content-length'?r.length:null},body:{},clone(){clones++;throw new Error('should not clone');}}};
 const observer=installMediaObserver(target);
 for(let i=0;i<3;i++)await target.fetch('/data');
 assert.equal(clones,0);observer.dispose();
});

test('two separately fetched MSE MP4 tracks are not offered as a single progressive file',async()=>{
 const target=browser(),observer=installMediaObserver(target),ms=new target.MediaSource();
 const video=ms.addSourceBuffer('video/mp4'),audio=ms.addSourceBuffer('audio/mp4');
 video.appendBuffer(await new target.Response('https://cdn.example/video-track',new ArrayBuffer(4),'video/mp4').arrayBuffer());
 audio.appendBuffer(await new target.Response('https://cdn.example/audio-track',new ArrayBuffer(4),'video/mp4').arrayBuffer());
 assert.equal(observer.sourcesFor({currentSrc:target.URL.createObjectURL(ms)}).candidates.length,0);
 observer.dispose();
});

test('fetch stream chunks retain their owning MP4 when appended directly to MSE',async()=>{
 const target=browser();target.ReadableStream=ReadableStream;target.ReadableStreamDefaultReader=ReadableStreamDefaultReader;
 target.fetch=async()=>({url:'https://cdn.example/complete.mp4',headers:{get:k=>k==='content-type'?'video/mp4':null},body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.close();}})});
 const observer=installMediaObserver(target),response=await target.fetch('/complete.mp4'),reader=response.body.getReader();
 const ms=new target.MediaSource(),buffer=ms.addSourceBuffer('video/mp4');buffer.appendBuffer((await reader.read()).value);
 assert.equal(observer.sourcesFor({currentSrc:target.URL.createObjectURL(ms)}).candidates[0].url,'https://cdn.example/complete.mp4');
 assert.equal((await reader.read()).done,true);observer.dispose();
});

test('manifestFor retains successful text and XHR manifests with validation rules', async () => {
  const target = browser();
  target.location = {href: 'https://www.dailymotion.com/video/x'};
  target.XMLHttpRequest = class {
    addEventListener(name, fn) { this.fn = fn; }
    open() {}
    send() { this.responseType = 'text'; this.responseText = '<MPD><Period/></MPD>'; this.responseURL = 'https://dmcdn.net/v/video.mpd'; this.fn(); }
  };
  const observer = installMediaObserver(target);
  const hls = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n';
  await new target.Response('https://dmcdn.net/v/video.m3u8', hls, 'application/vnd.apple.mpegurl').text();
  assert.deepEqual(observer.manifestFor('https://dmcdn.net/v/video.m3u8'), {
    url: 'https://dmcdn.net/v/video.m3u8', text: hls, type: 'hls',
  });
  const xhr = new target.XMLHttpRequest(); xhr.open('GET', '/redirect'); xhr.send();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/video.mpd')?.type, 'dash');
  await new target.Response('https://dmcdn.net/v/live.m3u8', '#EXTM3U\n#EXTINF:4,\nlive.ts\n', 'application/vnd.apple.mpegurl').text();
  await new target.Response('https://dmcdn.net/v/dynamic.mpd', '<MPD type="dynamic"><Period/></MPD>', 'application/dash+xml').text();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/live.m3u8'), null);
  assert.equal(observer.manifestFor('https://dmcdn.net/v/dynamic.mpd'), null);
  target.location.href='https://example.test/watch';
  await new target.Response('https://dmcdn.net/v/other-site.m3u8',hls,'application/vnd.apple.mpegurl').text();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/other-site.m3u8'),null);
  observer.dispose();
});

test('manifest cache supports fetch redirect aliases and remains bounded by TTL, count, and size', async () => {
  let clock = 0;
  const target = browser(); target.location = {href: 'https://www.dailymotion.com/video/x'};
  const makeResponse = (url, text) => ({url, headers: {get: k => k === 'content-type' ? 'application/vnd.apple.mpegurl' : null},
    body: new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); }}),
    clone() { return makeResponse(url, text); }});
  target.fetch = async request => makeResponse('https://dmcdn.net/v/final.m3u8', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8\n');
  const observer = installMediaObserver(target, {now: () => clock});
  const response = await target.fetch('/v/request.m3u8');
  const reader = response.body.getReader(); let received = 0;
  while (!(await reader.read()).done) received++;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(received > 0);
  assert.equal(observer.manifestFor('https://www.dailymotion.com/v/request.m3u8')?.url, 'https://dmcdn.net/v/final.m3u8');
  assert.deepEqual(observer.sourcesFor({currentSrc: 'https://dmcdn.net/v/child.m3u8'}).candidates.map(c => c.url), ['https://dmcdn.net/v/final.m3u8']);
  for (let i = 0; i < 13; i++) await new target.Response(`https://dmcdn.net/v/${i}.m3u8`, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=${i}\nx.m3u8\n`).text();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/final.m3u8'), null);
  assert.equal(observer.manifestFor('https://dmcdn.net/v/0.m3u8'), null);
  await new target.Response('https://dmcdn.net/v/ttl.m3u8', '#EXTM3U\nx.m3u8\n').text();
  clock = 121000;
  assert.equal(observer.manifestFor('https://dmcdn.net/v/ttl.m3u8'), null);
  await new target.Response('https://dmcdn.net/v/huge.m3u8', `#EXTM3U\n${'x'.repeat(512 * 1024)}\n`).text();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/huge.m3u8'), null);
  await new target.Response('https://dmcdn.net/v/failed.m3u8', '#EXTM3U\nchild.m3u8\n', 'application/vnd.apple.mpegurl', 403).text();
  assert.equal(observer.manifestFor('https://dmcdn.net/v/failed.m3u8'), null);
  observer.dispose();
});


test('manifest text budget and redirect alias budget stay bounded independently',async()=>{
 const target=browser();target.location={href:'https://www.dailymotion.com/video/x'};
 const final='https://vod.dmcdn.net/final.m3u8',text='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8\n';
 target.fetch=async()=>{const response=new Response(text,{headers:{'content-type':'application/vnd.apple.mpegurl'}});Object.defineProperty(response,'url',{value:final});return response;};
 const observer=installMediaObserver(target);
 for(let i=0;i<50;i++){await target.fetch(`https://cdndirector.dailymotion.com/r${i}.m3u8`);await new Promise(resolve=>setImmediate(resolve));}
 assert.equal(observer.manifestFor('https://cdndirector.dailymotion.com/r0.m3u8'),null);
 assert.equal(observer.manifestFor('https://cdndirector.dailymotion.com/r49.m3u8')?.url,final);
 for(let i=0;i<6;i++)await new target.Response(`https://vod.dmcdn.net/large${i}.m3u8`,text+'#'+'a'.repeat(200000),'application/vnd.apple.mpegurl').text();
 assert.equal(observer.manifestFor('https://vod.dmcdn.net/large0.m3u8'),null);
 assert.ok(observer.manifestFor('https://vod.dmcdn.net/large5.m3u8'));
 observer.dispose();
});

test('unknown pages retain streamed cross origin HLS master variant segment graph', async () => {
  const target = browser();
  target.location = {href: 'https://player.example/watch', hostname: 'player.example'};
  const bodies = new Map([
    ['https://edge.cdn.test/live/master', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nhttps://media.cdn.test/live/video/variant.m3u8\n'],
    ['https://media.cdn.test/live/video/variant.m3u8', '#EXTM3U\n#EXTINF:4,\npart-001.m4s\n#EXT-X-ENDLIST\n'],
  ]);
  const streamFor = (url, onCancel) => new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(bodies.get(url))); controller.close(); },
    cancel: onCancel,
  });
  let clones = 0;
  target.fetch = async request => {
    const requested = new URL(typeof request === 'string' ? request : request.url, target.location.href).href;
    const final = requested.includes('master') ? 'https://edge.cdn.test/live/master' : 'https://media.cdn.test/live/video/variant.m3u8';
    return {
      url: final,
      status: 200,
      ok: true,
      headers: {get: key => key.toLowerCase() === 'content-type' ? 'application/vnd.apple.mpegurl' : null},
      body: streamFor(final, () => {}),
      clone() { clones++; return {...this, body: streamFor(final, () => {})}; },
    };
  };
  const observer = installMediaObserver(target);
  const master = await target.fetch('https://edge.cdn.test/live/master');
  const masterReader = master.body.getReader(); while (!(await masterReader.read()).done) {}
  const variant = await target.fetch('https://media.cdn.test/live/video/variant.m3u8');
  const variantReader = variant.body.getReader(); while (!(await variantReader.read()).done) {}
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clones, 2);
  assert.equal(observer.manifestFor('https://edge.cdn.test/live/master')?.type, 'hls');
  assert.deepEqual(
    observer.sourcesFor({currentSrc: 'https://media.cdn.test/live/video/part-001.m4s'}).candidates.map(c => c.url),
    ['https://edge.cdn.test/live/master'],
  );
  observer.dispose();
});

test('unknown pages retain streamed cross origin DASH graph and segment template roots', async () => {
  const target = browser();
  target.location = {href: 'https://catalog.example/item', hostname: 'catalog.example'};
  const mpd = '<MPD><Period><AdaptationSet><Representation><SegmentTemplate media="chunks/$Number$.m4s" /></Representation></AdaptationSet></Period></MPD>';
  const make = () => ({url: 'https://video.cdn.test/path/manifest', status: 200, ok: true,
    headers: {get: key => key.toLowerCase() === 'content-type' ? 'application/dash+xml' : null},
    body: new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(mpd)); c.close(); }}),
    clone() { return make(); }});
  target.fetch = async () => make();
  const observer = installMediaObserver(target);
  const response = await target.fetch('https://video.cdn.test/path/manifest');
  const reader = response.body.getReader(); while (!(await reader.read()).done) {}
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observer.manifestFor('https://video.cdn.test/path/manifest')?.type, 'dash');
  assert.deepEqual(
    observer.sourcesFor({currentSrc: 'https://video.cdn.test/path/chunks/42.m4s'}).candidates.map(c => c.url),
    ['https://video.cdn.test/path/manifest'],
  );
  observer.dispose();
});

test('streamed non-media responses are never cloned and oversized manifests are cancelled', async () => {
  const target = browser();
  target.location = {href: 'https://unknown.example/', hostname: 'unknown.example'};
  let clones = 0, cancelled = 0;
  target.fetch = async url => {
    if (String(url).endsWith('.json')) return {
      url: 'https://api.cdn.test/data.json', status: 200, ok: true,
      headers: {get: key => key.toLowerCase() === 'content-type' ? 'application/json' : null},
      body: new ReadableStream({start(c) { c.close(); }}), clone() { clones++; throw new Error('must not clone'); },
    };
    const chunk = new Uint8Array(512 * 1024 + 1);
    return {url: 'https://video.cdn.test/oversized.m3u8', status: 200, ok: true,
      headers: {get: key => key.toLowerCase() === 'content-type' ? 'application/vnd.apple.mpegurl' : null},
      body: new ReadableStream({start(c) { c.enqueue(chunk); }}),
      clone() { clones++; return {body: new ReadableStream({start(c) { c.enqueue(chunk); }, cancel() { cancelled++; }})}; },
    };
  };
  const observer = installMediaObserver(target);
  await target.fetch('https://api.cdn.test/data.json');
  await target.fetch('https://video.cdn.test/oversized.m3u8');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(clones, 1);
  assert.equal(cancelled, 1);
  assert.equal(observer.manifestFor('https://video.cdn.test/oversized.m3u8'), null);
  observer.dispose();
});
