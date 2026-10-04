#ifndef LC_DWM_MONITOR
#define LC_DWM_MONITOR 0
#endif

#if !LC_DWM_MONITOR
#include "common/wgc_capture.h"
#endif

#include <dwmapi.h>
#include <windows.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cwctype>
#include <memory>
#include <string>
#include <unordered_set>
#include <vector>

#include "common/native_theme.h"

#ifndef DWMWA_CLOAKED
#define DWMWA_CLOAKED 14
#endif

namespace {

enum ControlId {
    ID_SOURCE_LIST = 101,
    ID_REFRESH,
    ID_FPS,
    ID_PIN,
    ID_APPLY,
    ID_BACK,
    ID_SETTINGS,
    ID_FILTER,
    ID_AUTO_GRID,
    ID_COLUMNS,
    ID_ROWS,
    ID_SELECT_ALL = 113,
    ID_SELECT_NONE,
};

constexpr UINT_PTR kCaptureTimer = 1;
constexpr UINT_PTR kGearTimer = 2;
constexpr UINT kActivateSourceMessage = WM_APP + 20;
constexpr UINT kRemoveSourceMessage = WM_APP + 21;
constexpr size_t kMaxSources = 24;

struct WindowChoice {
    HWND window{};
    std::wstring title;
    std::wstring label;
};

struct SourceView {
    HWND window{};
    std::wstring title;
#if LC_DWM_MONITOR
    HTHUMBNAIL thumbnail{};
    SIZE sourceSize{};
    bool thumbnailVisible = false;
    ~SourceView() {
        if (thumbnail) DwmUnregisterThumbnail(thumbnail);
    }
#else
    std::unique_ptr<lc::WgcCapture> capture;
    std::vector<uint8_t> frame;
    int width = 0;
    int height = 0;
#endif
    std::wstring signal = L"NO SIGNAL";
};

struct MonitorApp {
    HINSTANCE instance{};
    HWND window{};
    HWND sourceList{}, selectAll{}, selectNone{};
    int selectionAnchor = -1;
    bool selectionValue = true;
    HWND refreshButton{};
    HWND fpsEdit{};
    HWND pinCheck{};
    HWND applyButton{};
    HWND backButton{};
    HWND settingsButton{};
    HWND filterEdit{};
    HWND autoGridCheck{}, columnsEdit{}, rowsEdit{};
    UINT dpi = 96;
    HBRUSH panelBrush{}, fieldBrush{};
#if LC_DWM_MONITOR
    HWND previewOverlay{};
    HDC overlayDc{};
    HBITMAP overlayBitmap{};
    HGDIOBJ overlayOldBitmap{};
    int overlayWidth = 0, overlayHeight = 0;
#endif
    HFONT uiFont{};
    HFONT titleFont{};
    HDC bufferDc{};
    HBITMAP bufferBitmap{};
    HGDIOBJ oldBitmap{};
    int bufferWidth = 0;
    int bufferHeight = 0;
    int fps = 10;
    bool autoGrid = true;
    int columns = 2, rows = 2;
    int hoveredTile = -1;
    int pressedTile = -1;
    int dragSource = -1;
    int dragTarget = -1;
    POINT dragStart{};
    bool draggingTile = false;
    bool settingsPage = false;
    bool gearVisible = false;
    bool hasPreviewPlacement = false;
    RECT previewPlacement{};
    std::vector<std::unique_ptr<SourceView>> sources;
    std::vector<WindowChoice> catalog;
    std::unordered_set<HWND> pendingSelection;
};

MonitorApp g_app;
int D(int value) { return lc::ui::Scale(value, g_app.dpi); }
void LayoutSettings(HWND window);

size_t SourceCount() {
    return static_cast<size_t>(std::count_if(g_app.sources.begin(), g_app.sources.end(),
                                             [](const auto& source) { return source != nullptr; }));
}
struct Grid {
    int columns, rows;
    int Slots() const { return columns * rows; }
};
Grid GridFor(size_t count) {
    if (!g_app.autoGrid) return {g_app.columns, g_app.rows};
    const int columns = std::max(1, static_cast<int>(std::ceil(std::sqrt(count))));
    return {columns, std::max(1, (static_cast<int>(count) + columns - 1) / columns)};
}
Grid CurrentGrid() { return GridFor(SourceCount()); }
RECT GridTile(RECT area, int index, Grid grid) {
    const int column = index % grid.columns, row = index / grid.columns;
    return {area.left + (area.right - area.left) * column / grid.columns,
            area.top + (area.bottom - area.top) * row / grid.rows,
            area.left + (area.right - area.left) * (column + 1) / grid.columns,
            area.top + (area.bottom - area.top) * (row + 1) / grid.rows};
}
SourceView* SourceAt(int index) {
    return index >= 0 && index < static_cast<int>(g_app.sources.size())
               ? g_app.sources[static_cast<size_t>(index)].get()
               : nullptr;
}
void FitSlots() {
    const size_t slots = static_cast<size_t>(CurrentGrid().Slots());
    if (g_app.sources.size() <= slots) {
        g_app.sources.resize(slots);
        return;
    }
    for (size_t i = slots; i < g_app.sources.size(); ++i) {
        if (!g_app.sources[i]) continue;
        auto empty = std::find(g_app.sources.begin(), g_app.sources.begin() + slots, nullptr);
        if (empty != g_app.sources.begin() + slots) *empty = std::move(g_app.sources[i]);
    }
    g_app.sources.resize(slots);
}

bool IsSelectableWindow(HWND window) {
    if (window == g_app.window || !IsWindowVisible(window) || IsIconic(window)) return false;
    // Exclude every Light Capture UI, including another backend/process or recorder settings.
    wchar_t className[96]{};
    GetClassNameW(window, className, ARRAYSIZE(className));
    for (const wchar_t* ownClass :
         {L"LightRegionRecorderWindow", L"LightCaptureRegionToolbar", L"LightCaptureRegionSelector",
          L"LightCaptureRegionMarker", L"LightWindowMonitorMvp", L"LightDwmWindowMonitorMvp",
          L"LightDwmPreviewOverlay"})
        if (wcscmp(className, ownClass) == 0) return false;
#if LC_DWM_MONITOR
    if (window == g_app.previewOverlay) return false;
#endif
    RECT bounds{};
    if (!GetWindowRect(window, &bounds) || bounds.right <= bounds.left ||
        bounds.bottom <= bounds.top)
        return false;
    wchar_t title[512]{};
    if (!GetWindowTextW(window, title, ARRAYSIZE(title)) || !title[0]) return false;
    const LONG_PTR exStyle = GetWindowLongPtrW(window, GWL_EXSTYLE);
    if ((exStyle & WS_EX_TOOLWINDOW) && !(exStyle & WS_EX_APPWINDOW)) return false;
    if (GetWindow(window, GW_OWNER) && !(exStyle & WS_EX_APPWINDOW)) return false;
    DWORD cloaked = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) &&
        cloaked)
        return false;
    return true;
}

std::wstring WindowTitle(HWND window) {
    wchar_t title[512]{};
    GetWindowTextW(window, title, ARRAYSIZE(title));
    return title;
}

BOOL CALLBACK CollectWindow(HWND window, LPARAM) {
    if (!IsSelectableWindow(window)) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    WindowChoice choice;
    choice.window = window;
    choice.title = WindowTitle(window);
    choice.label = choice.title + L"  [PID " + std::to_wstring(pid) + L"]";
    g_app.catalog.push_back(std::move(choice));
    return TRUE;
}

