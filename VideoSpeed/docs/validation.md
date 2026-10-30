# VideoSpeed 1.0.0 原生速度按鈕與拖曳提示修正

2026-10-30。原生倍速提示修正與驗證。

- YouTube 新版 `.ytp-variable-speed-panel-preset-button` 沒有 menu role 或速度 aria-label；補上 speed-panel 控制區辨識，點下方數字能記錄並提示。
- 原生 range 優先讀目前的 value，避免取到延後更新的 ARIA。拖曳提示立即跟隨目前輸入值；真正播放速度及記憶仍以播放器確認結果為準，不把拖曳預覽寫入記憶。
- YouTube 在放開後才延遲提交真實倍速，收尾 click 原本會清掉待確認輸入；現在保留同次調整的最後精確值，仍有 1200ms 期限、影片身分與來源限制，確認後只用一次。自訂滑桿直接改速的 pointermove 也補上同事件驗證；純滑鼠移動不做媒體查找。
- Bilibili !／@ 真正使用 `.bpx-player-tooltip-item[data-name="shortcut"]` 與 `.bpx-player-tooltip-title`，前版僅處理 toast，漏了這套元件。本輪已補上；同一 shortcut 元件留下的舊倍率也保持隱藏，變成音量等非倍速訊息則還原。僅觀察播放器內已知的小提示區域，控制項 hover tooltip 不遮擋，沒有全頁輪詢。
- Bilibili 純倍速 toast 即使包含關閉圖示也可一併遮擋；確認、登入、連結等行動通知保留。未知網站不加入遮擋。

356 項單元／整合測試、Brave 的 14 項可信輸入案例與 Chromium 的 37 項提示遮擋／還原案例通過。新增新版數字按鈕、舊 ARIA、延遲提交、預覽不污染記憶、實際 shortcut tooltip、舊倍率、共用訊息還原，以及滑鼠懸停不查找媒體案例。提示立即顯示後，儲存仍非同步，瀏覽器驗證現已等待儲存完成再核對記憶。

YouTube 實站 8 項通過：1.5／2.0 數字按鈕提示、拖曳依序顯示 1.75／1.45／1.25，放開後實際速度與記憶確認為 1.25。Bilibili 實站 5 項通過：!／@ 真正切換 1／2 倍，VS 提示與記憶同步；實際 `2.0x播放`／`1.0x播放` shortcut tooltip 均標記並隱藏，後續 VS 改為 1.25 時舊倍率仍不重現。另用官方 toast API 產生含關閉鈕的真實速度 toast，確認被遮擋且登入通知仍可見。兩站畫面已以真實尺寸檢查，專用暫存 profile 已清理，前後成品 hash 一致。

限制：實站 ArrowDown 未在同一 shortcut 節點產生音量訊息，該探測未列為通過；共用節點改顯示音量、畫質、錯誤等通知的還原已由本地真實瀏覽器案例驗證。原始未觸發紀錄保留於 `bilibili-tooltip-final.json`，已確認案例另列於 `bilibili-verified.json`。

成品含 25 檔；SHA-256：`7ce9d9ada5b58a5f4682afe5b55fb04d0543bd021b393eeb192440bce852a1b2`。證據：`work/qa-095-native-controls/`、`work/qa-091-native-rate/tooltip-brave-final-results.json`、`work/qa-093-native-suppression/tooltip-chromium-verified-results.json`。

<details>
<summary>先前驗證紀錄</summary>

# VideoSpeed 1.0.0 即時倍速提示

2026-10-30。移除原生手動調速提示的 500ms 等待佇列；選單、按鍵及滑桿確認有效改速後立即更新提示，連續操作重用同一個提示框並延長顯示時間。原有使用者操作驗證、記憶保護、預設首次載入時機，以及 YouTube／Bilibili 原生倍速提示遮擋維持不變。

350 項單元／整合測試通過。隔離 Brave 的 11 項可信輸入回歸通過：原生選單、B 站 !／@、細調按鈕及自訂滑桿放開後，提示在操作確認後 0–9ms 讀取到；原生 range 拖曳每次有效變更均即時顯示。Chromium 的 32 項提示遮擋／還原回歸通過，未知網站及其他類型通知保持原生行為。此輪瀏覽器驗證使用本地播放器 fixture；額外的 YouTube 實站測試於頁面操作前遇到專用 profile 的 chrome.storage IO 錯誤，未列為實站驗收通過。專用 profile 均已清理。

成品含 25 檔；SHA-256：`26c415c452d903b91e8aaa2cc1572bee7c06ce30100ee16a34702239d4bea42c`。證據：`work/qa-094-immediate-native-notice/`、`work/qa-091-native-rate/immediate-brave-final-results.json`、`work/qa-093-native-suppression/immediate-chromium-results.json`。GitHub 未更新。

<details>
<summary>先前驗證紀錄</summary>

# VideoSpeed 1.0.0 原生倍速提示遮擋

2026-10-30。本機修正，未知網站不加入提示遮擋；原生改速仍等待最後一次有效變更後 500ms 顯示 VS 提示。

- 僅對目前控制影片的 YouTube／Bilibili 播放器辨識原生倍速文字。YouTube 另外辨識帶有明確速度 aria-label 的倍速圖示；播放與音量圖示保留。
- Bilibili 共用 toast 只接受帶倍率單位／速度標籤的短文字；裸數字只在倍速專用提示中接受。文字須符合已確認的實際速度，整數倍率不以粗略四捨五入擴大比對。包含互動按鈕的通知保留。
- 只添加可還原的顯示標記，不刪原生節點。提示改顯示錯誤、音量、畫質、換集內容，或停用、失焦、換片、卸載時，恢復原生顯示。
- 連續改速重用已找到的小容器。播放器內新提示容器的探索最多兩秒，之後只保留已隱藏訊息所在小容器的文字／aria-label 觀察，確保共用節點改顯示警告時能還原；沒有常駐全頁輪詢。

350 項單元／整合、Chromium 151 與 Brave 156 各 32 項提示遮擋／還原回歸、既有原生改速 11 項與首次播放提示／預覽排除 25 項通過。包含未知網站不處理、播放區外同文字不遮擋、共用訊息重用、互動通知保留、延遲建立、停用與換來源還原；暫時探索結束後，播放器內其他區域的 100 次 DOM 新增未觸發原生提示搜尋。

YouTube 實站另以隔離 Chromium 暫時解除 VS 的加減速快捷鍵，使用 YouTube 原生 > 調至 1.25×：實際速度與記憶一致，原生倍速文字／圖示被隱藏，VS 提示約 533ms 出現；原生 100% 音量與暫停提示保留。前後成品 hash 一致，專用 profile 已清理。Bilibili 實站一次無影片、一次載入逾時，因此 B 站驗證範圍僅限已知 DOM 與實際可信輸入的本地 fixture，沒有宣稱實站驗收通過。

成品含 25 檔；SHA-256：`48980df1e587793a23ff481d52f83da77efcc3cb801f3b7a60618fe8c0e4b2bd`（相對路徑依大小寫排序，各檔 path + NUL + bytes + NUL）。證據：`work/qa-093-native-suppression/`、`work/qa-075-main-qa093-final/results.json`、`work/qa-091-native-rate/suppression-final-results.json`。GitHub 未更新。

