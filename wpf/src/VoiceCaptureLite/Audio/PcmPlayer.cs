using System.IO;
using System.Runtime.InteropServices;

namespace VoiceCaptureLite.Audio;

/// <summary>UI-thread-only PCM16 WAV player backed by winmm waveOut.</summary>
public sealed class PcmPlayer : IDisposable
{
    private const int BufferCount = 4;
    private const int BufferMilliseconds = 50;
    // Mmsystem.h: TIME_MS=0x0001, TIME_SAMPLES=0x0002, TIME_BYTES=0x0004.
    private const uint TimeMilliseconds = 0x0001;
    private const uint TimeSamples = 0x0002;
    private const uint TimeBytes = 0x0004;
    private const uint WhdrDone = 0x00000001;

    private readonly BufferSlot?[] _buffers = new BufferSlot?[BufferCount];
    private readonly Queue<BufferSlot> _queue = new();
    private WaveFileInfo? _info;
    private FileStream? _stream;
    private IntPtr _waveOut;
    private long _rangeStartFrame;
    private long _rangeEndFrame;
    private long _readFrame;
    private long _nativePositionSamples;
    private bool _hasRange;
    private bool _isPlaying;
    private bool _disposed;

    public bool IsPlaying => _isPlaying;

    public double Position => _info is null || _info.SampleRate <= 0
        ? 0
        : Math.Clamp((double)_rangeStartFrame / _info.SampleRate +
                     (double)_nativePositionSamples / _info.SampleRate, 0, _info.Duration.TotalSeconds);

    public void Open(WaveFileInfo info)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(info);
        if (info.BitsPerSample != 16 || info.Channels <= 0 || info.SampleRate <= 0)
            throw new ArgumentException("只支援有效的 PCM16 WAV。", nameof(info));

        Close();
        _info = info;
        _stream = new FileStream(info.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        var format = new WaveFormatEx
        {
            FormatTag = 1,
            Channels = (ushort)info.Channels,
            SamplesPerSec = (uint)info.SampleRate,
            BitsPerSample = 16,
            BlockAlign = (ushort)info.FrameBytes,
            AvgBytesPerSec = (uint)(info.SampleRate * info.FrameBytes),
            Size = 0
        };
        uint result = waveOutOpen(out _waveOut, 0xffffffff, ref format, IntPtr.Zero, IntPtr.Zero, 0);
        if (result != 0)
        {
            _stream.Dispose();
            _stream = null;
            _info = null;
            throw new InvalidOperationException($"waveOutOpen failed: {result}");
        }

        try
        {
            int framesPerBuffer = Math.Max(1, (int)Math.Ceiling(info.SampleRate * BufferMilliseconds / 1000.0));
            int bytesPerBuffer = checked(framesPerBuffer * (int)info.FrameBytes);
            for (int i = 0; i < BufferCount; i++)
            {
                var slot = new BufferSlot(bytesPerBuffer);
                slot.Header = new WaveHeader { Data = slot.Data, BufferLength = (uint)bytesPerBuffer, User = (UIntPtr)i };
                Marshal.StructureToPtr(slot.Header, slot.HeaderPtr, false);
                _buffers[i] = slot;
                Check(waveOutPrepareHeader(_waveOut, slot.HeaderPtr, (uint)Marshal.SizeOf<WaveHeader>()));
                slot.Prepared = true;
            }
        }
        catch
        {
            Close();
            throw;
        }
    }

    public void Play(double startSeconds, double endSeconds)
    {
        ThrowIfDisposed();
        EnsureOpen();
        ValidateRange(startSeconds, endSeconds, false);
        long start = SecondsToFrame(startSeconds);
        long end = SecondsToFrame(endSeconds);
        bool sameRange = _hasRange && start == _rangeStartFrame && end == _rangeEndFrame;
        if (!sameRange || _nativePositionSamples >= _rangeEndFrame - _rangeStartFrame)
            ResetTo(start, end);
        if (!_isPlaying)
        {
            Check(waveOutRestart(_waveOut));
            _isPlaying = true;
            Tick();
        }
    }

    public void Pause()
    {
        ThrowIfDisposed();
        if (_waveOut == IntPtr.Zero || !_isPlaying) return;
        UpdatePosition();
        Check(waveOutPause(_waveOut));
        _isPlaying = false;
    }

