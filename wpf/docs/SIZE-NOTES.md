# 執行檔體積與精簡方向

## 結論

主要負擔是 C#/.NET 8 + WPF 的自包含部署，不是音訊處理套件。這個架構方便實作介面，但與「免額外安裝、單一 EXE、約 1 MiB」的目標不合。要達到該量級，優先考慮 C++ + Win32 自繪介面，保留現有 Windows 音訊 API；不必先犧牲 MP3、播放、裁切或波形。

目前交付仍為 WPF 2.2，不是已完成的 C++ 原生版本。原生版可把小於 1 MiB 設為工程目標，但需完成移植、靜態連結與功能驗證後量測，不能把空白視窗的幾十 KB 當作完整工具的大小保證。

## 已實測的體積

| 項目 | Bytes | 說明 |
| --- | ---: | --- |
| 2.1 自包含單檔 | 71,664,685 | 約 68.34 MiB，已啟用單檔壓縮 |
| 2.2 全語言對照組 | 71,665,140 | 與下列精簡組同一份 2.2 程式碼，發布時覆寫 SatelliteResourceLanguages 為空 |
| 2.2 自包含單檔 | 66,337,365 | 約 63.26 MiB，只保留繁體中文衛星資源，含中性資源備援 |
| 2.2 精簡單檔 | 288,396 | 約 282 KiB，需要既有 .NET 8 Desktop Runtime，不能視為免依賴方案 |
| 2.2 自訂程式 DLL | 122,880 | 120 KiB；包含本工具 GUI、波形、錄音、播放、裁切與編解碼呼叫，尚未與執行環境合併壓縮 |
| 應用 ICO 原始資產 | 9,125 | 已內嵌於應用程式，不應重複加總 |

2.1 → 2.2 成品差額為 5,327,320 bytes，約 5.08 MiB、7.43%。這是版本間成品比較，包含少量時間刻度程式碼變更，不能視為只移除語言的精確 A/B 分項數字。

同一份 2.2 程式碼另做全語言／只留繁中對照發布，差额為 5,327,775 bytes（約 5.08 MiB）。兩組均使用相同的自包含、單檔壓縮、無偵錯符號設定，因此這個對照直接反映語言資源設定的體積效果。

對 2.1 發布中介目錄按 deps.json 的 runtime pack 分類（以下皆為原始檔案大小，不是 EXE 內壓縮後占比）：

| 檔案群組 | 原始總量 |
| --- | ---: |
| .NETCore runtime，179 檔 | 73,848,112 bytes / 70.427 MiB |
| WindowsDesktop runtime，59 檔 | 77,385,896 bytes / 73.801 MiB |
| 13 種語言的 resources.dll，221 檔 | 16,263,208 bytes / 15.510 MiB |

語言檔另列，未重複计入上兩列。中介目錄的 EXE/apphost 與 deps/runtimeconfig 不當成「業務程式碼」；也不能將中介目錄所有檔案相加當作最終執行檔的大小。

## 音訊依賴實際放在哪裡

- 錄音：Windows WASAPI loopback。
- 播放：Windows winmm / waveOut。
- WAV 裁切／波形峰值：本工具自己的串流讀写程式碼。
- MP3 匯入／匯出：Windows Media Foundation，沒有打包 FFmpeg、LAME 或 Python。
- GUI：WPF；自包含版本需附 .NETCore 和 WindowsDesktop 執行環境，這才是大宗。

Microsoft 的 [MP3 Audio Encoder 文件](https://learn.microsoft.com/en-us/windows/win32/medfound/mp3-audio-encoder)列出內建編碼器及位元率支援。Windows N/KN 若缺媒體功能，仍可能需要補上 Windows 媒體元件；這是 OS 元件依賴，不是本工具附帶的數十 MB 音訊套件。

## 刪減各項能省多少

| 方案 | 體積效果與代價 |
| --- | --- |
| 移除其他框架語言資源 | 本次成品約少 5.08 MiB；已實作，不刪音訊功能 |
| 刪 MP3 編解碼／降低可選音質檔數 | 沒有可移除的第三方編碼器 DLL，只省少量自訂程式碼；不能省下數十 MB。未做功能切除 A/B，不提供虛構的精確 KB |
| 刪裁切、縮放、波形或改簡單配色，但仍用 WPF | 同樣只省少量自訂程式碼；整個應用 DLL 才 120 KiB，runtime 仍需附帶 |
| WAV 改低取樣率、MP3 改低位元率 | 主要縮小錄製／匯出的音檔，不會明顯縮小工具 EXE |
| 改成 framework-dependent | 成品約 282 KiB，但使用者要有 .NET，與免額外安裝需求不符 |
| 保留 WPF，強制開 trimming 或手動刪 runtime DLL | 不作為可靠交付方式；反射、XAML、COM 等路徑可能在特定操作才失敗 |
| 改 C++ + Win32 / GDI / Direct2D | 可移除整份 .NET/WPF 負擔，是接近 1 MiB 的主要方向；需要移植 UI 與 C# 程式碼，功能可保留，大小須實作後量測 |

上述小功能節省量不可將 120 KiB 重複相加：它們共用同一個應用 DLL；移除個別功能的精確差額尚未實測。

WPF 使用反射及動態程式碼檢查，Microsoft 目前明確列為不支援 trimming 的情況。不能只加 `PublishTrimmed=true` 就可靠地縮到幾 MB，更不能把既有 WPF 專案一鍵改成小型 Native AOT 工具。[官方 trimming 限制](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/incompatibilities)

## 原生版部署方式

使用 C++ 並不表示使用者要安裝 C++ 編譯器。可用 Win32 系統 API，自訂波形直接繪圖，CRT 靜態連結（MSVC 的 `/MT` 或其他工具鏈等效設定），避免額外的 VC++ runtime 安裝包。音訊仍使用 WASAPI、winmm、Media Foundation，不引入大型 GUI 框架或 codec 包。[Microsoft 靜態執行庫選項](https://learn.microsoft.com/en-us/cpp/build/reference/md-mt-ld-use-run-time-library?view=msvc-170)

這種做法依賴 Windows 自身元件，不代表完全不依賴任何 DLL；但使用者通常無須另裝 .NET、Python、C++ 編譯器等開發環境。指定程序錄音的 Windows 版本限制仍然存在，改語言不會解除它。
