using VoiceCaptureLite.Audio;

string path = Path.Combine(Path.GetTempPath(), "VoiceCaptureLiteSmoke", "capture.wav");
using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(700));
var progress = new Progress<CaptureProgress>(p => Console.WriteLine($"frames: {p.Duration.TotalSeconds:0.00}s"));
var result = await new WasapiLoopbackCapture().CaptureAsync(new CaptureSource(CaptureSourceKind.System), path, progress, cancellation.Token);
var wave = WaveFileInfo.Open(result.Path);
Console.WriteLine($"PASS: {wave.SampleRate} Hz, {wave.Channels} ch, {wave.Duration.TotalSeconds:0.00}s");

foreach (bool resume in new[] { true, false })
{
    var recorder = new WasapiLoopbackCapture();
    using var stop = new CancellationTokenSource();
    string output = Path.Combine(Path.GetTempPath(), "VoiceCaptureLiteSmoke", resume ? "pause-resume.wav" : "paused-stop.wav");
    var task = recorder.CaptureAsync(new CaptureSource(CaptureSourceKind.System), output, null, stop.Token);
    await Task.Delay(700);
    recorder.IsPaused = true;
    await Task.Delay(500);
    if (resume) { recorder.IsPaused = false; await Task.Delay(500); }
    stop.Cancel();
    var captured = await task;
    var actual = WaveFileInfo.Open(output);
    double expected = resume ? 1.2 : .7;
    if (Math.Abs(actual.Duration.TotalSeconds - expected) > .2)
        throw new Exception($"pause duration mismatch: {actual.Duration.TotalSeconds} expected {expected}");
    if (Math.Abs(actual.Duration.TotalSeconds - captured.Duration.TotalSeconds) > 1d / 44100)
        throw new Exception("result and WAV duration mismatch");
    Console.WriteLine($"PASS: {(resume ? "pause-resume" : "paused-stop")} WAV={actual.Duration.TotalSeconds:0.000}s expected~{expected:0.000}s");
}
