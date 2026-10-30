import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeToastPlatform,parseNativeSpeed,NativeRateToast} from '../src/native-rate-toast.js';

test('only genuine YouTube and Bilibili hosts have native-toast adapters',()=>{
 for(const host of ['youtube.com','www.youtube.com','music.youtube.com','www.youtube-nocookie.com'])assert.equal(nativeToastPlatform(host),'youtube');
 for(const host of ['www.bilibili.com','player.bilibili.com','bilibili.com'])assert.equal(nativeToastPlatform(host),'bilibili');
 for(const host of ['example.test','youtube.com.example.test','fakebilibili.com','bilibili.tv','facebook.com'])assert.equal(nativeToastPlatform(host),null);
});

test('native speed text normalizes known units and keeps displayed precision',()=>{
 for(const [text,rate,precision]of [['1.5x',1.5,1],['1.50×',1.5,2],['2.0x播放',2,1],['1.5倍速',1.5,1],['1.5倍速播放中',1.5,1],['速度為 1.25',1.25,2],['Speed is 1.25',1.25,2],['Playback speed: 2',2,0],['１．５ｘ',1.5,1]])assert.deepEqual(parseNativeSpeed(text),{rate,precision},text);
});

test('bare numbers require a speed-specific hint and unrelated notifications stay unmatched',()=>{
 for(const text of ['1.0','1.5']){
  assert.equal(parseNativeSpeed(text),null);
  assert.equal(parseNativeSpeed(text,{allowBare:true})?.rate,Number(text));
 }
 for(const text of ['50%','1080p','00:15','Next video in 2 seconds','2秒後播放','已恢复播放','Video 1.5x title','1.5x, click here','17x','0x','-1x','NaNx'])assert.equal(parseNativeSpeed(text),null,text);
});

test('unknown websites do not query, style or observe their player at all',()=>{
 let touched=0;const document={defaultView:{location:{hostname:'example.test'},MutationObserver:class{constructor(){touched++;}}},createElement(){touched++;throw Error('Unexpected style');}};
 const notice=new NativeRateToast(document);assert.equal(notice.arm({isConnected:true,closest(){touched++;}},2,'film'),false);notice.stop();assert.equal(touched,0);
});
