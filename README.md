# Voice Capture Lite｜Windows 聲音擷取工具

原生 C++ 版已加入後續編輯功能：編輯工作階段、區段移除、靜音、dB 音量調整與固定時間軸導航列；WPF 版維持 v2.2.1。詳細內容見 [本次編輯功能更新](native/README.md#本次編輯功能更新)。

不用下載整部影片，就能錄下 Windows 預設耳機／喇叭正在播放的聲音；也可以匯入 WAV／MP3，直接在波形上預覽、播放、裁切並匯出。程式不會主動錄麥克風。支援的 Windows 版本才會顯示「指定視窗的音訊」選項；實際擷取範圍是該程序與子程序，並非單一瀏覽器分頁。

## 下載

一般使用者選原生版，下載後直接執行，不需要安裝 C++、Python、.NET 或 FFmpeg。

| 版本 | 檔案 | 大小 |
| --- | --- | ---: |
| 原生 C++ 編輯版（建議） | [EXE](https://github.com/g114056175/VoiceCapture/releases/download/v3.0.2/VoiceCaptureLiteNative-edit-session.exe) | EXE 約 0.61 MiB |
| WPF/.NET v2.2.1 | [自含執行環境 EXE](https://github.com/g114056175/VoiceCapture/releases/download/v3.0.2/VoiceCaptureLiteWPF-v2.2.1-win-x64.exe) | 約 63.26 MiB |
| 兩版一起下載 | [整合 ZIP](https://github.com/g114056175/VoiceCapture/releases/download/v3.0.2/VoiceCaptureLite-Windows-v3.0.2-2.2.1.zip) | 約 58.91 MiB |

適用 Windows 10／11 x64，需有可用播放裝置與 Windows 媒體元件。ZIP 先解壓再執行；EXE 尚未簽章，請只從本儲存庫的 Release 下載，不需停用防毒或系統保護。
下載後可用 [SHA-256 校驗檔](https://github.com/g114056175/VoiceCapture/releases/download/v3.0.2/VoiceCaptureLiteNative-edit-session-SHA256SUMS.txt) 核對原生版檔案。

## 畫面

原生版：

![原生版波形、裁切與匯出介面](native/preview.png)

WPF 版：

![WPF 版波形、裁切與匯出介面](wpf/docs/preview.png)

## 快速使用

1. 按「開始錄製」，播放想保留的聲音，再按「結束錄製」；或直接匯入 WAV／MP3。
2. 在波形上點擊可跳轉，按「播放」試聽。拖動波形底部的時間刻度可縮放顯示範圍；「全部」與「建議 · 30 秒」可快速切換。放大時可用底部比例導航條平移。
3. 按「編輯」，拖曳左右把手，或輸入開始／結束時間。可直接移除選取區段、靜音、套用 −60～+24 dB 音量，或用「裁切保留」只留下選取部分；這些操作先修改編輯副本，不會立即覆寫原工作音檔。
4. 按「保留編輯」確認完整編輯結果，或按「取消編輯」捨棄本次變更；也可直接匯出目前選取片段。
5. 匯出 WAV（不壓縮）或 MP3（128／192／320 kbps）。原生版相容裝置可保留原生 44.1／48 kHz PCM16 或 float32 WAV。

兩版均將計時顯示為兩位小數、限制最低可用視窗大小，且波形卡片高度不再單獨拖曳。錄音封包依 [WASAPI 裝置樣本位置](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)接續，避免逐包時間戳抖動造成補零或丟樣本；這不是自動降噪，原始來源已有的噪聲仍可能被錄下。

## 原始碼

- [`native/`](native/)：Win32／WASAPI／Media Foundation 自繪 C++ 版。Windows x64 安裝 LLVM-MinGW 後執行 `native/build.ps1`、`native/tests/run.ps1`。
- [`wpf/`](wpf/)：.NET 8 WPF 版。安裝 .NET 8 SDK 後執行 `wpf/build.ps1 -Portable`、`wpf/verify.ps1 -Audio -Capture`。

本次在 Windows 10 build 19045 驗證了兩版的錄音、播放、裁切、WAV／MP3 與縮小視窗的介面。Windows 11 指定程序錄音尚待實機驗證。專案目前**尚未選定原始碼授權**；公開可見不代表已授予修改或再散布權利。WPF 自含執行環境的第三方授權告知見 [`wpf/notices/`](wpf/notices/)。
