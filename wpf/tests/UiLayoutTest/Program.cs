using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using VoiceCaptureLite;
using VoiceCaptureLite.Audio;
using VoiceCaptureLite.Controls;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        string root = Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "artifacts", "UiLayoutTest"));
        Directory.CreateDirectory(root);
        string fixture = Path.Combine(root, "preview-fixture.wav");
        using (var writer = new Pcm16WaveWriter(fixture, 44100, 2))
        {
            byte[] block = new byte[44100 * 4];
            for (int second = 0; second < 60; second++)
            {
                for (int i = 0; i < 44100; i++)
                {
                    double t = second + i / 44100d;
                    double amplitude = Math.Pow(Math.Max(0, Math.Sin(t * 5.7)), 2) * (0.2 + 0.8 * Math.Pow(Math.Sin(t * .9), 2));
                    short s = (short)(500 * amplitude * Math.Sin(t * 2 * Math.PI * 220));
                    block[i * 4] = block[i * 4 + 2] = (byte)s;
                    block[i * 4 + 1] = block[i * 4 + 3] = (byte)(s >> 8);
                }
                writer.Append(block, block.Length);
            }
        }
        var app = new App(); app.InitializeComponent();
        var confirmations = new List<string>();
        Func<string, string, bool> reject = (title, message) => { confirmations.Add(title); return false; };
        var window = (MainWindow)Activator.CreateInstance(typeof(MainWindow), BindingFlags.Instance | BindingFlags.NonPublic,
            null, new object[] { reject }, null)!; // no Show(): render in-process, never interact with the desktop
        var info = WaveFileInfo.Open(fixture);
        var player = (PcmPlayer)typeof(MainWindow).GetField("_player", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)!;
        typeof(MainWindow).GetField("_wave", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, info);
        player.Open(info);
        var wave = (WaveformControl)window.FindName("Waveform");
        wave.SetAudio(info.BuildPeaks(), info.Duration.TotalSeconds);
        ((TextBlock)window.FindName("WaveMeta")).Text = "範例音檔 · 60 秒 · 44.1 kHz";
        typeof(MainWindow).GetMethod("UpdateControls", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window, null);
        var rootElement = (FrameworkElement)window.Content;
        var navigator = (TimelineNavigator)window.FindName("Navigator");
        Assert(((FrameworkElement)window.FindName("SourceRow")).Visibility ==
            (WasapiLoopbackCapture.SupportsProcessCapture ? Visibility.Visible : Visibility.Collapsed), "capability source row");
        Assert(((FrameworkElement)window.FindName("SystemSourceDescription")).Visibility ==
            (WasapiLoopbackCapture.SupportsProcessCapture ? Visibility.Collapsed : Visibility.Visible), "system source description");
        Render(rootElement, 920, 485, Path.Combine(root, "ui-normal.png"));
        Assert(navigator.Visibility == Visibility.Visible, "long audio navigator visible");
        Click(window, "RecordButton"); Click(window, "DeleteButton");
        ((Task)Call(window, "ImportFile", fixture)!).GetAwaiter().GetResult();
        Assert(confirmations.SequenceEqual(new[] { "重新錄製", "清除工作音檔", "匯入音檔" }), "replacement confirmations");
        Assert(ReferenceEquals(typeof(MainWindow).GetField("_wave", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window), info), "cancel preserves working audio");
        Click(window, "PlayButton");
        string playingColor = ((SolidColorBrush)((Button)window.FindName("PlayButton")).Background).Color.ToString();
        Click(window, "PlayButton");
        Assert(playingColor != ((SolidColorBrush)((Button)window.FindName("PlayButton")).Background).Color.ToString(), "play/pause color differs");
        var format = (ComboBox)window.FindName("FormatCombo");
        var quality = (ComboBox)window.FindName("QualityCombo");
        Assert(format.Items.Count == 2 && quality.Items.Count == 3, "separate formats/quality");
        format.SelectedIndex = 1; quality.SelectedIndex = 2;
        Assert(quality.Visibility == Visibility.Visible && quality.IsEnabled, "MP3 quality enabled");
        Assert((int)typeof(MainWindow).GetProperty("Bitrate", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)! == 320, "quality bitrate");
        format.SelectedIndex = 0;
        Assert(quality.Visibility == Visibility.Collapsed, "WAV no fake quality");
        ((Button)window.FindName("TrimButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Click(window, "ConfirmTrimButton");
        Assert(confirmations.Last() == "確定裁切" && info.Duration.TotalSeconds == 60, "trim commit canceled");
        wave.SetSelection(4.25, 18.8); wave.SetPosition(9.5);
        wave.SetView(0, 30);
        ((TextBlock)window.FindName("PlaybackTimeText")).Text = "00:09.50 / 01:00.00";
        Assert(wave.IsTrimming && wave.SelectionStart == 4.25 && wave.SelectionEnd == 18.8, "trim bounds");
        Render(rootElement, 920, 485, Path.Combine(root, "ui-trim.png"));
        string selectedExport = Path.Combine(root, "selection-export.wav");
        double rangeStart = (double)typeof(MainWindow).GetProperty("RangeStart", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)!;
        double rangeEnd = (double)typeof(MainWindow).GetProperty("RangeEnd", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(window)!;
        info.ExportTrim(rangeStart / 60, rangeEnd / 60, selectedExport);
        Assert(Math.Abs(WaveFileInfo.Open(selectedExport).Duration.TotalSeconds - 14.55) < .0001 && info.Duration.TotalSeconds == 60, "trim export without commit");
        ((Button)window.FindName("CancelTrimButton")).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Assert(!wave.IsTrimming, "cancel");
        wave.Fit(); Assert(Math.Abs(wave.ViewLength - 60) < .001, "fit all");
        Assert(navigator.Visibility == Visibility.Collapsed, "fit hides navigator");
        Click(window, "SuggestedButton");
        Assert(Math.Abs(wave.ViewLength - 30) < .001, "suggested 30 seconds");
        rootElement.UpdateLayout();
        double X(double seconds) => 8 + seconds / 60 * (navigator.ActualWidth - 16);
        wave.SetView(0, 20);
        Call(navigator, "BeginInteraction", X(45.123)); Call(navigator, "EndInteraction");
        Assert(Math.Abs(wave.ViewStart - 35.123) < .000001, "track click fractional seek fires event immediately");
        wave.SetView(10, 20);
        Call(navigator, "BeginInteraction", X(20)); Call(navigator, "MoveInteraction", X(21.234)); Call(navigator, "EndInteraction");
        Assert(Math.Abs(wave.ViewStart - 11.234) < .000001 && wave.ViewLength == 20, "continuous pan");
        wave.SetView(10, 20);
        Call(navigator, "BeginInteraction", X(10)); Call(navigator, "MoveInteraction", X(15.125)); Call(navigator, "EndInteraction");
        Assert(Math.Abs(wave.ViewStart - 15.125) < .000001 && Math.Abs(wave.ViewStart + wave.ViewLength - 30) < .000001, "left resize anchors right");
        wave.SetView(10, 20);
        Call(navigator, "BeginInteraction", X(30)); Call(navigator, "MoveInteraction", X(35.875)); Call(navigator, "EndInteraction");
        Assert(wave.ViewStart == 10 && Math.Abs(wave.ViewLength - 25.875) < .000001, "right resize anchors left");
        wave.SetView(10, 20);
        Call(navigator, "BeginInteraction", X(10)); Call(navigator, "MoveInteraction", X(40)); Call(navigator, "EndInteraction");
        Assert(Math.Abs(wave.ViewLength - 5) < .000001 && Math.Abs(wave.ViewStart + wave.ViewLength - 30) < .000001, "no edge crossing, five-second minimum");
        wave.SetView(0, 30);
        Call(navigator, "BeginInteraction", X(30)); Call(navigator, "MoveInteraction", X(60));
        Assert(navigator.Visibility == Visibility.Visible, "full range keeps active drag");
        Call(navigator, "EndInteraction");
        Assert(navigator.Visibility == Visibility.Collapsed && wave.ViewLength == 60, "hide on drag end");
        var standalone = new TimelineNavigator(); standalone.Measure(new Size(816, 26)); standalone.Arrange(new Rect(0, 0, 816, 26));
        int events = 0; standalone.RangeChanged += (_, _) => events++;
        standalone.SetRange(60, 10, 30);
        var track = (Rect)Call(standalone, "GetTrackRect")!;
        var thumb = (Rect)Call(standalone, "GetThumbRect", track)!;
        Assert(Math.Abs(thumb.Width / track.Width - .5) < .000001 && events == 0, "proportional thumb, SetRange silent");
        standalone.SetRange(double.NaN, double.PositiveInfinity, double.NaN);
        Assert(standalone.Duration == 0 && standalone.ViewLength == 0, "invalid range safe");
        wave.SetView(1, 15);
        Call(wave, "BeginRulerZoom", 100d); Call(wave, "MoveRulerZoom", 260d);
        Assert(Math.Abs(wave.ViewLength - 30) < .000001 && wave.ViewStart == 1, "ruler right drag expands span with anchored left edge");
        Call(wave, "MoveRulerZoom", 180d);
        Assert(Math.Abs(wave.ViewLength - 15 * Math.Sqrt(2)) < .000001, "ruler scales continuously, no selection rectangle");
        Call(wave, "MoveRulerZoom", -2000d);
        Assert(wave.ViewLength == 5, "ruler left drag minimum five seconds");
        Call(wave, "MoveRulerZoom", 2000d);
        Assert(wave.ViewLength == 60 && wave.ViewStart == 0, "ruler maximum full recording");
        typeof(WaveformControl).GetField("_drag", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(wave, 0);
        var shortWave = new WaveformControl(); shortWave.SetAudio(new float[] { .2f }, 3);
        shortWave.SetView(0, .01); Assert(shortWave.ViewLength == 3, "under-five-second audio stays full");
        wave.SetView(0, 30);
        wave.SetSelection(0, 60);
        typeof(MainWindow).GetMethod("UpdateControls", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window, null);
        Render(rootElement, 804, 481, Path.Combine(root, "ui-minimum.png"));
        Render(rootElement, 700, 460, Path.Combine(root, "ui-compact.png"));
        ((FrameworkElement)window.FindName("SourceRow")).Visibility = Visibility.Visible;
        ((FrameworkElement)window.FindName("SystemSourceDescription")).Visibility = Visibility.Collapsed;
        format.SelectedIndex = 1;
        Render(rootElement, 804, 481, Path.Combine(root, "ui-source-layout.png")); // layout only, not an OS capability test
        Render(rootElement, 700, 520, Path.Combine(root, "ui-source-compact.png"));
        player.Close();
        window.Close(); app.Shutdown();
        Console.WriteLine("PASS: WPF layout, capability UI, confirmations cancel safely, play colors, split format/quality, trim-only export, fractional track clicks, pan/edge resize/clamps, proportional thumb and fit hiding. " + root);
    }
    static object? Call(object target, string method, params object[] args) => target.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(target, args);
    static void Click(MainWindow window, string name) => ((Button)window.FindName(name)).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    static void Assert(bool condition, string label) { if (!condition) throw new Exception(label); }
    static void Render(FrameworkElement element, double width, double height, string file)
    {
        element.Measure(new Size(width, height)); element.Arrange(new Rect(0, 0, width, height)); element.UpdateLayout();
        var image = new RenderTargetBitmap((int)width, (int)height, 96, 96, PixelFormats.Pbgra32);
        var background = new DrawingVisual();
        using (var dc = background.RenderOpen()) dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(12,20,32)), null, new Rect(0,0,width,height));
        image.Render(background);
        image.Render(element);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
        using var stream = File.Create(file); encoder.Save(stream);
    }
}
