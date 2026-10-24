#include "common/dxgi_capture.h"
#include <chrono>
#include <iostream>
#include <thread>

namespace {
using Clock=std::chrono::steady_clock;
void Pump(){MSG m{};while(PeekMessageW(&m,nullptr,0,0,PM_REMOVE)){TranslateMessage(&m);DispatchMessageW(&m);}}
LRESULT CALLBACK SourceProc(HWND window,UINT message,WPARAM w,LPARAM l) {
    if(message==WM_PAINT) {
        PAINTSTRUCT ps{};HDC dc=BeginPaint(window,&ps);RECT r{};GetClientRect(window,&r);
        HBRUSH brush=CreateSolidBrush(static_cast<COLORREF>(GetWindowLongPtrW(window,GWLP_USERDATA)));
        FillRect(dc,&r,brush);DeleteObject(brush);EndPaint(window,&ps);return 0;
    }
    return DefWindowProcW(window,message,w,l);
}
HWND Source(RECT r,COLORREF color) {
    HWND window=CreateWindowExW(WS_EX_TOPMOST|WS_EX_TOOLWINDOW,L"LCDxgiLiveSource",L"DXGI live test",
        WS_POPUP,r.left,r.top,r.right-r.left,r.bottom-r.top,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    SetWindowLongPtrW(window,GWLP_USERDATA,color);ShowWindow(window,SW_SHOWNOACTIVATE);UpdateWindow(window);return window;
}
bool Near(const std::vector<uint8_t>& data,int width,int x,int y,COLORREF color) {
    const auto* p=data.data()+(static_cast<size_t>(y)*width+x)*4;
    return abs(p[0]-GetBValue(color))<4 && abs(p[1]-GetGValue(color))<4 && abs(p[2]-GetRValue(color))<4;
}
template<class Check> bool Until(lc::DxgiDesktopCapture& capture,RECT region,bool cursor,std::vector<uint8_t>& pixels,Check check) {
    const auto end=Clock::now()+std::chrono::seconds(5);
    while(Clock::now()<end) {
        Pump();int width=0,height=0;std::wstring error;
        if(capture.Capture(region,cursor,pixels,width,height,error) && check(pixels,width,height)) return true;
        if(!error.empty()){std::wcerr<<error<<L'\n';return false;}
        std::this_thread::sleep_for(std::chrono::milliseconds(15));
    }
    return false;
}
BOOL CALLBACK Monitors(HMONITOR,HDC,LPRECT rect,LPARAM data){reinterpret_cast<std::vector<RECT>*>(data)->push_back(*rect);return TRUE;}
}
int wmain() {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    WNDCLASSW wc{};wc.hInstance=GetModuleHandleW(nullptr);wc.lpfnWndProc=SourceProc;
    wc.hCursor=LoadCursorW(nullptr,IDC_ARROW);wc.lpszClassName=L"LCDxgiLiveSource";RegisterClassW(&wc);
    POINT previous{};GetCursorPos(&previous);
    const RECT region{300,200,620,420};
    const COLORREF base=RGB(37,37,38),front=RGB(170,30,70);
    HWND background=Source(region,base),overlay=Source({380,240,460,300},front);
    SetCursorPos(700,500);
    lc::DxgiDesktopCapture capture;std::vector<uint8_t> pixels;
    bool ok=Until(capture,region,false,pixels,[&](const auto& p,int w,int h){return w==320 && h==220 && Near(p,w,10,10,base) && Near(p,w,100,60,front);});
    std::cout<<"frontmost overlapping windows="<<(ok?"PASS":"FAIL")<<'\n';
    ShowWindow(overlay,SW_HIDE);UpdateWindow(background);
    bool changed=Until(capture,region,false,pixels,[&](const auto& p,int w,int){return Near(p,w,100,60,base);});
    ok=changed&&ok;std::cout<<"uncovering source updates desktop="<<(changed?"PASS":"FAIL")<<'\n';
    RECT smaller{320,220,416,292};
    bool cropped=Until(capture,smaller,false,pixels,[&](const auto& p,int w,int h){return w==96 && h==72 && Near(p,w,20,20,base);});
    ok=cropped&&ok;std::cout<<"static desktop ROI change="<<(cropped?"PASS":"FAIL")<<'\n';
    SetCursorPos(410,280);SetCursor(LoadCursorW(nullptr,IDC_ARROW));
    bool cursorSeen=Until(capture,region,true,pixels,[&](const auto& p,int w,int){
        int different=0;for(int y=72;y<130;y++)for(int x=102;x<165;x++)if(!Near(p,w,x,y,base))++different;
        return different>10;
    });
    bool cursorHidden=Until(capture,region,false,pixels,[&](const auto& p,int w,int){
        for(int y=72;y<130;y++)for(int x=102;x<165;x++)if(!Near(p,w,x,y,base))return false;return true;
    });
    ok=cursorSeen&&cursorHidden&&ok;std::cout<<"real cursor enabled="<<cursorSeen<<" disabled="<<cursorHidden<<" result="<<(cursorSeen&&cursorHidden?"PASS":"FAIL")<<'\n';
    capture.Stop();
    bool restarted=Until(capture,smaller,false,pixels,[&](const auto& p,int w,int){return Near(p,w,20,20,base);});
    ok=restarted&&ok;capture.Stop();DestroyWindow(overlay);DestroyWindow(background);
    std::cout<<"duplication release/restart="<<(restarted?"PASS":"FAIL")<<'\n';
    std::vector<RECT> monitors;EnumDisplayMonitors(nullptr,nullptr,Monitors,reinterpret_cast<LPARAM>(&monitors));
    bool adjacent=false;
    for(size_t a=0;a<monitors.size() && !adjacent;++a)for(size_t b=a+1;b<monitors.size() && !adjacent;++b) {
        auto left=monitors[a],right=monitors[b];if(left.left>right.left)std::swap(left,right);
        if(left.right!=right.left || std::min(left.bottom,right.bottom)-std::max(left.top,right.top)<200)continue;
        adjacent=true;const LONG seam=left.right,top=std::max(left.top,right.top)+100;
        RECT area{seam-120,top,seam+120,top+160};HWND source=Source(area,base);
        bool moved=true;
        for(int x:{-4,4,-4}) {
            SetCursorPos(seam+x,top+40);SetCursor(LoadCursorW(nullptr,IDC_ARROW));
            moved=Until(capture,area,true,pixels,[&](const auto& p,int w,int h){
                if(w!=240 || h!=160)return false;int different=0;
                for(int y=32;y<90;y++)for(int px=108;px<175;px++)if(!Near(p,w,px,y,base))++different;
                return different>10;
            })&&moved;
        }
        ok=moved&&ok;std::cout<<"cross-monitor cursor ownership and negative coordinates="<<(moved?"PASS":"FAIL")<<'\n';
        capture.Stop();DestroyWindow(source);
    }
    if(!adjacent)std::cout<<"cross-monitor cursor hardware SKIP: no horizontal adjacent pair\n";
    SetCursorPos(previous.x,previous.y);
    return ok?0:1;
}
