using System.Runtime.InteropServices;
using System.ComponentModel;

namespace VoiceCaptureLite.Audio;

public enum CaptureSourceKind
{
    System,
    Process
}

public sealed record CaptureSource(CaptureSourceKind Kind, uint ProcessId = 0);
public sealed record CaptureProgress(TimeSpan Duration, IReadOnlyList<float> Peaks);
public sealed record CaptureResult(string Path, TimeSpan Duration);

/// <summary>
/// Minimal WASAPI loopback recorder. It keeps a supported device mix format, falling
/// back to 44.1 kHz / 16-bit PCM only when the mix format cannot be consumed directly.
/// No microphone permission and no third-party audio package are required.
/// </summary>
public sealed class WasapiLoopbackCapture
{
    private const int FallbackSampleRate = 44100;
    private const short FallbackChannels = 2;
    private const int ProcessLoopbackMinimumBuild = 20348;
    private const int ProgressIntervalMs = 100;
    private const int PeakBucketMs = 20;
    private static readonly TimeSpan MaxActiveRecordingDuration = TimeSpan.FromHours(2);
    private int _paused;

    /// <summary>When true, incoming audio is consumed but omitted from the WAV and duration.</summary>
    public bool IsPaused
    {
        get => Volatile.Read(ref _paused) != 0;
        set => Interlocked.Exchange(ref _paused, value ? 1 : 0);
    }

    /// <summary>Whether process loopback activation is available on this Windows build.</summary>
    public static bool SupportsProcessCapture => GetWindowsBuildNumber() >= ProcessLoopbackMinimumBuild;

    public Task<CaptureResult> CaptureAsync(
        CaptureSource source,
        string outputPath,
        IProgress<CaptureProgress>? progress,
        CancellationToken cancellationToken)
    {
        return Task.Run(() => Capture(source, outputPath, progress, cancellationToken), cancellationToken);
    }

    private CaptureResult Capture(
        CaptureSource source,
        string outputPath,
        IProgress<CaptureProgress>? progress,
        CancellationToken cancellationToken)
    {
        int comHr = Native.CoInitializeEx(IntPtr.Zero, Native.COINIT_MULTITHREADED);
        bool comInitialized = comHr >= 0;
        try
        {
            if (comHr < 0 && comHr != Native.RPC_E_CHANGED_MODE)
                Marshal.ThrowExceptionForHR(comHr);

            return source.Kind == CaptureSourceKind.Process
                ? CaptureProcess(source.ProcessId, outputPath, progress, cancellationToken)
                : CaptureSystem(outputPath, progress, cancellationToken);
        }
        finally
        {
            if (comInitialized) Native.CoUninitialize();
        }
    }

    private CaptureResult CaptureSystem(
        string outputPath,
        IProgress<CaptureProgress>? progress,
        CancellationToken cancellationToken)
    {
        var enumerator = (Native.IMMDeviceEnumerator)new Native.MMDeviceEnumerator();
        Native.IMMDevice? device = null;
        object? clientObject = null;
        try
        {
            enumerator.GetDefaultAudioEndpoint(Native.EDataFlow.eRender, Native.ERole.eConsole, out device).ThrowIfFailed("找不到預設播放裝置");
            device.Activate(Native.IID_IAudioClient, Native.CLSCTX_ALL, IntPtr.Zero, out clientObject).ThrowIfFailed("無法開啟播放裝置");
            return CaptureClient((Native.IAudioClient)clientObject, CaptureSourceKind.System, outputPath, progress, cancellationToken);
        }
        finally
        {
            // CaptureClient owns and releases the activated IAudioClient.
            ReleaseCom(device);
            ReleaseCom(enumerator);
        }
    }

    private CaptureResult CaptureProcess(
        uint processId,
        string outputPath,
        IProgress<CaptureProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (!SupportsProcessCapture)
            throw new NotSupportedException("指定視窗擷取需要 Windows 10 build 20348 或更新版本；請改用整台電腦模式。");

        Native.IAudioClient client = ActivateProcessLoopback(processId, cancellationToken);
        return CaptureClient(client, CaptureSourceKind.Process, outputPath, progress, cancellationToken);
    }

