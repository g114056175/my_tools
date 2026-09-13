using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace VoiceCaptureLite.Controls
{
    public sealed class ViewRangeChangedEventArgs : EventArgs
    {
        public ViewRangeChangedEventArgs(double start, double length)
        {
            Start = start;
            Length = length;
        }

        public double Start { get; }
        public double Length { get; }
    }

    public sealed class TimelineNavigator : FrameworkElement
    {
        private const double MinimumViewLength = 5.0;
        private const double TrackHorizontalInset = 8.0;
        private const double TrackHeight = 14.0;

        private double _duration;
        private double _viewStart;
        private double _viewLength;
        private InteractionMode _interaction;
        private double _dragAnchorTime;
        private double _dragStart;
        private double _dragLength;

        private enum InteractionMode
        {
            None,
            Pan,
            ResizeStart,
            ResizeEnd
        }

        public event EventHandler<ViewRangeChangedEventArgs>? RangeChanged;
        public event EventHandler? InteractionEnded;

        public double Duration => _duration;
        public double ViewStart => _viewStart;
        public double ViewLength => _viewLength;
        public bool Interacting => _interaction != InteractionMode.None;

        public TimelineNavigator()
        {
            Focusable = true;
            SnapsToDevicePixels = true;
            Cursor = Cursors.Arrow;
        }

        public void SetRange(double duration, double start, double length)
        {
            _duration = FiniteNonNegative(duration);
            NormalizeRange(start, length, out _viewStart, out _viewLength);
            InvalidateVisual();
            UpdateCursor(Mouse.DirectlyOver == this ? Mouse.GetPosition(this) : new Point(-1, -1));
        }

        protected override Size MeasureOverride(Size availableSize)
        {
            var width = double.IsInfinity(availableSize.Width) ? 160.0 : Math.Max(0.0, availableSize.Width);
            var height = double.IsInfinity(availableSize.Height) ? 22.0 : Math.Max(0.0, availableSize.Height);
            return new Size(width, Math.Max(22.0, height));
        }

        protected override void OnRender(DrawingContext drawingContext)
        {
            base.OnRender(drawingContext);
            drawingContext.DrawRectangle(Brushes.Transparent, null, new Rect(0, 0, ActualWidth, ActualHeight));

            var track = GetTrackRect();
            if (track.Width <= 0.0 || track.Height <= 0.0)
                return;

            drawingContext.DrawRoundedRectangle(
                new SolidColorBrush(Color.FromRgb(13, 35, 70)), null,
                track, 4.0, 4.0);

            var thumb = GetThumbRect(track);
            if (thumb.Width <= 0.0)
                return;

            drawingContext.DrawRoundedRectangle(
                new SolidColorBrush(Color.FromRgb(44, 119, 222)), null,
                thumb, 4.0, 4.0);

            // High-contrast edge grips remain visible without changing the proportional thumb width.
            var gripBrush = new SolidColorBrush(Color.FromRgb(235, 248, 255));
            if (thumb.Width < 12)
            {
                drawingContext.DrawRectangle(gripBrush, null, new Rect(thumb.Left, thumb.Top + 2,
                    thumb.Width, Math.Max(2, thumb.Height - 4)));
                return;
            }
            const double gripWidth = 2.0;
            const double gripInset = 3.0;
            drawingContext.DrawRoundedRectangle(
                gripBrush, null,
                new Rect(thumb.Left + gripInset, thumb.Top + 1.0, gripWidth, Math.Max(2.0, thumb.Height - 2.0)),
                1.0, 1.0);
            drawingContext.DrawRoundedRectangle(
                gripBrush, null,
                new Rect(thumb.Right - gripInset - gripWidth, thumb.Top + 1.0, gripWidth, Math.Max(2.0, thumb.Height - 2.0)),
                1.0, 1.0);
        }

        protected override void OnMouseDown(MouseButtonEventArgs e)
        {
            if (e.ChangedButton != MouseButton.Left)
                return;

            if (!IsEnabled || _duration <= 0) return;
            Focus();
            var point = e.GetPosition(this);
            BeginInteraction(point.X);
            CaptureMouse();
            UpdateCursor(point);
            e.Handled = true;
        }

        internal void BeginInteraction(double x)
        {
            var track = GetTrackRect();
            if (track.Width <= 0.0 || _duration <= 0)
                return;

            var thumb = GetThumbRect(track);
            var time = XToTime(x, track);
            _dragAnchorTime = time;
            _dragStart = _viewStart;
            _dragLength = _viewLength;

            if (thumb.Width > 0.0 && IsInResizeStartZone(x, thumb))
                _interaction = InteractionMode.ResizeStart;
            else if (thumb.Width > 0.0 && IsInResizeEndZone(x, thumb))
                _interaction = InteractionMode.ResizeEnd;
            else
            {
                // Clicking outside the thumb recenters it immediately, then starts a pan drag.
                _interaction = InteractionMode.Pan;
                if (thumb.Width <= 0.0 || x < thumb.Left || x > thumb.Right)
                    ApplyUserRange(time - _viewLength / 2.0, _viewLength);
                _dragStart = _viewStart;
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            var point = e.GetPosition(this);
            if (_interaction == InteractionMode.None)
            {
                UpdateCursor(point);
                return;
            }

            MoveInteraction(point.X);
            UpdateCursor(point);
            e.Handled = true;
        }

        internal void MoveInteraction(double x)
        {
            var track = GetTrackRect();
            if (track.Width <= 0.0)
                return;

            var time = XToTime(x, track);
            switch (_interaction)
            {
                case InteractionMode.Pan:
                    ApplyUserRange(_dragStart + time - _dragAnchorTime, _dragLength);
                    break;
                case InteractionMode.ResizeStart:
                    double end = _dragStart + _dragLength;
                    double start = Clamp(_dragStart + time - _dragAnchorTime, 0, end - Math.Min(MinimumViewLength, _duration));
                    ApplyUserRange(start, end - start);
                    break;
                case InteractionMode.ResizeEnd:
                    double right = Clamp(_dragStart + _dragLength + time - _dragAnchorTime,
                        _dragStart + Math.Min(MinimumViewLength, _duration), _duration);
                    ApplyUserRange(_dragStart, right - _dragStart);
                    break;
            }

        }

        protected override void OnMouseUp(MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left && _interaction != InteractionMode.None)
            {
                EndInteraction();
                ReleaseMouseCapture();
                UpdateCursor(e.GetPosition(this));
                InvalidateVisual();
                e.Handled = true;
            }
        }

        protected override void OnLostMouseCapture(MouseEventArgs e)
        {
            EndInteraction();
            UpdateCursor(Mouse.GetPosition(this));
            base.OnLostMouseCapture(e);
        }

        internal void EndInteraction()
        {
            if (_interaction == InteractionMode.None) return;
            _interaction = InteractionMode.None;
            InteractionEnded?.Invoke(this, EventArgs.Empty);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            var step = Math.Max(0.01, _duration * 0.01);
            if (e.Key == Key.Left)
            {
                ApplyUserRange(_viewStart - step, _viewLength);
                e.Handled = true;
            }
            else if (e.Key == Key.Right)
            {
                ApplyUserRange(_viewStart + step, _viewLength);
                e.Handled = true;
            }
            else if (e.Key == Key.Home)
            {
                ApplyUserRange(0.0, _viewLength);
                e.Handled = true;
            }
            else if (e.Key == Key.End)
            {
                ApplyUserRange(_duration - _viewLength, _viewLength);
                e.Handled = true;
            }
            base.OnKeyDown(e);
        }

        private Rect GetTrackRect()
        {
            var width = Math.Max(0.0, ActualWidth - TrackHorizontalInset * 2.0);
            var height = Math.Min(TrackHeight, Math.Max(2.0, ActualHeight));
            return new Rect(TrackHorizontalInset, Math.Max(0.0, (ActualHeight - height) / 2.0), width, height);
        }

        private Rect GetThumbRect(Rect track)
        {
            if (_duration <= 0.0)
                return new Rect(track.Left, track.Top, track.Width, track.Height);

            var width = track.Width * _viewLength / _duration;
            var left = track.Left + track.Width * _viewStart / _duration;
            return new Rect(left, track.Top, Math.Max(0.0, Math.Min(track.Width, width)), track.Height);
        }

        private bool IsInResizeStartZone(double x, Rect thumb)
        {
            var inside = Math.Min(7.0, thumb.Width / 3.0);
            return x >= thumb.Left - 7.0 && x <= thumb.Left + inside;
        }

        private bool IsInResizeEndZone(double x, Rect thumb)
        {
            var inside = Math.Min(7.0, thumb.Width / 3.0);
            return x >= thumb.Right - inside && x <= thumb.Right + 7.0 && !IsInResizeStartZone(x, thumb);
        }

        private double XToTime(double x, Rect track)
        {
            if (_duration <= 0.0 || track.Width <= 0.0)
                return 0.0;
            return Clamp((x - track.Left) / track.Width * _duration, 0.0, _duration);
        }

        private void ApplyUserRange(double start, double length)
        {
            var oldStart = _viewStart;
            var oldLength = _viewLength;
            NormalizeRange(start, length, out _viewStart, out _viewLength);
            InvalidateVisual();
            if (oldStart != _viewStart || oldLength != _viewLength)
                RangeChanged?.Invoke(this, new ViewRangeChangedEventArgs(_viewStart, _viewLength));
        }

        private void NormalizeRange(double start, double length, out double normalizedStart, out double normalizedLength)
        {
            start = FiniteNonNegative(start);
            length = FiniteNonNegative(length);
            if (_duration <= 0.0)
            {
                normalizedStart = 0.0;
                normalizedLength = 0.0;
                return;
            }

            normalizedLength = Math.Min(_duration, Math.Max(MinimumViewLength, length));
            normalizedStart = Clamp(start, 0.0, _duration - normalizedLength);
        }

        private void UpdateCursor(Point point)
        {
            if (_interaction == InteractionMode.Pan)
                Cursor = Cursors.SizeWE;
            else if (_interaction == InteractionMode.ResizeStart || _interaction == InteractionMode.ResizeEnd)
                Cursor = Cursors.SizeWE;
            else
            {
                var thumb = GetThumbRect(GetTrackRect());
                Cursor = thumb.Width > 0.0 && (IsInResizeStartZone(point.X, thumb) || IsInResizeEndZone(point.X, thumb))
                    ? Cursors.SizeWE : Cursors.Hand;
            }
        }

        private static double FiniteNonNegative(double value)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : Math.Max(0.0, value);
        }

        private static double Clamp(double value, double minimum, double maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }
    }
}
