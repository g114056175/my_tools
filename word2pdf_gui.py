# -*- coding: utf-8 -*-
import os
import queue
import threading
from pathlib import Path
from tkinter import (
    BooleanVar,
    END,
    LEFT,
    RIGHT,
    BOTH,
    DISABLED,
    NORMAL,
    StringVar,
    filedialog,
    messagebox,
    ttk,
)
import tkinter as tk

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
except ImportError:
    DND_FILES = None
    TkinterDnD = None

try:
    import pythoncom
    import win32com.client
except ImportError:
    pythoncom = None
    win32com = None


WORD_EXTENSIONS = {".doc", ".docx"}
WD_EXPORT_FORMAT_PDF = 17
WD_EXPORT_OPTIMIZE_FOR_PRINT = 0


def is_word_file(path: Path) -> bool:
    return (
        path.is_file()
        and not path.name.startswith("~$")
        and path.suffix.lower() in WORD_EXTENSIONS
    )


def collect_word_files(paths):
    found = []
    seen = set()
    for raw_path in paths:
        path = Path(raw_path).expanduser()
        if path.is_dir():
            try:
                candidates = sorted(item for item in path.iterdir() if is_word_file(item))
            except OSError:
                candidates = []
        elif is_word_file(path):
            candidates = [path]
        else:
            candidates = []

        for candidate in candidates:
            resolved = candidate.resolve()
            key = str(resolved).lower()
            if key not in seen:
                seen.add(key)
                found.append(resolved)
    return found


