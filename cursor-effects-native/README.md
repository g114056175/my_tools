# 滑鼠光跡

Windows 桌面滑鼠裝飾：按住左鍵拖曳出現光跡，點擊產生波紋與碎片。

## 下載

**v1.0.1 暫停下載**：Windows Defender 偵測為 `Trojan:Win32/Wacatac.C!ml`，正在覆核發布產物。確認前請保留隔離狀態。

適用 **Windows 10（1703 以上）／Windows 11 x64**，需 .NET Framework 4.8 與支援 Direct3D 11 的顯示驅動；已在 Windows 10 22H2 測試。

## 效果預覽

![光跡、點擊波紋與碎片效果](docs/preview.png)

## 操作

- 開關控制整體效果；效果顯示在最上層，不阻擋滑鼠操作。
- 「拖曳光跡」「點擊效果」「碎片」分頁調整顏色、大小、不透明度、數量、速度與光暈，或直接選用配色模板。
- 最小化回工作列；「收起面板」藏到托盤，雙擊托盤叫回；X 退出。「重設」還原外觀。

## 大小與效能

**EXE：101 KiB**；首次執行另釋出 **19 KiB** 原生 DLL。

測試電腦：**i5-12600K、RTX 4060、Windows 10 22H2**，桌面範圍 3840×1080。

| 狀態 | CPU | 記憶體（工作集） |
| --- | ---: | ---: |
| 背景常駐、無操作 | 約 0.03% | 約 74 MiB |
| 持續播放預設效果 | 約 0.05% | 約 79 MiB |
| 碎片數量／光暈 300% | 約 0.31% | 約 80 MiB |
| 跨桌面高速拖曳，碎片／光暈 300% | 約 0.60% | 約 84 MiB |

效果固定 60 FPS，結束後停止繪製。以上為收起面板、每階段 6 秒的短時量測；CPU 按 16 邏輯執行緒折算，未包含桌面合成器（DWM），不同電腦的結果會有差異。

## 參考

根據《蔚藍檔案》遊戲內的鼠標粒子效果嘗試模擬，為非官方工具。

<details>
<summary><strong>建置、驗證與技術細節（點此展開）</strong></summary>

### 技術

C#／WinForms 控制面板，C++／Direct2D + DirectComposition 繪製。只繪製效果附近的小區域，閒置時停止渲染；圖片與原生模組內嵌於 EXE。GPU 不可用時退回 WARP 軟體繪圖。

光跡連接相鄰游標取樣點，長距離移動也會連線；碎片依距離分布在沿途，各次取樣與存活碎片數量均有上限。停頓後續接原位置，放開滑鼠或進入控制面板時結束該段。

設定及原生 DLL 快取位於 `%LOCALAPPDATA%\BlueArchiveCursor.Native`。碎片速度改變移動與淡出時間，飛散範圍不變；0% 停止移動但仍淡出。程式僅允許一個實例，再次執行會叫回面板。

發布前以 `tests/security-scan.ps1` 掃描實際 EXE；`release.ps1` 在偵測到威脅、掃描失敗或檔案被隔離時停止。此檢查不代表微軟已完成覆核。

Windows 版本下限依據所用的 [DPI API](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setprocessdpiawarenesscontext)。Windows 11 尚未實機驗證。第三方聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 建置

在 Windows PowerShell 5.1 進入專案根目錄。需系統 .NET Framework C# compiler 與固定版本的 [LLVM-MinGW 20260616／Clang 22.1.8，x64 UCRT](https://github.com/mstorsjo/llvm-mingw/releases/tag/20260616)：

```powershell
# PATH 已有同版 LLVM-MinGW 時，可略過工具鏈下載
powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-toolchain.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File release.ps1
```

工具鏈下載約 179 MiB，僅供建置；版本、網址與 SHA-256 在 `toolchain.json`。可使用 `build.ps1 -Compiler "完整路徑\clang++.exe"` 指定同版編譯器。無須 Visual Studio、Node 或 Python。

- `dist/`：EXE、說明與效果圖。
- `dist/BlueArchiveCursor.exe`：發布用單檔 EXE。
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
