using VoiceCaptureLite.Audio;

string root = Path.Combine(Path.GetTempPath(), "VoiceCaptureLiteCodecSmoke");
Directory.CreateDirectory(root);
string source = Path.Combine(root, "source.wav");
string imported = Path.Combine(root, "imported.wav");
WriteTone(source, 44100, 2, 1.0);
var original = WaveFileInfo.Open(source);
WindowsAudioCodec.Import(source, imported);
var decoded = WaveFileInfo.Open(imported);
if (decoded.SampleRate != 44100 || decoded.Channels != 2 || decoded.BitsPerSample != 16 || decoded.Frames < 44000)
    throw new Exception("Import WAV invariants failed");
foreach (int bitrate in new[] { 128, 192, 320 })
{
    string encoded = Path.Combine(root, $"encoded-{bitrate}.mp3");
    WindowsAudioCodec.ExportMp3(decoded, 0.1, 0.9, encoded, bitrate);
    if (!File.Exists(encoded) || new FileInfo(encoded).Length < 1000)
        throw new Exception($"{bitrate} kbps MP3 output is missing or unexpectedly small");
    string roundTrip = Path.Combine(root, $"roundtrip-{bitrate}.wav");
    WindowsAudioCodec.Import(encoded, roundTrip);
    var roundTripInfo = WaveFileInfo.Open(roundTrip);
    if (roundTripInfo.SampleRate != 44100 || roundTripInfo.Channels != 2 || roundTripInfo.BitsPerSample != 16 || roundTripInfo.Frames < 30000)
        throw new Exception($"{bitrate} kbps MP3 round-trip invariants failed");
    if (roundTripInfo.Duration.TotalSeconds < .78 || roundTripInfo.Duration.TotalSeconds > .95)
        throw new Exception("MP3 roundtrip duration drift");
    if (roundTripInfo.BuildPeaks(200).Max() < .2f)
        throw new Exception("MP3 decoded silence instead of the source tone");
}

foreach ((int rate, short channels) in new[] { (48000, (short)1), (22050, (short)1), (32000, (short)2) })
{
    string input = Path.Combine(root, $"input-{rate}-{channels}.wav");
    string output = Path.Combine(root, $"output-{rate}-{channels}.wav");
    WriteTone(input, rate, channels, 0.4);
    WindowsAudioCodec.Import(input, output);
    var info = WaveFileInfo.Open(output);
    if (info.SampleRate != 44100 || info.Channels != 2 || info.BitsPerSample != 16 || info.Frames < 10000)
        throw new Exception($"{rate}/{channels} conversion invariants failed");
    if (Math.Abs(info.Duration.TotalSeconds - .4) > .03 || info.BuildPeaks(200).Max() < .2f)
        throw new Exception("resampling changed duration or dropped the tone");
}

Console.WriteLine($"PASS: {original.Frames} frames -> {decoded.Frames} frames; MP3 128/192/320 round-trips and rate/channel conversions verified");

static void WriteTone(string path, int rate, short channels, double seconds)
{
    int frames = (int)(rate * seconds);
    using var writer = new Pcm16WaveWriter(path, rate, channels);
    byte[] data = new byte[frames * channels * 2];
    for (int frame = 0; frame < frames; frame++)
    {
        short sample = (short)(Math.Sin(frame * 2 * Math.PI * 440 / rate) * 12000);
        for (int channel = 0; channel < channels; channel++)
        {
            int i = (frame * channels + channel) * 2;
            data[i] = (byte)sample;
            data[i + 1] = (byte)(sample >> 8);
        }
    }
    writer.Append(data, data.Length);
}