    public void Seek(double seconds, double endSeconds)
    {
        ThrowIfDisposed();
        EnsureOpen();
        ValidateRange(seconds, endSeconds, true);
        bool wasPlaying = _isPlaying;
        ResetTo(SecondsToFrame(seconds), SecondsToFrame(endSeconds));
        if (wasPlaying)
        {
            Check(waveOutRestart(_waveOut));
            _isPlaying = true;
            Tick();
        }
    }

    public void Tick()
    {
        ThrowIfDisposed();
        if (_waveOut == IntPtr.Zero || !_hasRange) return;
        UpdatePosition();
        int readyBudget = _queue.Count;
        while (readyBudget-- > 0 && _queue.Count > 0 && IsDone(_queue.Peek()))
        {
            var slot = _queue.Dequeue();
            slot.Queued = false;
            Fill(slot);
        }
        if (_isPlaying && _readFrame >= _rangeEndFrame && !AnyQueued())
        {
            _nativePositionSamples = _rangeEndFrame - _rangeStartFrame;
            _isPlaying = false;
        }
    }

    public void Close()
    {
        if (_waveOut != IntPtr.Zero)
        {
            waveOutPause(_waveOut);
            waveOutReset(_waveOut);
        }
        for (int i = 0; i < _buffers.Length; i++)
        {
            var slot = _buffers[i];
            if (slot is null) continue;
            if (_waveOut != IntPtr.Zero)
            {
                if (slot.Prepared) waveOutUnprepareHeader(_waveOut, slot.HeaderPtr, (uint)Marshal.SizeOf<WaveHeader>());
            }
            slot.Dispose();
            _buffers[i] = null;
        }
        if (_waveOut != IntPtr.Zero)
        {
            waveOutClose(_waveOut);
        }
        _waveOut = IntPtr.Zero;
        _queue.Clear();
        _stream?.Dispose();
        _stream = null;
        _info = null;
        _hasRange = false;
        _isPlaying = false;
        _nativePositionSamples = 0;
    }

