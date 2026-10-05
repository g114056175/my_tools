#include "project1_region_recorder/desktop_capture.h"
#include "project1_region_recorder/gif_writer.h"
#include "project1_region_recorder/region_selector.h"

#include <chrono>
#include <iostream>
#include <thread>

namespace {
struct Monitor { RECT rect; };
BOOL CALLBACK Enumerate(HMONITOR handle, HDC, LPRECT, LPARAM data) {
    MONITORINFO info{}; info.cbSize = sizeof(info);
    if (GetMonitorInfoW(handle, &info))
        reinterpret_cast<std::vector<Monitor>*>(data)->push_back({info.rcMonitor});
    return TRUE;
}
LRESULT CALLBACK SourceProc(HWND window, UINT message, WPARAM w, LPARAM l) {
    if (message == WM_PAINT) {
        PAINTSTRUCT paint{}; auto dc = BeginPaint(window, &paint);
        RECT rect{}; GetClientRect(window, &rect);
        auto brush = CreateSolidBrush(static_cast<COLORREF>(GetWindowLongPtrW(window, GWLP_USERDATA)));
        FillRect(dc, &rect, brush); DeleteObject(brush);
        EndPaint(window, &paint); return 0;
    }
    return DefWindowProcW(window, message, w, l);
}
void Pump() {
    MSG m{};
    while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&m); DispatchMessageW(&m);
    }
}
bool Near(const std::vector<uint8_t>& pixels, int width, int x, int y, COLORREF color, int tolerance=4) {
    const auto* p = pixels.data() + (static_cast<size_t>(y) * width + x) * 4;
    return abs(p[0] - GetBValue(color)) <= tolerance && abs(p[1] - GetGValue(color)) <= tolerance &&
           abs(p[2] - GetRValue(color)) <= tolerance;
}
bool DecodeGif(const std::wstring& path, UINT index, std::vector<uint8_t>& pixels, int& width, int& height) {
    lc::ComPtr<IWICImagingFactory> factory;
    lc::ComPtr<IWICBitmapDecoder> decoder;
    lc::ComPtr<IWICBitmapFrameDecode> frame;
    lc::ComPtr<IWICFormatConverter> converter;
    UINT w=0,h=0;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&factory))) ||
        FAILED(factory->CreateDecoderFromFilename(path.c_str(),nullptr,GENERIC_READ,WICDecodeMetadataCacheOnLoad,&decoder)) ||
        FAILED(decoder->GetFrame(index,&frame)) || FAILED(frame->GetSize(&w,&h)) ||
        FAILED(factory->CreateFormatConverter(&converter)) ||
        FAILED(converter->Initialize(frame.Get(),GUID_WICPixelFormat32bppBGRA,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom))) return false;
    width=w; height=h; pixels.resize(static_cast<size_t>(w)*h*4);
    return SUCCEEDED(converter->CopyPixels(nullptr,w*4,static_cast<UINT>(pixels.size()),pixels.data()));
}
bool TestPalette(const std::wstring& path) {
    lc::GifWriter writer; std::wstring error;
    if (!writer.Open(path,256,128,10'000'000,error)) return false;
    std::vector<uint8_t> pixels(256*128*4,255);
    const COLORREF colors[]{RGB(18,18,18),RGB(30,30,30),RGB(32,32,32),RGB(37,37,38),
        RGB(45,45,45),RGB(60,60,60),RGB(85,85,85),RGB(128,128,128),
        RGB(255,0,0),RGB(0,255,0),RGB(0,0,255),RGB(0,210,255),
        RGB(220,170,60),RGB(160,80,180),RGB(64,88,160),RGB(255,255,255)};
    const auto expected = [&](int i, int frame) {
        const auto c = colors[i];
        return frame == 0 ? c : RGB(255-GetRValue(c),255-GetGValue(c),255-GetBValue(c));
    };
    for (int f=0; f<2; ++f) {
        for (int y=0;y<128;++y) for (int x=0;x<256;++x) {
            auto color=expected((y/32)*4+x/64,f);
            auto* p=pixels.data()+(y*256+x)*4;
            p[0]=GetBValue(color); p[1]=GetGValue(color); p[2]=GetRValue(color);
        }
        bool limit=false;
        if (!writer.AddBgraFrame(pixels,5,limit,error)) return false;
    }
    if (!writer.Close(&error)) return false;
    for (int f=0;f<2;++f) {
        int w=0,h=0;
        if (!DecodeGif(path,f,pixels,w,h) || w!=256 || h!=128) return false;
        for (int i=0;i<16;++i)
            if (!Near(pixels,w,(i%4)*64+32,(i/4)*32+16,expected(i,f))) {
                auto* p=pixels.data()+(((i/4)*32+16)*w+(i%4)*64+32)*4;
                const auto c=expected(i,f);
                std::cout<<"palette mismatch frame="<<f<<" patch="<<i<<" got="<<int(p[2])<<","<<int(p[1])<<","<<int(p[0])
                    <<" expected="<<int(GetRValue(c))<<","<<int(GetGValue(c))<<","<<int(GetBValue(c))<<'\n';
                return false;
            }
    }
    return true;
}
bool TestRegion(const RECT& roi, const std::vector<Monitor>& monitors, const std::wstring& path) {
    std::vector<HWND> windows;
    std::vector<std::pair<RECT,COLORREF>> patches;
    const COLORREF colors[]{RGB(32,32,32),RGB(64,88,160),RGB(120,50,80),RGB(45,45,45)};
    for (size_t i=0;i<monitors.size();++i) {
        RECT crop{};
        if (!IntersectRect(&crop,&roi,&monitors[i].rect)) continue;
        HWND window=CreateWindowExW(WS_EX_TOPMOST|WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE,L"LCVisualSource",L"Visual test",
            WS_POPUP,crop.left,crop.top,crop.right-crop.left,crop.bottom-crop.top,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
        SetWindowLongPtrW(window,GWLP_USERDATA,colors[i%4]);
        ShowWindow(window,SW_SHOWNOACTIVATE); UpdateWindow(window);
        windows.push_back(window); patches.push_back({crop,colors[i%4]});
    }
    // Exercise the real ROI outline: ordinary edges stay outside the capture,
    // while edges clipped at a desktop boundary are excluded by Windows.
    RECT marker=roi;
    lc::ShowRegionMarker(GetModuleHandleW(nullptr),marker,true);
    HWND markerWindow=FindWindowW(L"LightCaptureRegionMarker",nullptr);
    DWORD affinity=0;
    const LONG left=GetSystemMetrics(SM_XVIRTUALSCREEN), top=GetSystemMetrics(SM_YVIRTUALSCREEN);
    const bool edgeInside=roi.left-3<left || roi.top-3<top ||
        roi.right+3>left+GetSystemMetrics(SM_CXVIRTUALSCREEN) ||
        roi.bottom+3>top+GetSystemMetrics(SM_CYVIRTUALSCREEN);
    bool ok=markerWindow && GetWindowDisplayAffinity(markerWindow,&affinity) &&
        affinity==(edgeInside?0x11u:0u);
    lc::DesktopCapture capture;
    std::vector<uint8_t> pixels; int width=0,height=0; std::wstring error;
    bool captured=false;
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(5);
    while (std::chrono::steady_clock::now()<deadline) {
        Pump();
        if(capture.Capture(roi,false,pixels,width,height,error)) { captured=true; break; }
        if(!error.empty()) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    ok=ok && captured && width==roi.right-roi.left && height==roi.bottom-roi.top;
    if(ok) {
        // Check the whole interior, including every marker edge and monitor seam.
        for(const auto& [crop,color]:patches)
            for(int y=crop.top+2;y<crop.bottom-2 && ok;++y)
                for(int x=crop.left+2;x<crop.right-2;++x)
                    if(!Near(pixels,width,x-roi.left,y-roi.top,color)) { ok=false; break; }
        lc::GifWriter writer; bool limit=false;
        ok=ok && writer.Open(path,width,height,100'000'000,error) &&
            writer.AddBgraFrame(pixels,10,limit,error) && writer.Close(&error);
        if(ok) {
            ok=DecodeGif(path,0,pixels,width,height);
            for(const auto& [crop,color]:patches)
                ok=ok && Near(pixels,width,(crop.left+crop.right)/2-roi.left,(crop.top+crop.bottom)/2-roi.top,color);
        }
    }
    if(!error.empty()) std::wcerr<<error<<L'\n';
    capture.Stop(); lc::HideRegionMarker();
    for(auto window:windows) DestroyWindow(window);
    std::cout<<"region "<<roi.left<<","<<roi.top<<" "<<roi.right-roi.left<<"x"<<roi.bottom-roi.top
             <<" monitors="<<patches.size()<<" markerExcluded="<<(affinity==0x11)<<" result="<<(ok?"PASS":"FAIL")<<'\n';
    return ok;
}
}
int wmain(int argc,wchar_t** argv) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    std::wstring directory=argc>1?argv[1]:L".";
    CreateDirectoryW(directory.c_str(),nullptr);
    WNDCLASSW wc{}; wc.hInstance=GetModuleHandleW(nullptr); wc.lpfnWndProc=SourceProc; wc.lpszClassName=L"LCVisualSource";
    RegisterClassW(&wc);
    bool ok=TestPalette(directory+L"/palette.gif");
    std::cout<<"adaptive palette neutral grays + colors + frame 2: "<<(ok?"PASS":"FAIL")<<'\n';
    std::vector<Monitor> monitors;
    EnumDisplayMonitors(nullptr,nullptr,Enumerate,reinterpret_cast<LPARAM>(&monitors));
    if(monitors.empty()) return 2;
    for(const auto& m:monitors) std::cout<<"monitor "<<m.rect.left<<","<<m.rect.top<<","<<m.rect.right<<","<<m.rect.bottom<<'\n';
    auto r=monitors[0].rect;
    RECT single{r.left,r.top+80,r.left+240,r.top+240};
    ok=TestRegion(single,monitors,directory+L"/single.gif") && ok;
    const auto edge=std::min_element(monitors.begin(),monitors.end(),
        [](const Monitor& a,const Monitor& b){return a.rect.left<b.rect.left;})->rect;
    RECT boundary{edge.left,edge.top+80,edge.left+240,edge.top+240};
    ok=TestRegion(boundary,monitors,directory+L"/boundary.gif") && ok;
    bool multi=false;
    for(size_t i=0;i<monitors.size() && !multi;++i) for(size_t j=i+1;j<monitors.size() && !multi;++j) {
        auto a=monitors[i].rect,b=monitors[j].rect; RECT roi{};
        LONG top=std::max(a.top,b.top),bottom=std::min(a.bottom,b.bottom);
        LONG left=std::max(a.left,b.left),right=std::min(a.right,b.right);
        if((a.right==b.left || b.right==a.left) && bottom-top>=180) {
            LONG seam=a.right==b.left?a.right:b.right;
            roi={seam-160,top+20,seam+160,top+180};
        } else if((a.bottom==b.top || b.bottom==a.top) && right-left>=180) {
            LONG seam=a.bottom==b.top?a.bottom:b.bottom;
            roi={left+20,seam-160,left+180,seam+160};
        } else continue;
        multi=true; ok=TestRegion(roi,monitors,directory+L"/multi.gif") && ok;
    }
    if(!multi) std::cout<<"Cross-monitor hardware test SKIP: no adjacent monitor pair\n";
    CoUninitialize();
    return ok?0:1;
}
