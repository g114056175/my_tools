#include <algorithm>
#include <chrono>
#include <cmath>

#include "common/image_utils.h"
#include "common/wgc_capture.h"
#include "project1_region_recorder/gif_writer.h"
#include "project1_region_recorder/mp4_writer.h"
#include "project1_region_recorder/recorder_app.h"

namespace lc::recorder {

void PostDone(DoneReason reason, const std::wstring& detail = {}) {
    auto* message = new std::wstring(detail);
    if (!PostMessageW(g_app.window, WM_CAPTURE_DONE, static_cast<WPARAM>(reason),
                      reinterpret_cast<LPARAM>(message)))
        delete message;
}

void RecordingWorker(bool gif, std::wstring outputPath, int canvasWidth, int canvasHeight,
                     RecordingLimits limits) {
    // H.264 uses an even-sized canvas. Keep the ROI unchanged, and scale into
    // this canvas before encoding so odd selections never misalign RGB rows.
    if (!gif) {
        canvasWidth &= ~1;
        canvasHeight &= ~1;
    }
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    lc::WgcCapture capture;
    const bool captureCursor = g_app.captureCursor.load();
    lc::Mp4Writer mp4;
    lc::GifWriter gifWriter;
    std::wstring error;

    if (gif) {
        if (!gifWriter.Open(outputPath, canvasWidth, canvasHeight, limits.bytes, error)) {
            PostDone(DoneError, error);
            CoUninitialize();
            return;
        }
    } else if (!mp4.Open(outputPath, canvasWidth, canvasHeight, g_app.fps.load(), error)) {
        PostDone(DoneError, error);
        CoUninitialize();
        return;
    }

    HMONITOR activeMonitor = nullptr;
    MONITORINFO monitorInfo{};
    monitorInfo.cbSize = sizeof(monitorInfo);
    RECT previousRegion{};
    std::vector<uint8_t> source;
    std::vector<uint8_t> previousSource;
    std::vector<uint8_t> canvas;
    int previousWidth = 0;
    int previousHeight = 0;
    int64_t mediaTime = 0;
    auto nextFrame = std::chrono::steady_clock::now();
    auto previousTick = nextFrame;
    int64_t activeTime = 0;
    bool previouslyPaused = g_app.paused.load();
    const uint64_t mp4Reserve = Mp4FinalizationReserve(canvasWidth, canvasHeight, limits.bytes);
    DoneReason reason = DoneStopped;

    while (!g_app.stopRequested.load()) {
        const auto tick = std::chrono::steady_clock::now();
        if (!previouslyPaused)
            activeTime +=
                std::chrono::duration_cast<std::chrono::nanoseconds>(tick - previousTick).count() /
                100;
        previousTick = tick;
        previouslyPaused = g_app.paused.load();
        if (previouslyPaused) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            nextFrame = std::chrono::steady_clock::now();
            continue;
        }
        if (activeTime >= limits.duration100ns || mediaTime >= limits.duration100ns) {
            reason = DoneTimeLimit;
            break;
        }
        if (!gif && mp4.CurrentSize() >= limits.bytes - mp4Reserve) {
            reason = DoneSizeLimit;
            break;
        }
        const int fps = std::clamp(g_app.fps.load(), 1, 60);
        const auto interval = std::chrono::nanoseconds(1'000'000'000LL / fps);
        nextFrame += interval;

        RECT region{};
        {
            std::lock_guard lock(g_app.regionMutex);
            region = g_app.region;
        }
        HMONITOR monitor = MonitorFromRect(&region, MONITOR_DEFAULTTONEAREST);
        if (monitor != activeMonitor || !capture.IsRunning()) {
            capture.Stop();
            monitorInfo = {};
            monitorInfo.cbSize = sizeof(monitorInfo);
            GetMonitorInfoW(monitor, &monitorInfo);
            if (!capture.StartForMonitor(monitor, error, captureCursor)) {
                reason = DoneError;
                break;
            }
            activeMonitor = monitor;
            previousSource.clear();
        }
        RECT relative{
            region.left - monitorInfo.rcMonitor.left, region.top - monitorInfo.rcMonitor.top,
            region.right - monitorInfo.rcMonitor.left, region.bottom - monitorInfo.rcMonitor.top};
        int sourceWidth = 0;
        int sourceHeight = 0;
        const bool fresh = capture.CaptureLatest(source, sourceWidth, sourceHeight, &relative);
        if (fresh) {
            previousSource = source;
            previousWidth = sourceWidth;
            previousHeight = sourceHeight;
            previousRegion = region;
        } else if (!previousSource.empty() && EqualRect(&region, &previousRegion)) {
            source = previousSource;
            sourceWidth = previousWidth;
            sourceHeight = previousHeight;
        } else {
            std::this_thread::sleep_until(nextFrame);
            continue;
        }

        lc::AspectFitBgra(source, sourceWidth, sourceHeight, canvas, canvasWidth, canvasHeight);
        int64_t duration = std::max<int64_t>(1, 10'000'000LL / fps);
        duration = std::min(duration, limits.duration100ns - mediaTime);
        if (gif) {
            bool limitReached = false;
            // Distribute centisecond rounding across frames (24 FPS uses 4/5 cs),
            // instead of silently turning every requested 24 FPS GIF into 25 FPS.
            const uint64_t frame = g_app.frameCount.load();
            const int remainingCs = static_cast<int>((limits.duration100ns - mediaTime) / 100'000);
            if (remainingCs <= 0) {
                reason = DoneTimeLimit;
                break;
            }
            const int delay = std::min(
                remainingCs, std::max(1, static_cast<int>(std::llround((frame + 1) * 100.0 / fps) -
                                                          std::llround(frame * 100.0 / fps))));
            duration = static_cast<int64_t>(delay) * 100'000;
            if (!gifWriter.AddBgraFrame(canvas, delay, limitReached, error)) {
                reason = limitReached ? DoneSizeLimit : DoneError;
                break;
            }
            g_app.outputBytes = gifWriter.CurrentSize();
            if (limitReached) {
                reason = DoneSizeLimit;
                break;
            }
        } else if (!mp4.WriteBgra(canvas, mediaTime, duration, error)) {
            reason = DoneError;
            break;
        }
        if (!gif) g_app.outputBytes = mp4.CurrentSize();
        mediaTime += duration;
        g_app.recordedTime100ns = mediaTime;
        ++g_app.frameCount;
        std::this_thread::sleep_until(nextFrame);
        const auto now = std::chrono::steady_clock::now();
        if (nextFrame + interval < now) nextFrame = now;
    }

    capture.Stop();
    if (!(gif ? gifWriter.Close(&error) : mp4.Close(&error))) reason = DoneError;
    {
        WIN32_FILE_ATTRIBUTE_DATA data{};
        if (GetFileAttributesExW(outputPath.c_str(), GetFileExInfoStandard, &data)) {
            g_app.outputBytes =
                (static_cast<uint64_t>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
        }
    }
    if (g_app.frameCount == 0 && reason != DoneStopped) {
        reason = DoneError;
        if (error.empty()) error = L"未取得可保存的畫格，請縮小範圍或重新錄製。";
    } else if (g_app.outputBytes > limits.bytes) {
        reason = DoneError;
        error = L"錄影已停止，但編碼器收尾超出容量上限；請檢查暫存檔。";
    }
    PostDone(reason, error);
    CoUninitialize();
}

}  // namespace lc::recorder

#ifndef LC_RECORDER_WORKER_TEST
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    return lc::recorder::RunRecorder(instance);
}
#endif
