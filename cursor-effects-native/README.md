# 滑鼠光跡

Windows 桌面滑鼠裝飾：按住左鍵拖曳出現光跡，點擊產生波紋與碎片。

## 下載

**[下載 EXE](https://github.com/g114056175/my_tools/releases/download/cursor-effects/BlueArchiveCursor.exe)**

Windows 防護可能阻擋下載或執行，原因尚未確認。

適用 **Windows 10（1703 以上）／Windows 11 x64**，需 .NET Framework 4.8 與支援 Direct3D 11 的顯示驅動；已在 Windows 10 22H2 測試。

## 效果預覽

![滑鼠光跡操作展示](docs/capture.gif)

![新版面板：拖曳、點擊與外觀設定](docs/control-panel.png)

## 操作

- 只有右上開關按鈕切換整體效果，旁邊文字不互動；效果顯示在最上層，不阻擋滑鼠操作。
- 「拖曳」調整光跡顏色、粗細、衰退時間與碎片間距；預設衰退 **180 ms**、間距 **100 px**。
- 「點擊」調整波紋顏色、大小與碎片數量上下限；預設每次隨機 **3–5 顆**，上下限都設為 0 可關閉點擊碎片。
- 「外觀」共用碎片顏色、大小、速度與不透明度；點擊與拖曳使用相同碎片大小。也可直接選配色模板。
- 粗細、碎片與波紋大小預設均為 **100%**。
- 數值可輸入或拖動滑條。最小化回工作列；「收起面板」藏到托盤，雙擊托盤叫回；X 退出。「重設」還原外觀。

## 大小與效能

**EXE：103.5 KiB（105,984 bytes）**；首次執行另釋出約 **21 KiB** 原生 DLL，使用者只需下載 EXE。

測試電腦：**i5-12600K、RTX 4060、Windows 10 22H2**，桌面範圍 3840×1080。

| 狀態 | CPU | 記憶體（工作集） |
| --- | ---: | ---: |
| 啟動後閒置 | 低於 0.1% | 約 75 MiB |
| 持續播放預設效果 | 約 0.07% | 約 85 MiB |
| 間距 8 px、每次點擊 18–20 顆、大小／速度 300%、衰退 1000 ms | 低於 0.1% | 約 86 MiB |
| 每 16 ms 跨桌面跳動，間距 8 px | 約 0.32% | 約 88 MiB |

效果固定 60 FPS，結束後停止繪製。預設效果 GPU 引擎讀值約 0–1%，上述極端跳動最高約 3%；壓力測試後閒置工作集可能維持約 88 MiB。

以上為收起面板、每階段 6 秒的短時量測；CPU 按 16 邏輯執行緒折算，低讀值受計時精度影響，未包含桌面合成器（DWM）。預設效果每幀 CPU 送出平均約 0.59 ms，幀間隔第 95 百分位約 17.4 ms，並非滑鼠到顯示的端到端延遲。不同電腦與測量時段會有差異。

## 參考

根據《蔚藍檔案》遊戲內的鼠標粒子效果嘗試模擬，為非官方工具。

<details>
<summary><strong>建置、驗證與技術細節（點此展開）</strong></summary>

### 技術

C#／WinForms 控制面板，C++／Direct2D + DirectComposition 繪製。僅更新效果附近的小區域，閒置時停止渲染；原生模組內嵌於 EXE，GPU 不可用時使用 WARP 軟體繪圖。

光跡連接滑鼠取樣點，轉折以二次曲線補間，使用 MAX 混合避免重疊處變亮。碎片按累積位移生成；點擊雙環獨立旋轉並逐段消散。三角碎片先長大再向中心縮小，亮白停留與轉色時間各自隨機。

設定及原生 DLL 快取位於 `%LOCALAPPDATA%\BlueArchiveCursor.Native`。設定自動儲存，再次執行會叫回面板。外觀為桌面環境的近似重現；不附帶遊戲解包檔案。

Windows 版本下限依據所用的 [DPI API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext)。Windows 11 尚未實機驗證。第三方聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 建置

在 Windows PowerShell 5.1 進入專案根目錄。需系統 .NET Framework C# compiler 與固定版本的 [LLVM-MinGW 20260616／Clang 22.1.8，x64 UCRT](https://github.com/mstorsjo/llvm-mingw/releases/tag/20260616)：

```powershell
# PATH 已有同版 LLVM-MinGW 時，可略過工具鏈下載
powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-toolchain.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File release.ps1
```

工具鏈下載約 179 MiB，僅供建置；版本、網址與 SHA-256 在 `toolchain.json`。可用 `build.ps1 -Compiler "完整路徑\clang++.exe"` 指定同版編譯器。無須 Visual Studio、Node 或 Python。

- `dist/BlueArchiveCursor.exe`：單檔 EXE。
- `dist/`：程式、說明與效果圖。
- `.build/build-info.json`：編譯器版本及來源／產物雜湊。

可重建功能相同的程式，不保證 EXE 位元組完全一致。下載的工具鏈、產物與測試結果已列入 `.gitignore`。

### 驗證

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/verify.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/release-smoke.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/performance.ps1
```

圖形驗證需要互動桌面與硬體 GPU；單檔啟動驗證前先退出正在執行的程式。結果寫入 `test-results/`；效能測試只統計本程式，使用內部測試座標，不操作系統滑鼠。

</details>
