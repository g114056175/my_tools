export const ZH_MESSAGES=Object.freeze({
 'Prefs':'偏好',
 'Keys':'快捷',
 'Exclude':'除外',
 'Quality':'畫質鎖定',
 'Preferred':'偏好速度',
 'Prev tick':'上一刻度',
 'Fine down':'細調減速',
 'Fine up':'細調加速',
 'Reset 1×':'還原 1×',

 'Loading':'載入中','Loading…':'載入中…','Settings':'設定','Preferences':'偏好','Ticks':'刻度','Shortcuts':'快捷鍵','Exclusions':'除外',
 'Playback options':'播放選項','Back':'返回','Interface':'介面','Appearance':'外觀','Language':'語言','Light':'淺色','Dark':'深色',
 'Chinese':'中文','Traditional Chinese':'繁體中文','Default speed':'速度預設','Default':'速度預設','Full':'完整停用','Off':'關閉','Last':'跟隨','Fixed':'指定','Fixed speed':'指定速度',
 'Quality lock':'畫質鎖定','Preferred speed':'偏好速度','Playback speed when a video first starts':'首次載入影片的播放速度',
 'Use the last speed from the previous video':'跟隨上一部影片最後使用的速度','Start each video at the fixed speed':'每部影片載入時使用指定速度',
 'Use the preferred-speed shortcut to switch to this speed':'按下偏好快捷鍵，跳至偏好速度',
 'Switch to dark theme':'切換深色外觀','Switch to light theme':'切換淺色外觀','Could not save appearance':'外觀保存失敗',
 'Enable VideoSpeed':'啟用 VideoSpeed','Disable VideoSpeed':'關閉 VideoSpeed','Disabled':'已關閉','Disabled on this site':'此網站已停用',
 'VideoSpeed (disabled)':'VideoSpeed（已關閉）','VideoSpeed (disabled on this site)':'VideoSpeed（此網站已停用）',
 'No video found':'未取得影片資訊','Select a video on the page':'在網頁選取影片','Select a video · Esc to cancel':'點選影片 · Esc 取消','Video':'影片','Video {number}':'影片 {number}','Refresh video':'更新影片資訊',
 'Playback speed':'播放速度','Current playback speed':'目前播放速度','Playback speed slider':'播放速度拉條','Settings tabs':'設定分類',
 'Previous tick':'上一個刻度','Next tick':'下一個刻度','Fine decrease':'降低一小格','Fine increase':'提高一小格',
 'Previous step':'上一刻度','Next step':'下一刻度','Fine slower':'細調減速','Fine faster':'細調加速','Reset to 1×':'還原 1×',
 'Set speed to {rate}×':'套用 {rate} 倍速','{rate}×':'{rate} 倍速','Reset defaults':'恢復預設','Cancel':'取消','Reset':'恢復',
 'Reset ticks?':'恢復預設刻度？','Reset shortcuts?':'恢復預設快捷鍵？','Speed ticks':'速度刻度','Press a key':'請按按鍵','Unbound':'未設定',
 'Set shortcut: {action}':'設定{action}快捷鍵','Clear shortcut: {action}':'清除{action}快捷鍵','Already assigned to “{action}”':'已用於「{action}」',
 'Domain or video URL':'網域或影片網址','Add a blocked domain or video URL':'新增停用網域或影片網址','Add block rule':'新增停用規則','Remove {rule}':'移除 {rule}',
 'Best':'最佳','Best ({height}p)':'最佳（{height}p）','{height}p (Auto)':'{height}p（自動）',
 'Preferred {wanted}p; this video uses {effective}p':'偏好 {wanted}p；此影片使用 {effective}p',
 'Could not connect':'無法連線','Open a page with a video first':'請先開啟有影片的網頁','Video changed; select it again':'影片已切換，請重新選取',
 'Return to the video tab first':'請先切回影片分頁','VideoSpeed is disabled':'VideoSpeed 已關閉','Video did not respond; reload the page':'影片未回應，請重新整理網頁',
 'Could not connect to the video':'影片控制未能連線','Player did not apply this speed':'播放器未套用此速度','Player does not accept this speed':'播放器不接受此速度',
 'Invalid playback speed':'無效的播放速度','Playback speed unavailable':'無法讀取播放速度','The site keeps overriding playback speed':'網站持續改寫播放速度',
 'Saved speed unavailable':'無法讀取倍速記憶','Video state unavailable':'無法讀取影片狀態','Live streams do not support playback speed':'此即時串流不支援倍速',
 'Speed range: 0.06–16×':'速度範圍：0.06–16×','Speed range: 0.06–16':'速度範圍：0.06–16',
 'Enter a speed between 0.06 and 16':'速度請填入 0.06～16 之間的數字','Use 1–64 ticks between 0.06 and 16':'刻度範圍：0.06–16，最多 64 個',
 'Use a character key with optional modifiers':'請使用字元鍵或修飾鍵組合','Shortcuts must be unique':'已設定的快捷鍵不可重複',
 'Enter a domain or full URL':'請輸入網域或完整網址','Invalid domain':'網域格式不正確','Enter an http or https URL':'請輸入 http 或 https 網址',
 'Only a trailing /* path wildcard is supported':'僅支援網址路徑結尾的 /*','Up to 200 block rules are supported':'最多可設定 200 條停用規則',
 'Invalid exclusion mode':'無效的除外類型','Skip automatic speed and quality settings':'略過自動倍速與畫質設定',
 'Disable all features on this site':'停用此網站所有功能','Could not save: {message}':'無法儲存：{message}',
 'Invalid saved playback speed data':'無效的播放速度記憶資料','Saved speed revision limit reached':'播放速度記憶版本已達上限',
 'Saved speed could not be confirmed':'播放速度記憶尚未確認','Unsupported action':'不支援的操作','Operation failed':'操作失敗',
 'An unexpected error occurred':'發生未預期的錯誤',
});

