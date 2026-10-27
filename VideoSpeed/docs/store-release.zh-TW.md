# VideoSpeed 發布準備

目前為 GitHub 預覽版，未提交 Chrome Web Store。示範影片與介面截圖可後續補上。

## 商店文案草稿

**中文**：用滑桿、自訂刻度與快捷鍵調整網頁影片倍速。可跟隨上一部影片、指定起始速度，並在支援播放器設定起始畫質。網站除外提供完全停用或僅略過預設套用；含中文／英文與深淺色介面，偏好保存在本機。

**English**: Control web video speed with a slider, custom ticks, and shortcuts. Follow your last speed or set a starting rate, with optional starting quality on supported players. Site exclusions can disable all features or only automatic settings. Includes Chinese/English and light/dark themes. Preferences stay local.

## 上架前

- 發布者自行完成開發者註冊、兩步驟驗證與帳戶驗證；本專案不代填個人資料。
- 補上真實介面截圖：至少一張，1280×800 或 640×400。套件已有 128×128 PNG 圖示。
- 在 Dashboard 填寫單一用途、權限理由、資料揭露及公開的隱私政策網址，並與最終程式一致。
- 安裝專用包為 `VideoSpeed.zip`；商店專用包為 `VideoSpeed-chrome-web-store.zip`，後者的 manifest 位於 ZIP 根目錄。
- 完成 [驗證紀錄](validation.md) 中尚未覆蓋的實站與原生 popup 驗收。發布新版本時保留版本與檢查碼，避免覆寫同版本下載檔。

## 權限用途

| 權限 | 用途 |
| --- | --- |
| storage | 本機保存偏好、除外規則與速度記憶；session 暫存影片摘要與近期分頁活動 |
| scripting | 更新後接管既有網頁，以及必要時恢復內容腳本 |
| webNavigation | 處理頁面與 iframe 的路由變更、除外政策 |
| HTTP／HTTPS 全站範圍 | 在使用者造訪的網站辨識與控制影片，包括嵌入播放器 |

網址、影片資訊與偏好雖然只在本機處理，仍需據實揭露；不載入遠端程式碼，程式邏輯隨套件提供。

官方依據：[開發者註冊](https://developer.chrome.com/docs/webstore/register)、[兩步驟驗證](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)、[資料處理](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[圖示與截圖](https://developer.chrome.com/docs/webstore/images)、[商店可見度](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)。
