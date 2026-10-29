# LLM_Caller

Windows 桌面 LLM 工具，將選取文字或指定範圍的截圖送至設定的 API，並以浮動視窗顯示回覆。

[下載 llm_overlay.exe](https://github.com/g114056175/my_tools/releases/download/test_examAssistant-migrated-2026-10-04/llm_overlay.exe)

## 開始使用

1. 執行 `llm_overlay.exe`，按 `Ctrl+Alt+S` 開啟設定。
2. 在 Basic 填入 `Endpoint`、`API Key`、`Model` 與主要 `Prompt`，按 `Save` 儲存。
3. 選取文字後按 `Ctrl+Q`；圖片提問則先按 `Ctrl+Alt+1` 框選，再按 `Ctrl+Alt+2` 傳送。

## API 設定

支援 OpenAI 相容 API、OpenRouter、Google Gemini 與 Anthropic。`Endpoint` 可輸入完整網址或以下簡稱：

| 簡稱 | 服務 |
| --- | --- |
| `openai` | OpenAI Chat Completions |
| `openrouter` | OpenRouter Chat Completions |
| `google` | Google Gemini |
| `anthropic`／`claude` | Anthropic Messages |

程式會依端點網址與 API Key 前綴選擇請求格式；模型名稱需填寫該服務支援的模型 ID。

## 預設快捷鍵

| 快捷鍵 | 功能 |
| --- | --- |
| `Ctrl+Q` | 傳送文字提問 |
| `Ctrl+Alt+1` | 框選截圖範圍 |
| `Ctrl+Alt+2` | 傳送圖片提問 |
| `Ctrl+R` | 取消請求 |
| `Alt+V` | 顯示／隱藏浮動視窗 |
| `Ctrl+Alt+Right`／`Left` | 增加／減少不透明度 |
| `Ctrl+Alt+Up`／`Down` | 向上／向下捲動 |
| `Ctrl+Alt+S` | 開啟／關閉設定 |
| `Ctrl+Alt+X` | 結束程式 |

## 設定與資料

- 未按 `Save` 的修改只在目前執行期間有效。Basic 儲存 API、Prompt、Quick Prompt、快捷鍵與介面設定；Advanced 另儲存 Reference Data 與 Model Router，並移除空白路由。
- Reference Data 接受 `.txt`／`.md` 檔案或包含這些檔案的資料夾；PDF／PPT 請先轉成文字。
- 舊設定可相容讀取，但儲存時不再保留舊的 `[Routes]`、`[Ensemble]` 區段。
- 提問內容、提示詞、截圖（PNG）及啟用的參考資料會送至設定的 API 服務。
- `config.ini` 內的 API Key 目前為明文，請勿分享或提交此檔案；Git 已忽略它。

## 建置

需要 MSVC Build Tools、MinGW 或 LLVM-MinGW。在此資料夾執行：

```powershell
.\build.ps1
```

預設使用 `portable` 設定，輸出 `llm_overlay.exe`。其他建置選項見 [build.ps1](build.ps1)。