<details>
<summary>原生提示等待調整紀錄</summary>

# VideoSpeed 1.0.0 原生提示等待調整

2026-10-30。本機原生手動改速提示改為最後一次有效變更後 500ms 顯示；改速與記憶仍立即處理，擴充快捷鍵維持即時提示。尚未加入原生播放器提示遮擋。

5 項提示單元檢查與隔離 Brave 156 的 11 項受信任操作情境通過，包含拖曳合併、B 站格式選項與 !／@、明確選回 1×、程式重設不污染記憶，以及下一部影片跟隨新速度。瀏覽器案例使用本地播放器，非實站驗收。測試啟動現在先等倍速記憶初始化、核對測試視窗聚焦，並為啟動保留六秒；初次等待不足的失敗紀錄另存，未列為通過。

成品 SHA-256：`86d20fd2074864efa954bb554d35aca4dae0982f82e85ce56ac37c3500aac35e`（相對路徑依大小寫排序，各檔 path + NUL + bytes + NUL）。證據：`work/qa-092-half-second/`、`work/qa-091-native-rate/half-second-brave-final-results.json`。GitHub 未更新。

<details>
<summary>原生改速提示修正紀錄</summary>

# VideoSpeed 1.0.0 原生改速提示修正

2026-10-30。本機修正，尚未更新 GitHub。

- 原生播放器改速原先沒有呼叫提示；現在確認使用者改速後仍立即更新記憶，提示則合併至最後一次調整後 300ms。擴充快捷鍵維持立即顯示，並取消較舊的待顯示原生提示。
- 補上自訂滑桿、速度加減按鈕、ARIA 標籤及 Bilibili class/data-value 選項辨識；音量、進度等控制不納入。元件與目前影片的歸屬仍需確認。
- 播放器較早的事件處理器可能先寫倍速，後續受信任事件證據尚未建立；觀察現在僅能等到同一事件回合結束，證據通過才記錄。按鍵證據在事件派送結束後立即失效。未確認的程式改速或載入重設不會升為跟隨記憶。
- 換片、卸載、離開焦點、關閉功能或較新的調速會取消／拒絕過期提示。

346 項單元／整合通過；Chromium 151、Brave 156 各 11 項受信任操作回歸通過，包含原生選單、連續 range 拖曳、自訂滑桿、B 站 !／@、加速按鈕、明確選回 1×、程式自動重設不污染記憶、擴充快捷鍵立即提示，以及下一部影片跟隨原生選擇的速度。原有主影片首次顯示與預覽排除 25 項也通過。

修正前同一組原生操作案例只有 2/10 通過，原生選項與提示缺失已重現。測試使用隔離 profile、本地播放器結構與實際可信鍵鼠事件；未以此宣稱完成 YouTube／Bilibili 實站驗收。

成品含 25 檔；SHA-256：`694d642fb356b76a5e7a726fdf5d5854f21966c4e0f468923c90e9baf3225244`（相對路徑依大小寫排序，各檔 path + NUL + bytes + NUL）。本機證據：`work/qa-091-native-rate/`、`work/qa-075-main-qa091-final-built/results.json`。

<details>
<summary>2026-10-29 歷史驗證</summary>

# VideoSpeed 1.0.0 發布驗證

2026-10-29。維持版本與下載檔名，更新本機修正並覆蓋既有發布檔。

- popup 的活動同步與影片補查共用一秒等待額度；外框繪製不再阻塞綁定。超時先顯示快取，並不代表頁面或瀏覽器停頓已被修復。
- 設定成功寫入本機後才更新快取並回覆；頁面通知另行處理，不拖住後續保存。延遲的頁面通知重新讀取已保存設定，舊讀取與舊啟動回覆不能覆蓋較新設定；寫入失敗不污染快取。
- 工具列圖示改為在 setIcon 回呼內接收 runtime.lastError。隔離 Brave 可重現「分頁已關閉、原 Promise 卻先成功」的未處理錯誤；修正後三次同樣操作均無新增警告。
- 發布回歸另抓到畫質排程缺少播放狀態檢查：延遲設定更新可能在手動改速後、影片仍暫停時提交畫質。排程及送出前現在都檢查播放狀態；第一次播放仍會套用，已提交的畫質不重複覆寫。

本次最終成品通過 336 項單元／整合測試，以及隔離瀏覽器的 11 項除外與介面、9 項頁面暫停／設定保存／BFCache、8 項首次播放畫質檢查。一般手動倍速、暫停重播、新影片套用最新設定與 Full／Default 行為均納入檢查。

Brave 156 與 Dark Reader 4.9.134 共存的本地 YouTube 結構測試，原生工具列 popup 持續開啟 12 秒、實際調速、Escape 返回、切窗恢復及未開 popup 的快捷鍵共五項通過。此為隔離 profile 與本地影片，沒有重現使用者的偶發共同停頓，不能作為已解決該問題的證據。

測試曾抓到新分頁第一個請求早於測試攔截器就載入外部網頁，之後資源被錯誤回覆為 HTML。測試現先開空白頁，再導航至本地 fixture 並確認影片存在；修正前的那次結果未列為通過。

成品含 25 檔；SHA-256：`9b49f9e45336524503a5d4b32a46b8b0354376b6fb6e578b5e9c9b102fd7b419`（相對路徑依大小寫排序，各檔 path + NUL + bytes + NUL）。沒有新增權限、介面、常駐輪詢或診斷蒐集。初始設定仍為速度／畫質關閉、偏好 2×、淺色英文。

本機證據：`work/qa-090-publish/`、`work/qa-088-settings-stall/publish-final-browser.json`、`work/qa-086-final/quality-before-play/publish-fixed-results.json`、`work/qa-087-darkreader/native/qa090-final-brave-results.json`、`work/qa-089-root-cause/publish-final-background-tab-close.json`、`work/qa-069-exclusion/results.json`。

<details>
<summary>2026-10-28 歷史驗證</summary>

# VideoSpeed 1.0.0 最後驗證

2026-10-28。修正兩個已重現的邊界，精簡打包；名稱、版本與下載檔名維持不變。首頁下載標籤統一為「下載ZIP」，大小保留在子專案說明與發布內文。

- 大型文件初次掃描未完成時，建構器又將同一份文件排入，導致完整走兩輪。15,000 節點的回歸測試在原版得到兩輪；移除多餘排程後為一輪，後續 DOM 變動仍由原先佇列處理。
- 影片載入後若先手動改速、再第一次播放，速度控制器已初始化，卻沒有觸發畫質排程。隔離 Chromium 已重現畫質呼叫為零；現在播放事件補交尚未完成的畫質工作，成功狀態仍阻止重複套用。修正版首次呼叫一次，暫停重播及同源重新載入都不重複，手動 1.5× 保留。
- 移除已包含在背景 bundle、未被執行期引用的 `rate-memory.js`／`tab-activity.js` 成品副本。來源保留；同步調整建置、封裝與測試清單，成品由 27 檔減為 25 檔。

修正版驗證：330 項單元／整合、8 項播放前改速與畫質檢查、25 項主片／預覽與提示、11 項除外與介面回歸均通過。不開 popup 的四次新文件、兩次 SPA、啟動故障恢復與 worker 冷啟動通過。Brave 原生 popup 持續開啟 35 秒、實際調速、Escape 返回、切窗恢復及不開 popup 的快捷鍵共五項通過；畫面以實際 420px 檢查。

