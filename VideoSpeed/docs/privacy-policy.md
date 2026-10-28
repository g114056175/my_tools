# VideoSpeed 隱私說明

## 中文

VideoSpeed 在瀏覽器本機讀取目前頁面與 frame 網址、影片標題、來源識別、播放狀態、速度及支援播放器的畫質資訊，用來選取影片、套用偏好與網站除外規則。影片來源網址僅在頁面記憶體中作識別，不存為設定。

本機儲存保存開關、播放與畫質偏好、刻度、快捷鍵、除外規則及類型、最後使用倍速、外觀與語言。關閉功能時，session storage 可暫存當前影片摘要；分頁關閉後移除，瀏覽器 session 結束時清除。

為限制背景探索，session storage 另保存聚焦視窗／分頁 ID 與離開分頁後的短暫期限。local storage 備份尚未到期的分頁 ID／期限，供更新後恢復原有的 10 秒緩衝；到期即不再使用，下次紀錄時清理，不包含網址或標題。首次從舊版升級時，可讀取瀏覽器提供的分頁最近啟用時間來補上資格，不探查資格外的頁面內容。

為辨認載入重設與使用者調速，頁面記憶體保留每部目標最近 32 筆速度診斷及最多 4 次程式改速堆疊；堆疊可能包含網站程式檔網址。不記錄一般文字輸入，診斷不持久保存或自動上傳。

擴充功能不使用分析服務，不將頁面、影片、偏好或診斷傳送給開發者或第三方。網站自身的網路活動由該網站負責。

除外規則可在介面移除；解除安裝擴充功能可清除其本機資料。問題可透過 [GitHub Issues](https://github.com/g114056175/my_tools/issues) 聯絡。

## English

VideoSpeed processes page and frame URLs, video titles, source identifiers, playback state, speed, and supported-player quality information locally in the browser to select videos and apply preferences and site exclusions. Media source URLs are used only for in-memory identity checks and are not saved as preferences.

Local storage holds preferences, ticks, shortcuts, exclusion rules and modes, the last confirmed speed, appearance, and language. Session storage may temporarily hold the current video summary while the extension is disabled; the summary is removed when its tab closes or the browser session ends.

To limit background discovery, session storage also holds focused window/tab IDs and a short grace deadline. Local storage backs up unexpired tab IDs and deadlines so an extension update can preserve the original ten-second grace period. Expired entries are ignored and pruned on the next write; the backup contains no URLs or titles. The first upgrade from an older version may read browser-provided tab activation timestamps to restore eligibility, without inspecting the contents of ineligible pages.

To distinguish load resets from user speed changes, each target keeps up to 32 recent rate diagnostics and four page-override call stacks in page memory. Stacks may contain website script URLs. Ordinary text input is not recorded. Diagnostics are not stored persistently or uploaded automatically.

The extension uses no analytics service and sends no page, video, preference, or diagnostic data to the developer or third parties. Websites remain responsible for their own network activity.

Exclusion rules can be removed in the interface. Uninstalling the extension clears its local data. Contact: [GitHub Issues](https://github.com/g114056175/my_tools/issues).
