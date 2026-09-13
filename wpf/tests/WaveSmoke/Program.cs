using VoiceCaptureLite.Audio;

string root = Path.Combine(Path.GetTempPath(), "VoiceCaptureLiteSmoke");
Directory.CreateDirectory(root);
string source = Path.Combine(root, "source.wav");
string trim = Path.Combine(root, "trim.wav");

using (var writer = new Pcm16WaveWriter(source, 44100, 2))
{
    var samples = new byte[44100 * 2 * 2];
    for (int i = 0; i < samples.Length; i += 4)
    {
        short sample = (short)(Math.Sin(i / 200.0) * 12000);
        samples[i] = (byte)sample;
        samples[i + 1] = (byte)(sample >> 8);
        samples[i + 2] = samples[i];
        samples[i + 3] = samples[i + 1];
    }
    writer.Append(samples, samples.Length);
}

var info = WaveFileInfo.Open(source);
if (info.Frames != 44100 || info.Duration.TotalSeconds is < 0.99 or > 1.01)
    throw new Exception("WAV header/duration check failed");
if (info.BuildPeaks(200).Count == 0)
    throw new Exception("Peak check failed");
info.ExportTrim(0.25, 0.75, trim);
var trimmed = WaveFileInfo.Open(trim);
if (trimmed.Duration.TotalSeconds is < 0.49 or > 0.51)
    throw new Exception("Trim check failed");

Console.WriteLine($"PASS: {info.Duration.TotalSeconds:0.00}s -> {trimmed.Duration.TotalSeconds:0.00}s");
