// UI fixture: real encoders and production UI, with deterministic worker completion reasons.
// This worker is linked only into the test executable, never into the released recorder.
#include "project1_region_recorder/recorder_app.h"
#include "project1_region_recorder/gif_writer.h"
#include "project1_region_recorder/mp4_writer.h"

namespace lc::recorder {
void RecordingWorker(bool gif, std::wstring path, int, int, RecordingLimits) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    std::wstring error;
    bool okay = false;
    {
        std::vector<uint8_t> frame(160 * 120 * 4, 96);
        if (gif) {
            lc::GifWriter writer;
            bool limited = false;
            okay = writer.Open(path, 160, 120, 1'000'000, error) &&
                   writer.AddBgraFrame(frame, 10, limited, error) && writer.Close(&error);
        } else {
            lc::Mp4Writer writer;
            okay = writer.Open(path, 160, 120, 10, error) &&
                   writer.WriteBgra(frame, 0, 1'000'000, error) && writer.Close(&error);
        }
    }
    g_app.frameCount = okay ? 1 : 0;
    g_app.recordedTime100ns = 1'000'000;
    wchar_t scenario[32]{};
    GetEnvironmentVariableW(L"LIGHTCAPTURE_LIMIT_NOTICE_TEST", scenario, 32);
    const DoneReason reason = !okay ? DoneError
                              : std::wstring(scenario) == L"time" ? DoneTimeLimit
                              : std::wstring(scenario) == L"stopped" ? DoneStopped
                                                                   : DoneSizeLimit;
    CoUninitialize();
    auto* message = new std::wstring(error);
    if (!PostMessageW(g_app.window, WM_CAPTURE_DONE, reason, reinterpret_cast<LPARAM>(message)))
        delete message;
}
}  // namespace lc::recorder

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    return lc::recorder::RunRecorder(instance);
}