std::wstring Lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](wchar_t ch) { return static_cast<wchar_t>(std::towlower(ch)); });
    return text;
}

std::wstring ControlText(HWND control) {
    const int length = GetWindowTextLengthW(control);
    std::wstring text(static_cast<size_t>(length + 1), L'\0');
    if (length) GetWindowTextW(control, text.data(), length + 1);
    text.resize(static_cast<size_t>(length));
    return text;
}

void SyncVisibleSelections() {
    const LRESULT count = SendMessageW(g_app.sourceList, LB_GETCOUNT, 0, 0);
    for (int i = 0; i < count; ++i) {
        const HWND item =
            reinterpret_cast<HWND>(SendMessageW(g_app.sourceList, LB_GETITEMDATA, i, 0));
        if (SendMessageW(g_app.sourceList, LB_GETSEL, i, 0) > 0)
            g_app.pendingSelection.insert(item);
        else
            g_app.pendingSelection.erase(item);
    }
}

LRESULT CALLBACK SelectionProc(HWND h, UINT m, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR) {
    if (m == WM_LBUTTONDOWN || (m == WM_KEYDOWN && w == VK_SPACE)) {
        SetFocus(h);
        int index;
        bool shift;
        if (m == WM_LBUTTONDOWN) {
            const LRESULT hit = SendMessageW(h, LB_ITEMFROMPOINT, 0, l);
            if (HIWORD(hit)) return 0;
            index = LOWORD(hit);
            shift = (w & MK_SHIFT) != 0;
        } else {
            index = static_cast<int>(SendMessageW(h, LB_GETCARETINDEX, 0, 0));
            shift = (GetKeyState(VK_SHIFT) & 0x8000) != 0;
        }
        const int count = static_cast<int>(SendMessageW(h, LB_GETCOUNT, 0, 0));
        if (index < 0 || index >= count) return 0;
        if (shift && g_app.selectionAnchor >= 0 && g_app.selectionAnchor < count) {
            for (int i = std::min(index, g_app.selectionAnchor);
                 i <= std::max(index, g_app.selectionAnchor); ++i)
                SendMessageW(h, LB_SETSEL, g_app.selectionValue, i);
        } else {
            g_app.selectionAnchor = index;
            g_app.selectionValue = SendMessageW(h, LB_GETSEL, index, 0) <= 0;
            SendMessageW(h, LB_SETSEL, g_app.selectionValue, index);
        }
        SendMessageW(h, LB_SETCARETINDEX, index, FALSE);
        SendMessageW(GetParent(h), WM_COMMAND, MAKEWPARAM(ID_SOURCE_LIST, LBN_SELCHANGE),
                     reinterpret_cast<LPARAM>(h));
        InvalidateRect(h, nullptr, FALSE);
        return 0;
    }
    if (m == WM_LBUTTONUP || m == WM_LBUTTONDBLCLK || (m == WM_MOUSEMOVE && (w & MK_LBUTTON)))
        return 0;
    if (m == WM_NCDESTROY) RemoveWindowSubclass(h, SelectionProc, 1);
    return DefSubclassProc(h, m, w, l);
}
void PopulateFilteredList() {
    g_app.selectionAnchor = -1;
    const std::wstring filter = Lower(ControlText(g_app.filterEdit));
    SendMessageW(g_app.sourceList, LB_RESETCONTENT, 0, 0);
    for (const auto& choice : g_app.catalog) {
        if (!filter.empty() && Lower(choice.label).find(filter) == std::wstring::npos) continue;
        const LRESULT index = SendMessageW(g_app.sourceList, LB_ADDSTRING, 0,
                                           reinterpret_cast<LPARAM>(choice.label.c_str()));
        if (index >= 0) {
            SendMessageW(g_app.sourceList, LB_SETITEMDATA, index,
                         reinterpret_cast<LPARAM>(choice.window));
            if (g_app.pendingSelection.contains(choice.window))
                SendMessageW(g_app.sourceList, LB_SETSEL, TRUE, index);
        }
    }
}

void RefreshWindowList(bool syncCurrent = true) {
    if (syncCurrent) SyncVisibleSelections();
    g_app.catalog.clear();
    EnumWindows(CollectWindow, 0);
    PopulateFilteredList();
}

int ReadFps() {
    wchar_t text[16]{};
    GetWindowTextW(g_app.fpsEdit, text, ARRAYSIZE(text));
    wchar_t* end = nullptr;
    long value = wcstol(text, &end, 10);
    if (end == text) value = g_app.fps;
    g_app.fps = static_cast<int>(std::clamp<long>(value, 1, 60));
    const std::wstring normalized = std::to_wstring(g_app.fps);
    SetWindowTextW(g_app.fpsEdit, normalized.c_str());
    return g_app.fps;
}

void ResetCaptureTimer() {
    KillTimer(g_app.window, kCaptureTimer);
    const UINT interval = std::max(1U, static_cast<UINT>((1000 + g_app.fps - 1) / g_app.fps));
    SetTimer(g_app.window, kCaptureTimer, interval, nullptr);
}

#if LC_DWM_MONITOR
constexpr COLORREF kOverlayKey = RGB(1, 2, 3);
void UpdatePreviewOverlay();

void SetDwmThumbnailsVisible(bool visible) {
    for (auto& source : g_app.sources) {
        if (!source || !source->thumbnail) continue;
        DWM_THUMBNAIL_PROPERTIES properties{};
        properties.dwFlags = DWM_TNP_VISIBLE;
        properties.fVisible = visible && source->signal.empty();
        if (SUCCEEDED(DwmUpdateThumbnailProperties(source->thumbnail, &properties)))
            source->thumbnailVisible = properties.fVisible != FALSE;
    }
}
#endif

