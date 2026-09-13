using System.Buffers.Binary;
using System.IO;

namespace VoiceCaptureLite.Audio;

public sealed class WaveFileInfo
{
    public required string Path { get; init; }
    public required int SampleRate { get; init; }
    public required short Channels { get; init; }
    public required short BitsPerSample { get; init; }
    public required long DataOffset { get; init; }
    public required long DataBytes { get; init; }

    public long FrameBytes => Channels * (BitsPerSample / 8);
    public long Frames => FrameBytes == 0 ? 0 : DataBytes / FrameBytes;
    public TimeSpan Duration => TimeSpan.FromSeconds(SampleRate == 0 ? 0 : (double)Frames / SampleRate);

    public static WaveFileInfo Open(string path)
    {
        using var stream = File.OpenRead(path);
        using var reader = new BinaryReader(stream);
        if (new string(reader.ReadChars(4)) != "RIFF") throw new InvalidDataException("不是 RIFF WAV 檔案。");
        _ = reader.ReadUInt32();
        if (new string(reader.ReadChars(4)) != "WAVE") throw new InvalidDataException("不是 WAV 檔案。");

        short channels = 0;
        int sampleRate = 0;
        short bitsPerSample = 0;
        long dataOffset = 0;
        long dataBytes = 0;

        while (stream.Position + 8 <= stream.Length)
        {
            string chunk = new string(reader.ReadChars(4));
            uint size = reader.ReadUInt32();
            long next = Math.Min(stream.Length, stream.Position + size);
            if (chunk == "fmt ")
            {
                if (size < 16 || next - stream.Position < 16) throw new InvalidDataException("WAV fmt 區塊不完整。");
                short format = reader.ReadInt16();
                channels = reader.ReadInt16();
                sampleRate = reader.ReadInt32();
                _ = reader.ReadInt32();
                _ = reader.ReadInt16();
                bitsPerSample = reader.ReadInt16();
                if (size > 16) stream.Position = next;
                if (format != 1 && format != 3) throw new InvalidDataException("只支援 PCM／IEEE float WAV。");
            }
            else if (chunk == "data")
            {
                dataOffset = stream.Position;
                dataBytes = Math.Min(size, (uint)(stream.Length - stream.Position));
                break;
            }
            stream.Position = next + (size % 2);
        }

        if (channels <= 0 || channels > 8 || sampleRate <= 0 || sampleRate > 384000 ||
            (bitsPerSample != 16 && bitsPerSample != 32) || dataOffset == 0)
            throw new InvalidDataException("WAV 格式不完整或不是支援的 PCM／IEEE float WAV。");

        return new WaveFileInfo
        {
            Path = path,
            SampleRate = sampleRate,
            Channels = channels,
            BitsPerSample = bitsPerSample,
            DataOffset = dataOffset,
            DataBytes = dataBytes
        };
    }

