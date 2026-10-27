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