修正版另通過 90 秒播放及五次快捷鍵檢查，包含動態替換影片、切離後返回與播放後段的控制；期間未開 popup 補救。

本輪修正前，原 v1.0.0 另通過 300 秒播放（12 次快捷鍵及提示、12 次同網址路由回授）、Chromium／Brave 原生 popup，以及更新時不探查三個未使用的無影片分頁、期限不延長與 BFCache 返回；其成品 hash 為 `d62d719a723175136840058d17743417920c5c8b64e55335ec27ef20ebf47335`。閒置測試使用 tab inactive 狀態；headless 的 visibilityState 仍為 visible，不能視為 hidden 分頁驗收。

以上使用隔離 profile、本機影片與播放器結構，不能取代各站實際長時間使用。先前環境中持續 context invalidation、長播卡死與 worker-fetch 的完整觸發條件仍未全數定位。本輪不新增亮度、音效或其他控制項。

成品 SHA-256：`ac41d37ab972b485cfacd00ec0d2150f4149c12caf222e65d66f5f49b930d5cf`（相對路徑依大小寫排序，各檔 path + NUL + bytes + NUL）。本機證據：`work/qa-086-final/`、`work/qa-082-popup/final-v100-after-brave-results.json`、`work/qa-autostart/final-v100-after-results.json`、`work/qa-075-main-final-v100-after/results.json`、`work/qa-069-exclusion/results.json`。

<details>
<summary>0.6.20 歷史驗證</summary>

# VideoSpeed 0.6.20 驗證

2026-10-28。新安裝外觀改為固定淺色，語言仍預設英文；速度預設與畫質皆關閉、偏好速度 2×。已儲存的外觀、語言與播放設定繼續保留。README 底部加入精簡已知問題，並明示縮圖預覽不支援調速。VideoPocket 未修改。

## 驗證

- 329 項單元／整合通過。
- 隔離 Chromium 設為中文語系、深色系統；全新安裝的 420px 擴充頁面仍為淺色英文，Default／Quality 均為 Off，Preferred 為 2。
- 本機影片原本 1.5×，開啟介面與預設設定後仍為 1.5×，未被偏好 2× 覆蓋。
- 使用者選擇深色及中文後，重開介面仍保留；移除這兩筆偏好後回到淺色英文。三項瀏覽器檢查通過，無頁面錯誤，測試 profile 已清理。

本輪範圍為預設值、外觀與語系保存及既有單元／整合。原生工具列 popup 與播放生命週期的驗證見 0.6.19 紀錄。

成品 SHA-256（相對路徑大小寫敏感排序，各檔 path + NUL + bytes + NUL）：`0599caea9f29236a9ec9ce52f600b118a8a3447f7c541a6774c45204fee0906c`。

本機證據：`work/qa-083-defaults/results.json`、`factory-light.png`、`unit.txt`；輸出摘要為 `VideoSpeed-validation.json`。

<details>
<summary>0.6.19 歷史驗證</summary>

# VideoSpeed 0.6.19 驗證

2026-10-28。修正原生工具列 popup 導致影片狀態被清空，以及初次狀態讀取被快取更新蓋掉的競態。VideoPocket 未修改。

## 原因與修正

隔離的有畫面 Chromium 已重現：開 popup 前，主影片仍在 registry 且可播放；呼叫原生 `chrome.action.openPopup()` 後，Chrome 回報所屬視窗未聚焦。舊程式將它視為真正離開頁面，立即移除已完成初始化的影片，送出空快照。popup 當時尚未訂閱分頁更新，後續讀取可能繼續顯示 No video found。這是擴充功能自身的活動與資料同步錯誤，不是 YouTube／Bilibili 抓取規則失效。

- popup 在讀取外觀設定前即連線、綁定目前分頁；背景核對實際 active tab 與所屬視窗，將這個原生 popup 視為同分頁的互動。真正切至其他視窗仍照常釋放控制。
- 關閉 popup 時重查真實焦點；若讀取途中發生開關或切窗，丟棄舊結果並重讀，避免恢復錯誤的活動狀態。
- 完整讀取先同步分頁資格，再取得影片快照；較早到達的 cachedState 不再取消首次完整讀取。
- 名稱、速度與位置的快照立即回傳，畫質能力在旁路補查；快照持續攜帶世代與序號。已知 navigation commit 的舊 document 回報不能清除或替換新文件的影片。
- 真正回到頁面時核對活動資格；失焦紀錄尚未更新但頁面已收到可信快捷鍵時，可重新確認資格後執行。沒有新增常駐全頁掃描或背景輪詢。

## 驗證

- 329 項單元／整合通過。新增 popup 綁定、真正切窗、關閉競態、先同步後抓取，以及舊文件延遲回報測試；舊文件案例已在未修正版本重現失敗。
- 13 項視覺選片回歸、25 項主影片／預覽與提示回歸通過。
- 不開 popup 的四次新文件、兩次 SPA、快捷鍵、啟動故障及 worker 冷啟動回歸通過。
- 12 項近期／待載入生命週期通過，包含真正離開頁面後停止控制、10／30 秒期限、首次速度與畫質，以及跟隨記憶保護。
- 有畫面 Chromium 的原生工具列 popup 在載入後 1、5、12、35 秒均核對名稱、控制區、快取影片 ID 與外框；持續開啟 35 秒並實際按鈕調速通過。
- 正常 Escape 關閉 popup、切窗返回、不開 popup 直接按快捷鍵均通過。快捷鍵核對可信 keyup、主片實際速度、`rateOrigin=command` 與影片提示，避免將播放器自行改速算成成功。
- Brave 的 YouTube 結構案例核對原生 popup、35 秒持續操作、Escape 返回與直接快捷鍵通過。

成品 SHA-256（大小寫敏感相對路徑排序，各檔 path + NUL + bytes + NUL）：`050492f5fde8d2585010a320dffe47e584fc9fcaf10ef3a14cf51bdcef60d183`。

原始診斷報告保留：早期測試以 CDP 強制銷毀 popup target，或等待會被擴充功能攔截的後置 keydown 觀察器，產生了不適合當正常互動驗收的失敗條件；正式補驗使用 Escape 與可信 keyup。早期原因重現期間的 runtime 曾有開發修改，不作完整舊版成品的驗收證據；最終候選測試均核對同一 hash 前後未變。

本機證據：`work/qa-082-popup/`、`work/qa-082-release/`、`work/qa-080-visual/candidate/results.json`、`work/qa-075-main-release-0619-final/results.json`、`work/qa-autostart/release-0619-final-results.json`。輸出摘要為 `VideoSpeed-validation.json`。

## 驗證界線

原先選片測試用無頭瀏覽器及擴充頁面，未涵蓋原生工具列 popup 的視窗焦點變化，因此即使快捷鍵測試通過，仍漏掉這次基本回歸。本輪把真 popup 的 DOM、影片名稱、控制區、外框及實際調速目標一致納入檢查。

以上使用隔離瀏覽器、本機影片及對應播放器結構，尚未替代使用者當前實站的最終 demo。舊版持續 context invalidation、長播卡死與 worker-fetch 的原始觸發條件未全數定位，不能宣稱全部解決。worker 重啟後的 document guard 需重新建立，因此不宣稱可拒絕所有跨重啟的退休文件訊息。

