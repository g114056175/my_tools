import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { chromium } from 'playwright';

const chromiumPath = process.env.VIDEOSPEED_CHROMIUM?.trim() || chromium.executablePath();

test('page bridge route binding settles under same-URL history and attribute feedback', { timeout: 15000 }, async () => {
  await stat(chromiumPath);
  const script = await readFile(new URL('../../extension/page-bridge.js', import.meta.url), 'utf8');
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://www.youtube.com') return route.abort('blockedbyclient');
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><title>Page bridge route test</title>
          <div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>
          <script>
            const player=document.querySelector('#movie_player');let videoId='qa-route';
            player.getVideoData=()=>({video_id:videoId,title:'QA'});
            player.getPlayerResponse=()=>({videoDetails:{videoId,title:'QA'}});
            window.__qa={routeEvents:0,videoScans:0,attributeWrites:0,timerTicks:0};
            window.addEventListener('video-control:route',()=>window.__qa.routeEvents++);
            window.__qa.setVideoId=value=>{videoId=value;};
            const originalSet=Element.prototype.setAttribute;
            Element.prototype.setAttribute=function(name,value){
              if(name.startsWith('data-video-control-'))window.__qa.attributeWrites++;
              return Reflect.apply(originalSet,this,[name,value]);
            };
            const originalQuery=document.querySelectorAll;
            document.querySelectorAll=function(selector){
              if(selector==='video')window.__qa.videoScans++;
              return Reflect.apply(originalQuery,this,[selector]);
            };
            setInterval(()=>window.__qa.timerTicks++,5);
          </script>`
      });
    });
    await page.goto('http://www.youtube.com/watch?v=qa-route');
    await page.addScriptTag({ content: script });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4', {
      detail: JSON.stringify({ enabled: true, owner: 'route-regression', exploring: true, qualityEnabled: false })
    })));
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('data-video-control-ready-key') === 'yt:qa-route');
    await page.waitForTimeout(20);

    const initial = await page.evaluate(() => ({ ...window.__qa }));
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        history.replaceState({ stateOnly: i }, '', location.href);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    });
    await page.waitForTimeout(20);
    const afterStateOnly = await page.evaluate(() => ({ ...window.__qa }));
    assert.equal(afterStateOnly.routeEvents, initial.routeEvents, 'state-only replaceState must not emit a route');
    assert.equal(afterStateOnly.videoScans, initial.videoScans, 'state-only replaceState must not rescan videos');
    assert.equal(afterStateOnly.attributeWrites, initial.attributeWrites, 'state-only replaceState must not rewrite video attributes');

    await page.evaluate(() => window.dispatchEvent(new Event('yt-navigate-finish')));
    await page.waitForFunction(count => window.__qa.videoScans > count, initial.videoScans);
    const afterIdempotentBind = await page.evaluate(() => ({ ...window.__qa }));
    assert.equal(afterIdempotentBind.attributeWrites, initial.attributeWrites, 'stable binding must avoid redundant attribute mutations');

    await page.evaluate(() => {
      const video = document.querySelector('video');
      window.__qa.feedbackCallbacks = 0;
      window.__qa.feedbackObserver = new MutationObserver(records => {
        if (!records.some(record => record.attributeName.startsWith('data-video-control-'))) return;
        window.__qa.feedbackCallbacks++;
        history.replaceState({ observerFeedback: window.__qa.feedbackCallbacks }, '', location.href);
      });
      window.__qa.feedbackObserver.observe(video, { attributes: true, attributeFilter: [
        'data-video-control-ready', 'data-video-control-ready-key', 'data-video-control-ad',
        'data-video-control-content-id', 'data-video-control-title', 'data-video-control-title-id'
      ] });
      window.__qa.timerTicksBeforeRoute = window.__qa.timerTicks;
      window.__qa.setVideoId('qa-next');
      history.replaceState({ actualRoute: true }, '', '/watch?v=qa-next');
    });
    await page.waitForFunction(() => document.querySelector('video')?.getAttribute('data-video-control-ready-key') === 'yt:qa-next');
    await page.waitForTimeout(50);
    const feedback = await page.evaluate(() => {
      window.__qa.feedbackObserver.disconnect();
      delete window.__qa.feedbackObserver;
      return { ...window.__qa };
    });
    assert.equal(feedback.routeEvents - afterIdempotentBind.routeEvents, 1, 'attribute observer state-only update must not retrigger route binding');
    assert.equal(feedback.videoScans - afterIdempotentBind.videoScans, 1, 'actual URL route must schedule one video scan');
    assert.equal(feedback.feedbackCallbacks, 1, 'attribute feedback must settle after the one real route update');
    assert.ok(feedback.timerTicks > feedback.timerTicksBeforeRoute, 'page tasks must continue while route binding settles');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('yt-navigate-finish'));
      document.dispatchEvent(new CustomEvent('video-control:bridge-state-v4', {
        detail: JSON.stringify({ force: true, enabled: false })
      }));
    });
    const beforeStopTimer = await page.evaluate(() => window.__qa.videoScans);
    await page.waitForTimeout(20);
    const afterStopTimer = await page.evaluate(() => window.__qa.videoScans);
    assert.equal(afterStopTimer, beforeStopTimer, 'stop must cancel the pending bind task');
  } finally {
    await browser.close();
  }
});
