using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace VoiceCaptureLite.Controls;

/// <summary>Time-based, virtualized waveform. Only visible bars are drawn; no audio is modified.</summary>
public sealed class WaveformControl : FrameworkElement
{
    private static readonly Brush Back = Brush("#07111F"), Unplayed = Brush("#38BDF8"), Played = Brush("#F59E0B"),
        Muted = Brush("#506078"), White = Brush("#DBEAFE"), Shade = Brush("#A60A101B"), Accent = Brush("#7DD3FC");
    private static readonly Pen CursorPen = new(White, 2), BorderPen = new(Accent, 1.5);
    private IReadOnlyList<float> _peaks = Array.Empty<float>();
    private float _maximum = 1;
    private float[] _visiblePeaks = Array.Empty<float>();
    private double _cachedPlotWidth;
    private bool _barsDirty = true;
    private int _drag; // 1 seek, 2 left edge, 3 right edge, 4 ruler zoom
    private double _rulerViewStart, _rulerViewLength, _rulerStartX;
    public event EventHandler<double>? SeekRequested;
    public event EventHandler? SelectionChanged;
    public event EventHandler? ViewChanged;
    public double Duration { get; private set; }
    public double ViewStart { get; private set; }
    public double ViewLength { get; private set; } = 1;
    public double SelectionStart { get; private set; }
    public double SelectionEnd { get; private set; }
    public double Position { get; private set; }
    public bool IsTrimming { get; private set; }
    public bool Interacting => _drag != 0;
    public double Zoom => Duration > 0 ? Duration / ViewLength : 1;
    private double PlotWidth => Math.Max(1, ActualWidth - 24);
    private double PlotHeight => Math.Max(30, ActualHeight - 30);