<details>
<summary>0.6.18 歷史驗證</summary>

# VideoSpeed 0.6.18 驗證

2026-10-28。自動選片改以視覺主體為主，手動選取不再永久固定。VideoPocket 未修改，UI、權限及速度／畫質偏好維持原有設定。

## 規則與成本

1. 先排除已知 YouTube／Bilibili 縮圖預覽；未知網站的影片照一般候選處理。
2. 全螢幕優先；有合理可見候選時，畫面外的舊影片不得競爭。可見比例至少 25%，或可見部分占視窗至少 20%，視為主要候選；都未達時再使用仍可見的影片。
3. 以可見面積平方根、可見比例及中央位置計算分數；播放中僅加 3% 輔助權重，近期操作僅加小幅權重，不能直接壓過大片暫停主體。
4. 手動選取優先最多四秒，且必須仍是合理可見候選。滑出或只剩細小殘片立即失去優先權。分數相近時，現有目標可在 15% 容差內維持，避免抖動；不是新增等待時間。
5. 原生 IntersectionObserver 只追蹤已登記影片，處理 viewport、overflow 裁切及父頁 iframe 的可見度；探索暫停與 dispose 時斷開。[W3C 規範](https://www.w3.org/TR/intersection-observer/#compute-the-intersection) 說明其異步交集計算與巢狀瀏覽內容裁切。
6. 快捷鍵先重讀已登記元素；只對最多四個領先候選同步核對祖先裁切，最多追十六層。目標未變時留在本地立即調速；目標改變或跨 frame 才請背景重選。跨 frame 只詢問至多八個已知 frame 的快照，各有 160ms 等待上限，不重新注入或全頁探索。
7. 選取公告與影片快照各有世代及序號，舊訊息不把目標切回舊片。同一頁重建控制器可從新序號接手，退休控制器的延遲空報告也不能清掉新狀態。初次影片偏好仍維持每片一次，探索／待載入期限沿用 0.6.16。

若整頁沒有任何可見候選，仍保留原有「已知播放器」退路，供單一播放頁面使用；本輪保證的切換條件是有新的合理可見主體時，舊片不能靠播放或手選繼續占住目標。

## 驗證

- 舊版 0.6.17 用同一組本機影片案例重現六種失敗：暫停主片被小片搶走、手選永久固定、捲動後快捷鍵改舊片、overflow 殘片搶片、父頁外 iframe 搶片，以及相近候選切換不穩定。
- 322 項單元／整合通過；包含快照亂序、同頁控制器重建與退休清理、選取訊息亂序、手選到期、可見幾何與 observer 生命週期。
- 最終 Chromium／Brave 各 13 項視覺主體操作檢查通過：未知網站大片暫停主片、直接捲動按鍵、FB-like 貼文手選後滑走、主片暫停與小片播放、overflow 殘片、同源／跨來源畫外 iframe、四秒優先到期、15% 容差及已知預覽排除。
- 一般快捷鍵與捲動後快捷鍵期間，ISOLATED world 的 Document／Element.querySelectorAll 及 createTreeWalker 計數均為零。測的是已有登記影片的操作路徑，不代表初次開頁完全不查 DOM。
- 25 項主影片／預覽提示回歸通過；不開 popup 的四次新文件、兩次 SPA、啟動故障恢復與 worker 冷啟動通過。
- 12 項近期／待載入生命週期通過，包含同頁 dispose／reinject 後十五秒首播仍套預設，以及原期限不延長。候選回歸曾抓到新 session 序號從頭開始而被拒收的問題；已用 snapshotEpoch 分開世代並補回歸。
- Chromium 與 Brave 更新／BFCache 回歸通過：閒置頁探查為零，更新期限不延長，返回後可控制，新增 runtime errors／warnings 為零。

最終成品 SHA-256（大小寫敏感相對路徑排序，各檔 path + NUL + bytes + NUL）：`75b3d7074562e8e6ebfaf2acc4ed07f4533ef1a22eba6747c167eaeaa1227647`。

本機證據：`work/qa-080-visual/`、`work/qa-078-focus/results.json`、`work/qa-075-main-release-0618-final/results.json`、`work/qa-autostart/release-0618-final-results.json`、`work/qa-076-lifecycle/`。各報告核對載入的最終成品 hash。輸出摘要為 `VideoSpeed-validation.json`。

## 界線

上述為隔離瀏覽器與真實本機影片的操作測試，未取代使用者當前實站驗收。未知網站以幾何與互動推斷主體，無法保證理解所有等尺寸、重疊或特殊播放器的用途；IntersectionObserver 主要提供幾何交集，不是完整的像素遮擋或內容語意辨識。跨來源 iframe 的父頁裁切已驗證，中央位置仍以影片所在 frame 為基準。

先前持續 context invalidation、長播卡死與 worker-fetch 的原始觸發條件尚未全數定位，不以本輪選片回歸宣稱全部解決。

<details>
<summary>0.6.17 歷史驗證</summary>

# VideoSpeed 0.6.17 驗證

2026-10-28。修正 Bilibili 影片頁右側推薦預覽誤入控制目標。VideoPocket 未修改。

## 原因與修正

Bilibili 首頁卡片與影片頁右側推薦使用不同容器。0.6.16 的明確預覽規則只有 `bili-video-card,.bili-video-card`，漏掉 `.video-page-card-small` 與 `.v-recommend-inline-player`。側欄內的播放器因此先命中 `.bpx-player-container`，被當作正式影片登記，後續自動倍速與目標選取便會接手它。

這種預覽也會取得主影片路由身份；首次提示以身份去重，所以可能沒有新的自動提示，實際速度卻已被修改。手動快捷鍵依被選中的影片執行，仍會在預覽上顯示提示。

本輪把這兩個官方容器加入登記前的預覽排除，優先於一般播放器容器。初始化、品質橋接、指標選取及目標清理共用此判定。判斷只限 Bilibili 網域，不依靜音、尺寸或動態新增來排除影片；FB 等社群動態內容繼續使用原流程。探索頻率、載入期限、UI 與權限沿用 0.6.16。

來源核對：Bilibili [官方影片頁程式](https://s1.hdslb.com/bfs/static/jinkela/video/video.10e8c86797efac5e5b578ffb54ae963b5a928508.js) 的推薦卡元件與 `inline-player` 指令，以及[官方樣式](https://s1.hdslb.com/bfs/static/jinkela/video/css/video.0.10e8c86797efac5e5b578ffb54ae963b5a928508.css)。指令在滑鼠進入時建立／啟動預覽，離開時關閉；預覽有明確容器可識別。這是原始碼核對，未把它當作使用者實站 DOM 的直接擷取。

## 驗證

- 舊版 0.6.16 在相同推薦結構 fixture 重現：預覽取得第二個 registry 身份，playbackRate 與 defaultPlaybackRate 被套為 1.75；測試以 `1.75 !== 1` 失敗。新增單元案例也在修正前失敗。
- 新版 304 項單元／整合通過；包含側欄、獨立 inline 容器、預覽內含主播放器 class、shadow boundary，以及一般正式播放器和社群內容對照。
- Chromium、Brave 各 25 項瀏覽器檢查通過。側欄與 inline 預覽在無來源時、載入後皆不取得身份；原速度與 defaultPlaybackRate 維持 1，沒有新增自動提示或跟隨記憶寫入。
- 滑鼠移至預覽並實際點擊後，`< >` 修改主影片，提示仍在主片。主影片暫停、預覽繼續播放時亦通過。移開、卸載預覽後，主影片立即可控；只有預覽的頁面不攔快捷鍵。
- YouTube 主片提示／換片／重載、既有首頁預覽及 FB／Instagram／TikTok 動態換片、快捷鍵回歸通過。這些項目包含在各瀏覽器的 25 項內。
- 本次兩個瀏覽器皆未新增頁面錯誤；專用 profile 已清理。未操作個人瀏覽器。

成品 SHA-256（大小寫敏感相對路徑排序，各檔 path + NUL + bytes + NUL）：`11f926264736b2e52a73b0a53e22c54defbdf4b943416fe653ce02bbef6bee39`。

本機證據：`work/qa-079-preview/`、`work/qa-075-main-baseline-0616-sidebar/results.json`、`work/qa-075-main-release-0617-chromium/results.json`、`work/qa-075-main-release-0617-brave/results.json`。輸出摘要為 `VideoSpeed-validation.json`。

## 驗證界線

瀏覽器操作使用真實本機影片與對應容器 fixture；官方 JS／CSS 另行唯讀核對。尚未完成使用者當前 Bilibili 實站頁面的操作驗收，也未重新執行 0.6.16 的全部長時間／生命週期測試。先前 context invalidation、長播卡死與 worker-fetch 的原始觸發條件仍未全數定位，不能以本輪預覽修正宣稱全部解決。

<details>
<summary>0.6.16 歷史驗證</summary>

# VideoSpeed 0.6.16 驗證

2026-10-28。依新活動規則分開「補查元素」「等待首次設定」「一般背景播放」。VideoPocket 未修改。

## 行為與計時

| 階段 | 處理方式 |
| --- | --- |
| 初次聚焦／切回 | 立即直接查詢影片，並做最多 6000 節點／12ms 的初始遍歷；剩餘工作分批接續。 |
| 留在前景 | 媒體事件直接登記；DOM 變動併批，最多每 500ms 處理 128 節點／4ms，沒有變動不重掃。 |
| 離開後 10 秒內 | 斷開探索用 MutationObserver，每 2 秒只查文件與已知 shadow root 中的 video；媒體事件可即時登記。 |
| 已找到但尚未完成的影片 | 以元素及媒體身份記錄待處理資格，最多等至離開後 30 秒；首次倍速與畫質處理結束後提前釋放。 |
| 已完成首次設定的背景影片 | 解除控制，保留目前倍速；不持續修復、不攔快捷鍵、不更新跟隨記憶。切回後採納同片目前速度，不重套預設。 |

10／30 秒從真正切離分頁／視窗的事件時間起算；從活躍頁新開背景分頁則以建立時間起算。重導、loadstart、playing、ratechange 和 worker 重啟都不續期。這些數字是產品的工作預算，並非網站平均載入時間或瀏覽器標準。

初份 HTTP 文件可能直到離開後才送達：沿用原 30 秒上限，允許該文件的第一次解析／DOMContentLoaded 補查；不把已載入的空白 SPA 頁面延長為 30 秒探索。影片到期仍未就緒、元素被移除或已變成另一媒體，終止該筆等待。下一次切回才恢復探索。

## 修正的缺口

- 移除背景正在播放就永久保留控制與重注入資格的條件。
- 移除整頁共用的 loadingComplete／initialized 通知；每個元素各自完成，不會由第一支影片提早終止其他待載入影片。
- 背景首次套用保留一次 500ms 的載入回呼收尾期，畫質重試仍有固定次數；不因網站持續改速延長期限。關閉畫質設定會結束已完成倍速的等待。
- 背景釋放保留目前 playbackRate／defaultPlaybackRate。最多 64 筆 WeakRef 保存原預設值的歸屬，不保留影片強引用、事件監聽或計時器；總關閉／Full 除外可還原仍屬擴充功能的 defaultPlaybackRate，不改當下 playbackRate。
- 畫質請求在轉換 adapter 前重新確認元素身份、請求、政策及廣告狀態；舊請求不延後套到已替換的影片。
- 待載入元素記錄媒體身份及原截止時間，速度與畫質完成狀態分開保存。十秒後重新注入腳本只恢復原標記；不把新出現的未知影片納入，也不重套已完成的畫質。
- 舊 60 秒廣泛等待的測試入口改為新生命週期回歸；歷史驗證保留於舊版本 tag。

## 驗證

- 301 項單元／整合通過。
- 4 項分頁活動、17 項主影片／預覽與提示回歸通過。
- 不開 popup 的 4 次新文件、2 次 SPA、本地快捷鍵、啟動故障恢復及 worker 冷啟動通過。
- Chromium 新生命週期 12 項通過：已知元素 15 秒後首播成功；12 秒後新插入未知影片不接手；已知元素 31 秒後開始則不套預設，切回後才初始化。事件及 route 不延長期限、已知 shadow root 有界補查、當前頁動態插入可發現、已初始化背景影片改成 1×不被修復且不污染記憶。
- 離開約 12.76 秒後重新注入 content 腳本，原待載入元素的身份與期限保持一致，15 秒首播後套 8×及一次畫質；同時插入的陌生影片保持 1×且未登記。
- 停用復原：影片原預設 1×，擴充套 8×，離開後保持 8×；總開關關閉後 defaultPlaybackRate 恢復 1×，當前 playbackRate 仍為 8×。
- 真實 HTTP 分別延遲媒體與整份文件 16 秒，切到另一視窗後仍套 4×及一次 1080p 畫質。
- Chromium 與 Brave 擴充更新／BFCache 回歸通過：閒置空頁探查為零，更新不延長原期限，返回快取頁可再次控制，新增 runtime error／warning 為零。回歸中的手動控制改為先切回目標分頁，符合這版規則。

成品 SHA-256（大小寫敏感的相對路徑排序，各檔 path + NUL + bytes + NUL）：`4a3ba1a83bbed142f00e4ba2647f83a75728e1560eb1dcb8250b710391c467df`。

## 驗證界線

以上使用隔離瀏覽器、真實本機影片及 HTTP，但播放器介面為 fixture，不代表 YouTube／Facebook 實站驗收。Chromium headless 跨視窗回焦 API 曾同時回報兩窗 focused；測試在離開階段完成後關閉 away 測試窗，再驗證剩餘視窗真正回焦及分頁切換。Brave 本輪新生命週期 fixture 未成功載入，0 項執行，不列為通過。所有測試 profile／瀏覽器／server 已清理，未操作個人瀏覽器。

已提交的網站畫質 setter 無法強制取消其網站內部異步工作；本輪防止在提交前使用過期目標。先前持續 context invalidation、長播卡死及 worker-fetch 的完整原始條件仍未全數定位，不以本輪結果宣稱全部解決。

本機證據：work/qa-078-focus/results-chromium.json、work/qa-077-network/results.json、work/qa-078-unit.txt；成品摘要見 VideoSpeed-validation.json。

<details>
<summary>0.6.15 歷史驗證（背景政策已由 0.6.16 取代）</summary>

# VideoSpeed 0.6.15 驗證

2026-10-28。修正剛開影片後立即切走、影片超過十秒才開始播放時漏套預設速度／畫質的問題。VideoPocket 未修改。

## 原因與修正

0.6.14 的十秒期限同時控制頁面探索及初始化存活。到期時只保留已初始化且仍播放的影片；待載入影片、尚未建立的元素或仍在廣告階段的播放器會失去控制器與 bridge 事件。隔離 Chromium 重現：延後十五秒播放的四種主影片案例均維持 1×，畫質 setter 為零。

- DOM 探索仍只限目前聚焦及離開後十秒。近期新開或開始導航的頁面另獲最多六十秒首次播放等待；背景網址變動不能無限續期。
- 十秒後斷開探索的 MutationObserver、清空遍歷佇列；只保留媒體事件。延後出現的影片由事件來源直接登記，新 open shadow root 只加事件監聽。若 content 很晚才啟動，對直接 video 做一次有數量上限的補查，不排整頁／shadow 遍歷。
- 目標影片成功初始化後撤銷載入期限，保留已知正在播放的同片。到期、關閉、Full 除外均停止待載入控制；預覽排除及使用者手動調速規則不變。
- 更新時，尚有有效載入期限的頁面可以單次恢復失效腳本，沿用原期限；一般設定／選取通知仍要求近期資格、已知媒體或 popup。未使用過、等待已過期的頁面不因此獲得探索資格。
- 被動啟動或更新後，已初始化且播放中的同一影片也能保留，不依賴曾開啟 DOM 探索。

## 驗證結果

- 293 項單元／整合、17 項主影片／預覽提示、4 項活動範圍通過。
- 不開 popup 的四次新文件、兩次 SPA、本地快捷鍵、三種同時啟動故障及 worker 冷啟動通過。
- Chromium 真實分頁切換：已知影片延遲播放、延遲插入影片、從活躍頁中鍵開背景頁、廣告解除，均於十五秒後套成 8×；每案畫質只設定一次，十秒後的整頁 video 查詢與 DOM walker 增量均為零。另驗證 open shadow media 事件接手。
- 六十秒後已處理影片仍為 8×、畫質不重套，載入期限已撤銷；未知新影片不再加入。未授權背景頁、總關閉、YouTube Full 除外均不套用速度或畫質。
- 真實 HTTP 延遲十六秒：媒體請求仍未回傳（readyState=0 且已發出 play），或連 HTML 文件都尚未回傳時，切到另一個隔離瀏覽器視窗；兩案均在原視窗仍未聚焦、未開 popup 時套成 4×，1080p 畫質各設定一次。
- Chromium 與 Brave 更新／BFCache 回歸均通過：既有閒置空頁探查為零、近期期限不延長，真正 BFCache 返回後仍可調速；錯誤收集器確認沒有新增 runtime error／warning。

成品 SHA-256（排序後每檔 filename + NUL + bytes + NUL）：`51997aa62143e778cd79531edb9757dd13d0e818ae3339ba52c9a36d132747ac`。所有瀏覽器驗證使用專用 profile 並清理，沒有操作個人瀏覽器或真實 YouTube 帳戶。這是實際瀏覽器、媒體及 HTTP 生命週期測試，播放器介面採本地 fixture；不作實站全面相容性保證。

## 仍有的界線

- Brave 本輪的仿 YouTube 網頁測試未成功進入 fixture（初始導航／TLS 測試環境問題），不列為該瀏覽器的慢載入通過證據。
- 六十秒是未開始播放的等待上限，不是背景播放時間上限。超過上限才載入且從未開始的影片，要回到分頁才重新探索。
- 背景既有播放保留同一媒體；播放清單跨曲／換播放器、網站原生休眠恢復與超長廣告仍值得追加實站長測。
- 畫質取決於網站播放器能力；已提交而未回覆的請求不盲目重送，以免反覆覆寫使用者選擇。
- 先前持續 Extension context invalidated、長播卡死及 worker script-fetch 的完整原始條件仍未全數定位。本輪不以通過測試宣稱這些問題均已解決。

本機證據位於 work/qa-077-slow-load、work/qa-077-network、work/qa-076-lifecycle，發布成品摘要見 VideoSpeed-validation.json。

<details>
<summary>0.6.14 驗證紀錄</summary>

# VideoSpeed 0.6.14 驗證

2026-10-28。本輪限制更新／背景訊息的分頁範圍，修正 Port 斷線錯誤與 BFCache 返回；VideoPocket 未修改。

## 確認的原因

- 舊 restoreOpenTabs 在更新時列舉全部 HTTP(S) 分頁，再逐頁對所有 frame 執行 API 探查與腳本注入；不要求該頁近期活動或存在影片。本輪隔離 Chromium 已重現三個閒置、無影片的頁面各收到一次探查與兩次注入，共 9 次 executeScript 呼叫。這證實範圍錯誤；同一輪未重現截圖上方完整的 Extension context invalidated 持續條件。
- 截圖下方的 BFCache 斷線錯誤已實際重現。頁面進入返回／前進快取時 Chrome 關閉 Port；舊 background 斷線回呼沒有讀取 runtime.lastError，collector 收到相同的 Unchecked runtime.lastError，occurrences=2。[Chromium 對此錯誤的原始變更](https://chromium.googlesource.com/chromium/src/+/988c43b97b00934e8df90c9949681e73434e70bb%5E%21/)；[Chrome runtime.lastError 規則](https://developer.chrome.com/docs/extensions/reference/api/runtime#property-lastError)。
- 第一版候選實際更新測試另抓到近期頁資格遺失：Chrome 在擴充更新／重新載入時清空 storage.session，並非只停止 worker。已改用不含網址或標題的本機分頁 ID／到期時間備份，沿用原期限。[Chrome storage.session 文件](https://developer.chrome.com/docs/extensions/reference/api/storage#storage_areas)。

## 修改範圍

- 更新僅恢復聚焦、10 秒內近期或目前已知仍播放的分頁；每個恢復階段重查資格，排隊工作過期後不繼續注入。
- 舊閒置空頁的設定／網址／子 frame 路由變動不再觸發背景政策訊息；既有背景播放器仍可收到停用指令。新文件維持 document_start 啟動，沒有依賴 popup 喚醒。
- 從聚焦或近期頁面中鍵開啟的新背景分頁，依實際建立時間獲得 10 秒載入緩衝。舊頁自行變更網址不會重新取得資格。
- 跨更新的近期備份只含分頁 ID、期限與版本序號，不寫入影片資訊。到期資料不採用，恢復時不重設為新的 10 秒。
- 首次從沒有備份的舊版升級，只讀一次瀏覽器分頁時間戳，再對資格內的頁面注入。這是分頁中繼資料，不是全頁影片掃描。舊版沒有保存的「長時間停留後剛離開」資訊無法完整重建；lastAccessed 表示最後成為活動分頁的時間，不是離開時間。[Chrome tabs 文件](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-lastAccessed)。往後更新採用原到期時間備份。
- 所有 Port 斷線回呼同步讀取 lastError；失效 context 只清理一次。content 在返回頁面時重建已斷的生命週期連線，BFCache 還原後重新握手；popup 斷線後停止 renew，不新增輪詢。

## 本輪結果

- 單元／整合 288 項、活動範圍 4 項、既有回歸 11 項、主影片／預覽提示 17 項與標示穩定性 3 組通過，共 323 項已列計數檢查。
- Chromium 與 Brave 的隔離原生瀏覽器更新測試均通過：三個超過 10 秒未活動的空頁，首次更新與 checkpoint 更新均收到 0 次探查／注入；聚焦、近期及中鍵新開背景頁均可調速。
- 兩者的第二次更新，近期資格到期時間與更新前完全一致，沒有重新續滿 10 秒。首次舊版遷移與後續 checkpoint 恢復分開驗證。
- 兩者均完成真正 BFCache 往返，pageshow.persisted=true 且頁面 token 不變；錯誤收集器正向 probe 可收錯並已清除。新版往返後新增 runtime errors／warnings 為 0／0，返回頁可改為 2×。
- 另驗證不開 popup 的 4 次新文件、2 次 SPA、本地快捷鍵、初始設定／選取／橋接器故障恢復及 worker 冷啟動。
- 提示回歸初跑曾逾時：只讀證據顯示測試器在空 profile 的記憶初始化前直接寫入倍速，與初始種子競爭；等待初始化完成後再設定 fixture，17 項通過。未修改產品記憶流程；失敗狀態保存在本機 work/qa-076-notices-seed-race.json。

這些是本地 HTTP fixture 與隔離瀏覽器的真實更新／快取生命週期驗證，未操作使用者舊分頁，也不是 ChatGPT／TradingView 實站驗收。上方 Extension context invalidated 持續新增的唯一完整條件、以及早先長播卡死與 worker script-fetch 的完整條件仍未定位，不以本輪結果宣稱全部已解決。

npm run test:lifecycle 需要含固定 baseline commit 歷史的 Git checkout；基線固定為 9b488d07d9a0942b7bbc97a5e479f8a53c30c203，避免新版發布後測錯來源。測試建立專用 profile 並檢查路徑後移除，不操作個人瀏覽器。實際結果與成品檢查碼保存在本機輸出的 VideoSpeed-validation.json。

<details>
<summary>0.6.13 驗證紀錄</summary>

# VideoSpeed 0.6.13 驗證

2026-10-27。改為控制主體影片，略過 YouTube、Bilibili 的縮圖預覽；VideoPocket 未修改。

## 本輪變更

- 在 MediaRegistry 登記前辨識已知預覽容器，尚無來源、名稱或卡片 ID 時也能略過。不建立速度控制器、不套預設速度／畫質、不成為快捷鍵或手動選取目標、不顯示提示、不更新跟隨記憶。
- 預覽不再進入目標候選池。A 正片旁新增或移除 B 預覽時，控制持續屬於 A。已登記元素若移入預覽容器，會解除控制、提示與標示；操作前也重新檢查。
- Facebook、Instagram、TikTok 等動態社群影片不使用此排除規則。判斷依已知網站播放器／縮圖結構，不以影片尺寸、靜音、動態載入或來源為 blob 當成預覽。
- 移除預覽卡片連結／ID 搜尋、預覽重播初始化及預覽提示週期分支。一般播放器的首次初始化、使用者調整與有限載入恢復保留。
- 自動提示另外確認分頁可見及影片進入視窗，再等待可見影格；手動調速仍立即回饋。背景先載入速度不必等提示顯示。

## 提示去重範圍

YouTube 正片使用目前影片的 `yt:影片ID`，由同一個 content 工作階段共用「上一次已顯示的鍵」。同 ID 更換來源、畫質或 video 元素，不會再顯示自動提示；切至另一 ID 可顯示，A→B→A 也可再次顯示。這不是持久儲存的已看清單：重新整理建立新文件後會清空。每個 frame／工作階段分開維護，不宣稱跨 frame 全域去重。

這個鍵只控制自動提示，不用來封鎖必要的速度初始化。預設設定在控制器確認當前影片首次播放並成功套用後完成；失敗可有限重試，手動調速不因暫停／續播再被預設蓋回。來源載入時若網站重設速度，沿用目前意圖的有限恢復與重新套用偏好是不同流程。

限制：預覽排除依已知容器，網站改版可能需要更新。主播放器、Shorts、嵌入與社群動態影片有獨立檢查；未知網站不採用全域預覽猜測。

## 本輪驗證

- 單元／整合 273 項通過，包含尚無來源的預覽排除、主播放器／Shorts／嵌入辨識、元素移入預覽後解除控制、重新整理重設提示，以及背景／視窗外影片延後提示。
- Chromium、Brave 各 17 項結構測試通過：可見首幀提示、同 ID 更換元素去重、換片與重整、手動回饋、A 正片旁 B 預覽的出現／移除、僅有預覽時不攔截快捷鍵，以及 Facebook／Instagram／TikTok 的動態換片控制。使用真實本地影片與網站結構資料，不等同實站驗收；全程不開 popup 補救。
- 既有回歸 11 項、標示穩定性 3 組通過。另驗證 4 次新文件、2 次 SPA、快捷鍵本地控制、初始設定／選取／橋接故障恢復與 worker 冷啟動。
- 回歸初跑有 1 項於非同步記憶保存前即讀取儲存值；測試改為最多等待 1.5 秒確認保存後通過，未修改產品記憶流程。初次失敗紀錄保存在本機 work/qa-075-release-before-memory-wait.json。

本輪未進行實站 YouTube／Bilibili 預覽驗收，也未重跑五分鐘長播。先前完整使用環境的卡死、持續失效 context 與偶發 worker script-fetch 的唯一觸發條件仍未定位，不以這輪測試宣稱已全部解決。

測試可用 npm test、npm run test:notices、npm run test:browser、npm run test:stability 與 npm run test:autostart 重跑。321 項已列計數的檢查通過；不開 popup 的自動啟動驗證另外記錄。

<details>
<summary>0.6.12 驗證紀錄（預覽控制政策已由 0.6.13 取代）</summary>

# VideoSpeed 0.6.12 驗證

2026-10-27。本輪只修正自動速度提示的時序及去重，倍速與畫質仍在原先初始化流程套用；VideoPocket 未修改。

## 修改與原因

- 舊提示在預設速度套用成功後，只憑 paused／readyState 判斷是否顯示。0.6.11 的一次真實 YouTube reload 中，提示出現在首個非廣告影片影格之前約 18ms；readyState 足夠不代表畫面已呈現。
- 現在自動提示等待可見影片的 requestVideoFrameCallback。沒有此 API 時，須先觀測播放進度，再等一次 animation frame。手動快捷鍵、按鈕和輸入仍立即提示。
- 同一 YouTube 路由共用提示去重，不因播放器替換 video 元素而再次彈出；換到另一部影片可顯示新的提示。
- 舊預覽提示以包含 currentSrc／src 的 media signature 比對，來源切換可能清掉尚未顯示的狀態。現在保留待顯示提示，依預覽播放週期及可取得的卡片 ID 區分；只有來源可辨識時，也允許下一個已換來源的預覽顯示。關閉功能、手動選速及移除影片會取消排程。
- 不新增輪詢掃描或全頁觀察器。只有等待提示的影片保留一個影格 callback，顯示或取消後移除事件監聽。

## 本輪結果

- 單元／整合 269 項通過，包含新增的首幀等待、來源切換、元素替換去重、預覽重播、取消及 fallback 檢查。
- Chromium 與 Brave 各通過 10 項實際瀏覽器結構測試：不可見載入、首幀時序、同片替換元素、新片、手動調速、YouTube 預覽換來源／重播，以及 Bilibili 預覽／重播。使用真實本地影片，網站結構由測試提供，不等同兩站實站驗收。
- 既有回歸 11 項及標示穩定性 3 組通過。另以 Chromium 不開 popup 驗證 4 次新文件、2 次 SPA、初始設定／選取通知／MAIN 橋接器故障恢復，以及 worker 冷啟動。
- 真實公開 YouTube 的一輪 0.6.12 載入：可見正片首幀前 0 次提示，首幀後約 56ms 出現一次 2×；動畫期間的多次位置快照屬於同一提示週期。
- 真實 YouTube 預覽本輪未完成驗收：隔離 profile 中依序 hover 三張普通推薦卡，網站均未建立預覽影片。這不是通過結果，也未判作擴充功能失敗；本輪的 YouTube 預覽可用性證據限於結構測試。

測試可用 `npm test`、`npm run test:notices`、`npm run test:stability` 與 `npm run test:autostart` 重跑。實際結果與產物檢查碼保存在本機輸出的 VideoSpeed-validation.json。先前完整使用環境的長播卡死、持續 Extension context invalidated，以及偶發 worker script-fetch 的唯一觸發條件仍未定位；本輪不對這些問題新增已解決的聲明。

<details>
<summary>0.6.11 驗證紀錄</summary>

# VideoSpeed 0.6.11 驗證

2026-10-27。針對長時間播放後延遲、提示缺漏與 popup 無回應，修正事件回授及控制路徑；VideoPocket 未修改。

## 找到的問題與修改

- **路由與 DOM 回授**：舊版每次 `history.replaceState` 都派送路由事件，即使網址相同；接著全頁掃描並重寫相同的影片屬性。使用真正 Chromium DOM、history 與 MutationObserver 已重現兩者互相觸發：舊版在測試強制中斷前連續產生 24 輪。這種微任務回授會阻礙後續計時器、輸入與繪製。新版只在網址改變時通知路由、屬性值改變時寫入，並以可取消的單一 task 合併路由掃描。相同測試更新一次後即穩定，頁面計時器繼續執行。這證明程式存在卡住的路徑，未證明使用者網站當時一定觸發同一條路徑。
- **選取通知對象累積**：舊版也保存沒有影片的子 frame；動態廣告／分析 iframe 不斷建立、移除時，選取通知對象可能累積。新版略過空子 frame，通知失敗後核對目前仍存在的 frame，僅移除已失效的記錄；新影片仍須取得實際內部 ID 的確認，失敗有限補送。200 個空子 frame 的回歸測試不增加通知對象，稍後出現影片仍能加入。
- **快捷鍵需繞經背景**：已選取且位於相同 frame 的影片，現在同步套用速度並更新提示，記憶保存留在非同步路徑。跨 frame 控制仍透過背景。測試刻意延遲 command RPC 三秒，兩次本地快捷鍵仍有效，且沒有送出 command RPC。
- **提示重建**：連續調速重用同一個提示節點，立即更新文字；popup 常駐提示不再反覆寫入相同文字及樣式。
- **名稱取得成本**：移除 24 層祖先影片盤點及直播連結搜尋，只為選中的影片取得低成本標題；未知時使用 Video N。名稱不參與選取 ID 確認或倍速套用。
- **popup 等待無上限**：開啟時最多等頁面探查一秒，之後先呈現快取狀態；尚未完成的探查繼續共用，避免反覆開啟時堆積新要求。這是介面容錯，不代表凍結頁面已恢復。

## 驗證方式

`npm test` 檢查設定、速度來源、啟動、選取確認、失效 context 清理與上述邊界。`npm run test:routes` 載入實際打包的 MAIN 橋接器，驗證 history／MutationObserver 回授會停止。

`npm run test:autostart` 不開 popup，也不呼叫 getState／refresh 補救：測新文件、SPA 換片、初次設定與選取通知故障、缺少 MAIN 橋接器，以及 service worker 真正停止後的重新啟動。快捷鍵測試另檢查原生速度、提示文字和本地操作是否避開背景 command RPC。

`npm run test:soak` 預設持續播放五分鐘，記錄原生影片進度、速度、提示、頁面心跳、worker 回應時間、訊息量與 heap；包含切離超過十秒再返回、動態換片，以及同網址 history／屬性回授。完成前不以 popup 補救。使用可播放的本地影片和隔離 Chromium profile；合成頁面不等於實站驗收。

64 個影片、2,265 個 DOM 元素的相同成本測試中，popup 等效 refresh 由 25.2ms／2,731 次 querySelectorAll 降至 3.8ms／1 次；layout/style 讀取仍各 128 次。這是本地 fixture 的單次量測，不能外推所有網站的加速幅度。

本輪各測試的實際結果與產物檢查碼保存在本機輸出的 VideoSpeed-validation.json；尚未重現使用者完整環境下的長播卡死，不以本地測試通過宣稱所有網站均已解決。headless 的 popup 頁面檢查不算原生工具列 popup 外框或互動驗收。

## 本輪結果

- 單元／整合 262 項、既有瀏覽器回歸 11 項、活動狀態 4 項、標示穩定性 3 組、語系 4 項、路由回授 1 項，均通過。
- Chromium 不開 popup：20 次新文件、10 次 SPA 換片；Brave 另做 4 次新文件與 2 次換片。兩者的快捷鍵、同時故障恢復與 worker 冷啟動均通過。
- 修正版本地持續播放 300 秒：12 次快捷鍵及提示、12 次同網址回授均通過；提示更新量測為 2–6ms。包含動態替換影片及切離 13 秒後返回，無失敗；不是以 popup 喚醒後才驗證。
- 本地長播期間 worker 回覆中位數 1ms、95 百分位 5ms；內容訊息平均約 0.20 次／秒。heap 約 2.57–4.66MB，最後約 3.53MB；這些量測不代表所有網站的上限。
- 真實公開 YouTube 以隔離 Chromium 累計播放正片 120 秒，短片完播後重載一次續播；2→1.75→1.5→1.75→2 的原生速率及提示均正確，量測延遲 14–19ms。未先開 popup 補救，無廣告、登入或 CAPTCHA 阻擋。
- 長播後 headless popup 頁面顯示目標與速度，控制可用；未驗收工具列原生 popup 的外框與實際點擊。

## 先前錯誤的定位界線

`Extension context invalidated` 涉及更新後舊頁面腳本仍使用失效的擴充 context。程式對此有停止監聽、計時器與 API 呼叫的處理，但先前持續新增錯誤的完整條件仍未重現，不能將這次事件回授修正當成該錯誤的確定答案。

`An unknown error occurred when fetching the script.` 是 Chromium service worker 載入／註冊失敗；Chrome 官方也以缺少靜態 import 檔案示範此訊息。[官方說明](https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events#optional-debugging-the-service-worker) 當時六個本機成品副本與三種 ZIP 均完整，截圖又未提供檔名，因此沒有證據指定是哪個檔案讀取失敗。0.6.10 已改為單一 classic 背景腳本並加入成品完整性檢查；不能把減少載入依賴說成已確定那次錯誤的唯一原因。

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>

</details>
