import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveLanguage,translate,translateMessage,applyPopupLanguage} from '../extension/i18n.js';

test('the shipped popup source starts in English before asynchronous preferences load',async()=>{
 const html=await readFile(new URL('../extension/popup.html',import.meta.url),'utf8');
 assert.match(html,/<html lang="en">/);assert.match(html,/aria-busy="true"/);
 assert.doesNotMatch(html,/[\u3400-\u9fff]/u);
 const source=await readFile(new URL('../extension/popup.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/[\u3400-\u9fff]/u);
});

test('English is the default regardless of browser locale or missing preferences',()=>{
 assert.equal(resolveLanguage(), 'en');
 assert.equal(resolveLanguage(undefined,'zh-TW'),'en');
 assert.equal(resolveLanguage('invalid','zh-Hant'),'en');
 assert.equal(resolveLanguage('en'),'en');
});

test('only an explicit Traditional Chinese preference selects Chinese',()=>{
 assert.equal(resolveLanguage('zh-Hant'),'zh-Hant');
 assert.equal(translate('en','No video found'),'No video found');
 assert.equal(translate('zh-Hant','No video found'),'未取得影片資訊');
 assert.equal(translate('zh-Hant','Set shortcut: {action}',{action:translate('zh-Hant','Previous tick')}),'設定上一個刻度快捷鍵');
});

test('legacy Chinese errors map back to English and unknown Chinese errors never leak into English UI',()=>{
 assert.equal(translateMessage('en','影片未回應，請重新整理網頁'),'Video did not respond; reload the page');
 assert.equal(translateMessage('en','保存失敗：影片已切換，請重新選取'),'Could not save: Video changed; select it again');
 assert.equal(translateMessage('en','保存失敗：來自未知元件的錯誤'),'Could not save: An unexpected error occurred');
 assert.equal(translateMessage('en','來自未知元件的錯誤'),'An unexpected error occurred');
 assert.equal(translateMessage('zh-Hant','來自未知元件的錯誤'),'來自未知元件的錯誤');
 assert.equal(translateMessage('en','Extension context invalidated.'),'Extension context invalidated.');
});

test('legacy dynamic quality messages are normalized before localization',()=>{
 assert.equal(translateMessage('en','最佳（720p）'),'Best (720p)');
 assert.equal(translateMessage('en','720p（自動）'),'720p (Auto)');
 assert.equal(translateMessage('en','偏好 1080p；此影片使用 720p'),'Preferred 1080p; this video uses 720p');
 assert.equal(translateMessage('zh-Hant','Best (720p)'),'最佳（720p）');
 assert.equal(translateMessage('zh-Hant','Select a video · Esc to cancel'),'點選影片 · Esc 取消');
 assert.equal(translate('zh-Hant','Video {number}',{number:2}),'影片 2');
});

test('popup localization updates status text, language metadata, title and accessible labels',()=>{
 const nodes=new Map();
 const node=()=>({textContent:'',title:'',attrs:{},childNodes:[],setAttribute(name,value){this.attrs[name]=value;}});
 for(const selector of ['#single-target','#advanced>summary>span','#tab-preferences','#enabled','#pick','#refresh','#open-settings','#settings-back','#site-input','#site-add'])nodes.set(selector,node());
 const root={documentElement:{lang:'en'},querySelector:selector=>nodes.get(selector)||null};
 applyPopupLanguage(root,'zh-Hant');
 assert.equal(root.documentElement.lang,'zh-Hant');
 assert.equal(nodes.get('#single-target').textContent,'載入中…');
 assert.equal(nodes.get('#advanced>summary>span').textContent,'播放選項');
 assert.equal(nodes.get('#tab-preferences').textContent,'偏好');
 assert.equal(nodes.get('#enabled').attrs['aria-label'],'載入中');
 assert.equal(nodes.get('#pick').attrs.title,'在網頁選取影片');
 assert.equal(nodes.get('#site-input').attrs.placeholder,'網域或影片網址');
});
