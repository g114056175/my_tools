# Voice Capture Lite｜C++ 原始碼

單一 Windows x64 EXE，約 0.61 MiB。下載、介面圖片與操作說明見 [首頁](../README.md)。

## 建置與測試

安裝 LLVM-MinGW，確認 `clang++` 與 `llvm-windres` 位於 PATH，在本目錄執行：

```powershell
./build.ps1
./tests/run.ps1
./tests/run-layout.ps1
./tests/run-edit-session.ps1
```

輸出為 `dist/VoiceCaptureLiteNative.exe`。測試涵蓋 PCM16／float32 WAV、區段編輯、MP3、播放、UI 版面，以及保留／取消編輯與失敗時的檔案完整性。`./tests/run.ps1 -Capture` 額外測試預設播放裝置錄音。

## 實作

- `src/Main.cpp`：Win32 自繪介面、波形、選取與編輯操作。
- `src/Audio.cpp`、`src/Audio.hpp`：WASAPI 錄音、WAV 處理、播放與 Media Foundation MP3 編解碼。
- `src/EditSession.hpp`：獨立編輯副本，保留時取代工作檔，取消時捨棄副本。

採靜態連結 C++ 執行環境，音訊與視窗功能使用 Windows 系統元件。

工作檔位於 `%TEMP%\VoiceCaptureLiteNative\capture.wav`；編輯使用同目錄的 `.edit-*.wav` 副本與 `.pending.wav` 暫存檔。匯入來源不會被覆寫。

相容裝置與 WAV 可保留 44.1／48 kHz PCM16 或 float32；其他格式經轉換。MP3 為有損壓縮，提高輸出位元率不能恢復來源已丟失的細節。音量增幅過大會限幅，可能造成失真。

快捷鍵：`Space` 播放／暫停、`Ctrl+R` 錄製、`Ctrl+O` 匯入、`Ctrl+S` 匯出、`Ctrl+T` 編輯／取消編輯、`Ctrl+0` 全部、`Ctrl+1` 建議範圍。
