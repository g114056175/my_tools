using System.Windows;

namespace VoiceCaptureLite;

public partial class App : Application
{
    private Mutex? _instance;
    protected override void OnStartup(StartupEventArgs e)
    {
        _instance = new Mutex(true, @"Local\VoiceCaptureLite.Editor.v2", out bool first);
        if (!first) { MessageBox.Show("聲音擷取已開啟，請使用現有視窗。"); Shutdown(); return; }
        base.OnStartup(e);
        new MainWindow().Show();
    }
    protected override void OnExit(ExitEventArgs e)
    {
        _instance?.Dispose(); base.OnExit(e);
    }
}
