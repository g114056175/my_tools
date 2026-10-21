import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { socialPageResponse } from "../extension/social-page-fetch.js";
import {directTransfer} from '../extension/transfers.js';
import {createHash} from 'node:crypto';

const source = await (await import("node:fs/promises")).readFile(new URL("../extension/social-page-fetch.js", import.meta.url), "utf8");
const serializedFetch = source.match(/export async function socialPageFetch[\s\S]*?\n}\n\nexport async function/)[0].replace(/\n\nexport async function$/, "").replace(/^export /, "");
const load = (fetchImpl, { now = 1000 } = {}) => {
  const clock = typeof now === "function" ? now : () => now;
  const context = { fetch: fetchImpl, location: { href: "https://www.facebook.com/reel/1" }, URL, URLSearchParams, AbortController, ReadableStream, TextDecoder, Uint8Array, crypto: { randomUUID: () => `h-${clock()}-${Math.random()}` }, setTimeout, clearTimeout, Date: class extends Date { static now() { return clock(); } } };
  vm.createContext(context);
  vm.runInContext(`${serializedFetch};globalThis.socialPageFetch=socialPageFetch;`, context);
  return context;
};
const response = (body, status = 200, headers = { "content-type": "video/mp4" }) => new Response(body, { status, headers });

test('Dailymotion frame bridge accepts only its own service CDNs and exact document origin',async()=>{
 const context=load(async()=>response('#EXTM3U\n',200,{'content-type':'application/x-mpegURL'}));
 context.location.href='https://geo.dailymotion.com/player/xtv3w.html?';
 const referer=context.location.href;
 const result=await socialPageResponse(async message=>context.socialPageFetch(message.action,message.options),{url:'https://cdndirector.dailymotion.com/main.m3u8',referer});
 assert.equal(await result.text(),'#EXTM3U\n');
 const cdn=await context.socialPageFetch('open',{url:'https://vod.dmcdn.net/main.mp4',referer});await context.socialPageFetch('cancel',{handle:cdn.handle});
 await assert.rejects(()=>context.socialPageFetch('open',{url:'https://video.fbcdn.net/a.mp4',referer}),/allowed/);
 await assert.rejects(()=>context.socialPageFetch('open',{url:'https://vod.dmcdn.net/a.mp4',referer:'https://www.dailymotion.com/'}),/context/);
});

