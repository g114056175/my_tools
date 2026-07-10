# Word2PDF Batch

Windows Word 批次轉 PDF 小工具。

## 直接下載

[下載 Word2PDF-Batch.exe](https://github.com/g114056175/word2pdf/raw/main/dist/Word2PDF-Batch.exe)

下載後請執行：

```text
dist\Word2PDF-Batch.exe
```

只需要開這個 EXE。`build_exe.ps1` 是給開發者重新打包用的，不是日常執行入口。

## 功能

- 支援 `.doc` / `.docx`
- 可複選 Word 檔
- 可選資料夾，只處理該層，不遞迴子資料夾
- 可拖曳檔案或資料夾
- 可輸出到 Word 同資料夾或指定資料夾
- 使用 Microsoft Word 原生匯出，優先保留文字編碼與版面

## 修改

```powershell
.\run_app.ps1
```

重新打包：

```powershell
.\build_exe.ps1
```