    public WaveformControl() { Focusable = true; ClipToBounds = true; }
    private static SolidColorBrush Brush(string hex)
    {
        var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)); b.Freeze(); return b;
    }
    public void SetAudio(IReadOnlyList<float> peaks, double duration, bool resetView = true)
    {
        _peaks = peaks; Duration = Math.Max(0, duration);
        _barsDirty = true;
        _maximum = peaks.Count == 0 ? 1 : Math.Max(0.01f, peaks.Max());
        if (resetView)
        {
            Position = 0; IsTrimming = false; SelectionStart = 0; SelectionEnd = Duration;
            SetView(0, Math.Min(30, Duration));
        }
        else SetView(0, Duration);
        InvalidateVisual();
    }
    public void SetPosition(double seconds, bool follow = false)
    {
        double next = Math.Clamp(seconds, 0, Duration);
        bool changed = next != Position;
        Position = next;
        if (follow && !Interacting && (Position > ViewStart + ViewLength || Position < ViewStart))
            SetView(Position - ViewLength * 0.1, ViewLength);
        if (changed) InvalidateVisual();
    }
    public void SetSelection(double start, double end, bool trimming = true)
    {
        IsTrimming = trimming;
        SelectionStart = Math.Clamp(start, 0, Math.Max(0, Duration - 0.001));
        SelectionEnd = Math.Clamp(end, Math.Min(Duration, SelectionStart + 0.001), Duration);
        InvalidateVisual(); SelectionChanged?.Invoke(this, EventArgs.Empty);
    }
    public void SetView(double start, double length)
    {
        _barsDirty = true;
        ViewLength = Math.Clamp(length, Math.Min(5, Math.Max(0.001, Duration)), Math.Max(0.001, Duration));
        ViewStart = Math.Clamp(start, 0, Math.Max(0, Duration - ViewLength));
        InvalidateVisual(); ViewChanged?.Invoke(this, EventArgs.Empty);
    }
    public void Fit() => SetView(0, Duration);
    private double X(double time) => 12 + (time - ViewStart) / ViewLength * PlotWidth;
    private double Time(double x) => Math.Clamp(ViewStart + (x - 12) / PlotWidth * ViewLength, 0, Duration);

    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRoundedRectangle(Back, null, new Rect(0, 0, ActualWidth, ActualHeight), 9, 9);
        double middle = PlotHeight / 2;
        if (_peaks.Count == 0)
        {
            DrawText(dc, "錄製或匯入音檔後，即可預覽與裁切", 18, middle - 7, Muted, 13); return;
        }
        dc.PushClip(new RectangleGeometry(new Rect(12, 0, PlotWidth, PlotHeight)));
        int bars = Math.Max(1, (int)(PlotWidth / 5));
        CacheVisibleBars(bars);
        for (int i = 0; i < bars; i++)
        {
            double t0 = ViewStart + i * ViewLength / bars;
            double t1 = ViewStart + (i + 1) * ViewLength / bars;
            float peak = _visiblePeaks[i];
            double height = Math.Max(2, peak / _maximum * (PlotHeight - 26));
            double t = (t0 + t1) / 2;
            Brush brush = IsTrimming && (t < SelectionStart || t > SelectionEnd) ? Muted : t <= Position ? Played : Unplayed;
            dc.DrawRoundedRectangle(brush, null, new Rect(12 + i * PlotWidth / bars, middle - height / 2, 3, height), 1.5, 1.5);
        }
        if (IsTrimming)
        {
            double left = Math.Clamp(X(SelectionStart), 12, PlotWidth + 12), right = Math.Clamp(X(SelectionEnd), 12, PlotWidth + 12);
            dc.DrawRectangle(Shade, null, new Rect(12, 0, Math.Max(0, left - 12), PlotHeight));
            dc.DrawRectangle(Shade, null, new Rect(right, 0, Math.Max(0, PlotWidth + 12 - right), PlotHeight));
            dc.DrawRectangle(null, BorderPen, new Rect(left, 3, Math.Max(0, right - left), PlotHeight - 6));
        }
        if (Position >= ViewStart && Position <= ViewStart + ViewLength)
            dc.DrawLine(CursorPen, new Point(X(Position), 2), new Point(X(Position), PlotHeight - 2));
        dc.Pop();
        if (IsTrimming)
        {
            DrawHandle(dc, SelectionStart, middle); DrawHandle(dc, SelectionEnd, middle);
        }
        double rough = ViewLength / Math.Max(2, PlotWidth / 105);
        double power = Math.Pow(10, Math.Floor(Math.Log10(Math.Max(0.001, rough))));
        double step = new[] {1d, 2, 5, 10}.First(n => n * power >= rough) * power;
        for (double t = Math.Ceiling(ViewStart / step) * step; t <= ViewStart + ViewLength; t += step)
        {
            double x = X(t); if (x > ActualWidth - 50) break;
            DrawText(dc, Label(t, step < 1), x, PlotHeight + 5, Muted, 11);
        }
    }
    private void CacheVisibleBars(int bars)
    {
        if (!_barsDirty && _cachedPlotWidth == PlotWidth && _visiblePeaks.Length == bars) return;
        if (_visiblePeaks.Length != bars) _visiblePeaks = new float[bars];
        for (int i = 0; i < bars; i++)
        {
            double t0 = ViewStart + i * ViewLength / bars;
            double t1 = ViewStart + (i + 1) * ViewLength / bars;
            int first = Math.Clamp((int)(t0 / Math.Max(.001, Duration) * _peaks.Count), 0, _peaks.Count - 1);
            int last = Math.Clamp((int)Math.Ceiling(t1 / Math.Max(.001, Duration) * _peaks.Count), first + 1, _peaks.Count);
            float peak = 0;
            for (int p = first; p < last; p++) peak = Math.Max(peak, _peaks[p]);
            _visiblePeaks[i] = peak;
        }
        _cachedPlotWidth = PlotWidth; _barsDirty = false;
    }
    private void DrawHandle(DrawingContext dc, double time, double middle)
    {
        if (time < ViewStart - .0001 || time > ViewStart + ViewLength + .0001) return;
        double x = X(time);
        dc.DrawRoundedRectangle(Accent, null, new Rect(x - 5, middle - 19, 10, 38), 4, 4);
        dc.DrawLine(new Pen(Back, 1.5), new Point(x, middle - 8), new Point(x, middle + 8));
    }
    private void DrawText(DrawingContext dc, string text, double x, double y, Brush brush, double size)
    {
        dc.DrawText(new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight,
            new Typeface("Microsoft JhengHei UI"), size, brush, VisualTreeHelper.GetDpi(this).PixelsPerDip), new Point(x, y));
    }
    private static string Label(double seconds, bool precise) =>
        $"{(int)seconds / 60:00}:{seconds % 60:00}" + (precise ? $".{(int)(seconds * 10) % 10}" : "");
    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e)
    {
        if (!IsEnabled || Duration <= 0) return;
        Focus(); double x = e.GetPosition(this).X;
        if (e.GetPosition(this).Y >= PlotHeight)
        {
            if (e.ClickCount == 2) { Fit(); e.Handled = true; return; }
            BeginRulerZoom(x);
            CaptureMouse(); e.Handled = true; return;
        }
        double left = Math.Abs(x - X(SelectionStart)), right = Math.Abs(x - X(SelectionEnd));
        _drag = IsTrimming && Math.Min(left, right) <= 13 ? (left <= right ? 2 : 3) : 1;
        CaptureMouse(); Move(x); e.Handled = true;
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        double x = e.GetPosition(this).X;
        if (_drag != 0) Move(x);
        else Cursor = e.GetPosition(this).Y >= PlotHeight ||
            IsTrimming && Math.Min(Math.Abs(x - X(SelectionStart)), Math.Abs(x - X(SelectionEnd))) < 13 ? Cursors.SizeWE : Cursors.Hand;
    }
    private void Move(double x)
    {
        if (_drag == 4) MoveRulerZoom(x);
        else if (_drag == 1)
        {
            double t = Time(x); if (IsTrimming) t = Math.Clamp(t, SelectionStart, SelectionEnd);
            SetPosition(t); SeekRequested?.Invoke(this, t);
        }
        else
        {
            // Pan at an edge while dragging a boundary through a zoomed recording.
            if (x < 12) SetView(ViewStart - ViewLength * .02, ViewLength);
            if (x > ActualWidth - 12) SetView(ViewStart + ViewLength * .02, ViewLength);
            double t = Time(x);
            if (_drag == 2) SetSelection(Math.Min(t, SelectionEnd - .001), SelectionEnd);
            else if (_drag == 3) SetSelection(SelectionStart, Math.Max(t, SelectionStart + .001));
        }
    }
    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e)
    {
        _drag = 0; ReleaseMouseCapture(); InvalidateVisual();
    }
    internal void BeginRulerZoom(double x)
    {
        _drag = 4; _rulerStartX = x;
        _rulerViewStart = ViewStart; _rulerViewLength = ViewLength;
    }
    internal void MoveRulerZoom(double x)
    {
        // A rightward 160-DIP drag doubles the visible seconds, continuously.
        // Keep the original left edge until reaching the end of the recording.
        double scale = Math.Pow(2, Math.Clamp((x - _rulerStartX) / 160.0, -30, 30));
        SetView(_rulerViewStart, _rulerViewLength * scale);
    }
    protected override void OnLostMouseCapture(MouseEventArgs e) { _drag = 0; InvalidateVisual(); base.OnLostMouseCapture(e); }
    protected override void OnMouseWheel(MouseWheelEventArgs e)
    {
        if (Duration <= 0) return;
        if ((Keyboard.Modifiers & ModifierKeys.Control) != 0)
        {
            double anchor = Time(e.GetPosition(this).X);
            double fraction = (anchor - ViewStart) / ViewLength;
            double length = ViewLength * (e.Delta > 0 ? .8 : 1.25);
            SetView(anchor - length * fraction, length);
        }
        else SetView(ViewStart - Math.Sign(e.Delta) * ViewLength * .15, ViewLength);
        e.Handled = true;
    }
}
