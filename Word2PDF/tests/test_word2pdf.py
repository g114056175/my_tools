import importlib.util
import os
from pathlib import Path
import queue
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[1] / "word2pdf_gui.py"
spec = importlib.util.spec_from_file_location("word2pdf_gui", SOURCE)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.output = self.root / "output"
        self.output.mkdir()
        self.com = Mock()
        self.word = Mock()
        self.client = Mock()
        self.client.DispatchEx.return_value = self.word
        self.logs = []
        self.results = []
        self.documents = []

        def open_document(filename, **kwargs):
            document = Mock()
            document.ExportAsFixedFormat.side_effect = (
                lambda **options: Path(options["OutputFileName"]).write_bytes(
                    b"%PDF-1.4\n" + filename.encode("utf-8")
                )
            )
            self.documents.append(document)
            return document

        self.word.Documents.Open.side_effect = open_document
        self.addCleanup(patch.stopall)
        patch.object(app, "pythoncom", self.com).start()
        patch.object(app, "win32com", SimpleNamespace(client=self.client)).start()

    def source(self, relative):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return path

    def convert(self, files, overwrite=False, cancel_event=None, progress=None):
        return app.convert_files_to_pdf(
            files, self.output, overwrite, self.logs.append,
            progress or (lambda *result: self.results.append(result)), cancel_event,
        )

    def test_same_batch_names_remain_distinct_when_overwriting(self):
        old = self.output / "report.pdf"
        old.write_bytes(b"previous")
        protected = self.output / "report_1.pdf"
        protected.write_bytes(b"unrelated")
        self.convert([self.source("A/report.docx"), self.source("B/report.docx")], True)
        self.assertIn(b"A", old.read_bytes())
        self.assertIn(b"B", (self.output / "report_2.pdf").read_bytes())
        self.assertEqual(protected.read_bytes(), b"unrelated")
        self.assertTrue(all(result[3] for result in self.results))

    def test_doc_and_docx_with_same_stem_get_distinct_outputs(self):
        self.convert([self.source("report.doc"), self.source("report.docx")], True)
        self.assertTrue((self.output / "report.pdf").is_file())
        self.assertTrue((self.output / "report_1.pdf").is_file())

    def test_reserved_names_are_case_insensitive_even_before_files_exist(self):
        reserved = set()
        first = app.get_output_pdf_path(self.root / "Report.docx", self.output, True, reserved)
        second = app.get_output_pdf_path(self.root / "report.doc", self.output, True, reserved)
        self.assertNotEqual(app.path_key(first), app.path_key(second))
        self.assertEqual(second.name, "report_1.pdf")

    def test_no_overwrite_preserves_existing_pdf(self):
        target = self.output / "report.pdf"
        target.write_bytes(b"original")
        self.convert([self.source("report.docx")])
        self.assertEqual(target.read_bytes(), b"original")
        self.assertTrue((self.output / "report_1.pdf").is_file())

    def test_partial_export_does_not_replace_existing_pdf_or_leave_temp_file(self):
        target = self.output / "report.pdf"
        target.write_bytes(b"original")
        document = Mock()

        def fail_export(**options):
            Path(options["OutputFileName"]).write_bytes(b"partial")
            raise RuntimeError("export failed")

        document.ExportAsFixedFormat.side_effect = fail_export
        self.word.Documents.Open.side_effect = None
        self.word.Documents.Open.return_value = document
        self.convert([self.source("report.docx")], True)
        self.assertEqual(target.read_bytes(), b"original")
        self.assertEqual(list(self.output.iterdir()), [target])
        self.assertFalse(self.results[0][3])
        document.Close.assert_called_once_with(False)

    def test_empty_export_is_a_failure(self):
        document = Mock()
        self.word.Documents.Open.side_effect = None
        self.word.Documents.Open.return_value = document
        self.convert([self.source("empty.docx")])
        self.assertFalse(self.results[0][3])
        self.assertEqual(list(self.output.iterdir()), [])

    @unittest.skipUnless(os.name == "nt", "Windows rename must not replace a newly created file")
    def test_file_created_during_export_is_not_overwritten(self):
        target = self.output / "report.pdf"
        document = Mock()

        def concurrent_export(**options):
            Path(options["OutputFileName"]).write_bytes(b"new pdf")
            target.write_bytes(b"created by another process")

        document.ExportAsFixedFormat.side_effect = concurrent_export
        self.word.Documents.Open.side_effect = None
        self.word.Documents.Open.return_value = document
        self.convert([self.source("report.docx")])
        self.assertEqual(target.read_bytes(), b"created by another process")
        self.assertFalse(self.results[0][3])
        self.assertEqual(list(self.output.iterdir()), [target])

    def test_open_failure_does_not_skip_next_file(self):
        original_open = self.word.Documents.Open.side_effect

        def open_document(filename, **kwargs):
            if filename.endswith("broken.docx"):
                raise RuntimeError("invalid document")
            return original_open(filename, **kwargs)

        self.word.Documents.Open.side_effect = open_document
        self.convert([self.source("broken.docx"), self.source("valid.docx")])
        self.assertEqual([result[3] for result in self.results], [False, True])
        self.com.CoUninitialize.assert_called_once()
        self.word.Quit.assert_called_once()

    def test_output_directory_failure_reports_each_file(self):
        self.output.rmdir()
        self.output.write_bytes(b"not a directory")
        self.convert([self.source("first.docx"), self.source("second.docx")])
        self.assertEqual([result[3] for result in self.results], [False, False])
        self.word.Documents.Open.assert_not_called()

    def test_cancel_finishes_current_document_and_skips_remaining_documents(self):
        stop = threading.Event()

        def progress(*result):
            self.results.append(result)
            stop.set()

        stopped = self.convert(
            [self.source("first.docx"), self.source("second.docx")],
            cancel_event=stop, progress=progress,
        )
        self.assertTrue(stopped)
        self.assertEqual(len(self.results), 1)
        self.assertTrue(self.results[0][3])
        self.assertFalse((self.output / "second.pdf").exists())
        self.documents[0].Close.assert_called_once_with(False)
        self.word.Quit.assert_called_once()

    def test_cancel_before_start_does_not_launch_word(self):
        stop = threading.Event()
        stop.set()
        self.assertTrue(self.convert([self.source("report.docx")], cancel_event=stop))
        self.com.CoInitialize.assert_not_called()
        self.client.DispatchEx.assert_not_called()

    def test_missing_word_has_actionable_error_and_releases_com(self):
        self.client.DispatchEx.side_effect = RuntimeError("class not registered")
        with self.assertRaisesRegex(RuntimeError, "桌面版 Microsoft Word"):
            self.convert([self.source("report.docx")])
        self.com.CoUninitialize.assert_called_once()

    def test_close_failure_does_not_stop_batch_and_quit_failure_releases_com(self):
        original_open = self.word.Documents.Open.side_effect

        def open_document(filename, **kwargs):
            document = original_open(filename, **kwargs)
            document.Close.side_effect = RuntimeError("close failed")
            return document

        self.word.Documents.Open.side_effect = open_document
        self.word.Quit.side_effect = RuntimeError("quit failed")
        self.convert([self.source("first.docx"), self.source("second.docx")])
        self.assertEqual([result[3] for result in self.results], [True, True])
        self.com.CoUninitialize.assert_called_once()
        self.assertTrue(any("關閉文件失敗" in line for line in self.logs))
        self.assertTrue(any("關閉 Word 失敗" in line for line in self.logs))