const LEGACY_MESSAGES=Object.freeze({
 '無法連線':'Could not connect','請先開啟有影片的網頁':'Open a page with a video first','影片已切換，請重新選取':'Video changed; select it again',
 '請先切回影片分頁':'Return to the video tab first','VideoSpeed 已關閉':'VideoSpeed is disabled','影片未回應，請重新整理網頁':'Video did not respond; reload the page',
 '影片控制未能連線':'Could not connect to the video','播放器未套用此速度':'Player did not apply this speed','播放器不接受此速度':'Player does not accept this speed',
 '無效的播放速度':'Invalid playback speed','無法讀取播放速度':'Playback speed unavailable','網站持續改寫播放速度':'The site keeps overriding playback speed',
 '無法讀取倍速記憶':'Saved speed unavailable','無法讀取影片狀態':'Video state unavailable','此即時串流不支援倍速':'Live streams do not support playback speed',
 '速度範圍：0.06–16×':'Speed range: 0.06–16×','速度範圍：0.06–16':'Speed range: 0.06–16',
 '速度請填入 0.06～16 之間的數字':'Enter a speed between 0.06 and 16','刻度範圍：0.06–16，最多 64 個':'Use 1–64 ticks between 0.06 and 16',
 '快捷鍵請使用單一字元或修飾鍵組合':'Use a character key with optional modifiers','請使用字元鍵或修飾鍵組合':'Use a character key with optional modifiers',
 '已設定的快捷鍵不可重複':'Shortcuts must be unique','請輸入網域或完整網址':'Enter a domain or full URL','網域格式不正確':'Invalid domain',
 '請輸入 http 或 https 網址':'Enter an http or https URL','僅支援網址路徑結尾的 /*':'Only a trailing /* path wildcard is supported',
 '最多可設定 200 條停用規則':'Up to 200 block rules are supported','無效的除外類型':'Invalid exclusion mode',
 '保存失敗：':'Could not save: ','不支援的操作':'Unsupported action','操作失敗':'Operation failed',
 '無效的播放速度記憶資料':'Invalid saved playback speed data','播放速度記憶版本已達上限':'Saved speed revision limit reached',
 '播放速度記憶尚未確認':'Saved speed could not be confirmed',
});

export function legacyChineseMessageToEnglish(message){
 const text=String(message??'');
 if(LEGACY_MESSAGES[text])return LEGACY_MESSAGES[text];
 if(text.startsWith('保存失敗：')){
  const detail=text.slice(5),translated=legacyChineseMessageToEnglish(detail);
  return 'Could not save: '+(translated??(/[\u3400-\u9fff]/u.test(detail)?'An unexpected error occurred':detail));
 }
 const used=text.match(/^已用於「(.+)」$/);if(used)return 'Already assigned to “'+(LEGACY_MESSAGES[used[1]]||({上一刻度:'Previous step',下一刻度:'Next step',細調減速:'Fine slower',細調加速:'Fine faster','還原 1×':'Reset to 1×','偏好速度':'Preferred speed'}[used[1]]||used[1]))+'”';
 const best=text.match(/^最佳（(\d+)p）$/);if(best)return `Best (${best[1]}p)`;
 const automatic=text.match(/^(\d+)p（自動）$/);if(automatic)return `${automatic[1]}p (Auto)`;
 const quality=text.match(/^偏好 (\d+)p；此影片使用 (\d+)p$/);if(quality)return `Preferred ${quality[1]}p; this video uses ${quality[2]}p`;
 return null;
}
