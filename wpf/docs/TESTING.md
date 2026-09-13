# 驗證方式

`verify.ps1` 使用合成音訊，不需要測試框架套件。首次 dotnet run 會建置及還原 SDK 所需套件。

| 參數／專案 | 範圍 |
| --- | --- |
| 預設：WaveSmoke | WAV 讀寫、峰值、1 秒裁成 0.5 秒 |
| 預設：WindowsAudioCodecSmoke | MP3 128/192/320 回轉、不同取樣率／聲道轉換；需要 Windows 媒體元件 |
| -Audio：PcmPlayerSmoke | 原生播放進度、暫停跳轉、選取終點、20 次重開關；需要播放裝置 |
| -Audio：UiLayoutTest | 不 Show 視窗、不操作桌面；程序內渲染及裁切／縮放／平移／確認取消／格式選項測試，會短暫初始化播放器 |
| -Capture：CaptureSmoke | 真實系統 loopback 錄製、pause/resume、paused-stop；會把當時預設播放裝置的音訊寫到測試暫存 |

UI 渲染圖與合成測試檔在 artifacts/UiLayoutTest/；音訊測試使用系統暫存下 VoiceCaptureLiteSmoke 或 VoiceCaptureLiteCodecSmoke，不影響正式的 VoiceCaptureLite/capture.wav。

2.2.1 已更動錄音封包接續與視窗最小尺寸；請同時執行 `verify.ps1 -Audio -Capture`，並檢視 `ui-compact.png`、`ui-source-compact.png`。這兩張圖分別模擬一般來源與可選程序來源時縮小到最低可用內容大小的介面。

限制：這些測試不能取代實際桌面操作、原生檔案對話框、所有 DPI、長時間錄製、裝置拔除及 Windows 11 指定程序測試。確認取消的測試使用注入回覆，不會操控桌面對話框。既有 Windows 10 主機無法驗證 Windows 11 程序模式。
