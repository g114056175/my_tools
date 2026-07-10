# Word2PDF Batch

Windows Word 批次轉 PDF 小工具。

## 下載

[下載單檔 EXE](https://github.com/g114056175/word2pdf/raw/main/dist/Word2PDF-Batch.exe)

執行後會開啟 UI。需要 Windows 與已安裝 Microsoft Word。

## 功能

- 支援 `.doc` / `.docx`
- 可複選檔案
- 可選資料夾，只處理該層，不遞迴子資料夾
- 可拖曳檔案或資料夾
- 預設輸出到 Word 同資料夾，也可指定輸出資料夾
- 使用 Microsoft Word 原生匯出，優先保留文字編碼與版面
- 轉換完成後不跳完成視窗，只更新紀錄與待處理清單

## 修改與重新打包

```powershell
cd D:\VSCode\my_LLMcaller\word2PDF
.\run_app.ps1
```

修改 `word2pdf_gui.py` 後重新打包：

```powershell
.\build_exe.ps1
```

輸出位置：

```text
dist\Word2PDF-Batch.exe
```

若要主程式 exe 較小、可接受整包資料夾一起攜帶：

```powershell
.\build_exe_folder.ps1
```
