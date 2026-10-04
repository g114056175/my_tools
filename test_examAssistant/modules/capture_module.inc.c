static RECT GetNormalizedCaptureRect(POINT a, POINT b) {
    RECT rc;
    rc.left = (a.x < b.x) ? a.x : b.x;
    rc.top = (a.y < b.y) ? a.y : b.y;
    rc.right = (a.x > b.x) ? a.x : b.x;
    rc.bottom = (a.y > b.y) ? a.y : b.y;
    return rc;
}

static int CaptureRectTooSmall(RECT rc) {
    return (rc.right - rc.left) < 12 || (rc.bottom - rc.top) < 12;
}

static int PointsCloseEnough(POINT a, POINT b) {
    LONG dx = a.x - b.x;
    LONG dy = a.y - b.y;
    return dx * dx + dy * dy <= 14 * 14;
}

static void BuildCapturePath(char *out, int out_size) {
    char temp_dir[MAX_PATH];
    char temp_file[MAX_PATH];
    char module_dir[MAX_PATH];
    DWORD len;
    if (!GetTempPathA(MAX_PATH, temp_dir)) {
        temp_dir[0] = 0;
    }
    if (temp_dir[0] && GetTempFileNameA(temp_dir, "hlp", 0, temp_file)) {
        DeleteFileA(temp_file);
        strncpy(out, temp_file, out_size - 1);
        out[out_size - 1] = 0;
    } else {
        len = GetModuleFileNameA(NULL, module_dir, MAX_PATH);
        if (len == 0 || len >= MAX_PATH) {
            strncpy(out, ".\\helper_capture.png", out_size - 1);
            out[out_size - 1] = 0;
            return;
        }
        for (int i = (int)len - 1; i >= 0; --i) {
            if (module_dir[i] == '\\' || module_dir[i] == '/') {
                module_dir[i + 1] = 0;
                break;
            }
        }
        snprintf(out, out_size, "%shelper_capture_%lu.png", module_dir, (unsigned long)GetTickCount());
    }
    {
        char *dot = strrchr(out, '.');
        if (dot) strcpy(dot, ".png");
        else strncat(out, ".png", out_size - strlen(out) - 1);
    }
}

static int GetPngEncoderClsid(CLSID *clsid) {
    UINT num = 0;
    UINT bytes = 0;
    Gdiplus::ImageCodecInfo *info = NULL;
    int found = 0;
    if (Gdiplus::GetImageEncodersSize(&num, &bytes) != Gdiplus::Ok || bytes == 0) return 0;
    info = (Gdiplus::ImageCodecInfo *)malloc(bytes);
    if (!info) return 0;
    if (Gdiplus::GetImageEncoders(num, bytes, info) != Gdiplus::Ok) {
        free(info);
        return 0;
    }
    for (UINT i = 0; i < num; ++i) {
        if (wcscmp(info[i].MimeType, L"image/png") == 0) {
            *clsid = info[i].Clsid;
            found = 1;
            break;
        }
    }
    free(info);
    return found;
}

static int SaveBitmapToPng(HBITMAP bmp, const char *path) {
    CLSID png_clsid;
    wchar_t wpath[MAX_PATH];
    Gdiplus::Bitmap image(bmp, NULL);
    if (!GetPngEncoderClsid(&png_clsid)) return 0;
    if (MultiByteToWideChar(CP_UTF8, 0, path, -1, wpath, MAX_PATH) == 0) {
        MultiByteToWideChar(CP_ACP, 0, path, -1, wpath, MAX_PATH);
    }
    return image.Save(wpath, &png_clsid, NULL) == Gdiplus::Ok;
}

static int SaveScreenRegionPng(RECT rc, char *path, int path_size) {
    int width = rc.right - rc.left;
    int height = rc.bottom - rc.top;
    HDC screen = NULL;
    HDC mem = NULL;
    HBITMAP bmp = NULL;
    int ok = 0;
    if (width <= 0 || height <= 0) return 0;
    BuildCapturePath(path, path_size);
    screen = GetDC(NULL);
    if (!screen) goto cleanup;
    mem = CreateCompatibleDC(screen);
    if (!mem) goto cleanup;
    bmp = CreateCompatibleBitmap(screen, width, height);
    if (!bmp) goto cleanup;
    SelectObject(mem, bmp);
    if (!BitBlt(mem, 0, 0, width, height, screen, rc.left, rc.top, SRCCOPY | CAPTUREBLT)) goto cleanup;
    ok = SaveBitmapToPng(bmp, path);
cleanup:
    if (bmp) DeleteObject(bmp);
    if (mem) DeleteDC(mem);
    if (screen) ReleaseDC(NULL, screen);
    return ok;
}

