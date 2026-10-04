# 來源與第三方元件

效果外觀參考《蔚藍檔案》及 Shittim Canvas 的游標效果；本專案為非官方程式重現，沒有附帶遊戲解包資源或 Unity/Spine 模型。《蔚藍檔案》名稱、角色與相關遊戲權利屬原權利人。

`assets/line-glow.png`、`triangle-glow.png` 是先前程式繪製並匯出的光暈快取；`cursor.ico` 是此工具既有圖示。它們隨原始碼提供，重建不需要原工作區或瀏覽器。

建置使用 [LLVM-MinGW 20260616](https://github.com/mstorsjo/llvm-mingw/releases/tag/20260616)。原生模組不連結通用 C++ 標準函式庫，使用 Windows heap 及系統 API；仍使用工具鏈的編譯器／啟動程式碼及標頭。隨附工具鏈的 LLVM 授權文字在 [licenses/LLVM.txt](licenses/LLVM.txt)，包含 Apache-2.0 WITH LLVM-exception；[licenses/MinGW-w64.txt](licenses/MinGW-w64.txt) 保留 [MinGW-w64 的 COPYRIGHT／ZPL 2.1 聲明](https://github.com/mingw-w64/mingw-w64/blob/master/COPYING)。這些是第三方元件聲明，不是本專案程式碼的授權。

Windows、.NET Framework、Direct2D、DirectComposition、Direct3D 與 WIC 為系統依賴，不隨本包重新分發。專案程式碼尚未指定開源授權。