def unique_pdf_path(pdf_path: Path, overwrite: bool) -> Path:
    if overwrite or not pdf_path.exists():
        return pdf_path

    index = 1
    while True:
        candidate = pdf_path.with_name(f"{pdf_path.stem}_{index}{pdf_path.suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def get_output_pdf_path(word_path: Path, output_folder: Path | None, overwrite: bool) -> Path:
    if output_folder is None:
        base_pdf = word_path.with_suffix(".pdf")
    else:
        output_folder.mkdir(parents=True, exist_ok=True)
        base_pdf = output_folder / f"{word_path.stem}.pdf"
    return unique_pdf_path(base_pdf, overwrite)


def convert_files_to_pdf(files, output_folder, overwrite, log_callback, progress_callback):
    if pythoncom is None or win32com is None:
        raise RuntimeError("缺少 pywin32，請先執行 pip install -r requirements.txt")

    pythoncom.CoInitialize()
    word = None
    try:
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = 0

        total = len(files)
        for index, word_path in enumerate(files, start=1):
            pdf_path = get_output_pdf_path(word_path, output_folder, overwrite)
            doc = None
            try:
                log_callback(f"[{index}/{total}] 轉換中：{word_path}")
                doc = word.Documents.Open(
                    str(word_path),
                    ConfirmConversions=False,
                    ReadOnly=True,
                    AddToRecentFiles=False,
                    Visible=False,
                    OpenAndRepair=False,
                    NoEncodingDialog=True,
                )
                doc.ExportAsFixedFormat(
                    OutputFileName=str(pdf_path),
                    ExportFormat=WD_EXPORT_FORMAT_PDF,
                    OpenAfterExport=False,
                    OptimizeFor=WD_EXPORT_OPTIMIZE_FOR_PRINT,
                    Range=0,
                    From=1,
                    To=1,
                    Item=0,
                    IncludeDocProps=True,
                    KeepIRM=True,
                    CreateBookmarks=1,
                    DocStructureTags=True,
                    BitmapMissingFonts=True,
                    UseISO19005_1=False,
                )
                log_callback(f"完成：{pdf_path}")
            except Exception as exc:
                log_callback(f"失敗：{word_path} -> {exc}")
            finally:
                if doc is not None:
                    doc.Close(False)
                progress_callback(index, total, word_path)
    finally:
        if word is not None:
            word.Quit()
        pythoncom.CoUninitialize()


class WordToPdfApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Word 批次轉 PDF")
        self.root.geometry("940x610")
        self.root.minsize(820, 500)

        self.files = []
        self.worker = None
        self.events = queue.Queue()
        self.overwrite_existing = BooleanVar(value=False)
        self.output_mode = StringVar(value="same")
        self.custom_output_dir = StringVar(value="")
        self.processed_count = 0
        self.total_count = 0

        self.setup_styles()
        self.build_ui()
        self.setup_drop_target()
        self.root.after(100, self.process_events)

    def setup_styles(self):
        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Title.TLabel", font=("Microsoft JhengHei UI", 16, "bold"))
        style.configure("Hint.TLabel", foreground="#555555")

    def build_ui(self):
        container = ttk.Frame(self.root, padding=16)
        container.pack(fill=BOTH, expand=True)

        header = ttk.Frame(container)
        header.pack(fill="x")
        ttk.Label(header, text="Word 批次轉 PDF", style="Title.TLabel").pack(side=LEFT)
        ttk.Label(
            header,
            text="使用 Microsoft Word 原生匯出，優先保留文字編碼與版面。",
            style="Hint.TLabel",
        ).pack(side=RIGHT)

        controls = ttk.Frame(container)
        controls.pack(fill="x", pady=(14, 8))

        self.select_file_button = ttk.Button(
            controls, text="選擇檔案", command=self.add_files
        )
        self.select_file_button.pack(side=LEFT)
        self.select_folder_button = ttk.Button(
            controls, text="選擇資料夾", command=self.add_folder
        )
        self.select_folder_button.pack(side=LEFT, padx=(8, 0))
        ttk.Button(controls, text="清空全部", command=self.clear_files).pack(
            side=LEFT, padx=(8, 0)
        )
        ttk.Checkbutton(
            controls,
            text="覆蓋同名 PDF",
            variable=self.overwrite_existing,
        ).pack(side=LEFT, padx=(18, 0))
        self.status_label = ttk.Label(controls, text="已處理: 0/0    待處理: 0")
        self.status_label.pack(side=LEFT, padx=(18, 0))
        self.start_button = ttk.Button(
            controls, text="開始轉換", command=self.start_conversion
        )
        self.start_button.pack(side=RIGHT)

        output_frame = ttk.LabelFrame(container, text="輸出位置")
        output_frame.pack(fill="x", pady=(0, 10))

        ttk.Radiobutton(
            output_frame,
            text="輸出到每個 Word 檔同一個資料夾",
            value="same",
            variable=self.output_mode,
            command=self.refresh_output_controls,
        ).pack(side=LEFT, padx=(8, 12), pady=8)
        ttk.Radiobutton(
            output_frame,
            text="輸出到指定資料夾",
            value="custom",
            variable=self.output_mode,
            command=self.refresh_output_controls,
        ).pack(side=LEFT, padx=(0, 8), pady=8)

        self.output_entry = ttk.Entry(output_frame, textvariable=self.custom_output_dir)
        self.output_entry.pack(side=LEFT, fill="x", expand=True, padx=(0, 8), pady=8)
        self.output_button = ttk.Button(
            output_frame, text="選擇", command=self.choose_output_folder
        )
        self.output_button.pack(side=RIGHT, padx=(0, 8), pady=8)

        self.drop_frame = ttk.LabelFrame(container, text="待處理 Word 檔案")
        self.drop_frame.pack(fill=BOTH, expand=True)

        list_frame = ttk.Frame(self.drop_frame, padding=8)
        list_frame.pack(fill=BOTH, expand=True)

        columns = ("remove", "name", "folder")
        self.file_list = ttk.Treeview(
            list_frame, columns=columns, show="headings", selectmode="extended"
        )
        self.file_list.heading("remove", text="移除")
        self.file_list.heading("name", text="檔案名稱")
        self.file_list.heading("folder", text="所在資料夾")
        self.file_list.column("remove", width=56, anchor="center", stretch=False)
        self.file_list.column("name", width=260, anchor="w")
        self.file_list.column("folder", width=520, anchor="w")
        self.file_list.pack(side=LEFT, fill=BOTH, expand=True)
        self.file_list.bind("<ButtonRelease-1>", self.handle_list_click)
        self.file_list.bind("<Delete>", lambda _event: self.remove_selected_files())

        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.file_list.yview)
        scrollbar.pack(side=RIGHT, fill="y")
        self.file_list.configure(yscrollcommand=scrollbar.set)

        log_frame = ttk.LabelFrame(container, text="紀錄")
        log_frame.pack(fill=BOTH, expand=False, pady=(10, 0))
        self.log_text = tk.Text(log_frame, height=7, wrap="word")
        self.log_text.pack(fill=BOTH, expand=True, padx=8, pady=8)
        self.log_text.configure(state=DISABLED)

        self.refresh_output_controls()

    def setup_drop_target(self):
        if TkinterDnD is None or DND_FILES is None:
            return
        self.file_list.drop_target_register(DND_FILES)
        self.file_list.dnd_bind("<<Drop>>", self.handle_drop)
        self.drop_frame.drop_target_register(DND_FILES)
        self.drop_frame.dnd_bind("<<Drop>>", self.handle_drop)

    def add_files(self):
        if self.worker and self.worker.is_alive():
            return
        paths = filedialog.askopenfilenames(
            title="選擇 Word 檔案",
            filetypes=[
                ("Word files", "*.doc *.docx"),
                ("All files", "*.*"),
            ],
        )
        if paths:
            self.add_paths(paths)

    def add_folder(self):
        if self.worker and self.worker.is_alive():
            return
        folder = filedialog.askdirectory(title="選擇包含 Word 檔案的資料夾")
        if folder:
            self.add_paths([folder])

    def choose_output_folder(self):
        folder = filedialog.askdirectory(title="選擇 PDF 輸出資料夾")
        if folder:
            self.custom_output_dir.set(folder)
            self.output_mode.set("custom")
            self.refresh_output_controls()

    def refresh_output_controls(self):
        state = NORMAL if self.output_mode.get() == "custom" else DISABLED
        self.output_entry.configure(state=state)
        self.output_button.configure(state=NORMAL)

    def handle_drop(self, event):
        self.add_paths(self.root.tk.splitlist(event.data))

    def handle_list_click(self, event):
        if self.file_list.identify("region", event.x, event.y) != "cell":
            return
        if self.file_list.identify_column(event.x) == "#1":
            row = self.file_list.identify_row(event.y)
            if row:
                self.remove_file_item(row)

    def add_paths(self, paths):
        new_files = collect_word_files(paths)
        existing = {str(path).lower() for path in self.files}
        added = 0

        for path in new_files:
            key = str(path).lower()
            if key in existing:
                continue
            self.files.append(path)
            self.file_list.insert(
                "", END, iid=str(path), values=("X", path.name, str(path.parent))
            )
            existing.add(key)
            added += 1

        if added:
            self.log(f"已加入 {added} 個 Word 檔。")
        else:
            self.log("沒有找到新的 .doc 或 .docx 檔。")
        self.update_status()

    def clear_files(self):
        if self.worker and self.worker.is_alive():
            return
        self.files.clear()
        for item in self.file_list.get_children():
            self.file_list.delete(item)
        self.processed_count = 0
        self.total_count = 0
        self.update_status()
        self.log("已清空全部。")

    def remove_selected_files(self):
        if self.worker and self.worker.is_alive():
            return
        for item in self.file_list.selection():
            self.remove_file_item(item)

    def remove_file_item(self, item):
        if self.worker and self.worker.is_alive():
            return
        try:
            removed = Path(item)
            self.files = [path for path in self.files if str(path) != str(removed)]
            self.file_list.delete(item)
            self.update_status()
            self.log(f"已移除：{removed.name}")
        except tk.TclError:
            pass

    def remove_finished_file(self, word_path):
        key = str(word_path)
        self.files = [path for path in self.files if str(path) != key]
        if self.file_list.exists(key):
            self.file_list.delete(key)

    def get_selected_output_folder(self):
        if self.output_mode.get() != "custom":
            return None
        folder = self.custom_output_dir.get().strip()
        if not folder:
            messagebox.showinfo("缺少輸出資料夾", "請先選擇 PDF 輸出資料夾。")
            return False
        return Path(folder).expanduser().resolve()

    def start_conversion(self):
        if not self.files:
            messagebox.showinfo("沒有檔案", "請先加入 Word 檔案或資料夾。")
            return
        if self.worker and self.worker.is_alive():
            return

        output_folder = self.get_selected_output_folder()
        if output_folder is False:
            return

        files = list(self.files)
        self.processed_count = 0
        self.total_count = len(files)
        self.update_status()
        self.set_controls_enabled(False)
        overwrite = self.overwrite_existing.get()
        target_text = "原檔同資料夾" if output_folder is None else str(output_folder)
        self.log(f"開始轉換 {len(files)} 個檔案。輸出位置：{target_text}")

        self.worker = threading.Thread(
            target=self.run_conversion,
            args=(files, output_folder, overwrite),
            daemon=True,
        )
        self.worker.start()

    def run_conversion(self, files, output_folder, overwrite):
        try:
            convert_files_to_pdf(
                files,
                output_folder,
                overwrite,
                lambda message: self.events.put(("log", message)),
                lambda current, total, word_path: self.events.put(
                    ("progress", current, total, word_path)
                ),
            )
            self.events.put(("done", None))
        except Exception as exc:
            self.events.put(("error", str(exc)))

    def process_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "log":
                    self.log(event[1])
                elif kind == "progress":
                    self.processed_count = event[1]
                    self.total_count = event[2]
                    self.remove_finished_file(event[3])
                    self.update_status()
                elif kind == "done":
                    self.log("全部轉換流程已結束。")
                    self.set_controls_enabled(True)
                elif kind == "error":
                    self.log(f"轉換流程中斷：{event[1]}")
                    self.set_controls_enabled(True)
                    messagebox.showerror("轉換失敗", event[1])
        except queue.Empty:
            pass
        self.root.after(100, self.process_events)

    def update_status(self):
        if self.worker and self.worker.is_alive():
            text = f"已處理: {self.processed_count}/{self.total_count}"
        else:
            text = f"已處理: {self.processed_count}/{self.total_count}    待處理: {len(self.files)}"
        self.status_label.configure(text=text)

    def set_controls_enabled(self, enabled):
        state = NORMAL if enabled else DISABLED
        self.select_file_button.configure(state=state)
        self.select_folder_button.configure(state=state)
        self.start_button.configure(state=state)

    def log(self, message):
        self.log_text.configure(state=NORMAL)
        self.log_text.insert(END, message + os.linesep)
        self.log_text.see(END)
        self.log_text.configure(state=DISABLED)


def main():
    root_class = TkinterDnD.Tk if TkinterDnD is not None else tk.Tk
    root = root_class()
    WordToPdfApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
