# GitHub 發布清單

本資料夾已整理為 Git 儲存庫內容，但未替你建立遠端儲存庫或上傳。

1. 在 GitHub 建立儲存庫，將 repository/ **裡面的內容**放在儲存庫根目錄，不要把外層所有 releases 成品一起提交。
2. 公開前選定本專案的原始碼授權。notices/ 是附帶執行環境的第三方告知，不等於本專案已採用同樣授權。
3. 確認 README 的圖片可顯示、build.ps1 與 verify.ps1 可在 Windows 執行。
4. 用實際提交建立 v2.2.0 標籤及 GitHub Release，貼上 releases/RELEASE-NOTES.md 內容。
5. 上傳 `VoiceCaptureLite-v2.2.0-win-x64.exe`、可攜版 ZIP、SHA256SUMS.txt；framework-dependent EXE 可列為進階選項。
6. 隨自包含成品提供 notices/ 告知內容。提供的可攜 ZIP 已包含告知檔；只下載 EXE 即可啟動程式。
7. 下載一次發布附件核對雜湊，並在沒有額外 .NET Desktop Runtime 的乾淨 Windows VM 測試。

不要提交 bin/、obj/、out/、artifacts/、錄音暫存、私人路徑或個人設定。已提供 .gitignore。

目前 EXE 未簽章。日後若簽章，必須對簽章後成品重新產生 SHA-256，不能沿用目前雜湊。GitHub Release 的自動原始碼 ZIP 與本地 source ZIP 不一定有相同檔案雜湊，應分別標示。