test("serialized MAIN fetch validates domains/method/range and strips request secrets", async () => {
  const seen = [];
  const context = load(async (url, init) => { seen.push({ url, init }); return response(new Uint8Array([1, 2, 3]), 200, { "content-type": "video/mp4", "content-length": "3" }); });
  const result = await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4?token=secret", referer: "https://www.facebook.com/reel/1", method: "GET", range: "bytes=0-", cookie: "secret" });
  assert.equal(result.status, 200);
  assert.equal(result.url, "https://video.xx.fbcdn.net/a.mp4");
  assert.equal(seen[0].init.headers.Range, "bytes=0-");
  assert.equal(seen[0].init.credentials, "include");
  await assert.rejects(() => context.socialPageFetch("open", { url: "https://evil.example/a.mp4", referer: "https://www.facebook.com/" }), /allowed/);
  await assert.rejects(() => context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/", method: "POST" }), /allowed/);
  await assert.rejects(() => context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/", range: "bytes=abc" }), /range/);
});

test("HEAD and forbidden responses preserve status without exposing unsafe headers", async () => {
  const context = load(async (url, init) => response(null, init.method === "HEAD" ? 200 : 403, { "content-type": "application/json", "set-cookie": "secret" }));
  const head = await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/", method: "HEAD" });
  assert.equal(head.done, true);
  const forbidden = await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/" });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers["set-cookie"], undefined);
});

test("reads complete chunks with leftover bytes and cancels", async () => {
  const context = load(async () => response(new Uint8Array([1, 2, 3, 4, 5])));
  const opened = await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/" });
  const first = await context.socialPageFetch("read", { handle: opened.handle });
  assert.deepEqual([...first.data], [1, 2, 3, 4, 5]);
  assert.equal(first.done, false);
  assert.equal((await context.socialPageFetch("read", { handle: opened.handle })).done, true);
  const second = await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/b.mp4", referer: "https://www.facebook.com/" });
  await context.socialPageFetch("cancel", { handle: second.handle });
  await assert.rejects(() => context.socialPageFetch("read", { handle: second.handle }), /expired/);
  const largeContext = load(async () => response(new Uint8Array(300000)));
  const large = await largeContext.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/large.mp4", referer: "https://www.facebook.com/" });
  const chunk = await largeContext.socialPageFetch("read", { handle: large.handle });
  assert.equal(chunk.data.length, 256 * 1024);
  assert.equal(chunk.done, false);
  const tail = await largeContext.socialPageFetch("read", { handle: large.handle });
  assert.equal(tail.data.length, 300000 - 256 * 1024);
  assert.equal(tail.done, false);
  assert.equal((await largeContext.socialPageFetch("read", { handle: large.handle })).done, true);
});

test("caps active readers and expires idle sessions", async () => {
  let clock = 1000;
  const context = load(async () => response(new Uint8Array([1])), { now: () => clock });
  const handles = [];
  for (let i = 0; i < 4; i++) handles.push((await context.socialPageFetch("open", { url: `https://video.xx.fbcdn.net/${i}.mp4`, referer: "https://www.facebook.com/" })).handle);
  await assert.rejects(() => context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/5.mp4", referer: "https://www.facebook.com/" }), /too many/);
  clock = 122001;
  await context.socialPageFetch("open", { url: "https://video.xx.fbcdn.net/5.mp4", referer: "https://www.facebook.com/" });
  assert.equal(handles.length, 4);
});

test("counts pending header fetches toward the reader cap", async () => {
  const resolvers = [];
  const context = load(() => new Promise((resolve) => resolvers.push(resolve)));
  const options = { referer: "https://www.facebook.com/" };
  const opens = [0, 1, 2, 3].map((i) => context.socialPageFetch("open", { ...options, url: `https://video.xx.fbcdn.net/p${i}.mp4` }));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => context.socialPageFetch("open", { ...options, url: "https://video.xx.fbcdn.net/p4.mp4" }), /too many/);
  for (const resolve of resolvers) resolve(response(new Uint8Array([1])));
  await Promise.all(opens);
});

test("RPC adapter streams reads and aborts the handle", async () => {
  const calls = [];
  const rpc = async (message) => {
    calls.push(message);
    if (message.action === "open") return { status: 200, headers: { "content-type": "video/mp4" }, handle: "h", done: false };
    if (message.action === "read") return { data: [7, 8], done: true };
    return { done: true };
  };
  const controller = new AbortController();
  const result = await socialPageResponse(rpc, { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/reel/1", context: { tabId: 1, documentId: "d", referer: "https://www.facebook.com/reel/1" }, options: { signal: controller.signal, headers: { Range: "bytes=0-" }, credentials: "omit", cookie: "secret" } });
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [7, 8]);
  assert.equal(calls[0].action, "open");
  assert.equal(calls[0].options.range, "bytes=0-");
  assert.equal(Object.hasOwn(calls[0].options, "credentials"), false);
  assert.equal(Object.hasOwn(calls[0].options, "cookie"), false);
  assert.equal(calls.some((call) => call.action === "cancel"), false);
  assert.equal(calls[1].action, "read");
  const cancelled = new AbortController();
  const pendingRpc = async (message) => message.action === "open" ? { status: 200, headers: {}, handle: "x", done: false } : new Promise(() => {});
  const pending = await socialPageResponse(pendingRpc, { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/", options: { signal: cancelled.signal } });
  cancelled.abort(new Error('cancel-stream'));
  await assert.rejects(pending.arrayBuffer(),/cancel-stream/);
});

test('adapter rejects unrelated HTTPS services before issuing RPC',async()=>{
 let called=false;
 await assert.rejects(socialPageResponse(async()=>{called=true;},{url:'https://cdn.example/a.mp4',referer:'https://example.com/'}),/not allowed/);
 assert.equal(called,false);
});

test("abort during open cancels a late handle", async () => {
  let resolveOpen;
  const controller = new AbortController();
  const calls = [];
  const rpc = async (message) => {
    calls.push(message);
    if (message.action === "open") return new Promise((resolve) => { resolveOpen = resolve; });
    return { done: true };
  };
  const opening = socialPageResponse(rpc, { url: "https://video.xx.fbcdn.net/a.mp4", referer: "https://www.facebook.com/", options: { signal: controller.signal } });
  controller.abort(new Error("stop"));
  await assert.rejects(opening, (error) => error.message === "stop");
  resolveOpen({ status: 200, headers: {}, handle: "late", done: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some((call) => call.action === "cancel" && call.options.handle === "late"), true);
});

test('range downloader receives byte-exact multi-megabyte output through the serialized page transport',async()=>{
 const input=new Uint8Array(2300000);for(let i=0;i<input.length;i++)input[i]=i%251;
 const output=new Uint8Array(input.length),ranges=[];
 const context=load(async(url,options)=>{
  assert.equal(options.credentials,'include');
  const match=options.headers.Range?.match(/^bytes=(\d+)-(\d*)$/);assert.ok(match);
  const start=Number(match[1]),end=Math.min(Number(match[2])||input.length-1,input.length-1);ranges.push([start,end]);
  return new Response(input.slice(start,end+1),{status:206,headers:{'content-type':'video/mp4','content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${input.length}`}});
 });
 const rpc=m=>context.socialPageFetch(m.action,m.options);
 const request=(url,options)=>socialPageResponse(rpc,{url,referer:'https://www.facebook.com/reel/1',options});
 const sink={writeAt:async(bytes,offset)=>output.set(bytes,offset),finish:async()=>({size:output.length})};
 const result=await directTransfer({url:'https://video.xx.fbcdn.net/large.mp4'},request,new AbortController().signal,()=>{},sink);
 assert.equal(result.size,input.length);assert.ok(ranges.length>=3);
 assert.equal(createHash('sha256').update(output).digest('hex'),createHash('sha256').update(input).digest('hex'));
});


test('page response preserves sanitized final path for redirected manifest references',async()=>{
 const result=await socialPageResponse(async()=>({status:200,headers:{},done:true,url:'https://vod.dmcdn.net/edge/master.m3u8'}),{url:'https://cdndirector.dailymotion.com/master.m3u8',referer:'https://geo.dailymotion.com/player/a.html'});
 assert.equal(new URL('360.m3u8',result.url).href,'https://vod.dmcdn.net/edge/360.m3u8');
});
