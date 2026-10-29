# Word2PDF

Windows Word 批次轉 PDF 工具，支援 `.doc`／`.docx`。

**需要已安裝且能正常開啟的桌面版 Microsoft Word。** 本工具透過 Word 原生匯出 PDF；網頁版 Word 或僅安裝 LibreOffice 無法取代此需求。

[下載 Word2PDF-Batch.exe](https://github.com/g114056175/my_tools/releases/download/word2pdf-migrated-2026-10-04/Word2PDF-Batch.exe)

## 使用

1. 開啟 `Word2PDF-Batch.exe`，選取或拖入 Word 檔案。
2. 選擇輸出到原檔資料夾或指定資料夾，按「開始轉換」。
3. 成功的文件會移出清單；失敗或未處理的文件會保留，可修正問題後重試。

按住 `Shift` 點「選擇檔案」可加入資料夾，也可直接拖入。一次加入一個資料夾，只處理該層；檔案與資料夾請分開加入。

## 輸出與停止

- 預設保留既有 PDF，同名時依序加上 `_1`、`_2`。
- 勾選「覆蓋同名 PDF」可取代既有同名檔案；同一批文件的輸出仍會自動區分名稱，避免互相覆蓋。
- PDF 匯出完成後才取代目標檔案，匯出失敗會保留原有 PDF。
- 轉換中按「停止」，會完成目前文件後停止；關閉視窗時也會先確認並等待清理完成。
- 若 Word 本身卡住，停止操作無法立即中斷目前文件，需先處理 Word 的對話框或異常。

## 開發

需要 Python 3.10 以上。於此資料夾執行：

```powershell
.\run_app.ps1
```

重新打包為同名 EXE：

```powershell
.\build_exe.ps1
```

安裝相依套件後，可執行不需啟動 Word 的回歸測試：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
