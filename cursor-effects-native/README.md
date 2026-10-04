# 滑鼠光跡

Windows 桌面滑鼠裝飾：按住左鍵拖曳出現光跡，點擊產生波紋與碎片。

## 下載

**[下載 EXE](https://github.com/g114056175/my_tools/releases/download/cursor-effects/BlueArchiveCursor.exe)**

Windows 防護可能阻擋下載或執行，原因尚未確認。

適用 **Windows 10（1703 以上）／Windows 11 x64**，需 .NET Framework 4.8 與支援 Direct3D 11 的顯示驅動；已在 Windows 10 22H2 測試。

## 效果預覽

![光跡、點擊波紋與碎片效果](docs/preview.png)

![點擊雙環與周邊三角粒子的實際 GPU 渲染](docs/click-reference.gif)

## 操作

- 開關控制整體效果；效果顯示在最上層，不阻擋滑鼠操作。
- 三個分頁分別調整拖曳、點擊及碎片，或直接選用配色模板。
- 拖曳預設約每 **80 px** 生成一顆，間距隨機浮動 **±35%**；間距越大越稀疏，0 關閉拖曳碎片。停止移動不生成。
- 點擊產生兩道大小及旋轉相位不同的環帶，預設 **4 顆** 三角粒子在周邊隨機生成；可調粒子半徑、散布與速度。
- 三角形固定朝上或朝下，先長大再縮小；出生時偏白，隨後轉色並依明暗曲線消散。
- 最小化回工作列；「收起面板」藏到托盤，雙擊托盤叫回；X 退出。「重設」還原外觀。

## 大小與效能

**EXE：115 KiB**；首次執行另釋出約 **22 KiB** 原生 DLL。

測試電腦：**i5-12600K、RTX 4060、Windows 10 22H2**，桌面範圍 3840×1080。

| 狀態 | CPU | 記憶體（工作集） |
| --- | ---: | ---: |
| 啟動後閒置 | 低於 0.1% | 約 76 MiB |
| 持續播放預設效果 | 低於 0.1% | 約 80 MiB |
| 間距 8 px、點擊 20 顆、大小／速度／光暈 300%、衰退 1000 ms | 低於 0.1% | 約 82 MiB |
| 每 16 ms 跨桌面跳動，間距 8 px／光暈 300% | 約 0.78% | 約 100 MiB |

效果固定 60 FPS，結束後停止繪製。預設效果 GPU 引擎讀值約 0–2%，上述極端跳動最高約 7%；壓力測試後閒置工作集可能仍維持約 100 MiB，不保證立即歸還全部記憶體。

以上為收起面板、每階段 6 秒的短時量測；CPU 按 16 邏輯執行緒折算，低讀值受計時精度影響，未包含桌面合成器（DWM）。預設效果每幀 CPU 送出平均約 0.47 ms，並非滑鼠到顯示的端到端延遲。無法保證零負載；不同電腦與測量時段會有差異。

## 參考

根據《蔚藍檔案》遊戲內的鼠標粒子效果嘗試模擬，為非官方工具。

<details>
<summary><strong>建置、驗證與技術細節（點此展開）</strong></summary>

### 技術

C#／WinForms 控制面板，C++／Direct2D + DirectComposition 繪製。只繪製效果附近的小區域，閒置時停止渲染；圖片與原生模組內嵌於 EXE。GPU 不可用時退回 WARP 軟體繪圖。

高速拖曳時連接取樣點，轉折使用輕量二次曲線補間；不增加滑鼠輪詢頻率，也不延遲最新端點。曲線頂點與存活碎片數量均有上限。停頓後續接原位置，放開滑鼠或進入控制面板時結束該段。

拖曳碎片依累積位移生成，同一路徑不因取樣次數增加而變多；生成間距與浮動百分比可調。跨螢幕的極端跳躍另有每次生成上限，避免大量粒子積欠。

「離線距離 px」預設 8 px，兩側生成位置帶 ±25% 隨機浮動，並計入碎片半徑保留空隙；之後以小幅隨機速度向外漂移。「散開幅度 %」一起縮放生成距離與漂移範圍，0% 貼合路徑，不影響數量或點擊。

點擊雙環參照 Shittim 的兩個薄環網格粒子：生命期 600 ms、隨機大小、獨立旋轉、沿圓周的明暗漸層。使用參照的 Hermite 成長曲線快速展開後緩慢延伸，預設最大半徑約 72 px；不以等速擴大的完整圓代替。

點擊可調 0–20 顆三角粒子，預設半徑 50 px、散布 35%；角度各自獨立抽取，保留聚集與空白區域。粒子成長／縮小及多段明暗曲線參照原資產；拖曳與點擊的大小、速度及不透明度各自獨立。

「出生白光 %」控制碎片本體偏白程度，「變色時間 ms」控制初始白光保留後的轉色速度，預設 65 ms。亂數在出生時決定；後續閃淡依時間曲線計算，逐幀繪製不會重新抽取。三角形只使用朝上、朝下兩種方向，無旋轉。

參照數值及移植範圍見 [reference-profile.json](tests/reference-profile.json)。螢幕像素比例、短暫閃光 shader 與 Unity HDR／Bloom 尚未完整還原，目前仍屬近似；不附帶解包貼圖、模型或 Unity 檔案。

「周圍光暈 %」控制光跡、點擊波紋與碎片周圍的柔光，0% 關閉柔光，本體仍保留；不改變碎片數量、大小或分散距離。櫻花紅模板使用較鮮明的紅粉光跡與粉色碎片。

![六種配色模板的實際渲染](docs/palettes.png)

「拖曳光跡 → 衰退時間 ms」可調 40–1000 毫秒，預設 **180 毫秒**；僅控制光跡，碎片仍使用自己的速度設定。設定會自動儲存，「重設」還原預設外觀。

光跡與光暈使用 Direct2D MAX 混合，避免接點、急彎與重疊處反覆累積亮度；點擊波紋與碎片維持原混合方式。不增加離屏紋理或逐幀模糊運算。

![光跡曲線、小圈與急彎的實際渲染](docs/trail-joints.png)

![相同稀疏取樣的折線與曲線補間比較](docs/curve-comparison.png)

![拖曳與點擊碎片在 0、100、200 ms 的實際渲染](docs/particle-rules.png)

![點擊雙環在 40–550 ms 的實際渲染](docs/click-reference-timeline.png)

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