    private static Native.IAudioClient ActivateProcessLoopback(uint processId, CancellationToken cancellationToken)
    {
        var activation = new Native.AudioClientActivationParams
        {
            ActivationType = Native.AudioClientActivationType.ProcessLoopback,
            ProcessLoopbackParams = new Native.AudioClientProcessLoopbackParams
            {
                TargetProcessId = processId,
                ProcessLoopbackMode = Native.ProcessLoopbackMode.IncludeTargetProcessTree
            }
        };

        int activationSize = Marshal.SizeOf<Native.AudioClientActivationParams>();
        var request = new ActivationRequest(activation, activationSize);
        Guid iid = Native.IID_IAudioClient;
        int hr = Native.ActivateAudioInterfaceAsync(
            Native.VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            ref iid,
            request.PropVariantPtr,
            request.Completion,
            out _);
        if (hr < 0)
        {
            request.Dispose();
            hr.ThrowIfFailed("無法啟用指定程序的音訊擷取");
        }

        // Do not wait forever if the OS never calls the completion handler. The request
        // owns the native payload until the callback, so cancellation cannot create a
        // use-after-free in the async activation path.
        return request.Wait(cancellationToken);
    }

    private CaptureResult CaptureClient(
        Native.IAudioClient client,
        CaptureSourceKind sourceKind,
        string outputPath,
        IProgress<CaptureProgress>? progress,
        CancellationToken cancellationToken)
    {
        var fallback = new Native.WaveFormatEx
        {
            FormatTag = 1,
            Channels = (ushort)FallbackChannels,
            SamplesPerSecond = FallbackSampleRate,
            BitsPerSample = 16,
            BlockAlign = FallbackChannels * 2,
            AverageBytesPerSecond = FallbackSampleRate * FallbackChannels * 2,
            ExtraSize = 0
        };

        IntPtr mixPtr = IntPtr.Zero;
        Native.WaveFormatEx format = fallback;
        bool nativePcm16 = false;
        if (client.GetMixFormat(out mixPtr) >= 0 && mixPtr != IntPtr.Zero &&
            TryReadNativePcm16(mixPtr, out var nativeFormat))
        {
            format = nativeFormat;
            nativePcm16 = true;
        }
        int sampleRate = format.SamplesPerSecond;
        short channels = (short)format.Channels;
        IntPtr formatPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Native.WaveFormatEx>());
        IntPtr eventHandle = IntPtr.Zero;
        object? captureObject = null;
        try
        {
            Marshal.StructureToPtr(format, formatPtr, false);
            var flags = Native.AudioClientStreamFlags.Loopback |
                        Native.AudioClientStreamFlags.EventCallback;
            if (!nativePcm16 && sourceKind == CaptureSourceKind.System)
                flags |= Native.AudioClientStreamFlags.AutoConvertPcm | Native.AudioClientStreamFlags.SrcDefaultQuality;
            client.Initialize(Native.AudioClientShareMode.Shared, flags, 10_000_000, 0, formatPtr, IntPtr.Zero)
                .ThrowIfFailed("無法初始化 WASAPI 音訊串流");
            client.GetBufferSize(out _).ThrowIfFailed("無法取得音訊緩衝區");
            client.GetService(Native.IID_IAudioCaptureClient, out captureObject)
                .ThrowIfFailed("無法取得音訊擷取服務");
            var capture = (Native.IAudioCaptureClient)captureObject;

            eventHandle = Native.CreateEvent(IntPtr.Zero, false, false, null);
            if (eventHandle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            client.SetEventHandle(eventHandle).ThrowIfFailed("無法設定音訊事件");

            using var writer = new Pcm16WaveWriter(outputPath, sampleRate, channels);
            long totalFrames = 0;
            long nextProgressFrame = 0;
            int peakBucketFrames = Math.Max(1, sampleRate * PeakBucketMs / 1000);
            long maxFrames = (long)(sampleRate * MaxActiveRecordingDuration.TotalSeconds);
            var pendingPeaks = new List<float>(5);
            int peakFrames = 0;
            float peakValue = 0;
            bool captureStarted = false;
            long captureStartQpc100ns = GetQpc100ns();
            long pausedQpc100ns = 0;
            long pauseStartedQpc100ns = IsPaused ? captureStartQpc100ns : 0;
            bool pauseState = IsPaused;
            ulong lastDeviceEnd = 0;
            bool haveDevicePosition = false;
            bool haveFirstPacket = false;
            bool resumePending = false;
            cancellationToken.ThrowIfCancellationRequested();
            client.Start().ThrowIfFailed("無法開始擷取");
            captureStarted = true;

            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    bool wasPaused = pauseState;
                    UpdatePauseTimeline(ref pauseState, ref pauseStartedQpc100ns, ref pausedQpc100ns, IsPaused, GetQpc100ns());
                    if (wasPaused && !pauseState) resumePending = true;
                    Native.WaitForSingleObject(eventHandle, 100);
                    wasPaused = pauseState;
                    UpdatePauseTimeline(ref pauseState, ref pauseStartedQpc100ns, ref pausedQpc100ns, IsPaused, GetQpc100ns());
                    if (wasPaused && !pauseState) resumePending = true;
                    // Once Start succeeded, cancellation means a normal user stop.
                    // Drain no more data, finalize the WAV below, and return its result.
                    long activeFramesNow = QpcFramesSinceStart(GetQpc100ns(), captureStartQpc100ns,
                        EffectivePausedQpc(pauseState, pauseStartedQpc100ns, pausedQpc100ns, GetQpc100ns()), sampleRate);
                    if (activeFramesNow >= maxFrames)
                        break;
                    capture.GetNextPacketSize(out uint packetFrames).ThrowIfFailed("讀取音訊封包失敗");
                    while (packetFrames > 0)
                    {
                        capture.GetBuffer(out IntPtr data, out uint frames, out Native.AudioClientBufferFlags bufferFlags, out ulong devicePosition, out ulong qpcPosition)
                            .ThrowIfFailed("取得音訊資料失敗");
                        try
                        {
                            bool silent = (bufferFlags & Native.AudioClientBufferFlags.Silent) != 0;
                            if (!IsPaused)
                            {
                                bool validPosition = (bufferFlags & Native.AudioClientBufferFlags.TimestampError) == 0;
                                bool newSegment = !haveFirstPacket || resumePending;
                                int skipFrames = 0;
                                if (newSegment)
                                {
                                    if (qpcPosition != 0 && validPosition)
                                    {
                                        long target = Math.Min(maxFrames, QpcFramesSinceStart(qpcPosition, captureStartQpc100ns, pausedQpc100ns, sampleRate));
                                        if (target > totalFrames)
                                        {
                                            long fill = target - totalFrames;
                                            AppendSilenceFrames(writer, fill, pendingPeaks, peakBucketFrames, ref peakFrames, ref peakValue, sampleRate);
                                            totalFrames += fill;
                                        }
                                    }
                                    haveFirstPacket = true; resumePending = false; haveDevicePosition = validPosition;
                                }
                                else if (validPosition && haveDevicePosition)
                                {
                                    if (devicePosition > lastDeviceEnd)
                                    {
                                        long fill = (long)Math.Min(devicePosition - lastDeviceEnd, (ulong)Math.Max(0, maxFrames - totalFrames));
                                        AppendSilenceFrames(writer, fill, pendingPeaks, peakBucketFrames, ref peakFrames, ref peakValue, sampleRate);
                                        totalFrames += fill;
                                    }
                                    else if (devicePosition < lastDeviceEnd)
                                        skipFrames = (int)Math.Min((ulong)frames, lastDeviceEnd - devicePosition);
                                }
                                else haveDevicePosition = validPosition;
                                if (validPosition) lastDeviceEnd = newSegment ? devicePosition + frames : Math.Max(lastDeviceEnd, devicePosition + frames);
                                int framesToWrite = checked((int)frames - skipFrames);
                                framesToWrite = (int)Math.Min((long)framesToWrite, Math.Max(0, maxFrames - totalFrames));
                                if (framesToWrite > 0)
                                {
                                    byte[] outputPcm = silent ? Array.Empty<byte>() : CopyBuffer(data + skipFrames * format.BlockAlign, checked(framesToWrite));
                                    if (silent) writer.AppendSilence(framesToWrite); else writer.Append(outputPcm, outputPcm.Length);
                                    totalFrames += framesToWrite;
                                    if (silent) AppendUniformSilencePeaks(pendingPeaks, framesToWrite, peakBucketFrames, ref peakFrames, ref peakValue);
                                    else AppendUniformPeaks(pendingPeaks, outputPcm, (uint)framesToWrite, channels, peakBucketFrames, ref peakFrames, ref peakValue);
                                }
                                if (progress is not null && totalFrames >= nextProgressFrame)
                                {
                                    progress.Report(new CaptureProgress(
                                        TimeSpan.FromSeconds((double)totalFrames / sampleRate),
                                        pendingPeaks.ToArray()));
                                    pendingPeaks.Clear();
                                    nextProgressFrame = totalFrames + sampleRate * ProgressIntervalMs / 1000;
                                }
                            }
                        }
                        finally
                        {
                            capture.ReleaseBuffer(frames);
                        }
                        capture.GetNextPacketSize(out packetFrames).ThrowIfFailed("讀取音訊封包失敗");
                    }
                }
            }
            finally
            {
                if (captureStarted)
                    client.Stop();
            }

