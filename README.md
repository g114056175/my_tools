# my_tools

個人桌面小工具集合。各工具保留自己的操作說明、依賴與建置方式。

| 工具 | 用途 | 下載 |
| --- | --- | --- |
| [滑鼠光跡](cursor-effects-native/) | 按住左鍵的光跡、點擊波紋與碎片 | [Windows x64](https://github.com/g114056175/my_tools/releases/tag/cursor-effects-v1.0.0) |
| [Word2PDF](word2pdf/) | 使用 Microsoft Word 批次轉 PDF | [Windows](https://github.com/g114056175/my_tools/releases/tag/word2pdf-migrated-2026-10-04) |
| [文字／截圖查詢工具](test_examAssistant/) | 快捷鍵呼叫 LLM 查詢文字或截圖 | [Windows x64](https://github.com/g114056175/my_tools/releases/tag/test_examAssistant-migrated-2026-10-04) |
| [VoiceCapture](VoiceCapture/) | 系統聲音錄製、波形編輯與匯出 | [v3.0.2](https://github.com/g114056175/my_tools/releases/tag/VoiceCapture-v3.0.2) |

詳細操作、適用環境與限制請見各工具的 README。Word2PDF 需要 Microsoft Word；查詢工具需自行設定服務；設定檔不隨倉庫提供。

## 新增或更新工具

首次下載：

```powershell
git clone https://github.com/g114056175/my_tools.git
cd my_tools
```

之後把檔案放在新資料夾，例如 `test_A/`，保留該工具的 README、原始碼及建置腳本，再更新本頁索引：

```powershell
git pull --ff-only
git add -- test_A/ README.md
git commit -m "Add test_A"
git push origin main
```

子資料夾不放另一份 `.git`。EXE／ZIP 發布至 GitHub Releases，各工具使用自己的標籤，例如 `test_A-v1.0.0`。

<details>
<summary>搬遷紀錄與原始提交</summary>

2026-10-04 從原工具倉庫整合；原有倉庫保留，供人工核對。來源分支的提交紀錄已匯入，原分支與標籤快照保存在 `source/<原倉庫>/branches/…`、`source/<原倉庫>/tags/…` 標籤下。來源與檔案樹比對見 [migration.json](migration.json)。

各工具授權與第三方聲明沿用各自目錄；本集合不另行覆蓋子專案授權。

</details>
