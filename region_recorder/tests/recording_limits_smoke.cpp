#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <wincodec.h>

#include <chrono>
#include <iostream>
#include <memory>
#include <vector>

#include "common/com_helpers.h"
#include "project1_region_recorder/recorder_app.h"

namespace lc::recorder {
AppState g_app;
}
using namespace lc::recorder;
namespace {
bool done = false;
DoneReason reason = DoneStopped;
std::wstring detail;
bool Readable(bool gif, const std::wstring& path) {
    if (gif) {
        lc::ComPtr<IWICImagingFactory> factory;
        lc::ComPtr<IWICBitmapDecoder> decoder;
        lc::ComPtr<IWICBitmapFrameDecode> frame;
        lc::ComPtr<IWICFormatConverter> converter;
        UINT count = 0, width = 0, height = 0;
        if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_PPV_ARGS(&factory))) ||
            FAILED(factory->CreateDecoderFromFilename(path.c_str(), nullptr, GENERIC_READ,
                                                      WICDecodeMetadataCacheOnLoad, &decoder)) ||
            FAILED(decoder->GetFrameCount(&count)) || count == 0 ||
            FAILED(decoder->GetFrame(count - 1, &frame)) ||
            FAILED(frame->GetSize(&width, &height)) ||
            FAILED(factory->CreateFormatConverter(&converter)) ||
            FAILED(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppBGRA,
                                         WICBitmapDitherTypeNone, nullptr, 0,
                                         WICBitmapPaletteTypeCustom)))
            return false;
        std::vector<BYTE> pixels(static_cast<size_t>(width) * height * 4);
        return SUCCEEDED(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(pixels.size()),
                                               pixels.data()));
    }
    lc::ComPtr<IMFSourceReader> reader;
    lc::ComPtr<IMFMediaType> type;
    if (FAILED(MFCreateSourceReaderFromURL(path.c_str(), nullptr, &reader)) ||
        FAILED(MFCreateMediaType(&type)))
        return false;
    type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
    if (FAILED(
            reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, type.Get())))
        return false;
    int decoded = 0;
    for (int i = 0; i < 1000; ++i) {
        DWORD flags = 0;
        lc::ComPtr<IMFSample> sample;
        if (FAILED(reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, nullptr, &flags,
                                      nullptr, &sample)))
            return false;
        if (sample) ++decoded;
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) return decoded > 0;
    }
    return false;
}
LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_TIMER) {
        InvalidateRect(window, nullptr, FALSE);
        return 0;
    }
    if (message == WM_PAINT) {
        PAINTSTRUCT paint{};
        HDC dc = BeginPaint(window, &paint);
        static uint32_t random = 1234567;
        std::vector<uint32_t> pixels(160 * 120);
        for (auto& pixel : pixels) {
            random ^= random << 13;
            random ^= random >> 17;
            random ^= random << 5;
            pixel = random | 0xff000000;
        }
        BITMAPINFO info{};
        info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biWidth = 160;
        info.bmiHeader.biHeight = -120;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        StretchDIBits(dc, 0, 0, 160, 120, 0, 0, 160, 120, pixels.data(), &info, DIB_RGB_COLORS,
                      SRCCOPY);
        EndPaint(window, &paint);
        return 0;
    }
    if (message == WM_CAPTURE_DONE) {
        std::unique_ptr<std::wstring> text(reinterpret_cast<std::wstring*>(l));
        detail = *text;
        reason = static_cast<DoneReason>(w);
        done = true;
        return 0;
    }
    return DefWindowProcW(window, message, w, l);
}
bool Run(bool gif, bool size, const std::wstring& path) {
    const RecordingLimits limits = size
                                       ? RecordingLimits{gif ? 450'000ULL : 200'000ULL, 100'000'000}
                                       : RecordingLimits{100'000'000, 10'000'000};
    done = false;
    detail.clear();
    g_app.stopRequested = false;
    g_app.paused = !size;
    g_app.frameCount = 0;
    g_app.outputBytes = 0;
    g_app.recordedTime100ns = 0;
    g_app.fps = gif ? 24 : 60;
    g_app.captureCursor = false;
    const auto start = std::chrono::steady_clock::now();
    std::thread worker(RecordingWorker, gif, path, 160, 120, limits);
    bool pausedFrames = false;
    while (!done && std::chrono::steady_clock::now() - start < std::chrono::seconds(13)) {
        MSG message{};
        while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if (!size && g_app.paused &&
            std::chrono::steady_clock::now() - start > std::chrono::milliseconds(500)) {
            pausedFrames = g_app.frameCount != 0 || g_app.recordedTime100ns != 0;
            g_app.paused = false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    g_app.stopRequested = true;
    worker.join();
    WIN32_FILE_ATTRIBUTE_DATA file{};
    const bool exists = GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &file) != FALSE;
    const uint64_t bytes = (static_cast<uint64_t>(file.nFileSizeHigh) << 32) | file.nFileSizeLow;
    const bool readable = exists && Readable(gif, path);
    const bool okay = done && reason == (size ? DoneSizeLimit : DoneTimeLimit) && !pausedFrames &&
                      readable && g_app.frameCount > 0 &&
                      g_app.recordedTime100ns <= limits.duration100ns && exists && bytes > 100 &&
                      bytes <= limits.bytes;
    std::cout << (gif ? "GIF" : "MP4") << (size ? " capacity" : " time/pause")
              << " frames=" << g_app.frameCount << " bytes=" << bytes << " reason=" << reason
              << " decoded=" << readable << " result=" << (okay ? "PASS" : "FAIL") << '\n';
    if (!detail.empty()) std::wcerr << detail << L'\n';
    DeleteFileW(path.c_str());
    return okay;
}
}  // namespace
int wmain() {
    static_assert(LimitsFor(true).bytes == 300'000'000 &&
                  LimitsFor(true).duration100ns == 600'000'000);
    static_assert(LimitsFor(false).bytes == 4'000'000'000 &&
                  LimitsFor(false).duration100ns == 18'000'000'000);
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    MFStartup(MF_VERSION);
    WNDCLASSW wc{};
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpfnWndProc = WindowProc;
    wc.lpszClassName = L"LightCaptureLimitsTest";
    RegisterClassW(&wc);
    g_app.window =
        CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, wc.lpszClassName, L"Limits test source",
                        WS_POPUP, 80, 80, 160, 120, nullptr, nullptr, wc.hInstance, nullptr);
    g_app.region = {80, 80, 240, 200};
    ShowWindow(g_app.window, SW_SHOWNOACTIVATE);
    UpdateWindow(g_app.window);
    SetTimer(g_app.window, 1, 16, nullptr);
    wchar_t temp[MAX_PATH]{};
    GetTempPathW(ARRAYSIZE(temp), temp);
    const auto base =
        std::wstring(temp) + L"LightCapture-limits-test-" + std::to_wstring(GetCurrentProcessId());
    bool okay = true;
    for (bool size : {false, true})
        for (bool gif : {true, false})
            okay = Run(gif, size, base + (gif ? L".gif" : L".mp4")) && okay;
    KillTimer(g_app.window, 1);
    DestroyWindow(g_app.window);
    MFShutdown();
    CoUninitialize();
    return okay ? 0 : 1;
}
