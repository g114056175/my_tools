#pragma once

#include "common/com_helpers.h"

#include <d3d11.h>
// LLVM-MinGW currently emits BYTE and WinRT boolean as the same C++ specialization in
// windows.foundation.h. This unused BYTE reference interface is skipped to avoid that header bug.
#if defined(__MINGW32__)
#define ____FIReference_1_BYTE_INTERFACE_DEFINED__
#endif
#include <windows.graphics.capture.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#include <cstdint>
#include <string>
#include <vector>

namespace lc {

// A small ABI-level Windows.Graphics.Capture wrapper. It intentionally avoids a dependency on
// C++/WinRT so the applications can also be built by LLVM-MinGW.
class WgcCapture {
public:
    WgcCapture() = default;
    ~WgcCapture();
    WgcCapture(const WgcCapture&) = delete;
    WgcCapture& operator=(const WgcCapture&) = delete;

    // showSystemCaptureBorder=false asks supported Windows versions not to draw the
    // colored capture indicator around the source. The OS may still require user consent.
    bool StartForWindow(HWND window, std::wstring& error,
                        bool showSystemCaptureBorder = true);
    bool StartForMonitor(HMONITOR monitor, std::wstring& error, bool captureCursor = true);
    void Stop();
    // Available on Windows 10 2004+. Older systems retain their system default.
    bool SetCursorCaptureEnabled(bool enabled);
    bool GetCursorCaptureEnabled(bool& enabled) const;

    // sourceRect is relative to the captured item. Pass nullptr for the complete item.
    // Returns false when no new frame is currently available or the source was lost.
    bool CaptureLatest(std::vector<uint8_t>& bgra, int& width, int& height,
                       const RECT* sourceRect = nullptr);

    SIZE SourceSize() const { return {sourceWidth_, sourceHeight_}; }
    bool IsRunning() const { return session_ != nullptr; }

private:
    bool StartItem(IUnknown* itemUnknown, std::wstring& error,
                   bool showSystemCaptureBorder = true, bool captureCursor = true);
    bool CreateDevice(std::wstring& error);
    void CloseInspectable(IInspectable* value);
    bool EnsureStaging(int width, int height);

    ComPtr<ID3D11Device> device_;
    ComPtr<ID3D11DeviceContext> context_;
    ComPtr<ABI::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice> winrtDevice_;
    ComPtr<ABI::Windows::Graphics::Capture::IGraphicsCaptureItem> item_;
    ComPtr<ABI::Windows::Graphics::Capture::IDirect3D11CaptureFramePool> framePool_;
    ComPtr<ABI::Windows::Graphics::Capture::IGraphicsCaptureSession> session_;
    ComPtr<ID3D11Texture2D> staging_;
    int stagingWidth_ = 0;
    int stagingHeight_ = 0;
    int sourceWidth_ = 0;
    int sourceHeight_ = 0;
    bool roNeedsUninitialize_ = false;
};

}  // namespace lc
