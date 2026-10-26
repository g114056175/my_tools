export function resolveLanguage(value,browserLanguage='en'){
 if(value==='zh-Hant'||value==='en')return value;
 return /^zh(?:[-_]|$)/i.test(browserLanguage)?'zh-Hant':'en';
}
const EN={
 '設定':'Settings','偏好':'Prefs','刻度':'Ticks','快捷':'Keys','除外':'Exclude','速度':'Speed',
 '播放選項':'Playback options','返回':'Back','介面':'Interface','外觀':'Appearance','語言':'Language','淺色':'Light','深色':'Dark',
 '速度預設':'Default','關閉':'Off','跟隨':'Last','指定':'Fixed','指定速度':'Fixed','畫質鎖定':'Quality','偏好速度':'Preferred',
 '首次載入影片的播放速度':'Playback speed when a video first starts',
 '跟隨上一部影片最後使用的速度':'Use the last speed from the previous video',
 '每部影片載入時使用指定速度':'Start each video at the fixed speed',
 '按下偏好快捷鍵，跳至偏好速度':'Use the preferred-speed shortcut to switch to this speed',
 '切換深色外觀':'Switch to dark theme','切換淺色外觀':'Switch to light theme','外觀保存失敗':'Could not save appearance',
 '啟用 VideoSpeed':'Enable VideoSpeed','關閉 VideoSpeed':'Disable VideoSpeed','已關閉':'Disabled','此網站已停用':'Disabled on this site',
 'VideoSpeed（已關閉）':'VideoSpeed (disabled)','VideoSpeed（此網站已停用）':'VideoSpeed (disabled on this site)',
 '未取得影片資訊':'No video found','在網頁選取影片':'Select a video on the page','更新影片資訊':'Refresh video',
 '播放速度':'Playback speed','目前播放速度':'Current playback speed','播放速度拉條':'Playback speed slider','設定分類':'Settings tabs',
 '上一個刻度':'Previous tick','下一個刻度':'Next tick','降低一小格':'Fine decrease','提高一小格':'Fine increase',
 '上一刻度':'Prev tick','下一刻度':'Next tick','細調減速':'Fine down','細調加速':'Fine up','還原 1×':'Reset 1×',
 '套用 {rate} 倍速':'Set speed to {rate}×','{rate} 倍速':'{rate}×',
 '恢復預設':'Reset defaults','取消':'Cancel','恢復':'Reset','恢復預設刻度？':'Reset ticks?','恢復預設快捷鍵？':'Reset shortcuts?',
 '速度刻度':'Speed ticks','請按按鍵':'Press a key','未設定':'Unbound','設定{action}快捷鍵':'Set shortcut: {action}','清除{action}快捷鍵':'Clear shortcut: {action}',
 '網域或影片網址':'Domain or video URL','新增停用網域或影片網址':'Add a blocked domain or video URL','新增停用規則':'Add block rule','移除 {rule}':'Remove {rule}',
 '最佳':'Best','{height}p（自動）':'{height}p (Auto)','最佳（{height}p）':'Best ({height}p)',
 '無法連線':'Could not connect','請先開啟有影片的網頁':'Open a page with a video first','影片已切換，請重新選取':'Video changed; select it again',
 'VideoSpeed 已關閉':'VideoSpeed is disabled','影片未回應，請重新整理網頁':'Video did not respond; reload the page','影片控制未能連線':'Could not connect to the video',
 '播放器未套用此速度':'Player did not apply this speed','播放器不接受此速度':'Player does not accept this speed','無效的播放速度':'Invalid playback speed',
 '無法讀取播放速度':'Playback speed unavailable','網站持續改寫播放速度':'The site keeps overriding playback speed',
 '無法讀取倍速記憶':'Saved speed unavailable','無法讀取影片狀態':'Video state unavailable',
 '此即時串流不支援倍速':'Playback speed is unavailable for this live stream',
 '速度範圍：0.06–16×':'Speed range: 0.06–16×','速度範圍：0.06–16':'Speed range: 0.06–16',
 '速度請填入 0.06～16 之間的數字':'Enter a speed between 0.06 and 16',
 '刻度範圍：0.06–16，最多 64 個':'Use 1–64 ticks between 0.06 and 16',
 '快捷鍵請使用單一字元或修飾鍵組合':'Use a character key with optional modifiers',
 '已設定的快捷鍵不可重複':'Shortcuts must be unique','請使用字元鍵或修飾鍵組合':'Use a character key with optional modifiers',
 '請輸入網域或完整網址':'Enter a domain or full URL','網域格式不正確':'Invalid domain',
 '請輸入 http 或 https 網址':'Enter an http or https URL','僅支援網址路徑結尾的 /*':'Only a trailing /* path wildcard is supported',
 '最多可設定 200 條停用規則':'Up to 200 block rules are supported',
 '無效的除外類型':'Invalid exclusion mode',
};
export function translate(language,key,values={}){
 const text=language==='en'?(EN[key]??key):key;
 return text.replace(/\{(\w+)\}/g,(match,name)=>values[name]===undefined?match:String(values[name]));
}
export function translateMessage(language,message){
 if(language!=='en')return String(message??'');
 const text=String(message??'');if(EN[text])return EN[text];
 if(text.startsWith('保存失敗：'))return 'Could not save: '+translateMessage(language,text.slice(5));
 const used=text.match(/^已用於「(.+)」$/);if(used)return 'Already assigned to '+translate(language,used[1]);
 const best=text.match(/^最佳（(\d+)p）$/);if(best)return translate(language,'最佳（{height}p）',{height:best[1]});
 const auto=text.match(/^(\d+)p（自動）$/);if(auto)return translate(language,'{height}p（自動）',{height:auto[1]});
 const quality=text.match(/^偏好 (\d+)p；此影片使用 (\d+)p$/);if(quality)return 'Preferred '+quality[1]+'p; this video uses '+quality[2]+'p';
 return text;
}
export function applyPopupLanguage(root,language){
 const textBindings={
  '#advanced>summary>span':'播放選項','#tab-preferences':'偏好','#tab-interface':'介面','#tab-steps':'刻度','#tab-shortcuts':'快捷','#tab-sites':'除外',
  '.settings-header h1':'設定','#appearance-label':'外觀','#language-label':'語言','[data-theme=light]>span':'淺色','[data-theme=dark]>span':'深色',
  '.field-label':'速度預設','[data-mode=off]':'關閉','[data-mode=follow]':'跟隨','[data-mode=custom]':'指定','#quality-label':'畫質鎖定',
  '#step-reset-request':'恢復預設','#shortcut-reset-request':'恢復預設','#step-reset-cancel':'取消','#shortcut-reset-cancel':'取消','#step-reset-confirm':'恢復','#shortcut-reset-confirm':'恢復',
  '#step-reset-toolbar>span':'恢復預設刻度？','#shortcut-reset-toolbar>span':'恢復預設快捷鍵？',
 };
 for(const [selector,key]of Object.entries(textBindings)){const node=root.querySelector(selector);if(node)node.textContent=translate(language,key);}
 for(const [selector,key]of [['#custom-row','指定速度'],['.preferred-setting','偏好速度']]){const node=root.querySelector(selector),text=[...node.childNodes].find(item=>item.nodeType===3);if(text)text.nodeValue=translate(language,key);}
 const attrs=[
  ['#pick','title','在網頁選取影片'],['#pick','aria-label','在網頁選取影片'],['#refresh','title','更新影片資訊'],['#refresh','aria-label','更新影片資訊'],
  ['#open-settings','title','設定'],['#open-settings','aria-label','設定'],['#settings-back','title','返回'],['#settings-back','aria-label','返回'],['[data-tab-group=playback]','aria-label','播放選項'],
  ['.playback','aria-label','播放速度'],['#current-rate','aria-label','目前播放速度'],['#rate-slider','aria-label','播放速度拉條'],['[data-tab-group=configuration]','aria-label','設定分類'],
  ['.field-label','title','首次載入影片的播放速度'],['.mode-switch','aria-label','速度預設'],['[data-mode=follow]','title','跟隨上一部影片最後使用的速度'],['[data-mode=custom]','title','每部影片載入時使用指定速度'],
  ['#custom-row','title','每部影片載入時使用指定速度'],['.preferred-setting','title','按下偏好快捷鍵，跳至偏好速度'],['#quality-list','aria-label','畫質鎖定'],['#steps-input','aria-label','速度刻度'],
  ['#site-input','placeholder','網域或影片網址'],['#site-input','aria-label','新增停用網域或影片網址'],['#site-add','aria-label','新增停用規則'],
 ];
 for(const [selector,attribute,key]of attrs)root.querySelector(selector)?.setAttribute(attribute,translate(language,key));
 root.documentElement.lang=language==='en'?'en':'zh-Hant';
}
