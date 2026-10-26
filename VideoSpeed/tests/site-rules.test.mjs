import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSiteRule,normalizeSiteRules,validateSiteRules,disabledOnUrl,siteModeOnUrl,settingsForUrls} from '../src/site-rules.js';
import {normalizeSettings,validateSettings} from '../src/settings.js';
import {siteDomain} from '../src/site-domain.js';
test('site defaults use public suffixes and isolate hosted tenants',()=>{
 assert.equal(siteDomain('https://www.youtube.com/watch?v=a'),'youtube.com');assert.equal(siteDomain('https://m.youtube.com/'),'youtube.com');
 assert.equal(siteDomain('https://video.example.co.uk/a'),'example.co.uk');assert.equal(siteDomain('https://alice.github.io/a'),'alice.github.io');
 assert.equal(siteDomain('http://127.0.0.1:8000'),'127.0.0.1');assert.equal(siteDomain('chrome://extensions'),'');
});
test('domain rules include all subdomains without matching lookalikes',()=>{
 const rules=[normalizeSiteRule('WWW.YouTube.COM')];for(const url of ['https://youtube.com/','https://www.youtube.com/watch?v=a','https://m.youtube.com/'])assert.equal(disabledOnUrl(url,rules),true);
 for(const url of ['https://youtube.com.evil.test/','https://notyoutube.com/','chrome://youtube.com'])assert.equal(disabledOnUrl(url,rules),false);
});
test('video URL rule accepts extra seek/tracking parameters but not another video',()=>{
 const rules=[normalizeSiteRule('https://www.youtube.com/watch?v=A')];assert.equal(disabledOnUrl('https://www.youtube.com/watch?t=30&v=A&list=L',rules),true);assert.equal(disabledOnUrl('https://youtube.com/watch?v=B',rules),false);assert.equal(disabledOnUrl('https://youtube.com/shorts/A',rules),false);
});
test('path wildcard and explicit port retain their intended scope',()=>{
 const rules=[normalizeSiteRule('http://localhost:8000/series/*')];assert.equal(disabledOnUrl('http://localhost:8000/series/one',rules),true);assert.equal(disabledOnUrl('http://localhost:8001/series/one',rules),false);assert.equal(disabledOnUrl('http://localhost:8000/series-other/one',rules),false);
});
test('hash routes remain specific rather than excluding the entire application',()=>{
 const rules=[normalizeSiteRule('https://example.com/#/video/1')];assert.equal(disabledOnUrl('https://example.com/#/video/1',rules),true);assert.equal(disabledOnUrl('https://example.com/#/video/2',rules),false);
});
test('generic exact URLs do not swallow different query or hash routes',()=>{
 const rules=[normalizeSiteRule('https://example.com/watch?id=1')];assert.equal(disabledOnUrl('https://example.com/watch?id=1&clip=2',rules),false);assert.equal(disabledOnUrl('https://example.com/watch?id=1#/other',rules),false);assert.equal(disabledOnUrl('https://example.com/watch?id=1',rules),true);
});
test('invalid rules cannot silently become broader exclusions',()=>{
 for(const raw of ['','javascript:alert(1)','https://user:pass@example.com/','youtube.com:443','https://*.youtube.com/*','https://example.com/a*/b/*'])assert.throws(()=>normalizeSiteRule(raw));
 assert.deepEqual(normalizeSiteRules([null,'youtube.com','youtube.com','javascript:bad']),['youtube.com']);assert.throws(()=>validateSiteRules(Array(201).fill('youtube.com')));
});

test('legacy exclusions stay Full and Default retains manual controls without changing saved preferences',()=>{
 const legacy=normalizeSettings({disabledSites:['youtube.com'],defaultMode:'follow',qualityEnabled:true});
 assert.deepEqual(legacy.siteModes,{});assert.equal(disabledOnUrl('https://youtube.com/watch?v=A',legacy.disabledSites,legacy.siteModes),true);
 const settings=validateSettings({...legacy,siteModes:{'youtube.com':'default'}});
 const local=settingsForUrls(settings,'https://www.youtube.com/watch?v=A');
 assert.equal(local.enabled,true);assert.equal(local.defaultMode,'off');assert.equal(local.qualityEnabled,false);
 assert.equal(local.preferredRate,settings.preferredRate);assert.deepEqual(local.shortcuts,settings.shortcuts);
 assert.equal(settings.defaultMode,'follow');assert.equal(settings.qualityEnabled,true);
 assert.equal(disabledOnUrl('https://youtube.com/',settings.disabledSites,settings.siteModes),false);
 assert.equal(siteModeOnUrl('https://youtube.com/',settings.disabledSites,settings.siteModes),'default');
 const other=settingsForUrls(settings,'https://example.com/');assert.equal(other.defaultMode,'follow');assert.equal(other.qualityEnabled,true);
});

test('parent Default exclusions apply to embedded frames and any matching Full rule wins',()=>{
 const settings=normalizeSettings({defaultMode:'custom',qualityEnabled:true,disabledSites:['example.com','https://player.test/blocked/*'],siteModes:{'example.com':'default'}});
 const embedded=settingsForUrls(settings,'https://player.test/watch','https://www.example.com/video');
 assert.equal(embedded.enabled,true);assert.equal(embedded.defaultMode,'off');assert.equal(embedded.qualityEnabled,false);
 assert.equal(settingsForUrls(settings,'https://player.test/blocked/one','https://example.com/').enabled,false);
 const fullParent=normalizeSettings({...settings,siteModes:{}});assert.equal(settingsForUrls(fullParent,'https://player.test/watch','https://example.com/').enabled,false);
 const globallyOff=settingsForUrls({...settings,enabled:false},'https://example.com/');assert.equal(globallyOff.enabled,false);
});

test('overlapping rules preserve Full scope and Default URL rules stay video-specific',()=>{
 const rules=['youtube.com','https://youtube.com/watch?v=A'],modes={'https://youtube.com/watch?v=A':'default'};
 assert.equal(siteModeOnUrl('https://youtube.com/watch?v=A',rules,modes),'full');
 assert.equal(siteModeOnUrl('https://youtube.com/watch?v=A&t=12',rules.slice(1),modes),'default');
 assert.equal(siteModeOnUrl('https://youtube.com/watch?v=B',rules.slice(1),modes),null);
 assert.equal(siteModeOnUrl('chrome://extensions',rules,modes),null);
});

test('invalid or orphaned modes recover conservatively and invalid writes are rejected',()=>{
 const base=normalizeSettings({disabledSites:['example.com']});
 const recovered=normalizeSettings({...base,siteModes:{'example.com':'typo','orphan.test':'default'}});
 assert.deepEqual(recovered.siteModes,{});assert.equal(disabledOnUrl('https://example.com/',recovered.disabledSites,recovered.siteModes),true);
 for(const siteModes of [null,[],{'example.com':'typo'},{'orphan.test':'default'}])assert.throws(()=>validateSettings({...base,siteModes}));
 assert.deepEqual(normalizeSettings({...base,siteModes:{'WWW.Example.COM':'default'}}).siteModes,{'example.com':'default'});
 const removed=normalizeSettings({...base,disabledSites:[],siteModes:{'example.com':'default'}});assert.deepEqual(removed.siteModes,{});
});
