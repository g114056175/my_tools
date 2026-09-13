# VoiceCaptureLite｜聲音擷取工具

Windows 上的短音訊錄製與裁切工具：聽到想保留的片段時直接錄下，不必先下載整部影片。

目前版本 **v2.2.1**，使用 C# / WPF；另有體積較小的原生 C++ 版本可選。

![介面預覽](docs/preview.png)

*預覽使用合成音訊，由程式內渲染產生。*

## 下載與執行

請從發佈包下載自含執行環境的檔案；一般使用者不需自行安裝 .NET：

| 檔案 | 大小 | 需求 |
| --- | ---: | --- |
| `VoiceCaptureLiteWPF-v2.2.1-win-x64.exe` | 約 63.26 MiB | 含 .NET 執行環境，下載後可直接執行 |

- 支援 Windows 10 / 11 x64；需可用的播放裝置及 Windows 媒體元件。
- 不需 Python、Node.js、C++ 編譯器、FFmpeg，也沒有背景伺服器或帳號登入。
- 自包含 EXE 第一次執行會解開必要的執行庫；磁碟占用會大於 EXE 大小。
- 發布檔尚未做 Authenticode 簽章，Windows 可能顯示信任提示。請先核對來源與 Releases 附上的 SHA-256，不需停用系統保護。
- 同一時間只開啟一個實例。更新前請先關閉舊版；工作音檔會保留。

## 功能

- 錄製預設耳機／喇叭收到的系統音訊；支援的系統可選取程序來源。
- 開始／結束錄製、暫停／繼續、有效錄製時間顯示。
- MP3 / WAV 匯入、拖放、檔案複製後 Ctrl+V 貼上、清除工作音檔。
- 真實 PCM 波形、已播放／未播放分色、播放游標與時間顯示。
- 播放／錄製時間顯示至小數點後兩位；視窗有最低可用大小，波形卡片高度不可單獨拖曳。
- 點擊跳轉不會自動播放；播放中可拖曳跳轉。
- 在波形內拖曳左右裁切把手，選取外變灰；選取期間只播放／匯出該範圍。
- 清除、覆寫裁切、已有音檔時重新錄製或匯入，都需先確認。
- WAV PCM16 或 MP3 匯出；MP3 音質獨立選擇 128 / 192 / 320 kbps。

## 快速操作

1. 按 **開始錄製**，接著播放想擷取的声音；完成後按 **結束錄製**。也可直接匯入音檔。
2. 按 **播放** 試聽；點擊波形可定位，暫停狀態不會因此開始播放。
3. 按 **裁切** 調整左右把手，或輸入開始／結束秒數。
4. 選格式與音質後 **匯出**；預設位置是 Windows「下載」資料夾，也可另選。

**匯出選取片段不必先確定裁切。**「確定裁切」是確認後用選取結果覆蓋工作暫存；「取消裁切」則保留完整音檔。匯入的原始檔案不會被修改。

### 時間軸縮放

- 上方提供 **全部** 與 **建議 · 30 秒**。
- 按住波形底部的時間刻度：**向右拖增加可見秒數，向左拖減少**，不使用框選縮放。
- 下方範圍條：中央拖曳平移、左右邊緣拉伸縮放；長度反映可見範圍占全檔比例。
- 點擊範圍條空白處直接定位，沒有整秒取整。全長顯示時隱藏範圍條。
- 最小顯示 5 秒，最大全長；短於 5 秒的音檔完整顯示。也支援 Ctrl+滾輪縮放、普通滾輪平移。

## 音質、暫存與限制

- 錄製使用雙聲道 16-bit PCM；播放裝置原生混音格式若相容，保留 **44.1 或 48 kHz**，否則經 Windows 高品質轉換為 44.1 kHz。匯入音檔仍按匯入流程轉成 44.1 kHz PCM16。10 秒 44.1 kHz WAV 約 1.68 MiB；MP3 192 kbps 約 0.23 MiB。
- WAV 不做有損編碼，但錄音／匯入可能經格式轉換，並非來源的 bit-perfect 擷取；MP3 轉 WAV 不會補回已丟失的細節。
- 錄音封包依 WASAPI 的裝置樣本位置接續，避免逐包時間戳微小抖動導致補零或丟樣本；沒有自動降噪，來源已有的噪音仍可能被錄下。
- 平時只保留 `%TEMP%\VoiceCaptureLite\capture.wav`。裁切預覽／縮放不寫檔；匯入或確定裁切時短暫建立待替換檔，完成後取代主檔。
- 系統模式只錄製開始時的預設播放裝置，不自動混入其他輸出端點或麥克風。若已把麥克風監聽送到該播放裝置，監聽聲仍會被錄下。
- 指定程序擷取要求 Windows build 20348 以上，一般 Windows 10 22H2 不支援；不支援時隱藏來源選取列。程序及其子程序可能共用多個視窗／分頁的聲音，並非單一瀏覽器分頁隔離。
- 單次有效錄製上限 2 小時。裝置拔除／切換可能需要停止後重新錄製。
- Windows N/KN 缺少媒體功能時，MP3 編解碼可能不可用。
- 未內建人聲分離、去噪或 AI 模型，可匯出 WAV 交给其他工具處理。

## 從原始碼建置

需要 Windows x64 與 .NET 8 SDK；一般使用者不需 SDK。建置及第一次套件還原可能需要網路。

```powershell
# 含執行環境，輸出 out/portable/VoiceCaptureLite.exe
.\build.ps1 -Portable

# 需既有 .NET Desktop Runtime，輸出 out/framework-dependent/VoiceCaptureLite.exe
.\build.ps1

# 指定 SDK
.\build.ps1 -Portable -Dotnet C:\path\to\dotnet.exe

# 不碰音訊裝置的基本測試
.\verify.ps1

# 加測播放器、WPF 程序內版面及互動邏輯：需要播放裝置
.\verify.ps1 -Audio

# 另測系統錄製：會短暫錄下預設輸出裝置，測試音檔存於系統暫存
.\verify.ps1 -Capture
```

測試使用合成音訊；錄製測試除外。詳見 [測試範圍與限制](docs/TESTING.md)。

## 專案結構與後續計畫

- `src/VoiceCaptureLite/`：現行 WPF 程式碼、Windows 音訊 API 呼叫與圖示。
- `tests/`：WAV、MP3、播放器、系統錄製與程序內 UI 測試。
- [C++ 移植計畫](docs/CPP-MIGRATION.md)：原生版的早期規劃紀錄；現已有獨立 C++ 版本。
- [模型試跑建議](docs/MODEL-TRIAL.md)：較低成本模型的適用範圍與試跑方式。
- [体積分析](docs/SIZE-NOTES.md)、[發布步驟](docs/PUBLISHING.md)、[版本紀錄](CHANGELOG.md)。

## 授權與第三方告知

**本專案尚未指定原始碼開源授權。**維護者公開發布前應選定授權條款；本 README 不代表已授予 MIT 或其他授權。

自包含成品含 .NET 執行環境，相關授權與第三方告知位於 [notices/](notices/)。這些條款不會自動成為本專案的授權。僅錄製及使用自己有權使用的內容。

## 技術依據

- [Microsoft Process Loopback](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ns-audioclientactivationparams-audioclient_process_loopback_params)
- [WASAPI 擷取封包與裝置樣本位置](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)
- [Windows MP3 編碼器](https://learn.microsoft.com/en-us/windows/win32/medfound/mp3-audio-encoder)
- [WPF trimming 限制](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/incompatibilities)
