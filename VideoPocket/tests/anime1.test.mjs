import test from 'node:test';
import assert from 'node:assert/strict';
import { anime1MediaUrl, mediaCredentials, resolveAnime1 } from '../extension/anime1.js';

const page = 'https://anime1.me/30114';
const token = encodeURIComponent(JSON.stringify({ c: '1958', e: '8', t: 1792044880, p: 0, s: 'redacted-fixture' }));
const descriptor = { referer: page, platform: { site: 'anime1', apiRequest: token }, title: 'fixture' };
const jsonResponse = value => ({ ok: true, status: 200, json: async () => value });

test('Anime1 API sends already encoded data-apireq without double form encoding', async () => {
  let call;
  const result = await resolveAnime1(descriptor, async (url, referer, init) => {
    call = { url, referer, init };
    return jsonResponse({ s: [{ src: '//miru.v.anime1.me/1958/8.mp4', type: 'video/mp4' }] });
  });
  assert.equal(call.url, 'https://v.anime1.me/api');
  assert.equal(call.referer, page);
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.init.body,'d='+token);
  assert.equal(new URLSearchParams(call.init.body).get('d'),decodeURIComponent(token));
  assert.ok(!call.init.body.includes('%257B'));
  assert.equal(result.url, 'https://miru.v.anime1.me/1958/8.mp4');
});

test('dynamic Anime1 CDN subdomains are accepted only for the expected episode', async () => {
  for (const host of ['muan.v.anime1.me', 'miru.v.anime1.me', 'hajime.v.anime1.me']) {
    const result = await resolveAnime1(descriptor, async () => jsonResponse({ s: [{ src: `https://${host}/1958/8.mp4` }] }));
    assert.equal(new URL(result.url).hostname, host);
  }
  await assert.rejects(
    resolveAnime1(descriptor, async () => jsonResponse({ s: [{ src: 'https://muan.v.anime1.me/1958/7.mp4' }] })),
    /可用來源/
  );
});

test('external hosts, credentials URLs, and wrong paths are rejected', async () => {
  for (const src of [
    'https://evil.example/1958/8.mp4',
    'https://muan.v.anime1.me/1958/8.mp4@evil.example/',
    'https://muan.v.anime1.me/1958/9.mp4',
  ]) {
    await assert.rejects(resolveAnime1(descriptor, async () => jsonResponse({ s: [{ src }] })), /可用來源/);
  }
  const signed = await resolveAnime1(descriptor, async () => jsonResponse({ s: [{ src: 'https://muan.v.anime1.me/1958/8.mp4?sig=fixture' }] }));
  assert.equal(new URL(signed.url).search, '?sig=fixture');
  assert.equal(anime1MediaUrl('https://muan.v.anime1.me/1958/8.mp4')?.hostname, 'muan.v.anime1.me');
  assert.equal(anime1MediaUrl('https://evil.example/1958/8.mp4'), null);
});

test('credentials are included only for an Anime1 page and Anime1 media host', () => {
  assert.equal(mediaCredentials('https://muan.v.anime1.me/1958/8.mp4', page), 'include');
  assert.equal(mediaCredentials('https://evil.example/1958/8.mp4', page), 'omit');
  assert.equal(mediaCredentials('https://muan.v.anime1.me/1958/8.mp4', 'https://evil.example/'), 'omit');
  assert.equal(mediaCredentials('https://muan.v.anime1.me/1958/8.mp4', 'http://anime1.me/30114'), 'omit');
});

test('malformed or unsuccessful API data never becomes a successful source', async () => {
  for (const body of [{}, { s: [] }, { s: [{ src: 'https://evil.example/file.mp4' }] }, { error: 'forbidden' }]) {
    await assert.rejects(resolveAnime1(descriptor, async () => jsonResponse(body)), /可用來源/);
  }
  await assert.rejects(resolveAnime1(descriptor, async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid json'); } })), /API 回應無效/);
});

test('live HTTP flow is opt-in and never uses the user browser profile', { skip: !process.env.ANIME1_LIVE }, async () => {
  const pageResponse = await fetch(page);
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  const match = html.match(/data-apireq="([^"]+)"/);
  assert.ok(match, 'public page must expose data-apireq');
  const liveDescriptor = { referer: page, platform: { site: 'anime1', apiRequest: match[1] } };
  const resolved = await resolveAnime1(liveDescriptor, async (url, referer, init) => {
    const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: 'https://anime1.me' } });
    return { ok: response.ok, status: response.status, json: () => response.json() };
  });
  assert.match(resolved.url, /^https:\/\/[^/]+\.v\.anime1\.me\/\d+\/\d+\.mp4$/);
});
