using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Microsoft.Win32;
using VoiceCaptureLite.Audio;
using VoiceCaptureLite.Models;

namespace VoiceCaptureLite;

public partial class MainWindow : Window
{
    private readonly WasapiLoopbackCapture _capture = new();
    private readonly PcmPlayer _player = new();
    private readonly System.Windows.Threading.DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(20) };
    private readonly List<float> _livePeaks = new();
    private readonly System.Diagnostics.Stopwatch _recordClock = new();
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "VoiceCaptureLite", "capture.wav");
    private CancellationTokenSource? _cancellation;
    private Task<CaptureResult>? _recordTask;
    private WaveFileInfo? _wave;
    private bool _busy, _recording, _stopping, _ready, _closeAllowed, _closeRequested;
    private readonly Func<string, string, bool> _confirm;
    private readonly bool _supportsProcessCapture = WasapiLoopbackCapture.SupportsProcessCapture;
    private int _generation;
    private string _fileLabel = "錄音";
    private double Duration => _wave?.Duration.TotalSeconds ?? 0;
    private double RangeStart => Waveform.IsTrimming ? Waveform.SelectionStart : 0;
    private double RangeEnd => Waveform.IsTrimming ? Waveform.SelectionEnd : Duration;

    public MainWindow() : this(null) { }
    internal MainWindow(Func<string, string, bool>? confirmation)
    {
        InitializeComponent();
        _confirm = confirmation ?? ((title, message) => MessageBox.Show(this, message, title,
            MessageBoxButton.OKCancel, MessageBoxImage.Warning, MessageBoxResult.Cancel) == MessageBoxResult.OK);
        _ready = true;
        SourceCombo.SelectedIndex = 0;
        MinHeight = _supportsProcessCapture ? 560 : 500;
        if (!_supportsProcessCapture)
        {
            ProcessSourceItem.IsEnabled = false;
            SourceRow.Visibility = Visibility.Collapsed;
            SystemSourceDescription.Visibility = Visibility.Visible;
        }
        RefreshWindows(this, new RoutedEventArgs());
        Waveform.SeekRequested += (_, position) => SafePlayer(() => _player.Seek(position, RangeEnd));
        Waveform.SelectionChanged += (_, _) =>
        {
            if (_wave is null) return;
            SafePlayer(() => { _player.Pause(); _player.Seek(Math.Clamp(_player.Position, RangeStart, RangeEnd), RangeEnd); });
            UpdateSelection();
        };
        Waveform.ViewChanged += (_, _) => SyncView();
        Navigator.RangeChanged += (_, range) => Waveform.SetView(range.Start, range.Length);
        Navigator.InteractionEnded += (_, _) => SyncView();
        _timer.Tick += (_, _) => Tick();
        _timer.Start(); UpdateControls();
        Loaded += async (_, _) =>
        {
            TryDarkTitleBar();
            if (File.Exists(_temp))
            {
                try { await LoadWorkingAudio("上次工作音檔"); } catch { SetStatus("就緒"); }
            }
            string? file = Environment.GetCommandLineArgs().Skip(1).FirstOrDefault(File.Exists);
            if (file is not null) await ImportFile(file);
        };
    }
    private void TryDarkTitleBar()
    {
        try
        {
            int on = 1; nint hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            DwmSetWindowAttribute(hwnd, 20, ref on, 4);
            Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/Assets/Capture.ico"));
        }
        catch { /* Older Windows still displays the app icon from its executable. */ }
    }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);

    private void SourceChanged(object sender, SelectionChangedEventArgs e) { if (_ready) { RefreshWindows(sender, e); UpdateControls(); } }
    private void RefreshWindows(object sender, RoutedEventArgs e)
    {
        if (_recording || _busy || !_supportsProcessCapture) return;
        nint previous = (WindowCombo.SelectedItem as WindowInfo)?.Handle ?? 0;
        var windows = WindowInfo.Enumerate().Where(w => w.ProcessId != Environment.ProcessId).ToList();
        WindowCombo.ItemsSource = windows;
        WindowCombo.SelectedItem = SourceCombo.SelectedIndex == 1 ? windows.FirstOrDefault(w => w.Handle == previous) ?? windows.FirstOrDefault() : null;
    }
    private void UpdateControls()
    {
        if (!_ready) return;
        bool edit = !_busy && !_recording && _wave is not null && Duration > 0;
        RecordButton.IsEnabled = !_busy && !_stopping;
        RecordButton.Content = _recording ? "■  結束錄製" : "●  開始錄製";
        RecordButton.Background = ColorBrush(_recording ? "#A33745" : "#23835D");
        RecordButton.BorderBrush = ColorBrush(_recording ? "#EF7B87" : "#46BA8D");
        PauseRecordButton.IsEnabled = _recording && !_stopping;
        PauseRecordButton.Content = _capture.IsPaused ? "▶  繼續錄製" : "Ⅱ  暫停錄製";
        PauseRecordButton.Background = ColorBrush(!_recording ? "#1C2C40" : _capture.IsPaused ? "#23835D" : "#88591A");
        PauseRecordButton.BorderBrush = ColorBrush(!_recording ? "#30465E" : _capture.IsPaused ? "#46BA8D" : "#DFA849");
        SourceCombo.IsEnabled = RefreshButton.IsEnabled = !_busy && !_recording;
        WindowCombo.IsEnabled = !_busy && !_recording && SourceCombo.SelectedIndex == 1 && _supportsProcessCapture;
        ImportButton.IsEnabled = !_busy && !_recording;
        DeleteButton.IsEnabled = edit;
        PlayButton.IsEnabled = TrimButton.IsEnabled = CancelTrimButton.IsEnabled = ConfirmTrimButton.IsEnabled = edit;
        FormatCombo.IsEnabled = ExportButton.IsEnabled = edit;
        QualityCombo.IsEnabled = edit && FormatCombo.SelectedIndex == 1;
        Waveform.IsEnabled = FitButton.IsEnabled = SuggestedButton.IsEnabled = Navigator.IsEnabled = edit;
        SyncView();
        TrimStartBox.IsEnabled = TrimEndBox.IsEnabled = edit;
        UpdatePlayButton();
        bool trimming = Waveform.IsTrimming && _wave is not null;
        PlaybackRow.MinHeight = trimming ? 86 : 48;
        TrimButton.Visibility = trimming ? Visibility.Collapsed : Visibility.Visible;
        CancelTrimButton.Visibility = ConfirmTrimButton.Visibility = TrimDetails.Visibility =
            trimming ? Visibility.Visible : Visibility.Collapsed;
        ExportButton.Content = trimming ? "匯出選取片段  ↗" : "匯出音檔  ↗";
        if (_closeRequested && !_busy && !_recording && _recordTask is null && !_closeAllowed)
        {
            _closeAllowed = true; Dispatcher.BeginInvoke(new Action(Close));
        }
    }
    private static Brush ColorBrush(string hex) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
    private void SetStatus(string message) { StatusText.Text = message; StatusText.ToolTip = message; }
    private void Error(Exception ex) { SetStatus(ex.Message); MessageBox.Show(this, ex.Message, "聲音擷取", MessageBoxButton.OK, MessageBoxImage.Warning); }
    private bool ConfirmReplacement(string title, string action) =>
        (_wave is null && !File.Exists(_temp)) || _confirm(title,
            $"{action}會取代目前的工作音檔，未匯出的內容將無法復原。\n\n匯入的原始檔案不受影響。是否確定繼續？");
    private void SafePlayer(Action action)
    {
        try { action(); UpdatePlayback(); } catch (Exception ex) { _player.Close(); Error(ex); }
    }
    private async void RecordClicked(object sender, RoutedEventArgs e)
    {
        if (_recording)
        {
            _stopping = true; _cancellation?.Cancel(); SetStatus("正在完成錄音…"); UpdateControls(); return;
        }
        if (_busy) return;
        var target = WindowCombo.SelectedItem as WindowInfo;
        if (SourceCombo.SelectedIndex == 1 && (target is null || !_supportsProcessCapture))
        { SetStatus("此系統不支援指定視窗音訊，請選擇系統音訊。"); return; }
        if (!ConfirmReplacement("重新錄製", "開始新的錄製")) return;
        _player.Close(); _wave = null; _livePeaks.Clear(); _capture.IsPaused = false;
        Directory.CreateDirectory(Path.GetDirectoryName(_temp)!);
        Waveform.SetAudio(Array.Empty<float>(), 0); _recording = true; _stopping = false;
        _recordClock.Restart();
        _cancellation = new CancellationTokenSource(); int generation = ++_generation;
        var progress = new Progress<CaptureProgress>(p =>
        {
            if (!_recording || generation != _generation) return;
            _livePeaks.AddRange(p.Peaks);
            Waveform.SetAudio(_livePeaks, p.Duration.TotalSeconds, false);
            WaveMeta.Text = $"錄製中 · {p.Duration.TotalSeconds:0.0} 秒";
        });
        UpdateControls(); SetStatus("錄製中");
        try
        {
            var source = SourceCombo.SelectedIndex == 1 ? new CaptureSource(CaptureSourceKind.Process, target!.ProcessId) : new CaptureSource(CaptureSourceKind.System);
            _recordTask = _capture.CaptureAsync(source, _temp, progress, _cancellation.Token);
            await _recordTask;
            _recording = false;
            await LoadWorkingAudio("錄音");
            SetStatus("錄製完成");
        }
        catch (OperationCanceledException) { SetStatus("已取消啟動錄音"); }
        catch (Exception ex) { Error(ex); }
        finally
        {
            _recording = _stopping = false; _recordTask = null; _generation++;
            _recordClock.Stop();
            _cancellation.Dispose(); _cancellation = null; UpdateControls();
        }
    }
    private void PauseRecordClicked(object sender, RoutedEventArgs e)
    {
        if (!_recording) return;
        _capture.IsPaused = !_capture.IsPaused;
        if (_capture.IsPaused) _recordClock.Stop(); else _recordClock.Start();
        SetStatus(_capture.IsPaused ? "錄製已暫停 · 暫停期間的聲音不會寫入" : "錄製中");
        UpdateControls();
    }
    private async Task LoadWorkingAudio(string label)
    {
        _busy = true; UpdateControls();
        try
        {
            var result = await Task.Run(() => { var w = WaveFileInfo.Open(_temp); return (w, peaks: w.BuildPeaks()); });
            if (result.w.Frames == 0) throw new InvalidDataException("這次沒有收到音訊。");
            _wave = result.w; _fileLabel = label;
            _player.Open(_wave); Waveform.SetAudio(result.peaks, Duration);
            WaveMeta.Text = $"{label} · {Duration:0.00} 秒 · {_wave.SampleRate / 1000d:0.#} kHz";
            RecordingTimeText.Text = Time(Duration); UpdateSelection(); UpdatePlayback();
        }
        finally { _busy = false; UpdateControls(); }
    }
    private async void ImportClicked(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "音訊檔案|*.wav;*.mp3", Multiselect = false };
        if (dialog.ShowDialog(this) == true) await ImportFile(dialog.FileName);
    }
    private async Task ImportFile(string source)
    {
        if (_recording || _busy) return;
        string ext = Path.GetExtension(source).ToLowerInvariant();
        if (ext != ".mp3" && ext != ".wav") { SetStatus("請選擇 MP3 或 WAV 音檔。"); return; }
        if (Path.GetFullPath(source).Equals(Path.GetFullPath(_temp), StringComparison.OrdinalIgnoreCase)) return;
        if (!ConfirmReplacement("匯入音檔", "匯入新的音檔")) return;
        _busy = true; _player.Pause(); UpdateControls(); SetStatus("正在解碼音檔…");
        string pending = _temp + ".pending.wav";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_temp)!);
            await Task.Run(() => WindowsAudioCodec.Import(source, pending));
            var candidate = WaveFileInfo.Open(pending);
            if (candidate.Frames == 0) throw new InvalidDataException("音檔沒有可用的音訊資料。");
            _player.Close(); File.Move(pending, _temp, true);
            await LoadWorkingAudio(Path.GetFileName(source)); SetStatus("匯入完成");
        }
        catch (Exception ex) { Error(ex); }
        finally { if (File.Exists(pending)) File.Delete(pending); _busy = false; UpdateControls(); }
    }
    private void DeleteClicked(object sender, RoutedEventArgs e)
    {
        if (_busy || _recording) return;
        if (!_confirm("清除工作音檔", "確定清除目前的工作音檔？未匯出的內容將無法復原。\n\n只刪除本工具的暫存副本，匯入的原始檔案不受影響。")) return;
        _player.Close(); _wave = null; _generation++;
        if (File.Exists(_temp)) File.Delete(_temp);
        Waveform.SetAudio(Array.Empty<float>(), 0); WaveMeta.Text = "拖入 MP3 / WAV，或開始錄製";
        RecordingTimeText.Text = "00:00.00"; UpdateSelection(); UpdatePlayback(); UpdateControls(); SetStatus("工作音檔已清除");
    }
    private void PlayClicked(object sender, RoutedEventArgs e)
    {
        if (_wave is null || _busy || _recording) return;
        SafePlayer(() =>
        {
            if (_player.IsPlaying) _player.Pause();
            else
            {
                double start = _player.Position;
                if (start < RangeStart || start >= RangeEnd - .001) start = RangeStart;
                _player.Play(start, RangeEnd);
            }
        });
    }
    private void TrimClicked(object sender, RoutedEventArgs e)
    {
        if (_wave is null) return;
        _player.Pause(); Waveform.SetSelection(0, Duration); Waveform.Fit(); UpdateControls();
        SetStatus("拖曳波形左右把手調整範圍；播放只涵蓋選取部分。");
    }
    private void CancelTrimClicked(object sender, RoutedEventArgs e)
    {
        _player.Pause(); Waveform.SetSelection(0, Duration, false); UpdateControls(); SetStatus("已取消裁切選取");
    }
    private async void ConfirmTrimClicked(object sender, RoutedEventArgs e)
    {
        if (_wave is null || _busy || !Waveform.IsTrimming) return;
        double start = RangeStart, end = RangeEnd;
        if (!_confirm("確定裁切", $"保留 {Time(start)} 到 {Time(end)}，共 {end - start:0.00} 秒？\n\n確定後會取代工作音檔，框外內容將無法復原。匯入的原始檔案不受影響。\n若只想匯出選取部分，直接按「匯出選取片段」即可。")) return;
        _busy = true; _player.Close(); UpdateControls(); SetStatus("正在裁切…");
        string pending = _temp + ".pending.wav"; var wave = _wave;
        try
        {
            await Task.Run(() => wave.ExportTrim(start / Duration, end / Duration, pending));
            File.Move(pending, _temp, true); await LoadWorkingAudio(_fileLabel); SetStatus("裁切完成");
        }
        catch (Exception ex) { _player.Open(wave); Error(ex); }
        finally { if (File.Exists(pending)) File.Delete(pending); _busy = false; UpdateControls(); }
    }
    private void UpdateSelection()
    {
        if (!_ready) return;
        if (!TrimStartBox.IsKeyboardFocused) TrimStartBox.Text = RangeStart.ToString("0.00", CultureInfo.InvariantCulture);
        if (!TrimEndBox.IsKeyboardFocused) TrimEndBox.Text = RangeEnd.ToString("0.00", CultureInfo.InvariantCulture);
        SelectionText.Text = $"選取 {RangeEnd - RangeStart:0.00} 秒"; UpdateSize();
    }
    private void TrimTimeEdited(object sender, KeyboardFocusChangedEventArgs e) => ApplyTrimTimes();
    private void TrimTimeKey(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) { ApplyTrimTimes(); Keyboard.ClearFocus(); e.Handled = true; }
    }
    private void ApplyTrimTimes()
    {
        if (!Waveform.IsTrimming || _wave is null) return;
        if (double.TryParse(TrimStartBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out double start) &&
            double.TryParse(TrimEndBox.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out double end) &&
            double.IsFinite(start) && double.IsFinite(end) && start >= 0 && end > start && end <= Duration + .0005)
        { Waveform.SetSelection(start, Math.Min(Duration, end)); SetStatus("已更新裁切範圍"); }
        else { SetStatus("請輸入有效秒數：開始需早於結束，且不得超過音檔長度。"); }
    }
    private void FitClicked(object sender, RoutedEventArgs e) => Waveform.Fit();
    private void SuggestedClicked(object sender, RoutedEventArgs e) => Waveform.SetView(_player.Position, Math.Min(30, Duration));
    private void SyncView()
    {
        if (!_ready) return;
        Navigator.SetRange(Waveform.Duration, Waveform.ViewStart, Waveform.ViewLength);
        // Keep capture stable while an edge expands to full width; hide after mouse-up.
        Navigator.Visibility = !_recording && _wave is not null &&
            (Waveform.ViewLength < Waveform.Duration - .000001 || Navigator.Interacting) ? Visibility.Visible : Visibility.Collapsed;
        ViewSpanText.Text = _wave is null ? "" : $"顯示 {Waveform.ViewLength:0.##} 秒";
    }
    private void Tick()
    {
        if (_recording) { RecordingTimeText.Text = Time(_recordClock.Elapsed.TotalSeconds); return; }
        if (_wave is null || _busy || _recording) return;
        try { _player.Tick(); UpdatePlayback(); }
        catch (Exception ex) { _player.Close(); SetStatus(ex.Message); UpdateControls(); }
    }
    private void UpdatePlayback()
    {
        Waveform.SetPosition(_player.Position, _player.IsPlaying && !Navigator.Interacting);
        UpdatePlayButton();
        if (!Navigator.Interacting && Navigator.Visibility == Visibility.Visible && Waveform.Zoom <= 1.000001) SyncView();
        PlaybackTimeText.Text = $"{Time(_player.Position)} / {Time(Duration)}";
    }
    private void UpdatePlayButton()
    {
        bool playing = _player.IsPlaying;
        string text = playing ? "Ⅱ  暫停" : "▶  播放";
        if (Equals(PlayButton.Content, text) && PlayButton.Tag is bool previous && previous == playing) return;
        PlayButton.Content = text; PlayButton.Tag = playing;
        PlayButton.Background = ColorBrush(playing ? "#88591A" : "#18567C");
        PlayButton.BorderBrush = ColorBrush(playing ? "#DFA849" : "#3286B5");
    }
    private void FormatChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_ready) return;
        bool mp3 = FormatCombo.SelectedIndex == 1;
        QualityCombo.Visibility = mp3 ? Visibility.Visible : Visibility.Collapsed;
        WavQualityText.Visibility = mp3 ? Visibility.Collapsed : Visibility.Visible;
        UpdateSize(); UpdateControls();
    }
    private int Bitrate => QualityCombo.SelectedIndex switch { 2 => 320, 1 => 192, _ => 128 };
    private void UpdateSize()
    {
        double seconds = Math.Max(0, RangeEnd - RangeStart);
        double bytes = FormatCombo.SelectedIndex == 0 ? seconds * (_wave?.SampleRate ?? 44100) * (_wave?.FrameBytes ?? 4) + 44 : seconds * Bitrate * 125;
        SizeText.Text = _wave is null ? "" : $"約 {bytes / 1024 / 1024:0.00} MiB";
    }
    private async void ExportClicked(object sender, RoutedEventArgs e)
    {
        if (_wave is null || _busy || _recording) return;
        bool mp3 = FormatCombo.SelectedIndex != 0; int bitrate = Bitrate;
        var dialog = new SaveFileDialog { Filter = mp3 ? "MP3 音訊|*.mp3" : "WAV 音訊|*.wav", DefaultExt = mp3 ? ".mp3" : ".wav",
            AddExtension = true, InitialDirectory = Downloads(), FileName = $"capture_{DateTime.Now:yyyyMMdd_HHmmss}" };
        if (dialog.ShowDialog(this) != true) return;
        if (Path.GetFullPath(dialog.FileName).Equals(Path.GetFullPath(_temp), StringComparison.OrdinalIgnoreCase))
        { SetStatus("請另選匯出位置。"); return; }
        _busy = true; _player.Pause(); UpdateControls(); SetStatus("正在匯出…");
        var wave = _wave; double start = RangeStart / Duration, end = RangeEnd / Duration;
        string pending = Path.Combine(Path.GetDirectoryName(dialog.FileName)!, $".vcl-{Guid.NewGuid():N}" + (mp3 ? ".mp3" : ".wav"));
        try
        {
            await Task.Run(() => { if (mp3) WindowsAudioCodec.ExportMp3(wave, start, end, pending, bitrate); else wave.ExportTrim(start, end, pending); });
            File.Move(pending, dialog.FileName, true); SetStatus($"已匯出：{dialog.FileName}");
        }
        catch (Exception ex) { Error(ex); }
        finally { if (File.Exists(pending)) File.Delete(pending); _busy = false; UpdateControls(); }
    }
    private static string Downloads()
    {
        Guid id = new("374DE290-123F-4565-9164-39C4925E467B");
        if (SHGetKnownFolderPath(ref id, 0, 0, out nint path) == 0)
        { try { return Marshal.PtrToStringUni(path)!; } finally { Marshal.FreeCoTaskMem(path); } }
        return Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    }
    [DllImport("shell32.dll")] private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, nint token, out nint path);
    private void OnDragOver(object sender, DragEventArgs e)
    {
        e.Effects = !_busy && !_recording && e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None; e.Handled = true;
    }
    private async void OnDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } files) await ImportFile(files[0]);
    }
    private async void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.OriginalSource is TextBox) return;
        if (e.Key == Key.V && Keyboard.Modifiers == ModifierKeys.Control)
        {
            e.Handled = true;
            try
            {
                if (Clipboard.ContainsFileDropList()) { var files = Clipboard.GetFileDropList(); if (files.Count > 0 && files[0] is string f) await ImportFile(f); }
                else if (Clipboard.ContainsText()) { string path = Clipboard.GetText().Trim().Trim('"'); if (File.Exists(path)) await ImportFile(path); }
            }
            catch (Exception ex) { SetStatus(ex.Message); }
        }
        else if (e.Key == Key.Space) { PlayClicked(this, new RoutedEventArgs()); e.Handled = true; }
    }
    internal static string Time(double seconds, int decimals = 2)
    {
        seconds = Math.Round(Math.Max(0, seconds), decimals);
        string sec = (seconds % 60).ToString(decimals == 1 ? "00.0" : "00.00", CultureInfo.InvariantCulture);
        return $"{(int)seconds / 60:00}:{sec}";
    }
    protected override void OnClosing(CancelEventArgs e)
    {
        if (!_closeAllowed && (_recording || _busy))
        {
            e.Cancel = true;
            _closeRequested = true;
            if (_recording) { _cancellation?.Cancel(); _stopping = true; SetStatus("正在停止錄製；完成後會關閉。"); UpdateControls(); }
            else SetStatus("完成目前操作後會關閉。");
            return;
        }
        _closeAllowed = true; _timer.Stop(); _player.Dispose(); base.OnClosing(e);
    }
}
