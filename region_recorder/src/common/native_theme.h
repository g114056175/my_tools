#pragma once

// Windows types must precede Common Controls and GDI+ in LLVM-MinGW.
// clang-format off
#include <windows.h>
#include <commctrl.h>
#include <gdiplus.h>
#include <algorithm>
#include <string>
// clang-format on

namespace lc::ui {
inline constexpr COLORREF Background = RGB(17, 21, 28), Panel = RGB(25, 31, 41);
inline constexpr COLORREF Field = RGB(14, 19, 27), Border = RGB(47, 58, 74);
inline constexpr COLORREF Ink = RGB(232, 238, 248), Muted = RGB(149, 163, 184);
inline constexpr COLORREF Accent = RGB(91, 145, 250), Hover = RGB(38, 49, 65);
inline constexpr COLORREF Selected = RGB(36, 57, 89), Danger = RGB(247, 111, 127);

struct Runtime {
    ULONG_PTR token{};
    Runtime() {
        Gdiplus::GdiplusStartupInput input;
        Gdiplus::GdiplusStartup(&token, &input, nullptr);
    }
    ~Runtime() {
        if (token) Gdiplus::GdiplusShutdown(token);
    }
};
inline Gdiplus::Color Color(COLORREF c) { return {255, GetRValue(c), GetGValue(c), GetBValue(c)}; }
inline int Scale(int value, UINT dpi) { return MulDiv(value, dpi, 96); }
inline void Rounded(HDC dc, RECT r, COLORREF fill, COLORREF border, float radius = 8) {
    Gdiplus::Graphics g(dc);
    g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    const float x = static_cast<float>(r.left) + .5f, y = static_cast<float>(r.top) + .5f;
    const float w = static_cast<float>(r.right - r.left) - 1,
                h = static_cast<float>(r.bottom - r.top) - 1;
    if (w <= 0 || h <= 0) return;
    const float d = std::min(radius * 2, std::min(w, h));
    Gdiplus::GraphicsPath p;
    p.AddArc(x, y, d, d, 180, 90);
    p.AddArc(x + w - d, y, d, d, 270, 90);
    p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
    p.AddArc(x, y + h - d, d, d, 90, 90);
    p.CloseFigure();
    Gdiplus::SolidBrush brush(Color(fill));
    Gdiplus::Pen pen(Color(border));
    g.FillPath(&brush, &p);
    g.DrawPath(&pen, &p);
}
inline std::wstring Caption(HWND control) {
    std::wstring text(GetWindowTextLengthW(control) + 1, L'\0');
    GetWindowTextW(control, text.data(), static_cast<int>(text.size()));
    text.pop_back();
    return text;
}
inline void Text(HDC dc, const std::wstring& text, RECT r, HFONT font, COLORREF ink,
                 UINT align = DT_LEFT | DT_VCENTER | DT_SINGLELINE) {
    const int saved = SaveDC(dc);
    IntersectClipRect(dc, r.left, r.top, r.right, r.bottom);
    SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, ink);
    DrawTextW(dc, text.c_str(), -1, &r, align | DT_END_ELLIPSIS | DT_NOPREFIX);
    RestoreDC(dc, saved);
}
enum class Icon {
    None,
    Record,
    Stop,
    Pause,
    Play,
    Select,
    Close,
    Save,
    Copy,
    Folder,
    Hide,
    Refresh,
    Gear,
    Search,
    Check
};
inline void DrawIcon(HDC dc, Icon icon, float x, float y, COLORREF ink, UINT dpi) {
    Gdiplus::Graphics g(dc);
    g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    g.TranslateTransform(x, y);
    const float s = static_cast<float>(dpi) / 96;
    g.ScaleTransform(s, s);
    Gdiplus::Pen p(Color(ink), 1.7f);
    p.SetStartCap(Gdiplus::LineCapRound);
    p.SetEndCap(Gdiplus::LineCapRound);
    Gdiplus::SolidBrush b(Color(ink));
    auto line = [&](float x1, float y1, float x2, float y2) { g.DrawLine(&p, x1, y1, x2, y2); };
    switch (icon) {
        case Icon::Record:
            g.FillEllipse(&b, -6.f, -6.f, 12.f, 12.f);
            break;
        case Icon::Stop:
            g.FillRectangle(&b, -6.f, -6.f, 12.f, 12.f);
            break;
        case Icon::Pause:
            g.FillRectangle(&b, -5.f, -7.f, 3.f, 14.f);
            g.FillRectangle(&b, 2.f, -7.f, 3.f, 14.f);
            break;
        case Icon::Play: {
            Gdiplus::PointF pts[]{{-4, -7}, {7, 0}, {-4, 7}};
            g.FillPolygon(&b, pts, 3);
            break;
        }
        case Icon::Close:
            line(-5, -5, 5, 5);
            line(5, -5, -5, 5);
            break;
        case Icon::Select:
            for (int sx : {-1, 1})
                for (int sy : {-1, 1}) {
                    line(sx * 3.f, sy * 7.f, sx * 7.f, sy * 7.f);
                    line(sx * 7.f, sy * 7.f, sx * 7.f, sy * 3.f);
                }
            break;
        case Icon::Save:
            line(0, -7, 0, 3);
            line(-4, -1, 0, 3);
            line(0, 3, 4, -1);
            line(-7, 3, -7, 7);
            line(-7, 7, 7, 7);
            line(7, 7, 7, 3);
            break;
        case Icon::Copy:
            g.DrawRectangle(&p, -3.f, -3.f, 10.f, 11.f);
            line(-7, 4, -7, -7);
            line(-7, -7, 3, -7);
            break;
        case Icon::Folder: {
            Gdiplus::PointF pts[]{{-8, 6}, {-8, -6}, {-2, -6}, {0, -3}, {8, -3}, {8, 6}, {-8, 6}};
            g.DrawLines(&p, pts, 7);
            break;
        }
        case Icon::Hide:
            line(-7, 2, -7, 7);
            line(-7, 7, 7, 7);
            line(7, 7, 7, 2);
            line(0, -7, 0, 2);
            line(-4, -2, 0, 2);
            line(0, 2, 4, -2);
            break;
        case Icon::Refresh:
            g.DrawArc(&p, -7.f, -7.f, 14.f, 14.f, 30.f, 280.f);
            line(7, -6, 7, -1);
            line(7, -1, 2, -1);
            break;
        case Icon::Search:
            g.DrawEllipse(&p, -7.f, -7.f, 10.f, 10.f);
            line(2, 2, 7, 7);
            break;
        case Icon::Check:
            line(-5, 0, -1, 4);
            line(-1, 4, 6, -4);
            break;
        case Icon::Gear:
            g.DrawEllipse(&p, -5.f, -5.f, 10.f, 10.f);
            g.DrawEllipse(&p, -1.5f, -1.5f, 3.f, 3.f);
            for (int i = 0; i < 8; ++i) {
                line(0, -6, 0, -8);
                g.RotateTransform(45);
            }
            break;
        default:
            break;
    }
}
struct ControlState {
    bool hover = false, toggle = false, checked = false, hotkey = false;
    bool button = false;
    WORD key = 0, originalKey = 0;
    BYTE modifiers = 0;
    UINT dpi = 96;
};
inline constexpr UINT_PTR SubclassId = 0x4c435549;
inline ControlState* State(HWND h) {
    return reinterpret_cast<ControlState*>(GetPropW(h, L"LightCapture.Theme"));
}
inline std::wstring HotkeyCaption(HWND h) {
    WORD key = static_cast<WORD>(SendMessageW(h, HKM_GETHOTKEY, 0, 0));
    std::wstring result;
    if (HIBYTE(key) & HOTKEYF_CONTROL) result += L"Ctrl + ";
    if (HIBYTE(key) & HOTKEYF_SHIFT) result += L"Shift + ";
    if (HIBYTE(key) & HOTKEYF_ALT) result += L"Alt + ";
    if (LOBYTE(key)) {
        wchar_t name[64]{};
        LONG scan = static_cast<LONG>(MapVirtualKeyW(LOBYTE(key), MAPVK_VK_TO_VSC) << 16);
        if (HIBYTE(key) & HOTKEYF_EXT) scan |= 1 << 24;
        GetKeyNameTextW(scan, name, 64);
        result += name;
    } else if (!result.empty())
        result.resize(result.size() - 3);
    return result.empty() ? L"按下組合鍵" : result;
}
inline LRESULT CALLBACK ControlProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR data) {
    auto* state = reinterpret_cast<ControlState*>(data);
    if (state->button && m == WM_ERASEBKGND) return TRUE;
    // This input uses a STATIC host: no native HOTKEY caret or global shortcut dispatch.
    if (state->hotkey) {
        if (m == HKM_GETHOTKEY) return state->key;
        if (m == HKM_SETHOTKEY) {
            state->key = static_cast<WORD>(w);
            InvalidateRect(h, nullptr, FALSE);
            return 0;
        }
        if (m == WM_GETDLGCODE) {
            const auto* keyMessage = reinterpret_cast<MSG*>(l);
            return keyMessage && keyMessage->wParam == VK_TAB ? 0 : DLGC_WANTALLKEYS;
        }
        if (m == WM_LBUTTONDOWN) {
            SetFocus(h);
            return 0;
        }
        if (m == WM_LBUTTONUP || m == WM_LBUTTONDBLCLK || m == WM_CHAR || m == WM_SYSCHAR) return 0;
        if (m == WM_SETFOCUS) {
            state->originalKey = state->key;
            state->modifiers = 0;
        }
        if (m == WM_KEYDOWN || m == WM_SYSKEYDOWN || m == WM_KEYUP || m == WM_SYSKEYUP) {
            const bool down = m == WM_KEYDOWN || m == WM_SYSKEYDOWN;
            BYTE modifier = w == VK_CONTROL ? HOTKEYF_CONTROL
                            : w == VK_SHIFT ? HOTKEYF_SHIFT
                            : w == VK_MENU  ? HOTKEYF_ALT
                                            : 0;
            if (modifier) {
                if (down)
                    state->modifiers |= modifier;
                else
                    state->modifiers &= ~modifier;
                if (down) state->key = MAKEWORD(0, state->modifiers);
            } else if (down) {
                if (w == VK_ESCAPE)
                    state->key = state->originalKey;
                else if (w != VK_TAB && w != VK_LWIN && w != VK_RWIN) {
                    BYTE mods = state->modifiers;
                    if (GetKeyState(VK_CONTROL) & 0x8000) mods |= HOTKEYF_CONTROL;
                    if (GetKeyState(VK_SHIFT) & 0x8000) mods |= HOTKEYF_SHIFT;
                    if (GetKeyState(VK_MENU) & 0x8000) mods |= HOTKEYF_ALT;
                    state->key = MAKEWORD(w, mods);
                }
            }
            InvalidateRect(h, nullptr, FALSE);
            return 0;
        }
    }
    if (state->toggle && m == BM_GETCHECK) return state->checked ? BST_CHECKED : BST_UNCHECKED;
    if (state->toggle && m == BM_SETCHECK) {
        state->checked = w == BST_CHECKED;
        InvalidateRect(h, nullptr, FALSE);
        return 0;
    }
    if (m == WM_MOUSEMOVE && !state->hover) {
        state->hover = true;
        TRACKMOUSEEVENT t{sizeof(t), TME_LEAVE, h, 0};
        TrackMouseEvent(&t);
        InvalidateRect(h, nullptr, FALSE);
    }
    if (m == WM_MOUSELEAVE) {
        state->hover = false;
        InvalidateRect(h, nullptr, FALSE);
    }
    if (m == WM_SETFOCUS || m == WM_KILLFOCUS) {
        InvalidateRect(h, nullptr, FALSE);
        InvalidateRect(GetParent(h), nullptr, FALSE);
    }
    if (state->hotkey && (m == WM_PAINT || m == WM_PRINTCLIENT)) {
        PAINTSTRUCT ps{};
        HDC dc = m == WM_PAINT ? BeginPaint(h, &ps) : reinterpret_cast<HDC>(w);
        RECT r{};
        GetClientRect(h, &r);
        HBRUSH bg = CreateSolidBrush(Panel);
        FillRect(dc, &r, bg);
        DeleteObject(bg);
        Rounded(dc, r, Field, GetFocus() == h ? Accent : Border, Scale(7, state->dpi));
        r.left += Scale(12, state->dpi);
        r.right -= Scale(10, state->dpi);
        Text(dc, HotkeyCaption(h), r, reinterpret_cast<HFONT>(SendMessageW(h, WM_GETFONT, 0, 0)),
             IsWindowEnabled(h) ? Ink : Muted);
        if (m == WM_PAINT) EndPaint(h, &ps);
        return 0;
    }
    if (m == WM_NCDESTROY) {
        RemovePropW(h, L"LightCapture.Theme");
        RemoveWindowSubclass(h, ControlProc, SubclassId);
        delete state;
        return DefSubclassProc(h, m, w, l);
    }
    LRESULT result = DefSubclassProc(h, m, w, l);
    if (state->hotkey && (m == WM_KEYDOWN || m == WM_KEYUP || m == WM_SYSKEYDOWN ||
                          m == WM_SYSKEYUP || m == HKM_SETHOTKEY))
        InvalidateRect(h, nullptr, FALSE);
    return result;
}
inline void Attach(HWND h, UINT dpi, bool toggle = false, bool hotkey = false) {
    auto* state = new ControlState;
    state->dpi = dpi;
    state->toggle = toggle;
    state->hotkey = hotkey;
    wchar_t className[32]{};
    GetClassNameW(h, className, ARRAYSIZE(className));
    state->button = _wcsicmp(className, L"BUTTON") == 0;
    SetPropW(h, L"LightCapture.Theme", state);
    SetWindowSubclass(h, ControlProc, SubclassId, reinterpret_cast<DWORD_PTR>(state));
    if (hotkey) {
        SetWindowLongPtrW(h, GWL_EXSTYLE, GetWindowLongPtrW(h, GWL_EXSTYLE) & ~WS_EX_CLIENTEDGE);
        SetWindowLongPtrW(h, GWL_STYLE, GetWindowLongPtrW(h, GWL_STYLE) & ~WS_BORDER);
        SetWindowPos(h, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}
inline void Toggle(HWND h) {
    SendMessageW(h, BM_SETCHECK,
                 SendMessageW(h, BM_GETCHECK, 0, 0) == BST_CHECKED ? BST_UNCHECKED : BST_CHECKED,
                 0);
}
inline void PaintButton(const DRAWITEMSTRUCT& item, HFONT font, UINT dpi, Icon icon = Icon::None,
                        bool primary = false, bool danger = false, bool iconOnly = false,
                        COLORREF surface = Panel) {
    auto* state = State(item.hwndItem);
    const bool hovered = state && state->hover;
    const bool disabled = (item.itemState & ODS_DISABLED) != 0,
               pressed = (item.itemState & ODS_SELECTED) != 0;
    RECT r = item.rcItem;
    HBRUSH bg = CreateSolidBrush(surface);
    FillRect(item.hDC, &r, bg);
    DeleteObject(bg);
    auto d = [&](int v) { return Scale(v, dpi); };
    if (state && state->toggle) {
        RECT label = r;
        label.right -= d(44);
        if (r.right - r.left > d(44))
            Text(item.hDC, Caption(item.hwndItem), label, font, disabled ? Muted : Ink);
        RECT track{r.right - d(36), (r.bottom + r.top) / 2 - d(10), r.right,
                   (r.bottom + r.top) / 2 + d(10)};
        Rounded(item.hDC, track, state->checked ? Accent : Border, state->checked ? Accent : Border,
                d(10));
        Gdiplus::Graphics g(item.hDC);
        g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
        Gdiplus::SolidBrush b(Color(Ink));
        const int left = state->checked ? track.right - d(17) : track.left + d(3);
        g.FillEllipse(&b, static_cast<float>(left), static_cast<float>(track.top + d(3)),
                      static_cast<float>(d(14)), static_cast<float>(d(14)));
        return;
    }
    COLORREF fill = primary ? (pressed ? RGB(65, 115, 218) : Accent)
                            : (pressed ? Selected : (hovered ? RGB(43, 56, 75) : RGB(32, 41, 55)));
    COLORREF ink = disabled ? Muted : (primary ? RGB(12, 24, 44) : (danger ? Danger : Ink));
    InflateRect(&r, -1, -1);
    Rounded(item.hDC, r, fill, (item.itemState & ODS_FOCUS) ? Accent : (hovered ? Border : fill),
            d(7));
    RECT label = r;
    label.left += d(10);
    label.right -= d(10);
    const auto caption = Caption(item.hwndItem);
    if (icon != Icon::None) {
        int x = (r.left + r.right) / 2;
        if (!iconOnly) {
            SIZE text{};
            auto old = SelectObject(item.hDC, font);
            GetTextExtentPoint32W(item.hDC, caption.c_str(), static_cast<int>(caption.size()),
                                  &text);
            SelectObject(item.hDC, old);
            const int textWidth = std::min(static_cast<int>(text.cx),
                                           std::max(0, static_cast<int>(r.right - r.left) - d(36)));
            x = (r.left + r.right - textWidth - d(22)) / 2 + d(7);
            label.left = x + d(15);
            label.right = label.left + textWidth;
        }
        DrawIcon(item.hDC, icon, static_cast<float>(x), static_cast<float>((r.top + r.bottom) / 2),
                 ink, dpi);
    }
    if (!iconOnly)
        Text(item.hDC, caption, label, font, ink, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
}
// Compose each control off screen; hover/focus must never expose its erased surface.
inline void Button(const DRAWITEMSTRUCT& item, HFONT font, UINT dpi, Icon icon = Icon::None,
                   bool primary = false, bool danger = false, bool iconOnly = false,
                   COLORREF surface = Panel) {
    const int width = item.rcItem.right - item.rcItem.left;
    const int height = item.rcItem.bottom - item.rcItem.top;
    if (width <= 0 || height <= 0) return;
    HDC buffer = CreateCompatibleDC(item.hDC);
    HBITMAP bitmap = CreateCompatibleBitmap(item.hDC, width, height);
    if (!buffer || !bitmap) {
        if (buffer) DeleteDC(buffer);
        if (bitmap) DeleteObject(bitmap);
        PaintButton(item, font, dpi, icon, primary, danger, iconOnly, surface);
        return;
    }
    auto previous = SelectObject(buffer, bitmap);
    DRAWITEMSTRUCT frame = item;
    frame.hDC = buffer;
    frame.rcItem = {0, 0, width, height};
    PaintButton(frame, font, dpi, icon, primary, danger, iconOnly, surface);
    BitBlt(item.hDC, item.rcItem.left, item.rcItem.top, width, height, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, previous);
    DeleteObject(bitmap);
    DeleteDC(buffer);
}
inline void PlaceField(HWND h, int x, int y, int w, int height, UINT dpi) {
    const int pad = Scale(12, dpi), textHeight = Scale(20, dpi);
    MoveWindow(h, x + pad, y + (height - textHeight) / 2, w - 2 * pad, textHeight, TRUE);
    SetPropW(h, L"LightCapture.FieldHeight",
             reinterpret_cast<HANDLE>(static_cast<INT_PTR>(height)));
}
inline void PaintField(HDC dc, HWND h, UINT dpi) {
    if (!IsWindowVisible(h)) return;
    RECT r{};
    GetWindowRect(h, &r);
    MapWindowPoints(nullptr, GetParent(h), reinterpret_cast<POINT*>(&r), 2);
    int height =
        static_cast<int>(reinterpret_cast<INT_PTR>(GetPropW(h, L"LightCapture.FieldHeight")));
    const int center = (r.top + r.bottom) / 2;
    r.top = center - height / 2;
    r.bottom = r.top + height;
    r.left -= Scale(12, dpi);
    r.right += Scale(12, dpi);
    Rounded(dc, r, Field, GetFocus() == h ? Accent : Border, Scale(7, dpi));
}
inline void DarkCaption(HWND window) {
    auto dwm = GetModuleHandleW(L"dwmapi.dll");
    if (!dwm) dwm = LoadLibraryW(L"dwmapi.dll");
    using SetAttribute = HRESULT(WINAPI*)(HWND, DWORD, LPCVOID, DWORD);
    auto set = reinterpret_cast<SetAttribute>(GetProcAddress(dwm, "DwmSetWindowAttribute"));
    if (set) {
        BOOL dark = TRUE;
        set(window, 20, &dark, sizeof(dark));
    }
}
inline HICON AppIcon(bool monitor, int size, COLORREF accent = Accent) {
    Gdiplus::Bitmap bitmap(size, size, PixelFormat32bppARGB);
    Gdiplus::Graphics g(&bitmap);
    g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias);
    g.Clear(Gdiplus::Color(0, 0, 0, 0));
    g.ScaleTransform(size / 32.f, size / 32.f);
    Gdiplus::SolidBrush tile(Color(accent)), ink(Color(Ink));
    Gdiplus::Pen outline(Color(accent), 2.5f);
    if (monitor) {
        g.DrawRectangle(&outline, 3.f, 5.f, 26.f, 20.f);
        for (int x : {7, 17})
            for (int y : {9, 17})
                g.FillRectangle(&tile, static_cast<float>(x), static_cast<float>(y), 8.f, 5.f);
        g.DrawLine(&outline, 11.f, 29.f, 21.f, 29.f);
    } else {
        for (int x : {0, 1})
            for (int y : {0, 1}) {
                const float px = x ? 28.f : 4.f, py = y ? 28.f : 4.f;
                g.DrawLine(&outline, px, py, px + (x ? -6.f : 6.f), py);
                g.DrawLine(&outline, px, py, px, py + (y ? -6.f : 6.f));
            }
        Gdiplus::SolidBrush record(Color(Danger));
        g.FillEllipse(&record, 9.f, 9.f, 14.f, 14.f);
    }
    HICON icon{};
    bitmap.GetHICON(&icon);
    return icon;
}
}  // namespace lc::ui
