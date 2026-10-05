// Windows types must precede commctrl.h (LLVM-MinGW does not include them there).
// clang-format off
#include <windows.h>
#include <commctrl.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shlobj.h>
#include <windowsx.h>

#include <algorithm>
#include <cwchar>
#include <functional>
#include <memory>
#include <utility>

#include "common/native_theme.h"
#include "project1_region_recorder/recorder_app.h"
#include "project1_region_recorder/region_selector.h"
#include "project1_region_recorder/save_dialog.h"
// clang-format on

#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

namespace lc::recorder {
AppState g_app;
namespace {
enum ControlId {
    ID_SELECT = 105,
    ID_VIDEO_FPS = 107,
    ID_VIDEO = 109,
    ID_DIRECTORY = 111,
    ID_BROWSE,
    ID_FILENAME,
    ID_AUTO_SAVE,
    ID_START,
    ID_PAUSE,
    ID_STOP,
    ID_STATUS,
    ID_CLOSE = 120,
    ID_RESIZE,
    ID_SAVE,
    ID_DISCARD,
    ID_TIME = 126,
    ID_GIF,
    ID_GIF_FPS,
    ID_SELECT_HOTKEY,
    ID_CLIPBOARD = 131,
    ID_TYPE,
    ID_HIDE,
    ID_COPY,
    ID_CURSOR,
    ID_SHOW_SETTINGS = 201,
    ID_EXIT
};
using Icon = lc::ui::Icon;
constexpr UINT kTrayMessage = WM_APP + 30;
constexpr int kSelectHotkey = 1, kEscapeHotkey = 3;
constexpr UINT_PTR kUiTimer = 1, kSettingsTimer = 2;
constexpr int kWidth = 600, kHeight = 394;
constexpr UINT kFinishHotkeyEdit = WM_APP + 31;
constexpr COLORREF kBackground = lc::ui::Background, kCard = lc::ui::Panel;
constexpr COLORREF kInk = lc::ui::Ink, kMuted = lc::ui::Muted;
constexpr COLORREF kAccent = lc::ui::Accent, kBorder = lc::ui::Border;
constexpr DWORD kMainStyle =
    WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
UINT g_taskbarCreated{};
bool g_suppressSettings = false;
bool EditingHotkey() {
    const HWND focus = GetFocus();
    return focus && focus == g_app.selectHotkey;
}
void ReadyEscape(bool enable);
void CommitSettings();
LRESULT CALLBACK HotkeyEditProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                DWORD_PTR) {
    if (message == WM_SETFOCUS) {
        g_app.hotkeysSuspended = true;
        KillTimer(g_app.window, kSettingsTimer);
        UnregisterHotKey(g_app.window, kSelectHotkey);
        g_app.selectRegistered = false;
        ReadyEscape(false);
    } else if (message == WM_KILLFOCUS) {
        PostMessageW(g_app.window, kFinishHotkeyEdit, 0, 0);
    } else if (message == WM_NCDESTROY) {
        RemoveWindowSubclass(window, HotkeyEditProc, 1);
    }
    return DefSubclassProc(window, message, wParam, lParam);
}

int D(int value) { return MulDiv(value, static_cast<int>(g_app.dpi), 96); }
RECT Box(int x, int y, int w, int h) { return {D(x), D(y), D(x + w), D(y + h)}; }
std::wstring ReadText(HWND control) {
    const int length = GetWindowTextLengthW(control);
    std::wstring text(static_cast<size_t>(length + 1), L'\0');
    GetWindowTextW(control, text.data(), length + 1);
    text.resize(static_cast<size_t>(length));
    return text;
}
int ReadInt(HWND control, int fallback) {
    const auto text = ReadText(control);
    wchar_t* end{};
    const long long value = wcstoll(text.c_str(), &end, 10);
    return end == text.c_str() || *end || value < INT_MIN || value > INT_MAX
               ? fallback
               : static_cast<int>(value);
}
void WriteInt(HWND control, int value) {
    const auto text = std::to_wstring(value);
    if (ReadText(control) != text) SetWindowTextW(control, text.c_str());
}
void Status(const std::wstring& text) {
    if (ReadText(g_app.status) != text) SetWindowTextW(g_app.status, text.c_str());
}
RECT CurrentRegion() {
    std::lock_guard lock(g_app.regionMutex);
    return g_app.region;
}
RECT ClampToDesktop(RECT rect) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (!GetMonitorInfoW(MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST), &info)) return rect;
    const LONG left = GetSystemMetrics(SM_XVIRTUALSCREEN), top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const RECT desktop{left, top, left + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                       top + GetSystemMetrics(SM_CYVIRTUALSCREEN)};
    RECT clipped{};
    if (!IntersectRect(&clipped, &rect, &desktop) || clipped.right - clipped.left < 8 ||
        clipped.bottom - clipped.top < 8)
        clipped = {info.rcMonitor.left, info.rcMonitor.top,
                   std::min(info.rcMonitor.left + 640, info.rcMonitor.right),
                   std::min(info.rcMonitor.top + 360, info.rcMonitor.bottom)};
    return clipped;
}
void SetRegion(RECT region) {
    {
        std::lock_guard lock(g_app.regionMutex);
        g_app.region = region;
    }
}
void UpdateToolbar();
std::wstring DefaultDirectory() {
    PWSTR path{};
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Downloads, 0, nullptr, &path))) {
        std::wstring result(path);
        CoTaskMemFree(path);
        return result;
    }
    wchar_t buffer[MAX_PATH]{};
    GetCurrentDirectoryW(ARRAYSIZE(buffer), buffer);
    return buffer;
}
std::wstring SettingsPath() {
    wchar_t overridePath[32768]{};
    if (GetEnvironmentVariableW(L"LIGHTCAPTURE_SETTINGS_PATH", overridePath,
                                ARRAYSIZE(overridePath)))
        return overridePath;
    PWSTR path{};
    if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &path))) return {};
    const auto directory = std::wstring(path) + L"\\LightCapture";
    CoTaskMemFree(path);
    CreateDirectoryW(directory.c_str(), nullptr);
    return directory + L"\\recorder.ini";
}
void FillRoundRect(HDC dc, RECT rect, COLORREF fill, COLORREF border, int radius = 12) {
    lc::ui::Rounded(dc, rect, fill, border, static_cast<float>(D(radius / 2)));
}
void Text(HDC dc, const std::wstring& text, RECT rect, COLORREF color, HFONT font,
          UINT align = DT_LEFT | DT_VCENTER | DT_SINGLELINE) {
    auto previous = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, color);
    DrawTextW(dc, text.c_str(), -1, &rect, align | DT_END_ELLIPSIS | DT_NOPREFIX);
    SelectObject(dc, previous);
}
Icon ButtonIcon(int id) {
    switch (id) {
        case ID_START:
            return Icon::Record;
        case ID_STOP:
            return Icon::Stop;
        case ID_PAUSE:
            return g_app.paused ? Icon::Play : Icon::Pause;
        case ID_SELECT:
        case ID_RESIZE:
            return Icon::Select;
        case ID_CLOSE:
        case ID_DISCARD:
            return Icon::Close;
        case ID_SAVE:
            return Icon::Save;
        case ID_BROWSE:
            return Icon::Folder;
        case ID_HIDE:
            return Icon::Hide;
        case ID_COPY:
            return Icon::Copy;
        default:
            return Icon::None;
    }
}
void DrawButton(const DRAWITEMSTRUCT& item) {
    const int id = static_cast<int>(item.CtlID);
    const bool primary = id == ID_START || (id == ID_VIDEO && !g_app.defaultGif) ||
                         (id == ID_GIF && g_app.defaultGif);
    const bool iconOnly =
        (GetParent(item.hwndItem) == g_app.toolbar && id != ID_TYPE && id != ID_START) ||
        id == ID_BROWSE;
    lc::ui::Button(item, g_app.uiFont, g_app.dpi, ButtonIcon(id), primary,
                   id == ID_STOP || id == ID_DISCARD || id == ID_CLOSE, iconOnly);
}
void AddTooltip(HWND control, const wchar_t* text) {
    TOOLINFOW tool{};
    tool.cbSize = sizeof(tool);
    tool.uFlags = TTF_IDISHWND | TTF_SUBCLASS;
    tool.hwnd = GetParent(control);
    tool.uId = reinterpret_cast<UINT_PTR>(control);
    tool.lpszText = const_cast<wchar_t*>(text);
    SendMessageW(g_app.tooltip, TTM_ADDTOOLW, 0, reinterpret_cast<LPARAM>(&tool));
}
LRESULT CALLBACK LabelProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                           DWORD_PTR) {
    if (message == WM_ERASEBKGND) return TRUE;
    if (message == WM_PAINT || message == WM_PRINTCLIENT) {
        PAINTSTRUCT ps{};
        HDC dc = message == WM_PAINT ? BeginPaint(window, &ps) : reinterpret_cast<HDC>(wParam);
        RECT client{};
        GetClientRect(window, &client);
        // Each label owns and clears its entire surface. Transparent STATIC
        // redraws otherwise leave previous status/timer glyphs behind.
        const bool main = GetParent(window) == g_app.window;
        FillRect(dc, &client, main ? g_app.backgroundBrush : g_app.cardBrush);
        lc::ui::Text(dc, ReadText(window), client,
                     reinterpret_cast<HFONT>(SendMessageW(window, WM_GETFONT, 0, 0)),
                     main ? kMuted : kInk,
                     (main ? DT_LEFT : DT_CENTER) | DT_VCENTER | DT_SINGLELINE);
        if (message == WM_PAINT) EndPaint(window, &ps);
        return 0;
    }
    if (message == WM_SETTEXT) {
        const LRESULT result = DefSubclassProc(window, message, wParam, lParam);
        RedrawWindow(window, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW);
        return result;
    }
    if (message == WM_NCDESTROY) RemoveWindowSubclass(window, LabelProc, 2);
    return DefSubclassProc(window, message, wParam, lParam);
}
HWND Control(HWND parent, const wchar_t* cls, const wchar_t* text, DWORD style, int x, int y, int w,
             int h, int id) {
    HWND control =
        CreateWindowExW(0, cls, text, WS_CHILD | WS_VISIBLE | style, D(x), D(y), D(w), D(h), parent,
                        reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), g_app.instance, nullptr);
    SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(g_app.uiFont), FALSE);
    if (wcscmp(cls, L"EDIT") == 0 || wcscmp(cls, L"BUTTON") == 0 || id == ID_SELECT_HOTKEY)
        lc::ui::Attach(control, g_app.dpi,
                       id == ID_AUTO_SAVE || id == ID_CLIPBOARD || id == ID_CURSOR,
                       id == ID_SELECT_HOTKEY);
    if (id == ID_STATUS || id == ID_TIME || id == 124)
        SetWindowSubclass(control, LabelProc, 2, 0);
    if (parent == g_app.window) g_app.setupControls.push_back(control);
    return control;
}
HWND Button(HWND parent, const wchar_t* text, int x, int y, int w, int h, int id) {
    HWND control = Control(parent, L"BUTTON", text, BS_OWNERDRAW | WS_TABSTOP, x, y, w, h, id);
    AddTooltip(control, id == ID_VIDEO  ? L"Video：上限 30 分鐘／4 GB，不含音訊"
                        : id == ID_GIF  ? L"GIF：上限 1 分鐘／300 MB"
                        : id == ID_TYPE ? L"切換格式：Video 30 分鐘／4 GB；GIF 1 分鐘／300 MB"
                                        : text);
    return control;
}
HWND Edit(const wchar_t* text, int x, int y, int w, int h, int id, bool number = false) {
    HWND control = Control(g_app.window, L"EDIT", text,
                           ES_AUTOHSCROLL | WS_TABSTOP | (number ? ES_NUMBER : 0), x, y, w, h, id);
    lc::ui::PlaceField(control, D(x), D(y), D(w), D(h), g_app.dpi);
    return control;
}
void Paint(HWND window, HDC printDc = nullptr) {
    PAINTSTRUCT ps{};
    HDC dc = printDc ? printDc : BeginPaint(window, &ps);
    RECT client{};
    GetClientRect(window, &client);
    HDC buffer = CreateCompatibleDC(dc);
    HBITMAP bitmap =
        CreateCompatibleBitmap(dc, std::max(1L, client.right), std::max(1L, client.bottom));
    auto old = SelectObject(buffer, bitmap);
    FillRect(buffer, &client, window == g_app.toolbar ? g_app.cardBrush : g_app.backgroundBrush);
    if (window == g_app.toolbar) {
        RECT frame = client;
        InflateRect(&frame, -1, -1);
        FillRoundRect(buffer, frame, kCard, kBorder);
    } else {
        for (RECT card : {Box(12, 12, 576, 60), Box(12, 84, 576, 102), Box(12, 198, 576, 138)})
            FillRoundRect(buffer, card, kCard, kCard, 20);
        Text(buffer, L"框選熱鍵", Box(24, 24, 86, 36), kMuted, g_app.uiFont);
        Text(buffer, L"錄影設定", Box(24, 94, 160, 30), kInk, g_app.titleFont);
        Text(buffer, L"擷取滑鼠游標", Box(196, 97, 92, 24), kInk, g_app.uiFont);
        Text(buffer, L"Video FPS", Box(24, 136, 88, 36), kMuted, g_app.uiFont);
        Text(buffer, L"GIF FPS", Box(310, 136, 80, 36), kMuted, g_app.uiFont);
        Text(buffer, L"位置", Box(24, 210, 56, 36), kMuted, g_app.uiFont);
        Text(buffer, L"檔名", Box(24, 253, 56, 36), kMuted, g_app.uiFont);
        Text(buffer, L"自動保存", Box(24, 298, 66, 24), kInk, g_app.uiFont);
        Text(buffer, L"完成後自動複製", Box(310, 298, 120, 24), kInk, g_app.uiFont);
        for (HWND field : {g_app.videoFps, g_app.gifFps, g_app.editDirectory, g_app.editFileName})
            lc::ui::PaintField(buffer, field, g_app.dpi);
    }
    BitBlt(dc, 0, 0, client.right, client.bottom, buffer, 0, 0, SRCCOPY);
    SelectObject(buffer, old);
    DeleteObject(bitmap);
    DeleteDC(buffer);
    if (!printDc) EndPaint(window, &ps);
}
void SaveSettings() {
    if (g_app.settingsPath.empty() || !g_app.editDirectory) return;
    // Win32 profile APIs preserve Unicode when the INI starts with a UTF-16 BOM.
    HANDLE initial = CreateFileW(g_app.settingsPath.c_str(), GENERIC_WRITE, FILE_SHARE_READ,
                                 nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (initial != INVALID_HANDLE_VALUE) {
        const WORD bom = 0xfeff;
        DWORD written{};
        WriteFile(initial, &bom, sizeof(bom), &written, nullptr);
        CloseHandle(initial);
    }
    auto write = [&](const wchar_t* key, const std::wstring& text) {
        WritePrivateProfileStringW(L"Recorder", key, text.c_str(), g_app.settingsPath.c_str());
    };
    for (auto pair : {std::pair{L"VideoFPS", g_app.videoFps},
                      {L"GifFPS", g_app.gifFps},
                      {L"Directory", g_app.editDirectory},
                      {L"FileName", g_app.editFileName}})
        write(pair.first, ReadText(pair.second));
    write(L"Gif", g_app.defaultGif ? L"1" : L"0");
    write(L"AutoSave", g_app.autoSave ? L"1" : L"0");
    write(L"CopyOnFinish", g_app.copyToClipboard ? L"1" : L"0");
    write(L"CaptureCursor", g_app.captureCursor ? L"1" : L"0");
    write(L"SelectKey", std::to_wstring(g_app.selectKey));
    for (const auto key : {L"X", L"Y", L"Width", L"Height", L"StopKey"})
        WritePrivateProfileStringW(L"Recorder", key, nullptr, g_app.settingsPath.c_str());
}
void LoadSettings() {
    auto get = [&](const wchar_t* key, const wchar_t* fallback) {
        wchar_t text[32768]{};
        GetPrivateProfileStringW(L"Recorder", key, fallback, text, ARRAYSIZE(text),
                                 g_app.settingsPath.c_str());
        return std::wstring(text);
    };
    for (auto pair : {std::pair{L"VideoFPS", g_app.videoFps},
                      {L"GifFPS", g_app.gifFps},
                      {L"Directory", g_app.editDirectory},
                      {L"FileName", g_app.editFileName}}) {
        const auto fallback = ReadText(pair.second);
        SetWindowTextW(pair.second, get(pair.first, fallback.c_str()).c_str());
    }
    g_app.defaultGif = get(L"Gif", L"1") == L"1";
    g_app.autoSave = get(L"AutoSave", L"0") == L"1";
    g_app.copyToClipboard = get(L"CopyOnFinish", L"1") == L"1";
    g_app.captureCursor = get(L"CaptureCursor", L"1") == L"1";
    g_app.selectKey = static_cast<WORD>(_wtoi(get(L"SelectKey", L"850").c_str()));
    SendMessageW(g_app.selectHotkey, HKM_SETHOTKEY, g_app.selectKey, 0);
    SendMessageW(g_app.autoSaveCheck, BM_SETCHECK, g_app.autoSave ? BST_CHECKED : BST_UNCHECKED, 0);
    SendMessageW(g_app.clipboardCheck, BM_SETCHECK,
                 g_app.copyToClipboard ? BST_CHECKED : BST_UNCHECKED, 0);
    SendMessageW(g_app.cursorCheck, BM_SETCHECK, g_app.captureCursor ? BST_CHECKED : BST_UNCHECKED,
                 0);
}
UINT KeyModifiers(WORD key) {
    const BYTE flags = HIBYTE(key);
    return MOD_NOREPEAT | ((flags & HOTKEYF_CONTROL) ? MOD_CONTROL : 0) |
           ((flags & HOTKEYF_SHIFT) ? MOD_SHIFT : 0) | ((flags & HOTKEYF_ALT) ? MOD_ALT : 0);
}
bool ValidKey(WORD key) {
    return LOBYTE(key) && LOBYTE(key) != VK_ESCAPE &&
           (HIBYTE(key) & (HOTKEYF_CONTROL | HOTKEYF_ALT));
}
void RefreshSelectKey() {
    const bool enable = g_app.view == View::Idle && !g_app.selectionActive &&
                        !g_app.hotkeysSuspended && !EditingHotkey();
    if (!enable && g_app.selectRegistered) {
        UnregisterHotKey(g_app.window, kSelectHotkey);
        g_app.selectRegistered = false;
    } else if (enable && !g_app.selectRegistered) {
        g_app.selectRegistered =
            RegisterHotKey(g_app.window, kSelectHotkey, KeyModifiers(g_app.selectKey),
                           LOBYTE(g_app.selectKey)) != FALSE;
        if (!g_app.selectRegistered) Status(L"框選熱鍵已被其他程式使用，請更換組合鍵。");
    }
}
bool RegisterKeys(WORD select) {
    if (EditingHotkey()) return false;
    if (!ValidKey(select)) {
        SendMessageW(g_app.selectHotkey, HKM_SETHOTKEY, g_app.selectKey, 0);
        RefreshSelectKey();
        Status(L"熱鍵須包含 Ctrl 或 Alt；已保留原設定。");
        return false;
    }
    if (select != g_app.selectKey) {
        UnregisterHotKey(g_app.window, kSelectHotkey);
        g_app.selectRegistered = false;
        if (!RegisterHotKey(g_app.window, kSelectHotkey, KeyModifiers(select), LOBYTE(select))) {
            RefreshSelectKey();
            SendMessageW(g_app.selectHotkey, HKM_SETHOTKEY, g_app.selectKey, 0);
            Status(L"熱鍵已被其他程式使用；已保留原設定。");
            return false;
        }
        g_app.selectRegistered = true;
        g_app.selectKey = select;
    }
    RefreshSelectKey();
    return g_app.view != View::Idle || g_app.selectRegistered;
}
void CommitSettings() {
    KillTimer(g_app.window, kSettingsTimer);
    if (EditingHotkey()) return;
    const bool finishingHotkeyEdit = g_app.hotkeysSuspended;
    g_app.hotkeysSuspended = false;
    g_suppressSettings = true;
    const bool registered =
        RegisterKeys(static_cast<WORD>(SendMessageW(g_app.selectHotkey, HKM_GETHOTKEY, 0, 0)));
    if (finishingHotkeyEdit && registered)
        Status(L"已設定框選熱鍵：" + lc::ui::HotkeyCaption(g_app.selectHotkey));
    g_app.autoSave = SendMessageW(g_app.autoSaveCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
    g_app.copyToClipboard = SendMessageW(g_app.clipboardCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
    g_app.captureCursor = SendMessageW(g_app.cursorCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
    WriteInt(g_app.videoFps, std::clamp(ReadInt(g_app.videoFps, 60), 1, 60));
    WriteInt(g_app.gifFps, std::clamp(ReadInt(g_app.gifFps, 24), 1, 60));
    SaveSettings();
    g_suppressSettings = false;
}

HICON MakeTrayIcon(COLORREF color) {
    HDC screen = GetDC(nullptr), dc = CreateCompatibleDC(screen);
    HBITMAP bitmap = CreateCompatibleBitmap(screen, 32, 32);
    auto old = SelectObject(dc, bitmap);
    RECT bounds{0, 0, 32, 32};
    FillRect(dc, &bounds, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    HBRUSH brush = CreateSolidBrush(color);
    auto oldBrush = SelectObject(dc, brush), oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
    Ellipse(dc, 5, 5, 27, 27);
    SelectObject(dc, oldPen);
    SelectObject(dc, oldBrush);
    DeleteObject(brush);
    SelectObject(dc, old);
    BYTE bits[128];
    std::fill(bits, bits + 128, 0xff);
    HBITMAP mask = CreateBitmap(32, 32, 1, 1, bits);
    auto maskOld = SelectObject(dc, mask);
    auto maskBrush = SelectObject(dc, GetStockObject(BLACK_BRUSH));
    auto maskPen = SelectObject(dc, GetStockObject(NULL_PEN));
    Ellipse(dc, 5, 5, 27, 27);
    SelectObject(dc, maskPen);
    SelectObject(dc, maskBrush);
    SelectObject(dc, maskOld);
    ICONINFO info{TRUE, 0, 0, mask, bitmap};
    HICON icon = CreateIconIndirect(&info);
    DeleteObject(mask);
    DeleteObject(bitmap);
    DeleteDC(dc);
    ReleaseDC(nullptr, screen);
    return icon;
}
void UpdateTray() {
    NOTIFYICONDATAW data{};
    data.cbSize = sizeof(data);
    data.hWnd = g_app.window;
    data.uID = 1;
    data.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    data.uCallbackMessage = kTrayMessage;
    data.hIcon = g_app.trayIcons[g_app.running ? (g_app.paused ? 2 : 1) : 0];
    const wchar_t* tip = g_app.running ? (g_app.paused ? L"區域擷取 · 暫停" : L"區域擷取 · 錄影中")
                                       : L"區域擷取 · 雙擊開啟設定";
    wcsncpy_s(data.szTip, tip, _TRUNCATE);
    if (Shell_NotifyIconW(g_app.trayAdded ? NIM_MODIFY : NIM_ADD, &data)) g_app.trayAdded = true;
    data.uVersion = NOTIFYICON_VERSION_4;
    Shell_NotifyIconW(NIM_SETVERSION, &data);
}
void ShowSettings() {
    if (g_app.dialogActive) {
        HWND dialog = GetLastActivePopup(g_app.window);
        if (dialog != g_app.window && IsWindowVisible(dialog)) SetForegroundWindow(dialog);
        return;
    }
    ShowWindow(g_app.window, SW_RESTORE);
    SetForegroundWindow(g_app.window);
}
void HideSettings() { ShowWindow(g_app.window, SW_HIDE); }
BOOL CALLBACK CollectWorkArea(HMONITOR monitor, HDC, LPRECT, LPARAM parameter) {
    MONITORINFO info{};
    info.cbSize = sizeof(info);
    if (GetMonitorInfoW(monitor, &info))
        reinterpret_cast<std::vector<RECT>*>(parameter)->push_back(info.rcWork);
    return TRUE;
}
bool Inside(RECT inner, RECT outer) {
    return inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right &&
           inner.bottom <= outer.bottom;
}
bool FindToolbarPosition(const RECT& roi, int width, int height, POINT& position) {
    const int gap = D(8);
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    GetMonitorInfoW(MonitorFromRect(&roi, MONITOR_DEFAULTTONEAREST), &monitor);
    std::vector<RECT> areas{monitor.rcWork};
    EnumDisplayMonitors(nullptr, nullptr, CollectWorkArea, reinterpret_cast<LPARAM>(&areas));
    bool found = false;
    for (const RECT area : areas) {
        if (area.right - area.left < width || area.bottom - area.top < height) continue;
        const LONG alignedX = std::clamp(roi.right - width, area.left, area.right - width);
        const LONG alignedY = std::clamp(roi.bottom - height, area.top, area.bottom - height);
        POINT candidates[]{{alignedX, roi.bottom + gap},
                           {alignedX, roi.top - height - gap},
                           {roi.right + gap, alignedY},
                           {roi.left - width - gap, alignedY},
                           {area.right - width - gap, area.bottom - height - gap},
                           {area.left + gap, area.top + gap}};
        for (POINT p : candidates) {
            RECT bounds{p.x, p.y, p.x + width, p.y + height}, overlap{};
            if (Inside(bounds, area) && !IntersectRect(&overlap, &bounds, &roi)) {
                position = p;
                found = true;
                break;
            }
        }
        if (found) break;
    }
    return found;
}
void PositionToolbar() {
    const RECT roi = CurrentRegion();
    const int width = D(g_app.view == View::Recording ? 252
                        : g_app.view == View::Result  ? 270 : 188);
    const int height = D(42), gap = D(8);
    POINT position{};
    const bool found = FindToolbarPosition(roi, width, height, position);
    MONITORINFO monitor{};
    monitor.cbSize = sizeof(monitor);
    GetMonitorInfoW(MonitorFromRect(&roi, MONITOR_DEFAULTTONEAREST), &monitor);
    g_app.toolbarInsideRegion = !found;
    if (!found)
        position = {std::max(monitor.rcWork.left, monitor.rcWork.right - width - gap),
                    std::max(monitor.rcWork.top, monitor.rcWork.bottom - height - gap)};
    // Keep the only recording controls visible to remote desktops and screen
    // capture. A recording may start only if these controls fit outside the ROI.
    SetWindowDisplayAffinity(g_app.toolbar, WDA_NONE);
    SetWindowPos(g_app.toolbar, HWND_TOPMOST, position.x, position.y, width, height,
                 SWP_NOACTIVATE | SWP_SHOWWINDOW);
}
void ReadyEscape(bool enable) {
    if (g_app.escapeRegistered) UnregisterHotKey(g_app.window, kEscapeHotkey);
    g_app.escapeRegistered =
        enable && !g_app.hotkeysSuspended &&
        RegisterHotKey(g_app.window, kEscapeHotkey, MOD_NOREPEAT, VK_ESCAPE) != FALSE;
}
void UpdateToolbar() {
    RefreshSelectKey();
    const bool ready = g_app.view == View::Ready, recording = g_app.view == View::Recording,
               result = g_app.view == View::Result;
    for (HWND control : {g_app.startButton, g_app.typeButton, g_app.closeButton})
        ShowWindow(control, ready ? SW_SHOW : SW_HIDE);
    for (HWND control :
         {g_app.stopButton, g_app.pauseButton, g_app.resizeButton, g_app.recordingTime})
        ShowWindow(control, recording ? SW_SHOW : SW_HIDE);
    for (HWND control : {g_app.saveButton, g_app.copyButton, g_app.discardButton, g_app.resultInfo})
        ShowWindow(control, result ? SW_SHOW : SW_HIDE);
    SetWindowTextW(g_app.typeButton, g_app.defaultGif ? L"GIF" : L"Video");
    SetWindowTextW(g_app.pauseButton, g_app.paused ? L"繼續" : L"暫停");
    if (ready || recording)
        lc::ShowRegionMarker(g_app.instance, CurrentRegion(), recording);
    else
        lc::HideRegionMarker();
    ShowWindow(g_app.closeButton, ready || recording ? SW_SHOW : SW_HIDE);
    const wchar_t* closeCaption = recording ? L"結束並捨棄錄影（需確認）" : L"取消框選（Esc）";
    SetWindowTextW(g_app.closeButton, closeCaption);
    TOOLINFOW closeTip{};
    closeTip.cbSize = sizeof(closeTip);
    closeTip.hwnd = g_app.toolbar;
    closeTip.uId = reinterpret_cast<UINT_PTR>(g_app.closeButton);
    closeTip.lpszText = const_cast<wchar_t*>(closeCaption);
    SendMessageW(g_app.tooltip, TTM_UPDATETIPTEXTW, 0, reinterpret_cast<LPARAM>(&closeTip));
    MoveWindow(g_app.closeButton, D(recording ? 216 : 152), D(6), D(30), D(30), TRUE);
    EnableWindow(GetDlgItem(g_app.window, ID_SELECT), g_app.view == View::Idle);
    ReadyEscape(ready);
    if (g_app.view != View::Idle) {
        PositionToolbar();
        InvalidateRect(g_app.toolbar, nullptr, FALSE);
    } else
        ShowWindow(g_app.toolbar, SW_HIDE);
    for (HWND control : g_app.setupControls)
        EnableWindow(control, (!recording || control == g_app.hideButton) &&
                                  (GetDlgCtrlID(control) != ID_SELECT || g_app.view == View::Idle));
    UpdateTray();
}
void CloseReady() {
    if (g_app.view != View::Ready) return;
    if (g_app.pendingRegion) SetRegion(g_app.previousRegion);
    g_app.pendingRegion = false;
    g_app.view = View::Idle;
    UpdateToolbar();
}
void FinishCapture(DoneReason reason, const std::wstring& detail);
void SelectRegion(bool resize = false) {
    if (EditingHotkey() || g_app.hotkeysSuspended || g_app.dialogActive || g_app.stopRequested ||
        g_app.selectionActive ||
        (resize ? g_app.view != View::Recording : g_app.view != View::Idle))
        return;
    CommitSettings();
    const bool recording = g_app.view == View::Recording;
    if (recording) {
        g_app.paused = true;
        // Wait for a currently reading desktop frame before displaying the
        // per-pixel-alpha selection overlay (which cannot use capture exclusion).
        std::lock_guard lock(g_app.regionMutex);
    }
    HideSettings();
    ShowWindow(g_app.toolbar, SW_HIDE);
    lc::HideRegionMarker();
    ReadyEscape(false);
    UpdateTray();
    RECT selected{};
    bool accepted = false;
    g_app.selectionActive = true;
    RefreshSelectKey();
    do {
        g_app.reselectRequested = false;
        accepted = lc::SelectDesktopRegion(g_app.instance, g_app.window, selected);
    } while (g_app.reselectRequested && !g_app.stopRequested && !g_app.exitRequested);
    g_app.selectionActive = false;
    if (accepted && !g_app.stopRequested && !g_app.exitRequested) {
        POINT position{};
        if (recording && !FindToolbarPosition(selected, D(252), D(42), position)) {
            accepted = false;
            Status(L"控制列沒有可放置空間，請縮小框選範圍。");
            ShowSettings();
        }
    }
    if (accepted && !g_app.stopRequested && !g_app.exitRequested) {
        if (!recording && !g_app.pendingRegion) {
            g_app.previousRegion = CurrentRegion();
            g_app.pendingRegion = true;
        }
        SetRegion(ClampToDesktop(selected));
        if (!recording) g_app.view = View::Ready;
    }
    UpdateToolbar();
    if (g_app.view == View::Ready) {
        SetForegroundWindow(g_app.toolbar);
        SetFocus(g_app.startButton);
    }
    if (g_app.donePending) {
        g_app.donePending = false;
        FinishCapture(g_app.pendingReason, g_app.pendingDetail);
    } else if (g_app.exitRequested && !g_app.running)
        DestroyWindow(g_app.window);
}
std::wstring CleanBaseName(std::wstring name) {
    if (name.size() >= 4 && (_wcsicmp(name.c_str() + name.size() - 4, L".gif") == 0 ||
                             _wcsicmp(name.c_str() + name.size() - 4, L".mp4") == 0))
        name.resize(name.size() - 4);
    for (wchar_t& ch : name)
        if (ch < 32 || wcschr(L"<>:\"/\\|?*", ch)) ch = L'_';
    while (!name.empty() && (name.back() == L' ' || name.back() == L'.')) name.pop_back();
    return name.empty() ? L"capture" : name;
}
RecordingNames g_recordingNames;
bool CreateTemporaryOutput() {
    wchar_t directory[MAX_PATH]{}, name[64]{};
    GUID guid{};
    if (!GetTempPathW(ARRAYSIZE(directory), directory) || FAILED(CoCreateGuid(&guid))) return false;
    StringFromGUID2(guid, name, ARRAYSIZE(name));
    const auto path =
        std::wstring(directory) + L"LightCapture-" + name + (g_app.outputGif ? L".gif" : L".mp4");
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    CloseHandle(file);
    g_app.temporaryPath = path;
    return true;
}
void StartRecording() {
    if (g_app.view != View::Ready || g_app.worker.joinable()) return;
    POINT position{};
    if (!FindToolbarPosition(CurrentRegion(), D(252), D(42), position)) {
        CloseReady();
        Status(L"控制列沒有可放置空間，請縮小框選範圍。");
        ShowSettings();
        return;
    }
    CommitSettings();
    g_app.outputGif = g_app.defaultGif;
    g_app.completionNotice.clear();
    g_app.fps = std::clamp(
        ReadInt(g_app.outputGif ? g_app.gifFps : g_app.videoFps, g_app.outputGif ? 24 : 60), 1, 60);
    if (!CreateTemporaryOutput()) {
        Status(L"無法建立錄影暫存檔。");
        ShowSettings();
        return;
    }
    const RECT region = CurrentRegion();
    g_app.pendingRegion = false;
    g_app.frameCount = 0;
    g_app.outputBytes = 0;
    g_app.recordedTime100ns = 0;
    g_app.stopRequested = false;
    g_app.paused = false;
    g_app.running = true;
    g_app.view = View::Recording;
    HideSettings();
    UpdateToolbar();
    g_app.worker = std::thread(RecordingWorker, g_app.outputGif, g_app.temporaryPath,
                               region.right - region.left, region.bottom - region.top,
                               LimitsFor(g_app.outputGif));
    SaveSettings();
}
void RequestStop() {
    if (!g_app.running || g_app.stopRequested.exchange(true)) return;
    g_app.paused = false;
    if (g_app.selectionActive) lc::CancelDesktopRegionSelection();
    for (HWND control : {g_app.stopButton, g_app.pauseButton, g_app.resizeButton})
        EnableWindow(control, FALSE);
    SetWindowTextW(g_app.recordingTime, L"處理中…");
}
void TogglePause() {
    if (g_app.view != View::Recording || g_app.stopRequested) return;
    g_app.paused = !g_app.paused.load();
    UpdateToolbar();
}
bool CopyFileToClipboard(const std::wstring& path) {
    const SIZE_T bytes = sizeof(DROPFILES) + (path.size() + 2) * sizeof(wchar_t);
    HGLOBAL files = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes),
            effect = GlobalAlloc(GMEM_MOVEABLE, sizeof(DWORD));
    if (!files || !effect) {
        if (files) GlobalFree(files);
        if (effect) GlobalFree(effect);
        return false;
    }
    auto* drop = static_cast<DROPFILES*>(GlobalLock(files));
    if (!drop) {
        GlobalFree(files);
        GlobalFree(effect);
        return false;
    }
    drop->pFiles = sizeof(DROPFILES);
    drop->fWide = TRUE;
    memcpy(reinterpret_cast<BYTE*>(drop) + sizeof(DROPFILES), path.c_str(),
           (path.size() + 1) * sizeof(wchar_t));
    GlobalUnlock(files);
    auto* value = static_cast<DWORD*>(GlobalLock(effect));
    if (!value) {
        GlobalFree(files);
        GlobalFree(effect);
        return false;
    }
    *value = DROPEFFECT_COPY;
    GlobalUnlock(effect);
    const UINT format = RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT);
    if (!OpenClipboard(g_app.window)) {
        GlobalFree(files);
        GlobalFree(effect);
        return false;
    }
    const bool okay = EmptyClipboard() && SetClipboardData(CF_HDROP, files) != nullptr;
    if (!okay) GlobalFree(files);
    if (!okay || !SetClipboardData(format, effect)) GlobalFree(effect);
    CloseClipboard();
    if (okay) {
        g_app.clipboardPath = path;
        g_app.clipboardSequence = GetClipboardSequenceNumber();
    }
    return okay;
}
bool OwnsClipboardPath(const std::wstring& path) {
    return g_app.clipboardPath == path && g_app.clipboardSequence == GetClipboardSequenceNumber() &&
           GetClipboardOwner() == g_app.window;
}
bool ReleaseTemporaryClipboard() {
    if (!OwnsClipboardPath(g_app.temporaryPath)) return true;
    if (!OpenClipboard(g_app.window)) return false;
    const bool okay = !OwnsClipboardPath(g_app.temporaryPath) || EmptyClipboard() != FALSE;
    CloseClipboard();
    if (okay) {
        g_app.clipboardPath.clear();
        g_app.clipboardSequence = 0;
    }
    return okay;
}
void CopyTemporaryOutput() {
    if (g_app.view != View::Result || g_app.temporaryPath.empty()) return;
    const bool copied = CopyFileToClipboard(g_app.temporaryPath);
    SetWindowTextW(g_app.resultInfo, copied ? L"已複製 · 未保存" : L"複製失敗，請重試");
}
void Completed() {
    g_app.temporaryPath.clear();
    g_app.stopRequested = false;
    g_app.view = View::Idle;
    UpdateToolbar();
    if (g_app.exitRequested) DestroyWindow(g_app.window);
}
bool SaveOutput(bool automatic) {
    if (g_app.temporaryPath.empty() || g_app.dialogActive) return false;
    auto directory = ReadText(g_app.editDirectory);
    if (directory.empty()) directory = DefaultDirectory();
    const auto base = CleanBaseName(ReadText(g_app.editFileName));
    const std::wstring extension = g_app.outputGif ? L".gif" : L".mp4";
    std::wstring path;
    DWORD namingError = 0;
    if (!g_recordingNames.Suggest(directory, base, extension, path, namingError)) {
        Status(L"無法產生保存檔名，錄影仍在暫存處：" + HrText(HRESULT_FROM_WIN32(namingError)));
        UpdateToolbar(); ShowSettings(); return false;
    }
    bool suggestedName = true;
    if (!automatic) {
        ComPtr<IFileSaveDialog> dialog;
        HRESULT hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                                      IID_PPV_ARGS(&dialog));
        const COMDLG_FILTERSPEC filter = g_app.outputGif ? COMDLG_FILTERSPEC{L"GIF 動畫 (*.gif)", L"*.gif"}
                                                       : COMDLG_FILTERSPEC{L"MP4 影片 (*.mp4)", L"*.mp4"};
        if (SUCCEEDED(hr)) hr = dialog->SetOptions(FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST |
                                                  FOS_OVERWRITEPROMPT | FOS_NOCHANGEDIR);
        if (SUCCEEDED(hr)) hr = dialog->SetFileTypes(1, &filter);
        if (SUCCEEDED(hr)) hr = dialog->SetDefaultExtension(extension.c_str() + 1);
        if (SUCCEEDED(hr)) hr = dialog->SetFileName(RecordingNames::Leaf(path).c_str());
        ComPtr<IShellItem> initialFolder;
        if (SUCCEEDED(hr) && SUCCEEDED(SHCreateItemFromParsingName(directory.c_str(), nullptr,
                                                                   IID_PPV_ARGS(&initialFolder))))
            hr = dialog->SetFolder(initialFolder.Get());
        const auto title =
            g_app.completionNotice.empty() ? L"保存錄影" : g_app.completionNotice + L" — 保存錄影";
        if (SUCCEEDED(hr)) hr = dialog->SetTitle(title.c_str());
        ComPtr<SaveNameEvents> events;
        events.Attach(new SaveNameEvents(g_recordingNames, base, extension, RecordingNames::Leaf(path)));
        DWORD cookie = 0;
        bool advised = false;
        if (SUCCEEDED(hr)) { hr = dialog->Advise(events.Get(), &cookie); advised = SUCCEEDED(hr); }
        g_app.dialogActive = true;
        ShowWindow(g_app.toolbar, SW_HIDE);
        if (SUCCEEDED(hr)) hr = dialog->Show(g_app.window);
        if (advised) dialog->Unadvise(cookie);
        g_app.dialogActive = false;
        ComPtr<IShellItem> result;
        PWSTR chosenPath = nullptr;
        if (SUCCEEDED(hr)) hr = dialog->GetResult(&result);
        if (SUCCEEDED(hr)) hr = result->GetDisplayName(SIGDN_FILESYSPATH, &chosenPath);
        if (FAILED(hr)) {
            g_app.exitRequested = false;
            if (hr != HRESULT_FROM_WIN32(ERROR_CANCELLED)) Status(L"無法開啟保存對話框：" + HrText(hr));
            UpdateToolbar();
            return false;
        }
        path = chosenPath;
        CoTaskMemFree(chosenPath);
        suggestedName = events->suggestedResult;
        directory = RecordingNames::Directory(path);
    }
    const bool wasShared = OwnsClipboardPath(g_app.temporaryPath);
    if (!ReleaseTemporaryClipboard()) {
        Status(L"剪貼簿目前忙碌，錄影仍在暫存處；請稍後重試保存。");
        g_app.exitRequested = false;
        UpdateToolbar();
        return false;
    }
    bool moved = false;
    for (int attempt = 0; attempt < 8; ++attempt) {
        if (MoveFileExW(g_app.temporaryPath.c_str(), path.c_str(),
                        MOVEFILE_COPY_ALLOWED | (suggestedName ? 0 : MOVEFILE_REPLACE_EXISTING))) {
            moved = true;
            break;
        }
        const DWORD error = GetLastError();
        if (!suggestedName || (error != ERROR_ALREADY_EXISTS && error != ERROR_FILE_EXISTS) ||
            !g_recordingNames.Suggest(directory, base, extension, path, namingError)) break;
    }
    if (!moved) {
        if (wasShared) CopyTemporaryOutput();
        Status(L"保存失敗；錄影仍在暫存處，可重試或另選位置。");
        g_app.exitRequested = false;
        UpdateToolbar();
        ShowSettings();
        return false;
    }
    g_recordingNames.Saved(path, base, extension);
    if (!automatic) {
        SetWindowTextW(g_app.editDirectory, directory.c_str());
        SaveSettings();
    }
    g_app.lastSavedPath = path;
    const bool copied = !(g_app.copyToClipboard || wasShared) || CopyFileToClipboard(path);
    Status(copied ? (g_app.completionNotice.empty() ? L"" : g_app.completionNotice + L"；") +
                        L"已保存：" + path
                  : L"錄影已保存，但剪貼簿忙碌；可從保存位置複製檔案。");
    if (!copied) ShowSettings();
    Completed();
    return true;
}
void DiscardOutput() {
    if (g_app.view != View::Result || g_app.dialogActive) return;
    if (!ReleaseTemporaryClipboard()) {
        SetWindowTextW(g_app.resultInfo, L"剪貼簿忙碌，請重試");
        return;
    }
    if (!DeleteFileW(g_app.temporaryPath.c_str()) && GetLastError() != ERROR_FILE_NOT_FOUND) {
        Status(L"暫存檔目前無法刪除，請稍後重試。");
        ShowSettings();
        return;
    }
    Status(L"已捨棄錄影。");
    Completed();
}
void FinishCapture(DoneReason reason, const std::wstring& detail) {
    if (g_app.worker.joinable()) g_app.worker.join();
    g_app.running = false;
    g_app.paused = false;
    g_app.stopRequested = false;
    g_app.view = View::Result;
    if (reason == DoneTimeLimit)
        g_app.completionNotice =
            g_app.outputGif ? L"已達 GIF 1 分鐘上限" : L"已達 Video 30 分鐘上限";
    else if (reason == DoneSizeLimit)
        g_app.completionNotice =
            g_app.outputGif ? L"已達 GIF 300 MB 容量限制" : L"已達 Video 4 GB 容量限制";
    if (!g_app.completionNotice.empty()) Status(g_app.completionNotice);
    SetWindowTextW(g_app.resultInfo, L"尚未保存");
    for (HWND control : {g_app.stopButton, g_app.pauseButton, g_app.resizeButton})
        EnableWindow(control, TRUE);
    if (g_app.discardWhenStopped) {
        g_app.discardWhenStopped = false;
        const bool exiting = g_app.exitRequested;
        DiscardOutput();
        if (exiting && IsWindow(g_app.window)) DestroyWindow(g_app.window);
        return;
    }
    UpdateToolbar();
    if (reason == DoneError) {
        Status(detail.empty() ? L"擷取失敗，暫存檔可保存或捨棄。" : detail);
        ShowSettings();
        if (g_app.frameCount == 0) {
            DiscardOutput();
            Status(detail.empty() ? L"未取得錄影畫格，請重新框選。" : L"未取得錄影畫格：" + detail);
            return;
        }
    }
    if (g_app.copyToClipboard) CopyTemporaryOutput();
    SaveOutput(g_app.autoSave);
}

void BrowseDirectory() {
    IFileDialog* dialog{};
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog))))
        return;
    DWORD options{};
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    dialog->SetTitle(L"選擇保存資料夾");
    IShellItem* initial{};
    const auto directory = ReadText(g_app.editDirectory);
    if (SUCCEEDED(
            SHCreateItemFromParsingName(directory.c_str(), nullptr, IID_PPV_ARGS(&initial)))) {
        dialog->SetFolder(initial);
        initial->Release();
    }
    g_app.dialogActive = true;
    if (SUCCEEDED(dialog->Show(g_app.window))) {
        IShellItem* item{};
        if (SUCCEEDED(dialog->GetResult(&item))) {
            PWSTR path{};
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                SetWindowTextW(g_app.editDirectory, path);
                CoTaskMemFree(path);
            }
            item->Release();
        }
    }
    dialog->Release();
    g_app.dialogActive = false;
    SaveSettings();
}
void ExitApp() {
    if (g_app.dialogActive) return;
    if (g_app.running) {
        if (!g_app.stopRequested) {
            g_app.dialogActive = true;
            const int answer = MessageBoxW(g_app.window,
                L"要停止錄影並結束程式嗎？\n尚未保存的這段錄影將清除。", L"結束區域錄影器",
                MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_TOPMOST);
            g_app.dialogActive = false;
            if (answer != IDYES) return;
        }
        g_app.exitRequested = true;
        g_app.discardWhenStopped = true;
        RequestStop();
        return;
    }
    if (g_app.selectionActive) {
        g_app.exitRequested = true;
        lc::CancelDesktopRegionSelection();
        return;
    }
    if (g_app.view == View::Result) {
        g_app.exitRequested = true;
        DiscardOutput();
        if (IsWindow(g_app.window)) DestroyWindow(g_app.window);
        return;
    }
    SaveSettings();
    DestroyWindow(g_app.window);
}
void TrayMenu() {
    HMENU menu = CreatePopupMenu();
    AppendMenuW(menu, MF_STRING, ID_SHOW_SETTINGS, L"開啟設定");
    AppendMenuW(menu, MF_STRING | (g_app.view != View::Idle ? MF_GRAYED : 0), ID_SELECT,
                L"滑鼠框選");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, ID_EXIT, L"結束程式");
    POINT pointer{};
    GetCursorPos(&pointer);
    SetForegroundWindow(g_app.window);
    const UINT command = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY | TPM_RIGHTBUTTON,
                                        pointer.x, pointer.y, 0, g_app.window, nullptr);
    DestroyMenu(menu);
    PostMessageW(g_app.window, WM_NULL, 0, 0);
    if (command) PostMessageW(g_app.window, WM_COMMAND, command, 0);
}
void CloseCapture() {
    if (g_app.view == View::Ready) {
        CloseReady();
        return;
    }
    if (g_app.view == View::Result) {
        DiscardOutput();
        return;
    }
    if (g_app.view != View::Recording || g_app.dialogActive || g_app.stopRequested) return;
    g_app.dialogActive = true;
    const int choice =
        MessageBoxW(g_app.toolbar, L"要結束並捨棄這次錄影嗎？\n這段錄影不會保存。", L"關閉錄影",
                    MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_TOPMOST);
    g_app.dialogActive = false;
    if (choice == IDYES) {
        g_app.discardWhenStopped = true;
        RequestStop();
    }
}
void Command(int id) {
    switch (id) {
        case ID_SELECT:
            SelectRegion();
            break;
        case ID_RESIZE:
            SelectRegion(true);
            break;
        case ID_START:
            StartRecording();
            break;
        case ID_STOP:
            RequestStop();
            break;
        case ID_PAUSE:
            TogglePause();
            break;
        case ID_CLOSE:
            CloseCapture();
            break;
        case ID_SAVE:
            if (g_app.view == View::Result) SaveOutput(false);
            break;
        case ID_DISCARD:
            DiscardOutput();
            break;
        case ID_COPY:
            CopyTemporaryOutput();
            break;
        case ID_HIDE:
            CommitSettings();
            HideSettings();
            break;
        case ID_VIDEO:
        case ID_GIF:
        case ID_TYPE:
            if (g_app.running) break;
            g_app.defaultGif = id == ID_TYPE ? !g_app.defaultGif : id == ID_GIF;
            InvalidateRect(g_app.videoButton, nullptr, FALSE);
            InvalidateRect(g_app.gifButton, nullptr, FALSE);
            SetWindowTextW(g_app.typeButton, g_app.defaultGif ? L"GIF" : L"Video");
            SaveSettings();
            break;
        case ID_AUTO_SAVE:
        case ID_CLIPBOARD:
        case ID_CURSOR:
            CommitSettings();
            break;
        case ID_BROWSE:
            BrowseDirectory();
            break;
        case ID_SHOW_SETTINGS:
            ShowSettings();
            break;
        case ID_EXIT:
            ExitApp();
            break;
    }
}
LRESULT CALLBACK ToolbarProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g_app.toolbar = window;
            g_app.startButton = Button(window, L"錄製", 6, 6, 68, 30, ID_START);
            g_app.typeButton = Button(window, L"Video", 80, 6, 66, 30, ID_TYPE);
            g_app.closeButton = Button(window, L"取消框選（Esc）", 152, 6, 30, 30, ID_CLOSE);
            g_app.stopButton = Button(window, L"結束錄影", 6, 6, 30, 30, ID_STOP);
            g_app.pauseButton = Button(window, L"暫停／繼續", 40, 6, 30, 30, ID_PAUSE);
            g_app.resizeButton = Button(window, L"暫停並重新框選", 74, 6, 30, 30, ID_RESIZE);
            g_app.recordingTime = Control(window, L"STATIC", L"00:00.0", SS_CENTER | SS_CENTERIMAGE,
                                          112, 6, 96, 30, ID_TIME);
            SendMessageW(g_app.recordingTime, WM_SETFONT, reinterpret_cast<WPARAM>(g_app.timerFont),
                         FALSE);
            g_app.saveButton = Button(window, L"選擇保存位置", 6, 6, 30, 30, ID_SAVE);
            g_app.copyButton = Button(window, L"複製錄影（無須保存）", 40, 6, 30, 30, ID_COPY);
            g_app.discardButton = Button(window, L"關閉並清除暫存錄影", 234, 6, 30, 30, ID_DISCARD);
            g_app.resultInfo = Control(window, L"STATIC", L"尚未保存", SS_CENTER | SS_CENTERIMAGE,
                                       76, 6, 152, 30, 124);
            return 0;
        case WM_COMMAND:
            if (HIWORD(wParam) == BN_CLICKED) Command(LOWORD(wParam));
            return 0;
        case WM_DRAWITEM:
            DrawButton(*reinterpret_cast<DRAWITEMSTRUCT*>(lParam));
            return TRUE;
        case WM_PAINT:
            Paint(window);
            return 0;
        case WM_PRINTCLIENT:
            Paint(window, reinterpret_cast<HDC>(wParam));
            return 0;
        case WM_ERASEBKGND:
            return TRUE;
        case WM_CTLCOLORSTATIC:
            SetBkMode(reinterpret_cast<HDC>(wParam), TRANSPARENT);
            SetTextColor(reinterpret_cast<HDC>(wParam), kInk);
            return reinterpret_cast<LRESULT>(g_app.cardBrush);
        case WM_CLOSE:
            CloseCapture();
            return 0;
        case WM_KEYDOWN:
            if (wParam == VK_ESCAPE && g_app.view == View::Ready) CloseReady();
            return 0;
        case WM_DPICHANGED:
            return 0;  // ROI and toolbar placement use physical desktop pixels.
        case WM_NCHITTEST: {
            POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
            ScreenToClient(window, &point);
            return point.y < D(6) ? HTCAPTION : HTCLIENT;
        }
    }
    return DefWindowProcW(window, message, wParam, lParam);
}
void CreateControls() {
    g_suppressSettings = true;
    g_app.hideButton = Button(g_app.window, L"隱藏至通知區", 408, 348, 168, 32, ID_HIDE);
    g_app.selectHotkey = Control(g_app.window, L"STATIC", L"框選熱鍵", WS_TABSTOP | SS_NOTIFY, 112,
                                 24, 242, 36, ID_SELECT_HOTKEY);
    Button(g_app.window, L"滑鼠框選", 366, 24, 210, 36, ID_SELECT);
    g_app.videoButton = Button(g_app.window, L"Video", 396, 93, 86, 32, ID_VIDEO);
    g_app.gifButton = Button(g_app.window, L"GIF", 490, 93, 86, 32, ID_GIF);
    g_app.cursorCheck = Button(g_app.window, L"擷取滑鼠游標", 298, 97, 36, 24, ID_CURSOR);
    g_app.videoFps = Edit(L"60", 112, 136, 164, 36, ID_VIDEO_FPS, true);
    g_app.gifFps = Edit(L"24", 396, 136, 180, 36, ID_GIF_FPS, true);
    SetWindowSubclass(g_app.selectHotkey, HotkeyEditProc, 1, 0);
    g_app.editDirectory = Edit(DefaultDirectory().c_str(), 84, 210, 444, 36, ID_DIRECTORY);
    Button(g_app.window, L"選擇保存資料夾", 540, 210, 36, 36, ID_BROWSE);
    g_app.editFileName = Edit(L"capture", 84, 253, 492, 36, ID_FILENAME);
    g_app.autoSaveCheck = Button(g_app.window, L"自動保存", 96, 298, 36, 24, ID_AUTO_SAVE);
    g_app.clipboardCheck = Button(g_app.window, L"完成後自動複製", 422, 298, 36, 24, ID_CLIPBOARD);
    g_app.status = Control(g_app.window, L"STATIC", L"", SS_LEFT | SS_CENTERIMAGE, 24, 344, 368, 42,
                           ID_STATUS);
    g_app.settingsPath = SettingsPath();
    LoadSettings();
    RegisterKeys(g_app.selectKey);
    g_suppressSettings = false;
}
LRESULT CALLBACK MainProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == g_taskbarCreated && g_taskbarCreated) {
        g_app.trayAdded = false;
        UpdateTray();
        return 0;
    }
    switch (message) {
        case WM_CREATE: {
            g_app.window = window;
            g_app.dpi = GetDpiForWindow(window);
            auto font = [&](int height, int weight, const wchar_t* name) {
                return CreateFontW(-D(height), 0, 0, 0, weight, FALSE, FALSE, FALSE,
                                   DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                   ANTIALIASED_QUALITY, DEFAULT_PITCH, name);
            };
            g_app.uiFont = font(14, FW_NORMAL, L"Microsoft JhengHei UI");
            g_app.titleFont = font(15, FW_SEMIBOLD, L"Microsoft JhengHei UI");
            g_app.timerFont = font(15, FW_NORMAL, L"Consolas");
            g_app.backgroundBrush = CreateSolidBrush(kBackground);
            g_app.cardBrush = CreateSolidBrush(kCard);
            g_app.fieldBrush = CreateSolidBrush(lc::ui::Field);
            lc::ui::DarkCaption(window);
            SendMessageW(window, WM_SETICON, ICON_SMALL,
                         reinterpret_cast<LPARAM>(lc::ui::AppIcon(false, 16)));
            g_app.tooltip = CreateWindowExW(WS_EX_TOPMOST, TOOLTIPS_CLASSW, nullptr,
                                            WS_POPUP | TTS_ALWAYSTIP | TTS_NOPREFIX, CW_USEDEFAULT,
                                            CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, window,
                                            nullptr, g_app.instance, nullptr);
            SendMessageW(g_app.tooltip, TTM_SETMAXTIPWIDTH, 0, D(280));
            CreateControls();
            // Keep the floating controls visible when the settings window is minimized.
            // An owned popup would be hidden automatically along with its owner.
            CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST, L"LightCaptureRegionToolbar",
                            L"擷取工具列", WS_POPUP | WS_CLIPCHILDREN, 0, 0, D(188), D(42), nullptr,
                            nullptr, g_app.instance, nullptr);
            g_app.trayIcons[0] = MakeTrayIcon(kAccent);
            g_app.trayIcons[1] = MakeTrayIcon(RGB(221, 65, 72));
            g_app.trayIcons[2] = MakeTrayIcon(RGB(234, 167, 40));
            UpdateToolbar();
            SetTimer(window, kUiTimer, 100, nullptr);
            return 0;
        }
        case WM_COMMAND:
            if ((HIWORD(wParam) == EN_CHANGE || HIWORD(wParam) == EN_KILLFOCUS) &&
                !g_suppressSettings && !g_app.running)
                SetTimer(window, kSettingsTimer, 600, nullptr);
            else if (HIWORD(wParam) == BN_CLICKED) {
                if (lParam && EditingHotkey()) SetFocus(reinterpret_cast<HWND>(lParam));
                if (g_app.hotkeysSuspended && !EditingHotkey()) CommitSettings();
                if (lParam && (LOWORD(wParam) == ID_AUTO_SAVE || LOWORD(wParam) == ID_CLIPBOARD ||
                               LOWORD(wParam) == ID_CURSOR))
                    lc::ui::Toggle(reinterpret_cast<HWND>(lParam));
                Command(LOWORD(wParam));
            }
            return 0;
        case WM_HOTKEY:
            if (EditingHotkey() || g_app.hotkeysSuspended) return 0;
            if (wParam == kSelectHotkey && g_app.view == View::Idle && !g_app.selectionActive)
                SelectRegion();
            else if (wParam == kEscapeHotkey)
                CloseReady();
            return 0;
        case kFinishHotkeyEdit:
            if (!EditingHotkey()) {
                CommitSettings();
                ReadyEscape(g_app.view == View::Ready);
            }
            return 0;
        case WM_CAPTURE_DONE: {
            std::unique_ptr<std::wstring> detail(reinterpret_cast<std::wstring*>(lParam));
            if (g_app.selectionActive) {
                g_app.donePending = true;
                g_app.pendingReason = static_cast<DoneReason>(wParam);
                g_app.pendingDetail = *detail;
                lc::CancelDesktopRegionSelection();
            } else
                FinishCapture(static_cast<DoneReason>(wParam), *detail);
            return 0;
        }
        case WM_TIMER:
            if (wParam == kSettingsTimer)
                CommitSettings();
            else if (wParam == kUiTimer && g_app.running && !g_app.stopRequested) {
                const int64_t tenths = g_app.recordedTime100ns.load() / 1'000'000;
                wchar_t text[64]{};
                swprintf(text, ARRAYSIZE(text), L"%02lld:%02lld.%lld%s", tenths / 600,
                         (tenths / 10) % 60, tenths % 10, L"");
                if (ReadText(g_app.recordingTime) != text)
                    SetWindowTextW(g_app.recordingTime, text);
            }
            return 0;
        case kTrayMessage:
            if (LOWORD(lParam) == WM_LBUTTONDBLCLK || LOWORD(lParam) == NIN_SELECT)
                ShowSettings();
            else if (LOWORD(lParam) == WM_CONTEXTMENU || LOWORD(lParam) == WM_RBUTTONUP)
                TrayMenu();
            return 0;
        case WM_SIZE:
            // Standard minimization keeps the settings window on the taskbar.
            return 0;
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
            // Clicking a card/background also completes shortcut editing.
            if (EditingHotkey()) SetFocus(window);
            return 0;
        case WM_CLOSE:
            CommitSettings();
            ExitApp();
            return 0;
        case WM_DRAWITEM:
            DrawButton(*reinterpret_cast<DRAWITEMSTRUCT*>(lParam));
            return TRUE;
        case WM_PAINT:
            Paint(window);
            return 0;
        case WM_PRINTCLIENT:
            Paint(window, reinterpret_cast<HDC>(wParam));
            return 0;
        case WM_ERASEBKGND:
            return TRUE;
        case WM_CTLCOLOREDIT:
            SetTextColor(reinterpret_cast<HDC>(wParam),
                         IsWindowEnabled(reinterpret_cast<HWND>(lParam)) ? kInk : kMuted);
            SetBkColor(reinterpret_cast<HDC>(wParam), lc::ui::Field);
            return reinterpret_cast<LRESULT>(g_app.fieldBrush);
        case WM_CTLCOLORSTATIC:
        case WM_CTLCOLORBTN:
            if (reinterpret_cast<HWND>(lParam) == g_app.videoFps ||
                reinterpret_cast<HWND>(lParam) == g_app.gifFps ||
                reinterpret_cast<HWND>(lParam) == g_app.editDirectory ||
                reinterpret_cast<HWND>(lParam) == g_app.editFileName) {
                SetTextColor(reinterpret_cast<HDC>(wParam), kMuted);
                SetBkColor(reinterpret_cast<HDC>(wParam), lc::ui::Field);
                SetBkMode(reinterpret_cast<HDC>(wParam), OPAQUE);
                return reinterpret_cast<LRESULT>(g_app.fieldBrush);
            }
            SetBkMode(reinterpret_cast<HDC>(wParam), TRANSPARENT);
            SetTextColor(reinterpret_cast<HDC>(wParam), kMuted);
            return reinterpret_cast<LRESULT>(reinterpret_cast<HWND>(lParam) == g_app.status
                                                 ? g_app.backgroundBrush
                                                 : g_app.cardBrush);
        case WM_DESTROY: {
            // Normal exits join in FinishCapture. Also close the encoder/capture
            // before destroying UI resources if shutdown destroys this window.
            g_app.stopRequested = true;
            g_app.paused = false;
            if (g_app.worker.joinable()) g_app.worker.join();
            g_app.running = false;
            ReleaseTemporaryClipboard();
            if (!g_app.temporaryPath.empty()) {
                DeleteFileW(g_app.temporaryPath.c_str());
                g_app.temporaryPath.clear();
            }
            KillTimer(window, kUiTimer);
            KillTimer(window, kSettingsTimer);
            UnregisterHotKey(window, kSelectHotkey);
            ReadyEscape(false);
            NOTIFYICONDATAW data{};
            data.cbSize = sizeof(data);
            data.hWnd = window;
            data.uID = 1;
            Shell_NotifyIconW(NIM_DELETE, &data);
            lc::HideRegionMarker();
            if (g_app.toolbar) DestroyWindow(g_app.toolbar);
            for (HICON icon : g_app.trayIcons)
                if (icon) DestroyIcon(icon);
            DeleteObject(g_app.uiFont);
            DeleteObject(g_app.titleFont);
            DeleteObject(g_app.timerFont);
            DeleteObject(g_app.backgroundBrush);
            DeleteObject(g_app.cardBrush);
            DeleteObject(g_app.fieldBrush);
            PostQuitMessage(0);
            return 0;
        }
    }
    return DefWindowProcW(window, message, wParam, lParam);
}
}  // namespace

