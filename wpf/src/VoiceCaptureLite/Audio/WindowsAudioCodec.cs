using System.IO;
using System.Runtime.InteropServices;

namespace VoiceCaptureLite.Audio;

/// <summary>Windows Media Foundation based MP3/WAV codec. Windows desktop only.</summary>
public static class WindowsAudioCodec
{
    private const int MF_VERSION = 0x00020070;
    private const int MFSTARTUP_FULL = 0;
    private const int FIRST_AUDIO_STREAM = unchecked((int)0xFFFFFFFD);
    private const int MF_SOURCE_READER_ALL_STREAMS = unchecked((int)0xFFFFFFFE);
    private const int MF_SINK_WRITER_ALL_STREAMS = unchecked((int)0xFFFFFFFE);
    private const int MF_SOURCE_READERF_ERROR = 0x00000001;
    private const int MF_SOURCE_READERF_ENDOFSTREAM = 0x00000002;
    private const int STREAM_TICK = 0x00000100;
    private const int MF_SDK_VERSION = 2;
    private const int MF_API_VERSION = 112;

    private static readonly Guid MFMediaTypeAudio = new("73647561-0000-0010-8000-00aa00389b71");
    private static readonly Guid MFAudioFormatPcm = new("00000001-0000-0010-8000-00aa00389b71");
    private static readonly Guid MFAudioFormatMp3 = new("00000055-0000-0010-8000-00aa00389b71");
    private static readonly Guid MFAttrMajorType = new("48eba18e-f8c9-4687-bf11-0a74c9f96a8f");
    private static readonly Guid MFAttrSubtype = new("f7e34c9a-42e8-4714-b74b-cb29d72c35e5");
    private static readonly Guid MFAttrAudioSamplesPerSecond = new("5faeeae7-0290-4c31-9e8a-c534f68d9dba");
    private static readonly Guid MFAttrAudioNumChannels = new("37e48bf5-645e-4c5b-89de-ada9e29b696a");
    private static readonly Guid MFAttrAudioBitsPerSample = new("f2deb57f-40fa-4764-aa33-ed4f2d1ff669");
    private static readonly Guid MFAttrAudioAvgBytesPerSecond = new("1aab75c8-cfef-451c-ab95-ac034b8e1731");
    private static readonly Guid MFAttrAudioBlockAlignment = new("322de230-9eeb-43bd-ab7a-ff412251541d");
    private static readonly Guid MFAttrAudioChannelMask = new("55fb5765-644a-4caf-8479-938983bb1588");

    public static string Import(string source, string output)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(output);
        EnsureWindows();