    public void Dispose()
    {
        if (_disposed) return;
        Close();
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private void ResetTo(long start, long end)
    {
        if (_waveOut != IntPtr.Zero)
        {
            Check(waveOutReset(_waveOut));
            Check(waveOutPause(_waveOut));
        }
        _isPlaying = false;
        _rangeStartFrame = start;
        _rangeEndFrame = end;
        _readFrame = start;
        _nativePositionSamples = 0;
        _hasRange = true;
        _queue.Clear();
        _stream!.Position = _info!.DataOffset + start * _info.FrameBytes;
        foreach (var slot in _buffers)
        {
            if (slot is null) continue;
            slot.Queued = false;
            Fill(slot);
        }
    }

    private void Fill(BufferSlot slot)
    {
        if (_readFrame >= _rangeEndFrame) return;
        long wantedFrames = Math.Min(_rangeEndFrame - _readFrame, slot.CapacityBytes / _info!.FrameBytes);
        int wantedBytes = checked((int)(wantedFrames * _info.FrameBytes));
        int read = 0;
        while (read < wantedBytes)
        {
            int n = _stream!.Read(slot.ManagedData, read, wantedBytes - read);
            if (n <= 0) throw new EndOfStreamException("WAV 資料在播放期間變更。");
            read += n;
        }
        Marshal.Copy(slot.ManagedData, 0, slot.Data, read);
        slot.Header.BufferLength = (uint)read;
        // Do not marshal the whole header after prepare: that would erase WHDR_PREPARED.
        Marshal.WriteInt32(slot.HeaderPtr, IntPtr.Size, read);
        int flagsOffset = IntPtr.Size + 8 + IntPtr.Size;
        Marshal.WriteInt32(slot.HeaderPtr, flagsOffset, Marshal.ReadInt32(slot.HeaderPtr, flagsOffset) & unchecked((int)~WhdrDone));
        Check(waveOutWrite(_waveOut, slot.HeaderPtr, (uint)Marshal.SizeOf<WaveHeader>()));
        slot.Queued = true;
        _queue.Enqueue(slot);
        _readFrame += read / _info.FrameBytes;
    }

    private void UpdatePosition()
    {
        if (_waveOut == IntPtr.Zero || !_hasRange) return;
        var time = new MmTime { Type = TimeSamples };
        uint result = waveOutGetPosition(_waveOut, ref time, (uint)Marshal.SizeOf<MmTime>());
        if (result != 0) return;
        long samples = time.Type switch
        {
            TimeSamples => time.Samples,
            TimeBytes => (long)time.Bytes / _info!.FrameBytes,
            TimeMilliseconds => (long)Math.Round(time.Milliseconds * _info!.SampleRate / 1000.0),
            _ => -1
        };
        if (samples >= 0)
            _nativePositionSamples = Math.Clamp(samples, 0, _rangeEndFrame - _rangeStartFrame);
    }

    private bool AnyQueued() => _buffers.Any(b => b is not null && b.Queued);
    private long SecondsToFrame(double seconds) => (long)Math.Clamp(Math.Round(seconds * _info!.SampleRate), 0, _info.Frames);
    private void ValidateRange(double start, double end, bool allowEqual)
    {
        if (!double.IsFinite(start) || !double.IsFinite(end) || start < 0 || end < start || end > _info!.Duration.TotalSeconds)
            throw new ArgumentOutOfRangeException(nameof(end), "播放區間必須位於 WAV 範圍內且 endSeconds > startSeconds。");
        if (end == start && !allowEqual) throw new ArgumentOutOfRangeException(nameof(end), "播放區間不可為零長度。");
    }
    private void EnsureOpen() { if (_waveOut == IntPtr.Zero || _info is null) throw new InvalidOperationException("尚未 Open WAV。"); }
    private void ThrowIfDisposed() { if (_disposed) throw new ObjectDisposedException(nameof(PcmPlayer)); }
    private static void Check(uint result) { if (result != 0) throw new InvalidOperationException($"winmm waveOut error: {result}"); }

    private static bool IsDone(BufferSlot slot)
    {
        int flagsOffset = IntPtr.Size + 8 + IntPtr.Size;
        return (Marshal.ReadInt32(slot.HeaderPtr, flagsOffset) & (int)WhdrDone) != 0;
    }

    private sealed class BufferSlot : IDisposable
    {
        public readonly IntPtr Data;
        public readonly byte[] ManagedData;
        public readonly int CapacityBytes;
        public IntPtr HeaderPtr;
        public WaveHeader Header;
        public bool Prepared;
        public bool Queued;
        public BufferSlot(int capacityBytes) { CapacityBytes = capacityBytes; ManagedData = new byte[capacityBytes]; Data = Marshal.AllocHGlobal(capacityBytes); HeaderPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WaveHeader>()); }
        public void Dispose() { Marshal.FreeHGlobal(Data); Marshal.FreeHGlobal(HeaderPtr); HeaderPtr = IntPtr.Zero; }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)] private struct WaveFormatEx { public ushort FormatTag, Channels; public uint SamplesPerSec, AvgBytesPerSec; public ushort BlockAlign, BitsPerSample, Size; }
    [StructLayout(LayoutKind.Sequential)] private struct WaveHeader
    {
        public IntPtr Data;
        public uint BufferLength, BytesRecorded;
        public UIntPtr User;
        public uint Flags, Loops;
        public IntPtr Next;
        public UIntPtr Reserved;
    }
    [StructLayout(LayoutKind.Explicit, Size = 12)] private struct MmTime
    {
        [FieldOffset(0)] public uint Type;
        [FieldOffset(4)] public uint Milliseconds;
        [FieldOffset(4)] public uint Bytes;
        [FieldOffset(4)] public uint Samples;
    }

    [DllImport("winmm.dll")] private static extern uint waveOutOpen(out IntPtr handle, uint deviceId, ref WaveFormatEx format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] private static extern uint waveOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutWrite(IntPtr handle, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern uint waveOutPause(IntPtr handle);
    [DllImport("winmm.dll")] private static extern uint waveOutRestart(IntPtr handle);
    [DllImport("winmm.dll")] private static extern uint waveOutReset(IntPtr handle);
    [DllImport("winmm.dll")] private static extern uint waveOutClose(IntPtr handle);
    [DllImport("winmm.dll")] private static extern uint waveOutGetPosition(IntPtr handle, ref MmTime time, uint size);
}