int RunRecorder(HINSTANCE instance) {
    g_app.instance = instance;
    const auto mutexName = L"Local\\LightCapture.Recorder." +
                           std::to_wstring(std::hash<std::wstring>{}(SettingsPath()));
    HANDLE singleInstance = CreateMutexW(nullptr, FALSE, mutexName.c_str());
    if (singleInstance && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = nullptr;
        while ((existing = FindWindowExW(nullptr, existing, L"LightRegionRecorderWindow", nullptr)))
            if (GetPropW(existing, mutexName.c_str())) break;
        if (existing) PostMessageW(existing, WM_COMMAND, ID_SHOW_SETTINGS, 0);
        CloseHandle(singleInstance);
        return 0;
    }
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    lc::ui::Runtime theme;
    INITCOMMONCONTROLSEX controls{sizeof(controls), ICC_WIN95_CLASSES};
    InitCommonControlsEx(&controls);
    g_taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
    WNDCLASSW wc{};
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.lpfnWndProc = ToolbarProc;
    wc.lpszClassName = L"LightCaptureRegionToolbar";
    RegisterClassW(&wc);
    wc.lpfnWndProc = MainProc;
    wc.lpszClassName = L"LightRegionRecorderWindow";
    wc.hIcon = lc::ui::AppIcon(false, 32);
    RegisterClassW(&wc);
    g_app.dpi = GetDpiForSystem();
    RECT bounds{0, 0, D(kWidth), D(kHeight)};
    AdjustWindowRectExForDpi(&bounds, kMainStyle, FALSE, 0, g_app.dpi);
    RECT work{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    HWND window =
        CreateWindowExW(0, wc.lpszClassName, L"擷取設定", kMainStyle,
                        work.left + (work.right - work.left - (bounds.right - bounds.left)) / 2,
                        work.top + (work.bottom - work.top - (bounds.bottom - bounds.top)) / 2,
                        bounds.right - bounds.left, bounds.bottom - bounds.top, nullptr, nullptr,
                        instance, nullptr);
    if (!window) {
        CoUninitialize();
        if (singleInstance) CloseHandle(singleInstance);
        return 1;
    }
    SetPropW(window, mutexName.c_str(), reinterpret_cast<HANDLE>(1));
    ShowWindow(window, SW_SHOW);
    SetForegroundWindow(window);
    UpdateWindow(window);
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if ((message.message == WM_LBUTTONDOWN || message.message == WM_RBUTTONDOWN ||
             message.message == WM_NCLBUTTONDOWN) && EditingHotkey() &&
            message.hwnd != g_app.selectHotkey &&
            (message.hwnd == window || IsChild(window, message.hwnd) ||
             message.hwnd == g_app.toolbar || IsChild(g_app.toolbar, message.hwnd))) {
            // Native STATIC labels and blank card areas don't transfer focus.
            // Finish before dispatching the click, including a click on Select.
            SetFocus(message.hwnd);
            CommitSettings();
        }
        if (message.message == WM_KEYDOWN && message.wParam == VK_ESCAPE && !EditingHotkey()) {
            if (g_app.view == View::Ready) CloseReady();
            continue;
        }
        HWND dialog = IsWindowVisible(g_app.toolbar) && (message.hwnd == g_app.toolbar ||
                                                         IsChild(g_app.toolbar, message.hwnd))
                          ? g_app.toolbar
                          : window;
        if (!IsDialogMessageW(dialog, &message)) {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    CoUninitialize();
    if (singleInstance) CloseHandle(singleInstance);
    return static_cast<int>(message.wParam);
}
}  // namespace lc::recorder
