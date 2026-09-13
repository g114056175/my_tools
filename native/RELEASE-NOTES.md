# Voice Capture Lite Native v3.0.2

單一 Windows x64 EXE；不需要 .NET、Python、編譯器或額外 GUI 套件。

直接執行 `VoiceCaptureLiteNative.exe`。按「開始錄製」後播放來源音訊；結束後可預覽、裁切並匯出 WAV／MP3。也可拖入 WAV／MP3。錄製預設播放裝置，並在支援的 Windows 版本提供指定視窗來源；不含麥克風。

本版移除波形區下方的高度拖曳條。錄音封包改用裝置樣本位置對齊，減少邊界補零與丟樣本；相容裝置優先保留 44.1／48 kHz 原生 float32 或 PCM16。WAV 匯出保留工作音檔格式，MP3 仍為有損壓縮。

3.0.2 將輸出格式下拉選單改為與介面一致的深色圓角樣式；播放／錄製計時與裁切秒數統一顯示兩位小數。限制最小視窗尺寸，避免縮得過小時原生控制項與自繪畫面互相重疊。

原生版暫存位置：`%TEMP%\VoiceCaptureLiteNative\capture.wav`。公開發佈前可依需要為 EXE 簽章。指定程序錄音尚未在 Windows 11 實機驗證。
