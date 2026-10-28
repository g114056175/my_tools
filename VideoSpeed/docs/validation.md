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
