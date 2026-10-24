#pragma once
#include "common/com_helpers.h"
#include "common/dxgi_pixels.h"
#include <d3d11.h>
#include <chrono>
#include <memory>

namespace lc {
// Pure Desktop Duplication. No WGC initialization or fallback.
class DxgiDesktopCapture {
public:
    DxgiDesktopCapture();
    ~DxgiDesktopCapture();
    DxgiDesktopCapture(const DxgiDesktopCapture&)=delete;
    DxgiDesktopCapture& operator=(const DxgiDesktopCapture&)=delete;
    bool Capture(const RECT& region,bool cursor,std::vector<uint8_t>& output,int& width,int& height,std::wstring& error);
    void Stop();
private:
    struct Source;
    bool Initialize(Source& source,std::wstring& error);
    bool Poll(Source& source,const RECT& crop,std::wstring& error);
    std::vector<std::unique_ptr<Source>> sources_;
    dxgi::PointerState pointer_;
};
} // namespace lc
