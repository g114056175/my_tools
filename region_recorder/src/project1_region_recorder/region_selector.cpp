#include "project1_region_recorder/region_selector.h"

#include <windowsx.h>

#include <algorithm>
#include <cstdint>
#include <string>

#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

namespace lc {
namespace {

HWND g_marker = nullptr;
HWND g_selector = nullptr;
constexpr COLORREF kMarkerKey = RGB(1, 2, 3);

struct SelectorState {
    int virtualX = 0;
    int virtualY = 0;
    POINT start{};
    POINT current{};
    bool dragging = false;
    bool accepted = false;
    RECT result{};
};

RECT Normalize(POINT a, POINT b) {
    return {std::min(a.x, b.x), std::min(a.y, b.y), std::max(a.x, b.x), std::max(a.y, b.y)};
}

void RenderSelector(HWND window, const SelectorState* state) {
    RECT client{}; GetClientRect(window, &client);
    const int width=client.right, height=client.bottom;
    if(width<=0 || height<=0) return;
    HDC screen=GetDC(nullptr), buffer=CreateCompatibleDC(screen);
    BITMAPINFO info{}; info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth=width; info.bmiHeader.biHeight=-height;
    info.bmiHeader.biPlanes=1; info.bmiHeader.biBitCount=32; info.bmiHeader.biCompression=BI_RGB;
    void* bits{}; HBITMAP bitmap=CreateDIBSection(screen,&info,DIB_RGB_COLORS,&bits,nullptr,0);
    if(!bitmap) { DeleteDC(buffer); ReleaseDC(nullptr,screen); return; }
    auto old=SelectObject(buffer,bitmap);
    auto* pixels=static_cast<uint32_t*>(bits);
    std::fill(pixels,pixels+static_cast<size_t>(width)*height,0x69000000u);
    if(state && state->dragging) {
        RECT selected=Normalize(state->start,state->current), clipped{};
        IntersectRect(&clipped,&selected,&client);
        for(int y=clipped.top;y<clipped.bottom;++y) {
            for(int x=clipped.left;x<clipped.right;++x) {
                const bool edge=x-selected.left<3 || selected.right-1-x<3 ||
                    y-selected.top<3 || selected.bottom-1-y<3;
                pixels[static_cast<size_t>(y)*width+x]=edge?0xff00d2ffu:0;
            }
        }
    }
    // Hide the hint once dragging starts, so it cannot cover any selected edge.
    if(!state || !state->dragging) {
        RECT hint{20,16,std::min(width,480),48};
        HBRUSH brush=CreateSolidBrush(RGB(18,25,35)); FillRect(buffer,&hint,brush); DeleteObject(brush);
        SetBkMode(buffer,TRANSPARENT); SetTextColor(buffer,RGB(255,255,255));
        RECT label=hint; label.left+=10;
        DrawTextW(buffer,L"拖曳框選；Esc 或右鍵取消",-1,&label,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
        for(int y=hint.top;y<std::min<int>(height,hint.bottom);++y)
            for(int x=hint.left;x<hint.right;++x) pixels[static_cast<size_t>(y)*width+x]|=0xff000000u;
    }
    RECT bounds{}; GetWindowRect(window,&bounds);
    POINT destination{bounds.left,bounds.top}, origin{}; SIZE size{width,height};
    BLENDFUNCTION blend{AC_SRC_OVER,0,255,AC_SRC_ALPHA};
    UpdateLayeredWindow(window,screen,&destination,&size,buffer,&origin,0,&blend,ULW_ALPHA);
    SelectObject(buffer,old); DeleteObject(bitmap); DeleteDC(buffer); ReleaseDC(nullptr,screen);
}

LRESULT CALLBACK SelectorProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* state = reinterpret_cast<SelectorState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        state = static_cast<SelectorState*>(create->lpCreateParams);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
    }
    switch (message) {
    case WM_ACTIVATE:
        if(LOWORD(wParam)==WA_INACTIVE) DestroyWindow(window);
        return 0;
    case WM_SETCURSOR:
        SetCursor(LoadCursorW(nullptr, IDC_CROSS));
        return TRUE;
    case WM_LBUTTONDOWN:
        if (state) {
            state->start = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            state->current = state->start;
            state->dragging = true;
            SetCapture(window);
            RenderSelector(window, state);
        }
        return 0;
    case WM_MOUSEMOVE:
        if (state && state->dragging && (wParam & MK_LBUTTON)) {
            state->current = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            RenderSelector(window, state);
        }
        return 0;
    case WM_LBUTTONUP:
        if (state && state->dragging) {
            state->current = {GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            state->dragging = false;
            ReleaseCapture();
            RECT local = Normalize(state->start, state->current);
            if (local.right - local.left >= 8 && local.bottom - local.top >= 8) {
                state->result = {local.left + state->virtualX, local.top + state->virtualY,
                                 local.right + state->virtualX, local.bottom + state->virtualY};
                state->accepted = true;
                DestroyWindow(window);
            } else RenderSelector(window, state);
        }
        return 0;
    case WM_KEYDOWN:
        if (wParam == VK_ESCAPE) DestroyWindow(window);
        return 0;
    case WM_RBUTTONDOWN:
        DestroyWindow(window);
        return 0;
    case WM_NCDESTROY:
        if (g_selector == window) g_selector = nullptr;
        break;
    case WM_ERASEBKGND: return TRUE;
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        BeginPaint(window, &paint);
        EndPaint(window, &paint);
        RenderSelector(window, state);
        return 0;
    }
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

LRESULT CALLBACK MarkerProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (message == WM_ERASEBKGND) return TRUE;
    // The outline follows physical desktop pixels, not a suggested DPI-scaled rect.
    if (message == WM_DPICHANGED) return 0;
    if (message == WM_PAINT) {
        PAINTSTRUCT paint{};
        HDC dc = BeginPaint(window, &paint);
        RECT client{};
        GetClientRect(window, &client);
        HBRUSH key = CreateSolidBrush(kMarkerKey);
        FillRect(dc, &client, key);
        DeleteObject(key);
        const int thickness = std::min<int>(kRegionMarkerThickness,
            std::min(client.right, client.bottom) / 2);
        const RECT edges[]{
            {0, 0, client.right, thickness},
            {0, client.bottom - thickness, client.right, client.bottom},
            {0, thickness, thickness, client.bottom - thickness},
            {client.right - thickness, thickness, client.right, client.bottom - thickness}
        };
        HBRUSH cyan = CreateSolidBrush(RGB(0, 210, 255));
        for (const RECT& edge : edges) FillRect(dc, &edge, cyan);
        DeleteObject(cyan);
        EndPaint(window, &paint);
        return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

bool RegisterMarkerClass(HINSTANCE instance) {
    static bool registered = false;
    if (registered) return true;
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.hInstance = instance;
    wc.lpfnWndProc = MarkerProc;
    wc.lpszClassName = L"LightCaptureRegionMarker";
    registered = RegisterClassExW(&wc) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    return registered;
}

}  // namespace

bool SelectDesktopRegion(HINSTANCE instance, HWND owner, RECT& result) {
    static bool registered = false;
    constexpr wchar_t className[] = L"LightCaptureRegionSelector";
    if (!registered) {
        WNDCLASSEXW wc{};
        wc.cbSize = sizeof(wc);
        wc.hInstance = instance;
        wc.lpfnWndProc = SelectorProc;
        wc.lpszClassName = className;
        wc.hCursor = LoadCursorW(nullptr, IDC_CROSS);
        registered = RegisterClassExW(&wc) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    }
    if (!registered) return false;

    SelectorState state;
    state.virtualX = GetSystemMetrics(SM_XVIRTUALSCREEN);
    state.virtualY = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    EnableWindow(owner, FALSE);
    HWND overlay = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
                                   className, L"選擇擷取範圍", WS_POPUP,
                                   state.virtualX, state.virtualY, width, height, owner, nullptr,
                                   instance, &state);
    if (!overlay) {
        EnableWindow(owner, TRUE);
        return false;
    }
    g_selector = overlay;
    RenderSelector(overlay, &state);
    ShowWindow(overlay, SW_SHOW);
    SetForegroundWindow(overlay);
    SetFocus(overlay);

    MSG message{};
    while (IsWindow(overlay) && GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    EnableWindow(owner, TRUE);
    if (IsWindowVisible(owner) && !IsIconic(owner)) SetForegroundWindow(owner);
    if (state.accepted) result = state.result;
    return state.accepted;
}

void CancelDesktopRegionSelection() {
    if (g_selector && IsWindow(g_selector)) PostMessageW(g_selector, WM_CLOSE, 0, 0);
}

void ShowRegionMarker(HINSTANCE instance, const RECT& region) {
    if (!RegisterMarkerClass(instance)) return;
    const LONG left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const LONG top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const LONG right = left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const LONG bottom = top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
    // Keep edge outlines visible even at the desktop boundary. Capture exclusion
    // keeps these pixels out of the recording, including cross-monitor selections.
    const RECT bounds{
        std::max(region.left - kRegionMarkerThickness, left),
        std::max(region.top - kRegionMarkerThickness, top),
        std::min(region.right + kRegionMarkerThickness, right),
        std::min(region.bottom + kRegionMarkerThickness, bottom)
    };
    const int width = std::max<LONG>(2, bounds.right - bounds.left);
    const int height = std::max<LONG>(2, bounds.bottom - bounds.top);
    if (!g_marker) {
        g_marker = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_LAYERED |
                                       WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
                                   L"LightCaptureRegionMarker", L"", WS_POPUP,
                                   bounds.left, bounds.top, width, height, nullptr, nullptr,
                                   instance, nullptr);
        if (!g_marker) return;
        SetLayeredWindowAttributes(g_marker, kMarkerKey, 255, LWA_COLORKEY);
        SetWindowDisplayAffinity(g_marker, WDA_EXCLUDEFROMCAPTURE);
    }
    SetWindowPos(g_marker, HWND_TOPMOST, bounds.left, bounds.top, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
    RedrawWindow(g_marker, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW);
}

void HideRegionMarker() {
    if (g_marker) ShowWindow(g_marker, SW_HIDE);
}

}  // namespace lc