void SetSettingsPage(bool settings) {
    const bool entering = settings && !g_app.settingsPage;
    const bool leaving = !settings && g_app.settingsPage;
    if (entering) {
        if (g_app.window && GetWindowRect(g_app.window, &g_app.previewPlacement))
            g_app.hasPreviewPlacement = true;
        g_app.pendingSelection.clear();
        for (const auto& source : g_app.sources)
            if (source) g_app.pendingSelection.insert(source->window);
        SendMessageW(g_app.autoGridCheck, BM_SETCHECK, g_app.autoGrid ? BST_CHECKED : BST_UNCHECKED,
                     0);
        SetWindowTextW(g_app.columnsEdit, std::to_wstring(g_app.columns).c_str());
        SetWindowTextW(g_app.rowsEdit, std::to_wstring(g_app.rows).c_str());
    }
    g_app.settingsPage = settings;
#if LC_DWM_MONITOR
    SetDwmThumbnailsVisible(!settings);
    if (settings && g_app.previewOverlay) ShowWindow(g_app.previewOverlay, SW_HIDE);
#endif
    if (entering && g_app.window) {
        RECT current{};
        GetWindowRect(g_app.window, &current);
        const int width = std::max<LONG>(D(560), current.right - current.left);
        const int height = std::max<LONG>(D(400), current.bottom - current.top);
        SetWindowPos(g_app.window, nullptr, 0, 0, width, height,
                     SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    } else if (leaving && g_app.window && g_app.hasPreviewPlacement) {
        const int width = g_app.previewPlacement.right - g_app.previewPlacement.left;
        const int height = g_app.previewPlacement.bottom - g_app.previewPlacement.top;
        SetWindowPos(g_app.window, nullptr, g_app.previewPlacement.left, g_app.previewPlacement.top,
                     width, height, SWP_NOZORDER | SWP_NOACTIVATE);
        g_app.hasPreviewPlacement = false;
    }
    for (HWND control : {g_app.selectAll, g_app.selectNone, g_app.sourceList, g_app.refreshButton,
                         g_app.fpsEdit, g_app.pinCheck, g_app.applyButton, g_app.backButton,
                         g_app.filterEdit, g_app.autoGridCheck, g_app.columnsEdit, g_app.rowsEdit})
        ShowWindow(control, settings ? SW_SHOW : SW_HIDE);
    LayoutSettings(g_app.window);
    ShowWindow(g_app.settingsButton, SW_HIDE);
    g_app.gearVisible = false;
    if (settings) {
        RefreshWindowList(false);
        SetFocus(g_app.filterEdit);
    } else {
        SetFocus(g_app.window);
    }
    InvalidateRect(g_app.window, nullptr, FALSE);
}

void ApplySettings() {
    SyncVisibleSelections();
    const bool autoGrid = SendMessageW(g_app.autoGridCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
    const int columns = _wtoi(ControlText(g_app.columnsEdit).c_str());
    const int rows = _wtoi(ControlText(g_app.rowsEdit).c_str());
    if (!autoGrid &&
        (columns < 1 || columns > 24 || rows < 1 || rows > 24 ||
         columns * rows < static_cast<int>(std::min(kMaxSources, g_app.pendingSelection.size())))) {
        MessageBoxW(g_app.window, L"欄、列須為 1～24，格數須足以容納所選來源。", L"網格設定",
                    MB_OK | MB_ICONWARNING);
        return;
    }
    g_app.autoGrid = autoGrid;
    if (!autoGrid) {
        g_app.columns = columns;
        g_app.rows = rows;
    }
    ReadFps();
    ResetCaptureTimer();
    const bool pin = SendMessageW(g_app.pinCheck, BM_GETCHECK, 0, 0) == BST_CHECKED;
    SetWindowPos(g_app.window, pin ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

    if (g_app.pendingSelection.size() > kMaxSources) {
        MessageBoxW(g_app.window, L"為避免失控的 GPU 與記憶體用量，同時最多預覽 24 個視窗。",
                    L"來源數量過多", MB_OK | MB_ICONINFORMATION);
    }

    std::vector<HWND> ordered;
    for (const auto& source : g_app.sources) {
        if (source && g_app.pendingSelection.contains(source->window))
            ordered.push_back(source->window);
    }
    for (const auto& choice : g_app.catalog) {
        if (g_app.pendingSelection.contains(choice.window) &&
            std::find(ordered.begin(), ordered.end(), choice.window) == ordered.end())
            ordered.push_back(choice.window);
    }
    if (ordered.size() > kMaxSources) ordered.resize(kMaxSources);
    std::vector<std::unique_ptr<SourceView>> replacements(
        static_cast<size_t>(GridFor(ordered.size()).Slots()));
    // Keep existing capture sessions and positions; move only slots which no longer fit.
    for (size_t i = 0; i < g_app.sources.size(); ++i) {
        auto& source = g_app.sources[i];
        if (!source || std::find(ordered.begin(), ordered.end(), source->window) == ordered.end())
            continue;
        const size_t target =
            i < replacements.size()
                ? i
                : static_cast<size_t>(std::find(replacements.begin(), replacements.end(), nullptr) -
                                      replacements.begin());
        replacements[target] = std::move(source);
    }
    for (HWND target : ordered) {
        if (std::any_of(replacements.begin(), replacements.end(), [target](const auto& source) {
                return source && source->window == target;
            }))
            continue;
        auto source = std::make_unique<SourceView>();
        source->window = target;
        source->title = WindowTitle(target);
#if LC_DWM_MONITOR
        if (SUCCEEDED(DwmRegisterThumbnail(g_app.window, target, &source->thumbnail)) &&
            source->thumbnail) {
            if (FAILED(DwmQueryThumbnailSourceSize(source->thumbnail, &source->sourceSize)))
                source->sourceSize = {};
            source->signal.clear();
        }
#else
        source->capture = std::make_unique<lc::WgcCapture>();
        std::wstring error;
        if (!source->capture->StartForWindow(target, error, false))
            source->signal = L"NO SIGNAL";
        else
            source->signal = L"CONNECTING…";
#endif
        *std::find(replacements.begin(), replacements.end(), nullptr) = std::move(source);
    }
    g_app.sources = std::move(replacements);
#if !LC_DWM_MONITOR
    for (auto& source : g_app.sources)
        if (source) source->capture->SetCursorCaptureEnabled(false);
#endif
    SetSettingsPage(false);
}

void CaptureTick() {
    if (g_app.settingsPage) return;
    bool changed = false;
    for (auto& source : g_app.sources) {
        if (!source) continue;
#if LC_DWM_MONITOR
        const std::wstring previousSignal = source->signal;
        if (!IsWindow(source->window) || !source->thumbnail || IsIconic(source->window))
            source->signal = L"NO SIGNAL";
        else
            source->signal.clear();
        if (source->thumbnail) {
            SIZE latest{};
            if (SUCCEEDED(DwmQueryThumbnailSourceSize(source->thumbnail, &latest)) &&
                latest.cx > 0 && latest.cy > 0) {
                changed = changed || latest.cx != source->sourceSize.cx ||
                          latest.cy != source->sourceSize.cy;
                source->sourceSize = latest;
            }
            DWM_THUMBNAIL_PROPERTIES properties{};
            properties.dwFlags = DWM_TNP_VISIBLE;
            properties.fVisible = source->signal.empty();
            DwmUpdateThumbnailProperties(source->thumbnail, &properties);
            source->thumbnailVisible = properties.fVisible != FALSE;
        }
        changed = changed || previousSignal != source->signal;
#else
        if (!IsWindow(source->window)) {
            source->signal = L"NO SIGNAL";
            source->capture->Stop();
            continue;
        }
        if (IsIconic(source->window)) {
            source->signal = L"NO SIGNAL";
            continue;
        }
        std::vector<uint8_t> latest;
        int width = 0;
        int height = 0;
        if (source->capture->CaptureLatest(latest, width, height)) {
            source->frame = std::move(latest);
            source->width = width;
            source->height = height;
            source->signal.clear();
            changed = true;
        }
#endif
    }
    if (changed) InvalidateRect(g_app.window, nullptr, FALSE);
}

bool EnsureBuffer(HDC target, int width, int height) {
    if (g_app.bufferDc && g_app.bufferBitmap && width == g_app.bufferWidth &&
        height == g_app.bufferHeight)
        return true;
    if (g_app.bufferDc) {
        if (g_app.oldBitmap) SelectObject(g_app.bufferDc, g_app.oldBitmap);
        if (g_app.bufferBitmap) DeleteObject(g_app.bufferBitmap);
        DeleteDC(g_app.bufferDc);
    }
    g_app.bufferDc = CreateCompatibleDC(target);
    g_app.bufferBitmap = CreateCompatibleBitmap(target, width, height);
    if (!g_app.bufferDc || !g_app.bufferBitmap) return false;
    g_app.oldBitmap = SelectObject(g_app.bufferDc, g_app.bufferBitmap);
    g_app.bufferWidth = width;
    g_app.bufferHeight = height;
    return true;
}

void DrawCenteredText(HDC dc, const std::wstring& text, RECT rect, COLORREF color) {
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, color);
    DrawTextW(dc, text.c_str(), -1, &rect,
              DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS);
}

#if LC_DWM_MONITOR
void PositionDwmThumbnail(SourceView* source, RECT tile) {
    if (!source || !source->thumbnail || !source->signal.empty() || g_app.settingsPage) return;
    RECT available = tile;
    const int availableWidth = std::max<LONG>(1, available.right - available.left);
    const int availableHeight = std::max<LONG>(1, available.bottom - available.top);
    RECT destination = available;
    if (source->sourceSize.cx > 0 && source->sourceSize.cy > 0) {
        const double scale = std::min(static_cast<double>(availableWidth) / source->sourceSize.cx,
                                      static_cast<double>(availableHeight) / source->sourceSize.cy);
        const int drawWidth = std::max(1, static_cast<int>(source->sourceSize.cx * scale));
        const int drawHeight = std::max(1, static_cast<int>(source->sourceSize.cy * scale));
        destination.left += (availableWidth - drawWidth) / 2;
        destination.top += (availableHeight - drawHeight) / 2;
        destination.right = destination.left + drawWidth;
        destination.bottom = destination.top + drawHeight;
    }
    DWM_THUMBNAIL_PROPERTIES properties{};
    properties.dwFlags =
        DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY;
    properties.rcDestination = destination;
    properties.opacity = 255;
    properties.fVisible = TRUE;
    properties.fSourceClientAreaOnly = FALSE;
    if (SUCCEEDED(DwmUpdateThumbnailProperties(source->thumbnail, &properties)))
        source->thumbnailVisible = true;
}
#endif

void DrawSourceDecoration(HDC dc, SourceView* source, RECT tile, bool showTitle, bool originMarker,
                          bool dropTarget) {
    if (source && showTitle) {
        RECT label{tile.left + 6, tile.top + 5, tile.right - 6, tile.top + 30};
        // Keep the settings control clear even in a very small preview.
        if (g_app.gearVisible && tile.top == 0) {
            RECT button{};
            GetWindowRect(g_app.settingsButton, &button);
            POINT corner{button.left, button.top};
            ScreenToClient(g_app.window, &corner);
            if (label.right > corner.x) label.right = std::max(label.left, corner.x - 4);
        }
        if (label.right > label.left) {
            HBRUSH background = CreateSolidBrush(RGB(18, 21, 26));
            FillRect(dc, &label, background);
            DeleteObject(background);
            DrawCenteredText(dc, source->title, label, RGB(238, 242, 247));
        }
    }
    if (originMarker || dropTarget) {
        HPEN pen = CreatePen(PS_SOLID, 3, originMarker ? RGB(255, 150, 30) : RGB(0, 205, 255));
        HGDIOBJ oldPen = SelectObject(dc, pen);
        HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
        Rectangle(dc, tile.left + 1, tile.top + 1, tile.right - 1, tile.bottom - 1);
        SelectObject(dc, oldBrush);
        SelectObject(dc, oldPen);
        DeleteObject(pen);
    }
}

#if LC_DWM_MONITOR
// DWM thumbnails are composited above the destination's GDI/child controls.
// An owned, click-through layered window keeps labels and drag markers above
// thumbnails without reserving any space or changing the image's destination.
LRESULT CALLBACK PreviewOverlayProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCHITTEST) return HTTRANSPARENT;
    if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
    if (message == WM_ERASEBKGND) return TRUE;
    if (message == WM_DESTROY) {
        if (g_app.overlayDc && g_app.overlayOldBitmap)
            SelectObject(g_app.overlayDc, g_app.overlayOldBitmap);
        if (g_app.overlayBitmap) DeleteObject(g_app.overlayBitmap);
        if (g_app.overlayDc) DeleteDC(g_app.overlayDc);
        g_app.overlayDc = nullptr;
        g_app.overlayBitmap = nullptr;
        g_app.overlayOldBitmap = nullptr;
        return 0;
    }
    if (message == WM_PAINT || message == WM_PRINTCLIENT) {
        PAINTSTRUCT paint{};
        HDC target =
            message == WM_PAINT ? BeginPaint(window, &paint) : reinterpret_cast<HDC>(wParam);
        RECT client{};
        GetClientRect(window, &client);
        const int width = std::max(1L, client.right), height = std::max(1L, client.bottom);
        if (!g_app.overlayDc || !g_app.overlayBitmap || g_app.overlayWidth != width ||
            g_app.overlayHeight != height) {
            if (g_app.overlayDc && g_app.overlayOldBitmap)
                SelectObject(g_app.overlayDc, g_app.overlayOldBitmap);
            if (g_app.overlayBitmap) DeleteObject(g_app.overlayBitmap);
            if (g_app.overlayDc) DeleteDC(g_app.overlayDc);
            g_app.overlayDc = CreateCompatibleDC(target);
            g_app.overlayBitmap = CreateCompatibleBitmap(target, width, height);
            if (!g_app.overlayDc || !g_app.overlayBitmap) {
                if (message == WM_PAINT) EndPaint(window, &paint);
                return 0;
            }
            g_app.overlayOldBitmap = SelectObject(g_app.overlayDc, g_app.overlayBitmap);
            g_app.overlayWidth = width;
            g_app.overlayHeight = height;
        }
        HDC dc = g_app.overlayDc;
        HBRUSH clear = CreateSolidBrush(kOverlayKey);
        FillRect(dc, &client, clear);
        DeleteObject(clear);
        HGDIOBJ font = SelectObject(dc, g_app.uiFont);
        const Grid grid = CurrentGrid();
        for (int i = 0; i < grid.Slots(); ++i) {
            const RECT tile = GridTile(client, i, grid);
            DrawSourceDecoration(
                dc, SourceAt(i), tile, i == g_app.hoveredTile || i == g_app.dragTarget,
                g_app.pressedTile >= 0 && i == g_app.dragSource,
                g_app.draggingTile && i == g_app.dragTarget && i != g_app.dragSource);
        }
        if (g_app.gearVisible) {
            RECT gear{std::max(0L, client.right - 42), 3, client.right - 8, 31};
            HBRUSH background = CreateSolidBrush(RGB(32, 38, 47));
            FillRect(dc, &gear, background);
            DeleteObject(background);
            DrawCenteredText(dc, L"⚙", gear, RGB(238, 242, 247));
        }
        SelectObject(dc, font);
        // Commit the complete decoration in one blit. Clearing the visible
        // color-key surface before drawing labels could expose a partial frame.
        BitBlt(target, 0, 0, width, height, dc, 0, 0, SRCCOPY);
        if (message == WM_PAINT) EndPaint(window, &paint);
        return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

void UpdatePreviewOverlay() {
    if (g_app.settingsPage || !IsWindowVisible(g_app.window) || IsIconic(g_app.window)) {
        if (g_app.previewOverlay) ShowWindow(g_app.previewOverlay, SW_HIDE);
        return;
    }
    if (!g_app.previewOverlay) {
        WNDCLASSW wc{};
        wc.hInstance = g_app.instance;
        wc.lpfnWndProc = PreviewOverlayProc;
        wc.lpszClassName = L"LightDwmPreviewOverlay";
        if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return;
        g_app.previewOverlay =
            CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                            wc.lpszClassName, L"", WS_POPUP, 0, 0, 1, 1, g_app.window, nullptr,
                            g_app.instance, nullptr);
        if (!g_app.previewOverlay) return;
        SetLayeredWindowAttributes(g_app.previewOverlay, kOverlayKey, 255, LWA_COLORKEY);
    }
    RECT client{};
    GetClientRect(g_app.window, &client);
    POINT origin{};
    ClientToScreen(g_app.window, &origin);
    // Keep the overlay immediately above its owner, including after a pin/
    // foreground transition. Never raise it above an unrelated foreground app.
    HWND preceding = GetWindow(g_app.window, GW_HWNDPREV);
    const bool alreadyAbove = preceding == g_app.previewOverlay;
    RECT previous{};
    GetWindowRect(g_app.previewOverlay, &previous);
    if (!alreadyAbove || !IsWindowVisible(g_app.previewOverlay) || previous.left != origin.x ||
        previous.top != origin.y || previous.right - previous.left != client.right ||
        previous.bottom - previous.top != client.bottom)
        SetWindowPos(g_app.previewOverlay,
                     alreadyAbove ? nullptr : (preceding ? preceding : HWND_TOP), origin.x,
                     origin.y, std::max(1L, client.right), std::max(1L, client.bottom),
                     (alreadyAbove ? SWP_NOZORDER : 0) | SWP_NOOWNERZORDER | SWP_NOACTIVATE |
                         SWP_SHOWWINDOW);
    RedrawWindow(g_app.previewOverlay, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW);
}
#endif

void DrawSource(HDC dc, SourceView* source, RECT tile, bool showTitle, bool originMarker,
                bool dropTarget) {
    HBRUSH black = CreateSolidBrush(RGB(12, 14, 17));
    FillRect(dc, &tile, black);
    DeleteObject(black);
#if LC_DWM_MONITOR
    if (!source || !source->thumbnail || !source->signal.empty())
        if (source) DrawCenteredText(dc, source->signal, tile, RGB(238, 238, 238));
    PositionDwmThumbnail(source, tile);
    (void)showTitle;
    (void)originMarker;
    (void)dropTarget;
#else
    const int tileWidth = tile.right - tile.left;
    const int tileHeight = tile.bottom - tile.top;
    if (source && !source->frame.empty() && source->width > 0 && source->height > 0 &&
        source->signal.empty()) {
        const double scale = std::min(static_cast<double>(tileWidth) / source->width,
                                      static_cast<double>(tileHeight) / source->height);
        const int drawWidth = std::max(1, static_cast<int>(source->width * scale));
        const int drawHeight = std::max(1, static_cast<int>(source->height * scale));
        const int x = tile.left + (tileWidth - drawWidth) / 2;
        const int y = tile.top + (tileHeight - drawHeight) / 2;
        BITMAPINFO info{};
        info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biWidth = source->width;
        info.bmiHeader.biHeight = -source->height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        SetStretchBltMode(dc, HALFTONE);
        StretchDIBits(dc, x, y, drawWidth, drawHeight, 0, 0, source->width, source->height,
                      source->frame.data(), &info, DIB_RGB_COLORS, SRCCOPY);
    } else {
        if (source) DrawCenteredText(dc, source->signal, tile, RGB(238, 238, 238));
    }
    DrawSourceDecoration(dc, source, tile, showTitle, originMarker, dropTarget);
#endif
}

void PaintWindow(HWND window) {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(window, &paint);
    RECT client{};
    GetClientRect(window, &client);
    const int width = std::max<LONG>(1, client.right);
    const int height = std::max<LONG>(1, client.bottom);
    if (!EnsureBuffer(dc, width, height)) {
        EndPaint(window, &paint);
        return;
    }
    HDC out = g_app.bufferDc;
    HBRUSH background = CreateSolidBrush(g_app.settingsPage ? lc::ui::Background : RGB(10, 12, 15));
    FillRect(out, &client, background);
    DeleteObject(background);
    HGDIOBJ previousFont = SelectObject(out, g_app.uiFont);

    if (g_app.settingsPage) {
        namespace ui = lc::ui;

        ui::Text(out, std::to_wstring(g_app.pendingSelection.size()) + L" 個視窗已勾選",
                 {D(280), D(16), client.right - D(20), D(48)}, g_app.uiFont, ui::Muted,
                 DT_RIGHT | DT_VCENTER | DT_SINGLELINE);
        ui::PaintField(out, g_app.filterEdit, g_app.dpi);
        RECT list{};
        GetWindowRect(g_app.sourceList, &list);
        MapWindowPoints(nullptr, window, reinterpret_cast<POINT*>(&list), 2);
        InflateRect(&list, D(1), D(1));
        ui::Rounded(out, list, ui::Panel, ui::Border, D(8));
        RECT options{D(12), client.bottom - D(120), client.right - D(12), client.bottom - D(64)};
        ui::Rounded(out, options, ui::Panel, ui::Panel, D(9));
        for (HWND field : {g_app.fpsEdit, g_app.columnsEdit, g_app.rowsEdit})
            ui::PaintField(out, field, g_app.dpi);
        const int row = client.bottom - D(108);
        if (IsWindowVisible(g_app.columnsEdit)) {
            ui::Text(out, L"欄 × 列", {D(174), row, D(228), row + D(32)}, g_app.uiFont, ui::Muted);
            ui::Text(out, L"×", {D(274), row, D(294), row + D(32)}, g_app.uiFont, ui::Muted,
                     DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        }
        ui::Text(out, L"FPS", {client.right - D(124), row, client.right - D(84), row + D(32)},
                 g_app.uiFont, ui::Muted);
    } else {
        RECT area{0, 0, client.right, client.bottom};
        const Grid grid = CurrentGrid();
        for (int i = 0; i < grid.Slots(); ++i) {
            const RECT tile = GridTile(area, i, grid);
            DrawSource(
                out, SourceAt(i), tile,
                static_cast<int>(i) == g_app.hoveredTile || static_cast<int>(i) == g_app.dragTarget,
                g_app.pressedTile >= 0 && static_cast<int>(i) == g_app.dragSource,
                g_app.draggingTile && static_cast<int>(i) == g_app.dragTarget &&
                    g_app.dragTarget != g_app.dragSource);
        }
    }
    SelectObject(out, previousFont);
    BitBlt(dc, 0, 0, width, height, out, 0, 0, SRCCOPY);
    EndPaint(window, &paint);
#if LC_DWM_MONITOR
    UpdatePreviewOverlay();
#endif
}

void LayoutSettings(HWND window) {
    RECT client{};
    GetClientRect(window, &client);
    const int width = client.right, height = client.bottom;
    MoveWindow(g_app.selectAll, D(20), D(16), D(114), D(34), FALSE);
    MoveWindow(g_app.selectNone, D(142), D(16), D(114), D(34), FALSE);
    lc::ui::PlaceField(g_app.filterEdit, D(20), D(56), width - D(138), D(36), g_app.dpi);
    MoveWindow(g_app.refreshButton, width - D(106), D(56), D(86), D(36), TRUE);
    MoveWindow(g_app.sourceList, D(21), D(105), std::max(D(180), width - D(42)),
               std::max(D(64), height - D(241)), TRUE);
    MoveWindow(g_app.autoGridCheck, D(24), height - D(108), D(132), D(32), TRUE);
    lc::ui::PlaceField(g_app.columnsEdit, D(228), height - D(108), D(46), D(32), g_app.dpi);
    lc::ui::PlaceField(g_app.rowsEdit, D(294), height - D(108), D(46), D(32), g_app.dpi);
    const bool manual =
        g_app.settingsPage && SendMessageW(g_app.autoGridCheck, BM_GETCHECK, 0, 0) != BST_CHECKED;
    ShowWindow(g_app.columnsEdit, manual ? SW_SHOW : SW_HIDE);
    ShowWindow(g_app.rowsEdit, manual ? SW_SHOW : SW_HIDE);
    lc::ui::PlaceField(g_app.fpsEdit, width - D(82), height - D(108), D(58), D(32), g_app.dpi);
    MoveWindow(g_app.pinCheck, D(24), height - D(49), D(100), D(32), TRUE);
    MoveWindow(g_app.backButton, width - D(218), height - D(50), D(84), D(36), TRUE);
    MoveWindow(g_app.applyButton, width - D(126), height - D(50), D(106), D(36), TRUE);
    MoveWindow(g_app.settingsButton, std::max(0, width - 42), 3, 34, 28, FALSE);
    RedrawWindow(window, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
}

int TileAtPoint(HWND window, POINT point) {
    RECT client{};
    GetClientRect(window, &client);
    if (point.x < 0 || point.y < 0 || point.x >= client.right || point.y >= client.bottom)
        return -1;
    const Grid grid = CurrentGrid();
    const int columns = grid.columns, rows = grid.rows;
    const int column = std::clamp<int>(
        static_cast<int>(point.x * columns / std::max<LONG>(1, client.right)), 0, columns - 1);
    const int row = std::clamp<int>(
        static_cast<int>(point.y * rows / std::max<LONG>(1, client.bottom)), 0, rows - 1);
    const int index = row * columns + column;
    return index;
}

void ActivateSourceWindow(int index, bool minimizeMonitor) {
    if (!SourceAt(index)) return;
    const HWND target = g_app.sources[static_cast<size_t>(index)]->window;
    if (!IsWindow(target)) {
        MessageBoxW(g_app.window, L"來源視窗已經關閉。", L"無法切換", MB_OK | MB_ICONINFORMATION);
        return;
    }
    if (minimizeMonitor) ShowWindow(g_app.window, SW_MINIMIZE);
    if (IsIconic(target))
        ShowWindowAsync(target, SW_RESTORE);
    else if (!IsWindowVisible(target))
        ShowWindowAsync(target, SW_SHOW);
    BringWindowToTop(target);
    if (!SetForegroundWindow(target)) {
        SetWindowPos(target, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        FLASHWINFO flash{sizeof(flash), target, FLASHW_TRAY | FLASHW_TIMERNOFG, 3, 0};
        FlashWindowEx(&flash);
    }
}

void RemoveSource(int index) {
    if (!SourceAt(index)) return;
    const HWND removed = g_app.sources[static_cast<size_t>(index)]->window;
    g_app.sources[static_cast<size_t>(index)].reset();
    FitSlots();
    g_app.pendingSelection.erase(removed);
    g_app.hoveredTile = -1;
    g_app.pressedTile = g_app.dragSource = g_app.dragTarget = -1;
    g_app.draggingTile = false;
    InvalidateRect(g_app.window, nullptr, FALSE);
}

void ShowSourceMenu(HWND owner, int index, POINT screenPoint) {
    if (!SourceAt(index)) return;
    HMENU menu = CreatePopupMenu();
    if (!menu) return;
    AppendMenuW(menu, MF_STRING, 1, L"切換到此視窗");
    AppendMenuW(menu, MF_STRING, 2, L"切換並最小化監視器");
    AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
    AppendMenuW(menu, MF_STRING, 3, L"停止監測此來源");
    SetMenuDefaultItem(menu, 1, FALSE);
    SetForegroundWindow(owner);
    const UINT command = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY,
                                        screenPoint.x, screenPoint.y, 0, owner, nullptr);
    DestroyMenu(menu);
    PostMessageW(owner, WM_NULL, 0, 0);
    if (command == 1)
        PostMessageW(owner, kActivateSourceMessage, index, FALSE);
    else if (command == 2)
        PostMessageW(owner, kActivateSourceMessage, index, TRUE);
    else if (command == 3)
        PostMessageW(owner, kRemoveSourceMessage, index, 0);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE: {
            g_app.window = window;
            namespace ui = lc::ui;
            g_app.dpi = GetDpiForWindow(window);
            g_app.panelBrush = CreateSolidBrush(ui::Panel);
            g_app.fieldBrush = CreateSolidBrush(ui::Field);
            g_app.uiFont = CreateFontW(-D(14), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                                       DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                       CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft JhengHei UI");
            g_app.titleFont =
                CreateFontW(-D(19), 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                            OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                            DEFAULT_PITCH, L"Microsoft JhengHei UI");
            auto control = [&](const wchar_t* cls, const wchar_t* text, DWORD style, int id) {
                HWND h = CreateWindowExW(0, cls, text, WS_CHILD | style, 0, 0, 1, 1, window,
                                         reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
                                         g_app.instance, nullptr);
                SendMessageW(h, WM_SETFONT, reinterpret_cast<WPARAM>(g_app.uiFont), FALSE);
                return h;
            };
            auto button = [&](const wchar_t* text, int id, bool toggle = false) {
                HWND h = control(L"BUTTON", text, BS_OWNERDRAW | WS_TABSTOP, id);
                ui::Attach(h, g_app.dpi, toggle);
                return h;
            };
            auto edit = [&](const wchar_t* text, int id, DWORD style = 0) {
                HWND h = control(L"EDIT", text, ES_AUTOHSCROLL | WS_TABSTOP | style, id);
                ui::Attach(h, g_app.dpi);
                return h;
            };
            g_app.sourceList =
                control(L"LISTBOX", L"",
                        LBS_EXTENDEDSEL | LBS_NOINTEGRALHEIGHT | LBS_NOTIFY | LBS_OWNERDRAWFIXED |
                            LBS_HASSTRINGS | WS_VSCROLL | WS_TABSTOP,
                        ID_SOURCE_LIST);
            SendMessageW(g_app.sourceList, LB_SETITEMHEIGHT, 0, D(34));
            SetWindowSubclass(g_app.sourceList, SelectionProc, 1, 0);
            g_app.selectAll = button(L"全選", ID_SELECT_ALL);
            g_app.selectNone = button(L"全不選", ID_SELECT_NONE);
            g_app.filterEdit = edit(L"", ID_FILTER);
            g_app.refreshButton = button(L"更新", ID_REFRESH);
            g_app.fpsEdit = edit(L"10", ID_FPS, ES_NUMBER | ES_CENTER);
            g_app.pinCheck = button(L"置頂", ID_PIN, true);
            g_app.backButton = button(L"返回", ID_BACK);
            g_app.applyButton = button(L"套用", ID_APPLY);
            g_app.settingsButton = button(L"設定", ID_SETTINGS);
            g_app.autoGridCheck = button(L"自動網格", ID_AUTO_GRID, true);
            g_app.columnsEdit = edit(L"2", ID_COLUMNS, ES_NUMBER | ES_CENTER);
            g_app.rowsEdit = edit(L"2", ID_ROWS, ES_NUMBER | ES_CENTER);
            SendMessageW(g_app.fpsEdit, EM_SETLIMITTEXT, 2, 0);
            SendMessageW(g_app.filterEdit, EM_SETCUEBANNER, TRUE,
                         reinterpret_cast<LPARAM>(L"搜尋視窗名稱或 PID"));
            SendMessageW(g_app.pinCheck, BM_SETCHECK, BST_CHECKED, 0);
            ui::DarkCaption(window);
            SetSettingsPage(true);
            ResetCaptureTimer();
            return 0;
        }
        case WM_SIZE:
            LayoutSettings(window);
            InvalidateRect(window, nullptr, FALSE);
#if LC_DWM_MONITOR
            UpdatePreviewOverlay();
#endif
            return 0;
#if LC_DWM_MONITOR
        case WM_MOVE:
        case WM_SHOWWINDOW:
            UpdatePreviewOverlay();
            break;
#endif
        case WM_GETMINMAXINFO: {
            auto* limits = reinterpret_cast<MINMAXINFO*>(lParam);
            limits->ptMinTrackSize = g_app.settingsPage ? POINT{D(560), D(400)} : POINT{120, 80};
            return 0;
        }
        case WM_LBUTTONDOWN:
            if (!g_app.settingsPage) {
                const POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
                g_app.pressedTile = TileAtPoint(window, point);
                if (SourceAt(g_app.pressedTile)) {
                    g_app.dragStart = point;
                    g_app.dragSource = g_app.pressedTile;
                    g_app.dragTarget = g_app.pressedTile;
                    SetCapture(window);
                    InvalidateRect(window, nullptr, FALSE);
                } else
                    g_app.pressedTile = -1;
            }
            return 0;
        case WM_MOUSEMOVE: {
            if (!g_app.settingsPage) {
                bool decorationChanged = false;
                TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, window, 0};
                TrackMouseEvent(&track);
                const POINT point{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
                const int hovered = TileAtPoint(window, point);
                if (g_app.pressedTile >= 0 && (wParam & MK_LBUTTON)) {
                    const int distance = std::abs(point.x - g_app.dragStart.x) +
                                         std::abs(point.y - g_app.dragStart.y);
                    if (!g_app.draggingTile && distance >= 6) g_app.draggingTile = true;
                    if (g_app.draggingTile && hovered != g_app.dragTarget) {
                        g_app.dragTarget = hovered;
                        decorationChanged = true;
                        InvalidateRect(window, nullptr, FALSE);
                    }
                    if (g_app.draggingTile) SetCursor(LoadCursorW(nullptr, IDC_SIZEALL));
                }
                if (hovered != g_app.hoveredTile) {
                    g_app.hoveredTile = hovered;
                    decorationChanged = true;
                    InvalidateRect(window, nullptr, FALSE);
                }
                if (!g_app.gearVisible) {
                    g_app.gearVisible = true;
                    decorationChanged = true;
                    ShowWindow(g_app.settingsButton, SW_SHOW);
                }
#if LC_DWM_MONITOR
                if (decorationChanged) UpdatePreviewOverlay();
#else
                (void)decorationChanged;
#endif
                SetTimer(window, kGearTimer, 800, nullptr);
            }
            return 0;
        }
        case WM_LBUTTONUP:
            if (!g_app.settingsPage && g_app.pressedTile >= 0) {
                if (g_app.draggingTile && g_app.dragSource >= 0 && g_app.dragTarget >= 0 &&
                    g_app.dragSource != g_app.dragTarget &&
                    g_app.dragSource < static_cast<int>(g_app.sources.size()) &&
                    g_app.dragTarget < static_cast<int>(g_app.sources.size())) {
                    std::swap(g_app.sources[static_cast<size_t>(g_app.dragSource)],
                              g_app.sources[static_cast<size_t>(g_app.dragTarget)]);
                }
                g_app.pressedTile = g_app.dragSource = g_app.dragTarget = -1;
                g_app.draggingTile = false;
                if (GetCapture() == window) ReleaseCapture();
                InvalidateRect(window, nullptr, FALSE);
            }
            return 0;
        case WM_RBUTTONUP:
            if (!g_app.settingsPage) {
                const POINT local{GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam)};
                const int index = TileAtPoint(window, local);
                POINT screen = local;
                ClientToScreen(window, &screen);
                ShowSourceMenu(window, index, screen);
            }
            return 0;
        case WM_CAPTURECHANGED:
            if (reinterpret_cast<HWND>(lParam) != window) {
                g_app.pressedTile = g_app.dragSource = g_app.dragTarget = -1;
                g_app.draggingTile = false;
                InvalidateRect(window, nullptr, FALSE);
            }
            return 0;
        case WM_MOUSELEAVE:
            if (!g_app.settingsPage) {
#if LC_DWM_MONITOR
                // The owned overlay/gear can trigger a leave for the destination
                // HWND while the pointer is still inside the preview.
                POINT pointer{};
                RECT client{};
                GetCursorPos(&pointer);
                ScreenToClient(window, &pointer);
                GetClientRect(window, &client);
                if (PtInRect(&client, pointer)) return 0;
#endif
                if (g_app.hoveredTile != -1) {
                    g_app.hoveredTile = -1;
                    InvalidateRect(window, nullptr, FALSE);
                }
                SetTimer(window, kGearTimer, 350, nullptr);
            }
            return 0;
        case WM_TIMER:
            if (wParam == kCaptureTimer)
                CaptureTick();
            else if (wParam == kGearTimer && !g_app.settingsPage) {
                POINT cursor{};
                GetCursorPos(&cursor);
                ScreenToClient(window, &cursor);
                RECT button{};
                GetWindowRect(g_app.settingsButton, &button);
                POINT topLeft{button.left, button.top}, bottomRight{button.right, button.bottom};
                ScreenToClient(window, &topLeft);
                ScreenToClient(window, &bottomRight);
                RECT localButton{topLeft.x, topLeft.y, bottomRight.x, bottomRight.y};
                RECT client{};
                GetClientRect(window, &client);
                if (!PtInRect(&localButton, cursor) && !PtInRect(&client, cursor)) {
                    ShowWindow(g_app.settingsButton, SW_HIDE);
                    g_app.gearVisible = false;
#if LC_DWM_MONITOR
                    UpdatePreviewOverlay();
#endif
                    KillTimer(window, kGearTimer);
                }
            }
            return 0;
        case WM_COMMAND:
            if ((LOWORD(wParam) == ID_SELECT_ALL || LOWORD(wParam) == ID_SELECT_NONE) &&
                HIWORD(wParam) == BN_CLICKED) {
                g_app.pendingSelection.clear();
                if (LOWORD(wParam) == ID_SELECT_ALL)
                    for (const auto& choice : g_app.catalog)
                        g_app.pendingSelection.insert(choice.window);
                PopulateFilteredList();
                InvalidateRect(window, nullptr, FALSE);
                return 0;
            }
            if (LOWORD(wParam) == ID_AUTO_GRID && HIWORD(wParam) == BN_CLICKED) {
                if (lParam) lc::ui::Toggle(g_app.autoGridCheck);
                LayoutSettings(window);
                InvalidateRect(window, nullptr, FALSE);
            } else if (LOWORD(wParam) == ID_PIN && HIWORD(wParam) == BN_CLICKED) {
                if (lParam) lc::ui::Toggle(g_app.pinCheck);
            } else if (LOWORD(wParam) == ID_SETTINGS && HIWORD(wParam) == BN_CLICKED)
                SetSettingsPage(true);
            else if (LOWORD(wParam) == ID_REFRESH && HIWORD(wParam) == BN_CLICKED)
                RefreshWindowList();
            else if (LOWORD(wParam) == ID_SOURCE_LIST && HIWORD(wParam) == LBN_SELCHANGE) {
                SyncVisibleSelections();
                InvalidateRect(window, nullptr, FALSE);
            } else if (LOWORD(wParam) == ID_FILTER && HIWORD(wParam) == EN_CHANGE) {
                SyncVisibleSelections();
                PopulateFilteredList();
            } else if (LOWORD(wParam) == ID_APPLY && HIWORD(wParam) == BN_CLICKED)
                ApplySettings();
            else if (LOWORD(wParam) == ID_BACK && HIWORD(wParam) == BN_CLICKED)
                SetSettingsPage(false);
            else if (LOWORD(wParam) == ID_FPS && HIWORD(wParam) == EN_KILLFOCUS) {
                ReadFps();
                ResetCaptureTimer();
            }
            return 0;
        case WM_CTLCOLORLISTBOX:
        case WM_CTLCOLOREDIT: {
            HDC dc = reinterpret_cast<HDC>(wParam);
            SetTextColor(dc, lc::ui::Ink);
            SetBkColor(dc, message == WM_CTLCOLOREDIT ? lc::ui::Field : lc::ui::Panel);
            return reinterpret_cast<LRESULT>(message == WM_CTLCOLOREDIT ? g_app.fieldBrush
                                                                        : g_app.panelBrush);
        }
        case WM_MEASUREITEM:
            reinterpret_cast<MEASUREITEMSTRUCT*>(lParam)->itemHeight = D(34);
            return TRUE;
        case WM_DRAWITEM: {
            const auto& item = *reinterpret_cast<DRAWITEMSTRUCT*>(lParam);
            namespace ui = lc::ui;
            const int saved = SaveDC(item.hDC);
            RECT clip{};
            GetClientRect(item.hwndItem, &clip);
            IntersectClipRect(item.hDC, clip.left, clip.top, clip.right, clip.bottom);
            IntersectClipRect(item.hDC, item.rcItem.left, item.rcItem.top, item.rcItem.right,
                              item.rcItem.bottom);
            if (item.CtlID == ID_SOURCE_LIST) {
                const bool selected = (item.itemState & ODS_SELECTED) != 0;
                HBRUSH b = CreateSolidBrush(selected ? ui::Selected : ui::Panel);
                FillRect(item.hDC, &item.rcItem, b);
                DeleteObject(b);
                if (item.itemID == static_cast<UINT>(-1)) {
                    RestoreDC(item.hDC, saved);
                    return TRUE;
                }
                RECT check{item.rcItem.left + D(12), item.rcItem.top + D(9),
                           item.rcItem.left + D(28), item.rcItem.top + D(25)};
                ui::Rounded(item.hDC, check, selected ? ui::Accent : ui::Field,
                            selected ? ui::Accent : ui::Border, D(4));
                if (selected)
                    ui::DrawIcon(item.hDC, ui::Icon::Check,
                                 static_cast<float>((check.left + check.right) / 2),
                                 static_cast<float>((check.top + check.bottom) / 2), ui::Background,
                                 g_app.dpi);
                RECT text = item.rcItem;
                text.left += D(40);
                text.right = std::min(text.right, clip.right) - D(12);
                ui::Text(item.hDC, WindowTitle(reinterpret_cast<HWND>(item.itemData)), text,
                         g_app.uiFont, ui::Ink);
            } else {
                ui::Icon icon = item.CtlID == ID_REFRESH    ? ui::Icon::Refresh
                                : item.CtlID == ID_SETTINGS ? ui::Icon::Gear
                                                            : ui::Icon::None;
                ui::Button(item, g_app.uiFont, g_app.dpi, icon, item.CtlID == ID_APPLY, false,
                           item.CtlID == ID_SETTINGS,
                           item.CtlID == ID_AUTO_GRID ? ui::Panel : ui::Background);
            }
            RestoreDC(item.hDC, saved);
            return TRUE;
        }
        case kActivateSourceMessage:
            ActivateSourceWindow(static_cast<int>(wParam), lParam != FALSE);
            return 0;
        case kRemoveSourceMessage:
            RemoveSource(static_cast<int>(wParam));
            return 0;
        case WM_ERASEBKGND:
            return TRUE;
        case WM_PAINT:
            PaintWindow(window);
            return 0;
        case WM_DESTROY:
            KillTimer(window, kCaptureTimer);
            KillTimer(window, kGearTimer);
            g_app.sources.clear();
#if LC_DWM_MONITOR
            if (g_app.previewOverlay) DestroyWindow(g_app.previewOverlay);
#endif
            if (g_app.bufferDc && g_app.oldBitmap) SelectObject(g_app.bufferDc, g_app.oldBitmap);
            if (g_app.bufferBitmap) DeleteObject(g_app.bufferBitmap);
            if (g_app.bufferDc) DeleteDC(g_app.bufferDc);
            if (g_app.uiFont) DeleteObject(g_app.uiFont);
            if (g_app.titleFont) DeleteObject(g_app.titleFont);
            DeleteObject(g_app.panelBrush);
            DeleteObject(g_app.fieldBrush);
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    lc::ui::Runtime theme;
    INITCOMMONCONTROLSEX controls{sizeof(controls), ICC_STANDARD_CLASSES};
    InitCommonControlsEx(&controls);
    g_app.instance = instance;
    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.hInstance = instance;
    wc.lpfnWndProc = WindowProc;
#if LC_DWM_MONITOR
    wc.lpszClassName = L"LightDwmWindowMonitorMvp";
#else
    wc.lpszClassName = L"LightWindowMonitorMvp";
#endif
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hIcon = lc::ui::AppIcon(true, 32, LC_DWM_MONITOR ? lc::ui::Accent : RGB(57, 196, 178));
    wc.hIconSm = lc::ui::AppIcon(true, 16, LC_DWM_MONITOR ? lc::ui::Accent : RGB(57, 196, 178));
    wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    if (!RegisterClassExW(&wc)) return 1;
    const int width = 600;
    // The settings list is client height minus 241 logical pixels; allow eight full rows.
    RECT initialBounds{0, 0, 0, lc::ui::Scale(241 + 8 * 34, GetDpiForSystem())};
    AdjustWindowRectExForDpi(&initialBounds, WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, FALSE,
                             WS_EX_TOPMOST, GetDpiForSystem());
    const int height = initialBounds.bottom - initialBounds.top;
    RECT work{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    const int x = work.left + std::max(0L, (work.right - work.left - width) / 2);
    const int y = work.top + std::max(0L, (work.bottom - work.top - height) / 2);
    g_app.window = CreateWindowExW(WS_EX_TOPMOST, wc.lpszClassName,
#if LC_DWM_MONITOR
                                   L"輕量 DWM 視窗預覽",
#else
                                   L"輕量視窗預覽",
#endif
                                   WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, x, y, width, height,
                                   nullptr, nullptr, instance, nullptr);
    if (!g_app.window) return 1;
    ShowWindow(g_app.window, SW_SHOWNORMAL);
    UpdateWindow(g_app.window);
    SetForegroundWindow(g_app.window);
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        if (g_app.settingsPage && message.message == WM_KEYDOWN) {
            if (message.wParam == VK_RETURN) {
                ApplySettings();
                continue;
            }
            if (message.wParam == VK_ESCAPE) {
                SetSettingsPage(false);
                continue;
            }
            if (message.wParam == VK_F5) {
                RefreshWindowList();
                continue;
            }
            if ((GetKeyState(VK_CONTROL) & 0x8000) && message.wParam == 'F') {
                SetFocus(g_app.filterEdit);
                SendMessageW(g_app.filterEdit, EM_SETSEL, 0, -1);
                continue;
            }
        }
        if (g_app.settingsPage && IsDialogMessageW(g_app.window, &message)) continue;
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    CoUninitialize();
    return static_cast<int>(message.wParam);
}
