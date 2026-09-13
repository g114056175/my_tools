using VoiceCaptureLite.Audio;

string root = Path.Combine(Path.GetTempPath(), "VoiceCaptureLiteSmoke");
Directory.CreateDirectory(root);
string source = Path.Combine(root, "player.wav");
using (var writer = new Pcm16WaveWriter(source, 8000, 1))
    writer.AppendSilence(8000);

var info = WaveFileInfo.Open(source);
using var player = new PcmPlayer();
player.Open(info);
player.Play(0.20, 0.70);
if (!player.IsPlaying || player.Position < 0.19 || player.Position > 0.21)
    throw new Exception($"initial play state/position failed: {player.IsPlaying}, {player.Position}");

player.Pause();
double paused = player.Position;
player.Seek(0.40, 0.60);
for (int i = 0; i < 12; i++) { Thread.Sleep(20); player.Tick(); }
if (player.IsPlaying || player.Position < 0.39 || player.Position > 0.41)
    throw new Exception($"paused seek failed: {player.IsPlaying}, {player.Position}");

player.Seek(0.80, 0.80);
if (player.IsPlaying || player.Position < 0.79 || player.Position > 0.81)
    throw new Exception($"seek-to-end failed: {player.IsPlaying}, {player.Position}");

player.Play(0.40, 0.60);
Thread.Sleep(80); player.Tick();
if (player.Position <= .41 || player.Position >= .60) throw new Exception("native cursor did not advance during playback");
for (int i = 0; i < 20 && player.IsPlaying; i++)
{
    Thread.Sleep(20);
    player.Tick();
}
if (player.IsPlaying || player.Position < 0.59 || player.Position > 0.61)
    throw new Exception($"trim completion failed: {player.IsPlaying}, {player.Position}");

double final = player.Position;
player.Play(.40, .60); Thread.Sleep(80); player.Tick();
if (!player.IsPlaying || player.Position <= .40 || player.Position >= .60) throw new Exception("replay same selection failed");
for (int i = 0; i < 20; i++)
{
    player.Open(info);
    player.Play(0.10, 0.12);
    player.Pause();
    player.Close();
}

player.Close();
Console.WriteLine($"PASS: pause={paused:0.000}s, final={final:0.000}s, seek-end and 20 reopen/close cycles");