    public IReadOnlyList<float> BuildPeaks(int desiredCount = 0)
    {
        int count = desiredCount <= 0 ? Math.Clamp((int)Math.Ceiling(Duration.TotalSeconds * 1000), 200, 2000000) : Math.Clamp(desiredCount, 200, 2000000);
        int bytesPerBucket = (int)Math.Max(FrameBytes, Math.Ceiling((double)Frames / count) * FrameBytes);
        bytesPerBucket -= bytesPerBucket % (int)FrameBytes;
        if (bytesPerBucket <= 0) bytesPerBucket = (int)FrameBytes;

        var peaks = new List<float>(count);
        byte[] buffer = new byte[bytesPerBucket];
        using var stream = File.OpenRead(Path);
        stream.Position = DataOffset;
        long remaining = DataBytes;
        while (remaining > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, remaining);
            int read = stream.Read(buffer, 0, wanted);
            if (read <= 0) break;
            float peak = 0;
            for (int i = 0; i + (BitsPerSample / 8) <= read; i += BitsPerSample / 8)
            {
                float sample = BitsPerSample == 32
                    ? BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(buffer.AsSpan(i, 4)))
                    : BinaryPrimitives.ReadInt16LittleEndian(buffer.AsSpan(i, 2)) / 32768f;
                if (float.IsFinite(sample)) peak = Math.Max(peak, Math.Min(1f, Math.Abs(sample)));
            }
            peaks.Add(peak);
            remaining -= read;
        }
        return peaks;
    }

    public string ExportTrim(double startRatio, double endRatio, string outputPath)
    {
        startRatio = Math.Clamp(startRatio, 0, 1);
        endRatio = Math.Clamp(endRatio, startRatio, 1);
        long startFrame = (long)Math.Round(Frames * startRatio);
        long endFrame = (long)Math.Round(Frames * endRatio);
        long bytesToCopy = Math.Max(0, (endFrame - startFrame) * FrameBytes);

        if (string.Equals(System.IO.Path.GetFullPath(outputPath), System.IO.Path.GetFullPath(Path), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("匯出位置不能覆寫目前使用中的工作音檔。");
        if (bytesToCopy == 0) throw new InvalidOperationException("請選取至少一個音訊取樣。");
        using var source = File.OpenRead(Path);
        source.Position = DataOffset + startFrame * FrameBytes;
        using var destination = new Pcm16WaveWriter(outputPath, SampleRate, Channels);
        byte[] buffer = new byte[64 * 1024];
        long remaining = bytesToCopy;
        while (remaining > 0)
        {
            int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
            if (read <= 0) throw new EndOfStreamException("來源音檔在匯出期間變更。");
            destination.Append(buffer, read);
            remaining -= read;
        }
        destination.Complete();
        return outputPath;
    }
}

public class WaveWriter : IDisposable
{
    private readonly FileStream _stream;
    private readonly int _sampleRate;
    private readonly short _channels;
    private readonly short _formatTag;
    private readonly short _bitsPerSample;
    private long _dataBytes;
    private bool _completed;

    public WaveWriter(string path, int sampleRate, short channels, short formatTag = 1, short bitsPerSample = 16)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
        _stream = new FileStream(path, FileMode.Create, FileAccess.ReadWrite, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        _sampleRate = sampleRate;
        _channels = channels;
        _formatTag = formatTag;
        _bitsPerSample = bitsPerSample;
        WriteHeader(0);
    }

    public void Append(byte[] bytes, int count)
    {
        if (_completed) throw new InvalidOperationException("WAV 已關閉寫入。");
        if (_dataBytes + count > uint.MaxValue - 36) throw new IOException("已達 WAV 4 GB 上限。");
        _stream.Write(bytes, 0, count);
        _dataBytes += count;
    }

    public void AppendSilence(int frames)
    {
        int frameBytes = _channels * (_bitsPerSample / 8);
        byte[] silence = new byte[Math.Min(frames * frameBytes, 64 * 1024)];
        int remaining = frames * frameBytes;
        while (remaining > 0)
        {
            int count = Math.Min(silence.Length, remaining);
            Append(silence, count);
            remaining -= count;
        }
    }

    public void Complete()
    {
        if (_completed) return;
        _stream.Position = 0;
        WriteHeader(_dataBytes);
        _stream.Flush(true);
        _completed = true;
    }

    private void WriteHeader(long dataBytes)
    {
        using var writer = new BinaryWriter(_stream, System.Text.Encoding.ASCII, leaveOpen: true);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
        writer.Write((uint)(36 + dataBytes));
        writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));
        writer.Write(16u);
        writer.Write((ushort)_formatTag);
        writer.Write((ushort)_channels);
        writer.Write(_sampleRate);
        writer.Write(_sampleRate * _channels * (_bitsPerSample / 8));
        writer.Write((ushort)(_channels * (_bitsPerSample / 8)));
        writer.Write((ushort)_bitsPerSample);
        writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
        writer.Write((uint)dataBytes);
        if (dataBytes == 0) _stream.SetLength(44);
    }

    public void Dispose()
    {
        Complete();
        _stream.Dispose();
    }
}

public sealed class Pcm16WaveWriter : WaveWriter
{
    public Pcm16WaveWriter(string path, int sampleRate, short channels) : base(path, sampleRate, channels) { }
}