        return WithMf(() =>
        {
            IMFSourceReader reader = CreateSourceReader(source);
            try
            {
                IMFMediaType type = CreateAudioType(MFAudioFormatPcm, 44100, 2, 16, 0, 0);
                try
                {
                    Check(reader.SetStreamSelection(FIRST_AUDIO_STREAM, true), "選取音訊串流");
                    Check(reader.SetCurrentMediaType(FIRST_AUDIO_STREAM, IntPtr.Zero, type), "設定解碼輸出格式");
                    using var writer = new Pcm16WaveWriter(output, 44100, 2);
                    ReadSource(reader, (buffer, count) => writer.Append(buffer, count));
                    writer.Complete();
                    return output;
                }
                finally { Release(type); }
            }
            finally { Release(reader); }
        });
    }

    public static string ExportMp3(WaveFileInfo wave, double startRatio, double endRatio, string output, int bitrateKbps)
    {
        ArgumentNullException.ThrowIfNull(wave);
        ArgumentException.ThrowIfNullOrWhiteSpace(output);
        if (bitrateKbps is not (128 or 192 or 320))
            throw new ArgumentOutOfRangeException(nameof(bitrateKbps), "MP3 僅允許 128、192 或 320 kbps。");
        if (wave.BitsPerSample != 16 || wave.SampleRate != 44100 || wave.Channels != 2)
            throw new NotSupportedException("ExportMp3 目前要求 44,100 Hz、stereo、PCM16 WAV；請先用 Import 正規化來源。");

        startRatio = Math.Clamp(startRatio, 0, 1);
        endRatio = Math.Clamp(endRatio, startRatio, 1);
        long startFrame = (long)Math.Round(wave.Frames * startRatio);
        long endFrame = (long)Math.Round(wave.Frames * endRatio);

        return WithMf(() =>
        {
            IMFSinkWriter sink = CreateSinkWriter(output);
            try
            {
                IMFMediaType outputType = CreateAudioType(MFAudioFormatMp3, 44100, 2, 0, bitrateKbps * 125, 0);
                try
                {
                    Check(sink.AddStream(outputType, out int stream), "加入 MP3 輸出串流");
                    IMFMediaType inputType = CreateAudioType(MFAudioFormatPcm, 44100, 2, 16, 176400, 4);
                    try
                    {
                        Check(sink.SetInputMediaType(stream, inputType, IntPtr.Zero), "設定 MP3 輸入格式");
                        Check(sink.BeginWriting(), "開始 MP3 編碼");
                        using var input = File.OpenRead(wave.Path);
                        input.Position = wave.DataOffset + startFrame * wave.FrameBytes;
                        long bytes = Math.Max(0, (endFrame - startFrame) * wave.FrameBytes);
                        EncodePcm(sink, stream, input, bytes);
                        Check(sink.FinalizeSink(), "完成 MP3 編碼");
                        return output;
                    }
                    finally { Release(inputType); }
                }
                finally { Release(outputType); }
            }
            finally { Release(sink); }
        });
    }

    private static void ReadSource(IMFSourceReader reader, Action<byte[], int> consume)
    {
        while (true)
        {
            Check(reader.ReadSample(FIRST_AUDIO_STREAM, 0, out _, out int flags, out _, out IMFSample? sample), "讀取解碼資料");
            if ((flags & MF_SOURCE_READERF_ERROR) != 0) throw new InvalidDataException("Media Foundation 解碼器回報錯誤。");
            if (sample is not null)
            {
                try
                {
                    // Source Reader samples are normally single-buffer audio samples.
                    // GetBufferByIndex also works for decoder outputs that do not expose
                    // the optional contiguous-buffer conversion service.
                    Check(sample.ConvertToContiguousBuffer(out IntPtr bufferPtr), "取得解碼緩衝區");
                    IMFMediaBuffer buffer = (IMFMediaBuffer)Marshal.GetObjectForIUnknown(bufferPtr);
                    Marshal.Release(bufferPtr);
                    try
                    {
                        Check(buffer.Lock(out IntPtr p, out _, out int length), "鎖定解碼緩衝區");
                        try
                        {
                            byte[] bytes = new byte[length];
                            Marshal.Copy(p, bytes, 0, length);
                            consume(bytes, length);
                        }
                        finally { buffer.Unlock(); }
                    }
                    finally { Release(buffer); }
                }
                finally { Release(sample); }
            }
            if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) break;
        }
    }

    private static void EncodePcm(IMFSinkWriter sink, int stream, FileStream input, long byteCount)
    {
        const int chunk = 64 * 1024;
        byte[] bytes = new byte[chunk];
        long position = 0;
        while (position < byteCount)
        {
            int count = input.Read(bytes, 0, (int)Math.Min(bytes.Length, byteCount - position));
            if (count == 0) throw new EndOfStreamException("WAV 資料在編碼期間變更。");
            Check(Native.MFCreateMemoryBuffer(count, out IMFMediaBuffer buffer), "建立輸入緩衝區");
            try
            {
                Check(buffer.Lock(out IntPtr p, out _, out _), "鎖定輸入緩衝區");
                try { Marshal.Copy(bytes, 0, p, count); }
                finally { buffer.Unlock(); }
                Check(buffer.SetCurrentLength(count), "設定輸入長度");
                Check(Native.MFCreateSample(out IMFSample sample), "建立輸入 sample");
                try
                {
                    Check(sample.AddBuffer(buffer), "加入輸入緩衝區");
                    Check(sample.SetSampleTime(position * 10_000_000L / 176400), "設定 sample 時間");
                    Check(sample.SetSampleDuration((long)count * 10_000_000L / 176400), "設定 sample 長度");
                    Check(sink.WriteSample(stream, sample), "寫入 MP3 編碼器");
                }
                finally { Release(sample); }
            }
            finally { Release(buffer); }
            position += count;
        }
    }

    private static IMFMediaType CreateAudioType(Guid subtype, int rate, int channels, int bits, int avgBytes, int blockAlign)
    {
        Check(Native.MFCreateMediaType(out IMFMediaType type), "建立 Media Foundation media type");
        try
        {
            SetGuid(type, MFAttrMajorType, MFMediaTypeAudio, "設定 major type");
            SetGuid(type, MFAttrSubtype, subtype, "設定 subtype");
            SetUInt(type, MFAttrAudioSamplesPerSecond, rate, "設定取樣率");
            SetUInt(type, MFAttrAudioNumChannels, channels, "設定聲道數");
            if (bits != 0) SetUInt(type, MFAttrAudioBitsPerSample, bits, "設定位元深度");
            if (avgBytes != 0) SetUInt(type, MFAttrAudioAvgBytesPerSecond, avgBytes, "設定平均位元組率");
            if (blockAlign != 0) SetUInt(type, MFAttrAudioBlockAlignment, blockAlign, "設定 block alignment");
            if (subtype == MFAudioFormatPcm && channels == 2) SetUInt(type, MFAttrAudioChannelMask, 3, "設定 stereo channel mask");
            return type;
        }
        catch { Release(type); throw; }
    }


    private static void SetGuid(IMFAttributes type, Guid key, Guid value, string operation)
    {
        Check(type.SetGUID(ref key, ref value), operation);
    }

    private static void SetUInt(IMFAttributes type, Guid key, int value, string operation)
    {
        Check(type.SetUINT32(ref key, value), operation);
    }

    private static IMFSourceReader CreateSourceReader(string path)
    {
        Check(Native.MFCreateSourceReaderFromURL(path, IntPtr.Zero, out IMFSourceReader reader), "建立 Media Foundation source reader");
        return reader;
    }

    private static IMFSinkWriter CreateSinkWriter(string path)
    {
        Check(Native.MFCreateSinkWriterFromURL(path, IntPtr.Zero, IntPtr.Zero, out IMFSinkWriter writer), "建立 MP3 sink writer");
        return writer;
    }

    private static T WithMf<T>(Func<T> action)
    {
        int hr = Native.CoInitializeEx(IntPtr.Zero, 0x0);
        bool uninit = hr >= 0;
        try
        {
            Check(Native.MFStartup(MF_VERSION, MFSTARTUP_FULL), "啟動 Media Foundation");
            try { return action(); } finally { Native.MFShutdown(); }
        }
        finally { if (uninit) Native.CoUninitialize(); }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("WindowsAudioCodec 需要 Windows Media Foundation。");
    }

    private static void Check(int hr, string operation)
    {
        if (hr < 0) throw new InvalidOperationException($"{operation}失敗（0x{hr:X8}）。", Marshal.GetExceptionForHR(hr));
    }

    private static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    [ComImport, Guid("2cd2d921-c447-44a7-a13c-4adabfc247e3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMFAttributes
    {
        int GetItem(ref Guid key, IntPtr value); int GetItemType(ref Guid key, out int type); int CompareItem(ref Guid key, IntPtr value, out bool result); int Compare(IMFAttributes theirs, int matchType, out bool result); int GetUINT32(ref Guid key, out int value); int GetUINT64(ref Guid key, out long value); int GetDouble(ref Guid key, out double value); int GetGUID(ref Guid key, out Guid value); int GetStringLength(ref Guid key, out int length); int GetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value, int size, out int length); int GetAllocatedString(ref Guid key, out IntPtr value, out int length); int GetBlobSize(ref Guid key, out int size); int GetBlob(ref Guid key, IntPtr buffer, int size, out int blobSize); int GetAllocatedBlob(ref Guid key, out IntPtr buffer, out int size); int GetUnknown(ref Guid key, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object value); int SetItem(ref Guid key, IntPtr value); int DeleteItem(ref Guid key); int DeleteAllItems(); int SetUINT32(ref Guid key, int value); int SetUINT64(ref Guid key, long value); int SetDouble(ref Guid key, double value); int SetGUID(ref Guid key, ref Guid value); int SetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value); int SetBlob(ref Guid key, IntPtr buffer, int size); int SetUnknown(ref Guid key, [MarshalAs(UnmanagedType.Interface)] object value); int LockStore(); int UnlockStore(); int GetCount(out int count); int GetItemByIndex(int index, out Guid key, IntPtr value); int CopyAllItems(IMFAttributes destination);
    }

    [ComImport, Guid("44ae0fa8-ea31-4109-8d2e-4cae4997c555"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] private interface IMFMediaType : IMFAttributes { int GetMajorType(out Guid value); int IsCompressed(out bool value); int IsEqual(IMFMediaType other, out int flags); int GetRepresentation(ref Guid guid, out IntPtr representation); int FreeRepresentation(ref Guid guid, IntPtr representation); }
    [ComImport, Guid("70ae66f2-c809-4e4f-8915-bdcb406b7993"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] private interface IMFSourceReader { int GetStreamSelection(int stream, out bool selected); int SetStreamSelection(int stream, bool selected); int GetNativeMediaType(int stream, int index, out IMFMediaType type); int GetCurrentMediaType(int stream, out IMFMediaType type); int SetCurrentMediaType(int stream, IntPtr reserved, IMFMediaType type); int SetCurrentPosition(ref Guid format, IntPtr position); int ReadSample(int stream, int control, out int actualStream, out int flags, out long timestamp, [MarshalAs(UnmanagedType.Interface)] out IMFSample? sample); int Flush(int stream); int GetServiceForStream(int stream, ref Guid guid, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object service); int GetPresentationAttribute(int stream, ref Guid key, IntPtr value); }
    [ComImport, Guid("3137f1cd-fe5e-4805-a5d8-fb477448cb3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] private interface IMFSinkWriter { int AddStream(IMFMediaType type, out int stream); int SetInputMediaType(int stream, IMFMediaType type, IntPtr attributes); int BeginWriting(); int WriteSample(int stream, IMFSample sample); int SendStreamTick(int stream, long timestamp); int PlaceMarker(int stream, IntPtr marker); int NotifyEndOfSegment(int stream); int Flush(int stream); int FinalizeSink(); int GetServiceForStream(int stream, ref Guid guid, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object service); int GetStatistics(int stream, IntPtr stats); }
    [ComImport, Guid("c40a00f2-b93a-4d80-ae8c-5a1c634f58e4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] private interface IMFSample
    {
        int GetItem(ref Guid key, IntPtr value); int GetItemType(ref Guid key, out int type); int CompareItem(ref Guid key, IntPtr value, out bool result); int Compare(IMFAttributes theirs, int matchType, out bool result); int GetUINT32(ref Guid key, out int value); int GetUINT64(ref Guid key, out long value); int GetDouble(ref Guid key, out double value); int GetGUID(ref Guid key, out Guid value); int GetStringLength(ref Guid key, out int length); int GetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value, int size, out int length); int GetAllocatedString(ref Guid key, out IntPtr value, out int length); int GetBlobSize(ref Guid key, out int size); int GetBlob(ref Guid key, IntPtr buffer, int size, out int blobSize); int GetAllocatedBlob(ref Guid key, out IntPtr buffer, out int size); int GetUnknown(ref Guid key, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object value); int SetItem(ref Guid key, IntPtr value); int DeleteItem(ref Guid key); int DeleteAllItems(); int SetUINT32(ref Guid key, int value); int SetUINT64(ref Guid key, long value); int SetDouble(ref Guid key, double value); int SetGUID(ref Guid key, ref Guid value); int SetString(ref Guid key, [MarshalAs(UnmanagedType.LPWStr)] string value); int SetBlob(ref Guid key, IntPtr buffer, int size); int SetUnknown(ref Guid key, [MarshalAs(UnmanagedType.Interface)] object value); int LockStore(); int UnlockStore(); int GetCount(out int count); int GetItemByIndex(int index, out Guid key, IntPtr value); int CopyAllItems(IMFAttributes destination);
        int GetSampleFlags(out int flags); int SetSampleFlags(int flags); int GetSampleTime(out long time); int SetSampleTime(long time); int GetSampleDuration(out long duration); int SetSampleDuration(long duration); int GetBufferCount(out int count); int GetBufferByIndex(int index, out IntPtr buffer); int ConvertToContiguousBuffer(out IntPtr buffer); int AddBuffer(IMFMediaBuffer buffer); int RemoveBufferByIndex(int index); int RemoveAllBuffers(); int GetTotalLength(out int length); int CopyToBuffer(IMFMediaBuffer buffer);
    }
    [ComImport, Guid("045fa593-8799-42b8-bc8d-8968c6453507"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] private interface IMFMediaBuffer { int Lock(out IntPtr buffer, out int maxLength, out int currentLength); int Unlock(); int GetCurrentLength(out int length); int SetCurrentLength(int length); int GetMaxLength(out int length); }

    private static class Native
    {
        [DllImport("ole32.dll")] internal static extern int CoInitializeEx(IntPtr pvReserved, uint coInit); [DllImport("ole32.dll")] internal static extern void CoUninitialize();
        [DllImport("mfplat.dll")] internal static extern int MFStartup(int version, int flags); [DllImport("mfplat.dll")] internal static extern int MFShutdown(); [DllImport("mfplat.dll")] internal static extern int MFCreateMediaType(out IMFMediaType type); [DllImport("mfplat.dll")] internal static extern int MFCreateMemoryBuffer(int maxLength, out IMFMediaBuffer buffer); [DllImport("mfplat.dll")] internal static extern int MFCreateSample(out IMFSample sample);
        [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode)] internal static extern int MFCreateSourceReaderFromURL(string url, IntPtr attributes, out IMFSourceReader reader); [DllImport("mfreadwrite.dll", CharSet = CharSet.Unicode)] internal static extern int MFCreateSinkWriterFromURL(string url, IntPtr attributes, IntPtr reserved, out IMFSinkWriter writer);
    }
}
