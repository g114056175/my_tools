#pragma once

#include <windows.h>

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "project1_region_recorder/recording_limits.h"

namespace lc::recorder {

constexpr UINT WM_CAPTURE_DONE = WM_APP + 10;
enum DoneReason { DoneStopped, DoneSizeLimit, DoneError, DoneTimeLimit };
enum class View { Idle, Ready, Recording, Result };

struct AppState {
    HINSTANCE instance{};
    HWND window{}, toolbar{}, tooltip{};
    HWND videoFps{}, gifFps{};
    HWND editDirectory{}, editFileName{}, autoSaveCheck{}, clipboardCheck{}, cursorCheck{};
    HWND selectHotkey{}, videoButton{}, gifButton{}, status{};
    HWND startButton{}, pauseButton{}, stopButton{}, typeButton{}, closeButton{}, resizeButton{};
    HWND saveButton{}, copyButton{}, discardButton{}, hideButton{}, recordingTime{}, resultInfo{};
    std::vector<HWND> setupControls;
    HFONT uiFont{}, titleFont{}, timerFont{};
    HBRUSH backgroundBrush{}, cardBrush{}, fieldBrush{};
    UINT dpi = 96;
    View view = View::Idle;
    bool selectionActive = false;
    bool reselectRequested = false;
    bool exitRequested = false, dialogActive = false;
    bool donePending = false;
    DoneReason pendingReason = DoneStopped;
    std::wstring pendingDetail;
    WORD selectKey = 0x0352;  // HOTKEYF_CONTROL | HOTKEYF_SHIFT
    bool selectRegistered = false, escapeRegistered = false, discardWhenStopped = false;
    bool defaultGif = true, autoSave = false, copyToClipboard = true;
    bool hotkeysSuspended = false;
    std::wstring clipboardPath;
    DWORD clipboardSequence = 0;
    bool toolbarInsideRegion = false;
    bool pendingRegion = false;
    RECT previousRegion{};
    std::wstring settingsPath;
    HICON trayIcons[3]{};
    bool trayAdded = false;
    std::wstring temporaryPath, lastSavedPath;
    std::wstring completionNotice;
    bool outputGif = false;
    std::mutex regionMutex;
    RECT region{100, 100, 740, 460};
    std::atomic<int> fps{60};
    std::atomic<bool> captureCursor{true};
    std::atomic<bool> running{false}, paused{false}, stopRequested{false};
    std::atomic<uint64_t> frameCount{0}, outputBytes{0};
    std::atomic<int64_t> recordedTime100ns{0};
    std::thread worker;
};

extern AppState g_app;
void RecordingWorker(bool gif, std::wstring outputPath, int canvasWidth, int canvasHeight,
                     RecordingLimits limits);
int RunRecorder(HINSTANCE instance);

}  // namespace lc::recorder