class QueueLifecycleTests(unittest.TestCase):
    def make_app(self):
        instance = app.WordToPdfApp.__new__(app.WordToPdfApp)
        instance.root = Mock()
        instance.worker = Mock()
        instance.worker.is_alive.return_value = False
        instance.files = [Path("failed.docx"), Path("success.docx"), Path("pending.docx")]
        instance.file_list = Mock()
        instance.file_list.exists.return_value = True
        instance.events = queue.Queue()
        instance.cancel_event = threading.Event()
        instance.close_requested = False
        instance.batch_finished = False
        instance.batch_error = None
        instance.log = Mock()
        instance.update_status = Mock()
        instance.set_controls_enabled = Mock()
        instance.start_button = Mock()
        return instance

    def test_failed_and_unprocessed_files_stay_in_queue(self):
        instance = self.make_app()
        instance.events.put(("progress", 1, 3, Path("failed.docx"), False))
        instance.events.put(("progress", 2, 3, Path("success.docx"), True))
        instance.events.put(("done", True))
        instance.process_events()
        self.assertEqual(instance.files, [Path("failed.docx"), Path("pending.docx")])
        instance.file_list.delete.assert_called_once_with("success.docx")
        self.assertIsNone(instance.worker)

    def test_close_waits_for_worker_cleanup_after_done_event(self):
        instance = self.make_app()
        instance.close_requested = True
        instance.worker.is_alive.return_value = True
        instance.events.put(("done", True))
        instance.process_events()
        instance.root.destroy.assert_not_called()
        instance.worker.is_alive.return_value = False
        instance.process_events()
        instance.root.destroy.assert_called_once()
        instance.set_controls_enabled.assert_not_called()

    def test_close_can_be_declined_without_cancelling_batch(self):
        instance = self.make_app()
        with patch.object(app.messagebox, "askyesno", return_value=False):
            instance.on_close()
        self.assertFalse(instance.cancel_event.is_set())
        self.assertFalse(instance.close_requested)
        instance.root.destroy.assert_not_called()

    def test_confirmed_close_requests_cooperative_cancellation(self):
        instance = self.make_app()
        with patch.object(app.messagebox, "askyesno", return_value=True):
            instance.on_close()
        self.assertTrue(instance.cancel_event.is_set())
        self.assertTrue(instance.close_requested)
        instance.root.destroy.assert_not_called()

    def test_thread_start_failure_restores_controls_and_allows_close(self):
        instance = self.make_app()
        instance.worker = None
        instance.get_selected_output_folder = Mock(return_value=None)
        instance.overwrite_existing = Mock()
        instance.overwrite_existing.get.return_value = False
        failed_worker = Mock()
        failed_worker.start.side_effect = RuntimeError("cannot start new thread")
        with patch.object(app.threading, "Thread", return_value=failed_worker), patch.object(
            app.messagebox, "showerror"
        ) as show_error:
            instance.start_conversion()
        self.assertIsNone(instance.worker)
        self.assertEqual(len(instance.files), 3)
        instance.set_controls_enabled.assert_called_with(True)
        show_error.assert_called_once()
        instance.on_close()
        instance.root.destroy.assert_called_once()


if __name__ == "__main__":
    unittest.main()