static LRESULT CALLBACK CaptureProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    switch (msg) {
    case WM_NCHITTEST:
        return HTTRANSPARENT;
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT client;
        RECT rc = GetNormalizedCaptureRect(g_capture_anchor, g_capture_current);
        int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        HBRUSH clear = CreateSolidBrush(RGB(255, 0, 255));
        HBRUSH old_brush;
        HPEN outer_pen = CreatePen(PS_SOLID, 2, RGB(72, 72, 72));
        HPEN inner_pen = CreatePen(PS_SOLID, 1, RGB(236, 236, 236));
        HPEN marker_pen = CreatePen(PS_SOLID, 1, RGB(250, 250, 250));
        HBRUSH marker_brush = CreateSolidBrush(RGB(96, 96, 96));
        HPEN old_pen;
        GetClientRect(hwnd, &client);
        FillRect(hdc, &client, clear);
        DeleteObject(clear);
        rc.left -= vx;
        rc.right -= vx;
        rc.top -= vy;
        rc.bottom -= vy;
        old_brush = (HBRUSH)SelectObject(hdc, GetStockObject(NULL_BRUSH));
        SetBkMode(hdc, TRANSPARENT);
        if (!CaptureRectTooSmall(GetNormalizedCaptureRect(g_capture_anchor, g_capture_current))) {
            old_pen = (HPEN)SelectObject(hdc, outer_pen);
            MoveToEx(hdc, rc.left, rc.top, NULL);
            LineTo(hdc, rc.right, rc.top);
            LineTo(hdc, rc.right, rc.bottom);
            LineTo(hdc, rc.left, rc.bottom);
            LineTo(hdc, rc.left, rc.top);
            SelectObject(hdc, inner_pen);
            MoveToEx(hdc, rc.left + 1, rc.top + 1, NULL);
            LineTo(hdc, rc.right - 1, rc.top + 1);
            LineTo(hdc, rc.right - 1, rc.bottom - 1);
            LineTo(hdc, rc.left + 1, rc.bottom - 1);
            LineTo(hdc, rc.left + 1, rc.top + 1);
            SelectObject(hdc, old_pen);
        }
        old_pen = (HPEN)SelectObject(hdc, marker_pen);
        SelectObject(hdc, marker_brush);
        Ellipse(hdc,
                g_capture_anchor.x - vx - 4, g_capture_anchor.y - vy - 4,
                g_capture_anchor.x - vx + 4, g_capture_anchor.y - vy + 4);
        SelectObject(hdc, old_brush);
        SelectObject(hdc, old_pen);
        DeleteObject(outer_pen);
        DeleteObject(inner_pen);
        DeleteObject(marker_pen);
        DeleteObject(marker_brush);
        EndPaint(hwnd, &ps);
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wparam, lparam);
}

static void EnsureCaptureWindow(HWND hwnd_parent) {
    if (g_hwnd_capture) return;
    WNDCLASSA wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = CaptureProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "LLMCaptureOverlayWindow";
    RegisterClassA(&wc);
    g_hwnd_capture = CreateWindowExA(
        WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE,
        wc.lpszClassName, "CaptureOverlay",
        WS_POPUP,
        0, 0, 10, 10,
        hwnd_parent, NULL, wc.hInstance, NULL);
    SetLayeredWindowAttributes(g_hwnd_capture, RGB(255, 0, 255), 100, LWA_COLORKEY | LWA_ALPHA);
}

static void ShowCaptureOverlay(void) {
    int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    int vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    EnsureCaptureWindow(g_hwnd_main);
    SetWindowPos(g_hwnd_capture, HWND_TOPMOST, vx, vy, vw, vh, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    InvalidateRect(g_hwnd_capture, NULL, TRUE);
}

static void CancelCaptureSelection(void) {
    g_capture_active = 0;
    g_have_tl = 0;
    g_have_br = 0;
    KillTimer(g_hwnd_main, 2);
    if (g_hwnd_capture) ShowWindow(g_hwnd_capture, SW_HIDE);
}

static void StartCaptureSelection(POINT anchor) {
    if (g_capture_active && PointsCloseEnough(anchor, g_capture_anchor)) {
        CancelCaptureSelection();
        return;
    }
    g_capture_anchor = anchor;
    g_capture_current = anchor;
    g_tl = anchor;
    g_have_tl = 1;
    g_have_br = 0;
    g_capture_active = 1;
    g_capture_deadline = GetTickCount64() + 2000;
    ShowCaptureOverlay();
    SetTimer(g_hwnd_main, 2, 33, NULL);
}

static int ConfirmCaptureSelection(POINT cursor, char *path, int path_size) {
    RECT rc;
    if (path_size > 0) path[0] = 0;
    if (!g_capture_active) return 0;
    g_capture_current = cursor;
    g_br = cursor;
    g_have_br = 1;
    rc = GetNormalizedCaptureRect(g_capture_anchor, g_capture_current);
    CancelCaptureSelection();
    if (CaptureRectTooSmall(rc)) return 0;
    if (!SaveScreenRegionPng(rc, path, path_size)) return 0;
    strncpy(g_last_capture_path, path, sizeof(g_last_capture_path) - 1);
    g_last_capture_path[sizeof(g_last_capture_path) - 1] = 0;
    return 1;
}
