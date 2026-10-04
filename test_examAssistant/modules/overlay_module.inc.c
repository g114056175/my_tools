static void CacheOverlayText(const char *text) {
    strncpy(g_overlay_text, text ? text : "", sizeof(g_overlay_text) - 1);
    g_overlay_text[sizeof(g_overlay_text) - 1] = 0;
    if (MultiByteToWideChar(CP_UTF8, 0, g_overlay_text, -1, g_overlay_text_w,
                            (int)(sizeof(g_overlay_text_w) / sizeof(wchar_t))) == 0) {
        MultiByteToWideChar(CP_ACP, 0, g_overlay_text, -1, g_overlay_text_w,
                            (int)(sizeof(g_overlay_text_w) / sizeof(wchar_t)));
    }
}

static void NormalizeOverlayTextForWrap(const char *src, char *dst, int dst_size) {
    int i = 0;
    if (!dst || dst_size <= 0) return;
    dst[0] = 0;
    if (!src) return;
    while (*src && i < dst_size - 1) {
        char c = *src++;
        if (c == '\r') continue;
        dst[i++] = c;
    }
    dst[i] = 0;
}

static LRESULT CALLBACK OverlayProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    switch (msg) {
    case WM_NCHITTEST:
        return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        RECT text_rc;
        GetClientRect(hwnd, &rc);
        COLORREF bgc = g_cfg.theme_light ? RGB(250, 250, 250) : RGB(20, 20, 20);
        COLORREF fgc = g_cfg.theme_light ? RGB(15, 15, 15) : RGB(230, 230, 230);
        HBRUSH bg = CreateSolidBrush(bgc);
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);
        SetBkMode(hdc, TRANSPARENT);
        SetTextColor(hdc, fgc);
        text_rc.left = 10;
        text_rc.top = 10 - g_overlay_scroll_px;
        text_rc.right = rc.right - 10;
        text_rc.bottom = text_rc.top + g_overlay_content_height + 20;
        DrawTextW(hdc, g_overlay_text_w, -1, &text_rc, DT_LEFT | DT_TOP | DT_WORDBREAK);
        EndPaint(hwnd, &ps);
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wparam, lparam);
}

static void EnsureOverlayWindow(HWND hwnd_parent) {
    if (g_hwnd_overlay) return;
    WNDCLASSA wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = OverlayProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "LLMOverlayWindow";
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassA(&wc);
    g_hwnd_overlay = CreateWindowExA(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
        wc.lpszClassName, "Overlay",
        WS_POPUP,
        0, 0, 10, 10,
        hwnd_parent, NULL, wc.hInstance, NULL);
    SetLayeredWindowAttributes(g_hwnd_overlay, 0, (BYTE)g_cfg.opacity, LWA_ALPHA);
}

static void ShowOverlayText(const char *text, POINT anchor) {
    char wrapped[262144];
    int width;
    int content_height;
    RECT rc;
    RECT rc2;
    NormalizeOverlayTextForWrap(text ? text : "", wrapped, (int)sizeof(wrapped));
    CacheOverlayText(wrapped);
    if (!g_cfg.overlay_visible) return;
    EnsureOverlayWindow(g_hwnd_main);
    HDC hdc = GetDC(g_hwnd_overlay);
    rc.left = 0;
    rc.top = 0;
    rc.right = 460;
    rc.bottom = 200000;
    DrawTextW(hdc, g_overlay_text_w, -1, &rc, DT_LEFT | DT_TOP | DT_WORDBREAK | DT_CALCRECT);
    width = ClampInt((rc.right - rc.left) + 20, 220, 480);
    rc2.left = 0;
    rc2.top = 0;
    rc2.right = width - 20;
    rc2.bottom = 200000;
    DrawTextW(hdc, g_overlay_text_w, -1, &rc2, DT_LEFT | DT_TOP | DT_WORDBREAK | DT_CALCRECT);
    ReleaseDC(g_hwnd_overlay, hdc);
    content_height = rc2.bottom - rc2.top;
    int height = ClampInt(content_height + 20, 60, 600);
    g_overlay_content_height = content_height;
    int x = anchor.x + 16;
    int y = anchor.y + 16;
    int sx = GetSystemMetrics(SM_CXSCREEN);
    int sy = GetSystemMetrics(SM_CYSCREEN);
    if (x + width > sx) x = sx - width - 10;
    if (y + height > sy) y = sy - height - 10;
    SetWindowPos(g_hwnd_overlay, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    InvalidateRect(g_hwnd_overlay, NULL, TRUE);
}

static void HideOverlay(void) {
    if (g_hwnd_overlay) ShowWindow(g_hwnd_overlay, SW_HIDE);
}

static void ShowCachedOverlayAt(POINT anchor) {
    if (g_overlay_text[0]) ShowOverlayText(g_overlay_text, anchor);
    else ShowOverlayText("(No response yet)", anchor);
}

static void ScrollOverlayByStep(int direction) {
    RECT rc;
    int visible_h;
    int max_scroll;
    if (!g_hwnd_overlay || !IsWindow(g_hwnd_overlay)) return;
    if (!g_cfg.overlay_visible) return;
    GetClientRect(g_hwnd_overlay, &rc);
    visible_h = (rc.bottom - rc.top) - 20;
    if (visible_h < 20) visible_h = 20;
    max_scroll = g_overlay_content_height - visible_h;
    if (max_scroll < 0) max_scroll = 0;
    g_overlay_scroll_px += direction * 56;
    if (g_overlay_scroll_px < 0) g_overlay_scroll_px = 0;
    if (g_overlay_scroll_px > max_scroll) g_overlay_scroll_px = max_scroll;
    InvalidateRect(g_hwnd_overlay, NULL, TRUE);
}