            long stopQpc100ns = GetQpc100ns();
            UpdatePauseTimeline(ref pauseState, ref pauseStartedQpc100ns, ref pausedQpc100ns, IsPaused, stopQpc100ns);
            long activeFramesAtStop = Math.Min(maxFrames, QpcFramesSinceStart(stopQpc100ns, captureStartQpc100ns,
                EffectivePausedQpc(pauseState, pauseStartedQpc100ns, pausedQpc100ns, stopQpc100ns), sampleRate));
            if (activeFramesAtStop > totalFrames)
                AppendSilenceFrames(writer, activeFramesAtStop - totalFrames, pendingPeaks, peakBucketFrames, ref peakFrames, ref peakValue, sampleRate);
            FlushPeakBucket(pendingPeaks, ref peakFrames, ref peakValue);
            if (progress is not null && pendingPeaks.Count > 0)
                progress.Report(new CaptureProgress(TimeSpan.FromSeconds((double)Math.Max(totalFrames, activeFramesAtStop) / sampleRate), pendingPeaks.ToArray()));

            writer.Complete();
            totalFrames = Math.Max(totalFrames, activeFramesAtStop);
            return new CaptureResult(outputPath, TimeSpan.FromSeconds((double)totalFrames / sampleRate));
        }
        finally
        {
            if (eventHandle != IntPtr.Zero) Native.CloseHandle(eventHandle);
            ReleaseCom(captureObject);
            Marshal.FreeHGlobal(formatPtr);
            if (mixPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(mixPtr);
            ReleaseCom(client);
        }
    }

    private static byte[] CopyBuffer(IntPtr data, int frames)
    {
        byte[] pcm = new byte[checked(frames * 4)];
        Marshal.Copy(data, pcm, 0, pcm.Length);
        return pcm;
    }

    private static bool TryReadNativePcm16(IntPtr formatPtr, out Native.WaveFormatEx format)
    {
        format = Marshal.PtrToStructure<Native.WaveFormatEx>(formatPtr);
        return format.FormatTag == 1 && format.Channels == FallbackChannels &&
            (format.SamplesPerSecond == 44100 || format.SamplesPerSecond == 48000) &&
            format.BitsPerSample == 16 && format.BlockAlign == FallbackChannels * 2;
    }

    private static void AppendUniformPeaks(List<float> output, byte[] pcm, uint frames, short channels, int bucketFrames, ref int bucketFrameCount, ref float bucketPeak)
    {
        int frameCount = checked((int)frames);
        for (int frame = 0; frame < frameCount; frame++)
        {
            for (int channel = 0; channel < channels; channel++)
            {
                int offset = (frame * channels + channel) * 2;
                short sample = (short)(pcm[offset] | (pcm[offset + 1] << 8));
                bucketPeak = Math.Max(bucketPeak, Math.Abs(sample / 32768f));
            }
            if (++bucketFrameCount == bucketFrames)
            {
                output.Add(bucketPeak);
                bucketFrameCount = 0;
                bucketPeak = 0;
            }
        }
    }

    private static void AppendSilenceFrames(Pcm16WaveWriter writer, long frames, List<float> peaks, int bucketFrames, ref int bucketFrameCount, ref float bucketPeak, int sampleRate)
    {
        while (frames > 0)
        {
            int chunk = (int)Math.Min(frames, sampleRate);
            writer.AppendSilence(chunk);
            AppendUniformSilencePeaks(peaks, chunk, bucketFrames, ref bucketFrameCount, ref bucketPeak);
            frames -= chunk;
        }
    }

    private static void AppendUniformSilencePeaks(List<float> output, int frames, int bucketFrames, ref int bucketFrameCount, ref float bucketPeak)
    {
        for (int frame = 0; frame < frames; frame++)
        {
            if (++bucketFrameCount == bucketFrames)
            {
                output.Add(bucketPeak);
                bucketFrameCount = 0;
                bucketPeak = 0;
            }
        }
    }

    private static void FlushPeakBucket(List<float> output, ref int bucketFrameCount, ref float bucketPeak)
    {
        if (bucketFrameCount == 0) return;
        output.Add(bucketPeak);
        bucketFrameCount = 0;
        bucketPeak = 0;
    }

    private static long EffectivePausedQpc(bool pauseState, long pauseStartedQpc100ns, long pausedQpc100ns, long nowQpc100ns) =>
        pausedQpc100ns + (pauseState ? Math.Max(0, nowQpc100ns - pauseStartedQpc100ns) : 0);

    private static void UpdatePauseTimeline(ref bool pauseState, ref long pauseStartedQpc100ns, ref long pausedQpc100ns, bool paused, long nowQpc100ns)
    {
        if (paused == pauseState) return;
        if (paused)
            pauseStartedQpc100ns = nowQpc100ns;
        else
            pausedQpc100ns += Math.Max(0, nowQpc100ns - pauseStartedQpc100ns);
        pauseState = paused;
    }

    private static long QpcFramesSinceStart(ulong qpc100ns, long captureStartQpc100ns, long pausedQpc100ns, int sampleRate = FallbackSampleRate)
    {
        long effectiveQpc100ns = (long)Math.Max(0, (long)qpc100ns - captureStartQpc100ns - pausedQpc100ns);
        return Math.Max(0, (long)(effectiveQpc100ns * (double)sampleRate / 10_000_000.0));
    }

    private static long QpcFramesSinceStart(long nowQpc100ns, long captureStartQpc100ns, long pausedQpc100ns, int sampleRate = FallbackSampleRate)
    {
        long effectiveQpc100ns = Math.Max(0, nowQpc100ns - captureStartQpc100ns - pausedQpc100ns);
        return Math.Max(0, (long)(effectiveQpc100ns * (double)sampleRate / 10_000_000.0));
    }

    private static long GetQpc100ns() => (long)(System.Diagnostics.Stopwatch.GetTimestamp() * (10_000_000.0 / System.Diagnostics.Stopwatch.Frequency));

    private static int GetWindowsBuildNumber()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        var version = new Native.RtlOsVersionInfoEx { OSVersionInfoSize = Marshal.SizeOf<Native.RtlOsVersionInfoEx>() };
        return Native.RtlGetVersion(ref version) == 0 ? checked((int)version.BuildNumber) : 0;
    }

    private static void ReleaseCom(object? value)
    {
        if (value is not null && Marshal.IsComObject(value))
            Marshal.FinalReleaseComObject(value);
    }

    private sealed class ActivationRequest : IDisposable
    {
        private readonly IntPtr _activationPtr;
        private readonly IntPtr _propVariantPtr;
        private readonly TaskCompletionSource<Native.IAudioClient> _source = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private readonly object _completionGate = new();
        private int _disposed;
        private bool _abandoned;

        public ActivationRequest(Native.AudioClientActivationParams activation, int activationSize)
        {
            _activationPtr = Marshal.AllocHGlobal(activationSize);
            _propVariantPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Native.PropVariantBlob>());
            Marshal.StructureToPtr(activation, _activationPtr, false);
            Marshal.StructureToPtr(new Native.PropVariantBlob
            {
                VariantType = Native.VT_BLOB,
                BlobSize = (uint)activationSize,
                BlobData = _activationPtr
            }, _propVariantPtr, false);
            Completion = new CompletionHandler(this);
        }

        public IntPtr PropVariantPtr => _propVariantPtr;
        public Native.IActivateAudioInterfaceCompletionHandler Completion { get; }

        private void Complete(Native.IActivateAudioInterfaceAsyncOperation operation)
        {
            try
            {
                int result;
                operation.GetActivateResult(out result, out object audioInterface).ThrowIfFailed("指定程序擷取啟用失敗");
                result.ThrowIfFailed("指定程序擷取啟用失敗");
                var client = (Native.IAudioClient)audioInterface;
                bool releaseClient;
                lock (_completionGate)
                {
                    releaseClient = _abandoned || !_source.TrySetResult(client);
                }
                if (releaseClient)
                    ReleaseCom(client);
            }
            catch (Exception ex)
            {
                lock (_completionGate)
                    _source.TrySetException(ex);
            }
            finally
            {
                Dispose();
            }
        }

        public Native.IAudioClient Wait(CancellationToken token)
        {
            try
            {
                return _source.Task.WaitAsync(TimeSpan.FromSeconds(10), token).GetAwaiter().GetResult();
            }
            catch (Exception ex) when (ex is OperationCanceledException or TimeoutException)
            {
                // Keep the native payload alive until the callback. If activation
                // completes later, Complete releases the client because this waiter left.
                Native.IAudioClient? completedClient = null;
                lock (_completionGate)
                {
                    _abandoned = true;
                    if (_source.Task.IsCompletedSuccessfully)
                        completedClient = _source.Task.Result;
                }
                ReleaseCom(completedClient);
                throw;
            }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            Marshal.FreeHGlobal(_propVariantPtr);
            Marshal.FreeHGlobal(_activationPtr);
        }

        [ComVisible(true)]
        [ClassInterface(ClassInterfaceType.None)]
        private sealed class CompletionHandler : Native.IActivateAudioInterfaceCompletionHandler
        {
            private readonly ActivationRequest _owner;
            public CompletionHandler(ActivationRequest owner) => _owner = owner;
            public int ActivateCompleted(Native.IActivateAudioInterfaceAsyncOperation operation)
            {
                _owner.Complete(operation);
                return 0;
            }
        }
    }

    private static class Native
    {
        internal const int COINIT_MULTITHREADED = 0;
        internal const int RPC_E_CHANGED_MODE = unchecked((int)0x80010106);
        internal const uint CLSCTX_ALL = 0x17;
        internal const ushort VT_BLOB = 65;
        internal const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = "VAD\\Process_Loopback";
        internal static readonly Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
        internal static readonly Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        internal struct RtlOsVersionInfoEx
        {
            public int OSVersionInfoSize;
            public int MajorVersion;
            public int MinorVersion;
            public int BuildNumber;
            public int PlatformId;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string CSDVersion;
            public ushort ServicePackMajor;
            public ushort ServicePackMinor;
            public ushort SuiteMask;
            public byte ProductType;
            public byte Reserved;
        }

        internal enum EDataFlow { eRender, eCapture, eAll }
        internal enum ERole { eConsole, eMultimedia, eCommunications }
        internal enum AudioClientShareMode { Shared, Exclusive }
        internal enum AudioClientActivationType : uint { ProcessLoopback = 1 }
        internal enum ProcessLoopbackMode : uint { IncludeTargetProcessTree = 0, ExcludeTargetProcessTree = 1 }
        [Flags]
        internal enum AudioClientStreamFlags : uint
        {
            Loopback = 0x00020000,
            EventCallback = 0x00040000,
            AutoConvertPcm = 0x80000000,
            SrcDefaultQuality = 0x08000000
        }
        [Flags]
        internal enum AudioClientBufferFlags : uint
        {
            DataDiscontinuity = 0x1,
            Silent = 0x2,
            TimestampError = 0x4
        }

        [StructLayout(LayoutKind.Sequential, Pack = 2)]
        internal struct WaveFormatEx
        {
            public ushort FormatTag;
            public ushort Channels;
            public int SamplesPerSecond;
            public int AverageBytesPerSecond;
            public ushort BlockAlign;
            public ushort BitsPerSample;
            public ushort ExtraSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct AudioClientProcessLoopbackParams
        {
            public uint TargetProcessId;
            public ProcessLoopbackMode ProcessLoopbackMode;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct AudioClientActivationParams
        {
            public AudioClientActivationType ActivationType;
            public AudioClientProcessLoopbackParams ProcessLoopbackParams;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct PropVariantBlob
        {
            public ushort VariantType;
            public ushort Reserved1;
            public ushort Reserved2;
            public ushort Reserved3;
            public uint BlobSize;
            public IntPtr BlobData;
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ClassInterface(ClassInterfaceType.None)]
        internal class MMDeviceEnumerator { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out object devices);
            [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
            [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
            [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
            [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out object interfacePointer);
            [PreserveSig] int OpenPropertyStore(uint access, out object properties);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetState(out uint state);
        }

        [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IAudioClient
        {
            [PreserveSig] int Initialize(AudioClientShareMode shareMode, AudioClientStreamFlags streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr audioSessionGuid);
            [PreserveSig] int GetBufferSize(out uint numBufferFrames);
            [PreserveSig] int GetStreamLatency(out long latency);
            [PreserveSig] int GetCurrentPadding(out uint numPaddingFrames);
            [PreserveSig] int IsFormatSupported(AudioClientShareMode shareMode, IntPtr format, out IntPtr closestMatch);
            [PreserveSig] int GetMixFormat(out IntPtr format);
            [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
            [PreserveSig] int Start();
            [PreserveSig] int Stop();
            [PreserveSig] int Reset();
            [PreserveSig] int SetEventHandle(IntPtr eventHandle);
            [PreserveSig] int GetService(ref Guid serviceId, [MarshalAs(UnmanagedType.Interface)] out object service);
        }

        [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IAudioCaptureClient
        {
            [PreserveSig] int GetBuffer(out IntPtr data, out uint numFrames, out AudioClientBufferFlags flags, out ulong devicePosition, out ulong qpcPosition);
            [PreserveSig] int ReleaseBuffer(uint numFrames);
            [PreserveSig] int GetNextPacketSize(out uint numFramesInNextPacket);
        }

        [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IActivateAudioInterfaceAsyncOperation
        {
            [PreserveSig] int GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.Interface)] out object activatedInterface);
        }

        [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        internal interface IActivateAudioInterfaceCompletionHandler
        {
            [PreserveSig] int ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation);
        }

        [DllImport("Mmdevapi.dll", CharSet = CharSet.Unicode)]
        internal static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            ref Guid riid,
            IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation operation);

        [DllImport("ole32.dll")]
        internal static extern int CoInitializeEx(IntPtr reserved, int coInit);

        [DllImport("ole32.dll")]
        internal static extern void CoUninitialize();

        [DllImport("ntdll.dll")]
        internal static extern int RtlGetVersion(ref RtlOsVersionInfoEx versionInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr CreateEvent(IntPtr eventAttributes, bool manualReset, bool initialState, string? name);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll")]
        internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    }
}

internal static class HResultExtensions
{
    public static void ThrowIfFailed(this int hr, string message)
    {
        if (hr < 0) throw new InvalidOperationException($"{message}（HRESULT 0x{hr:X8}）");
    }
}
