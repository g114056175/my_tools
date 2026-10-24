static void SendCopyShortcut(void) {
    INPUT inputs[4];
    ZeroMemory(inputs, sizeof(inputs));
    inputs[0].type = INPUT_KEYBOARD;
    inputs[0].ki.wVk = VK_CONTROL;
    inputs[1].type = INPUT_KEYBOARD;
    inputs[1].ki.wVk = 'C';
    inputs[2].type = INPUT_KEYBOARD;
    inputs[2].ki.wVk = 'C';
    inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
    inputs[3].type = INPUT_KEYBOARD;
    inputs[3].ki.wVk = VK_CONTROL;
    inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(4, inputs, sizeof(INPUT));
}

static void ReleaseModifierKeys(void) {
    INPUT in[5];
    ZeroMemory(in, sizeof(in));
    in[0].type = INPUT_KEYBOARD; in[0].ki.wVk = VK_CONTROL; in[0].ki.dwFlags = KEYEVENTF_KEYUP;
    in[1].type = INPUT_KEYBOARD; in[1].ki.wVk = VK_MENU; in[1].ki.dwFlags = KEYEVENTF_KEYUP;
    in[2].type = INPUT_KEYBOARD; in[2].ki.wVk = VK_SHIFT; in[2].ki.dwFlags = KEYEVENTF_KEYUP;
    in[3].type = INPUT_KEYBOARD; in[3].ki.wVk = VK_LWIN; in[3].ki.dwFlags = KEYEVENTF_KEYUP;
    in[4].type = INPUT_KEYBOARD; in[4].ki.wVk = VK_RWIN; in[4].ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(5, in, sizeof(INPUT));
}

static char *GetClipboardTextCopy(void) {
    char *result = NULL;
    if (!OpenClipboard(NULL)) return NULL;
    HANDLE h = GetClipboardData(CF_UNICODETEXT);
    if (h) {
        const wchar_t *w = (const wchar_t *)GlobalLock(h);
        if (w) {
            int len = WideCharToMultiByte(CP_UTF8, 0, w, -1, NULL, 0, NULL, NULL);
            result = (char *)malloc(len);
            if (result) WideCharToMultiByte(CP_UTF8, 0, w, -1, result, len, NULL, NULL);
            GlobalUnlock(h);
        }
    }
    if (!result) {
        HANDLE h2 = GetClipboardData(CF_TEXT);
        if (h2) {
            const char *a = (const char *)GlobalLock(h2);
            if (a) {
                size_t len = strlen(a);
                result = (char *)malloc(len + 1);
                if (result) {
                    memcpy(result, a, len + 1);
                }
                GlobalUnlock(h2);
            }
        }
    }
    CloseClipboard();
    return result;
}

static void RestoreClipboardText(const char *text) {
    if (!OpenClipboard(NULL)) return;
    EmptyClipboard();
    if (text && text[0]) {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, text, -1, NULL, 0);
        HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, wlen * sizeof(wchar_t));
        if (h) {
            wchar_t *w = (wchar_t *)GlobalLock(h);
            if (w) {
                MultiByteToWideChar(CP_UTF8, 0, text, -1, w, wlen);
                GlobalUnlock(h);
                SetClipboardData(CF_UNICODETEXT, h);
            } else {
                GlobalFree(h);
            }
        }
    }
    CloseClipboard();
}

static char *GetSelectedText(void) {
    DWORD seq_before = GetClipboardSequenceNumber();
    char *prev = GetClipboardTextCopy();
    int changed = 0;
    ReleaseModifierKeys();
    Sleep(25);
    SendCopyShortcut();
    for (int i = 0; i < 35; ++i) {
        Sleep(15);
        if (GetClipboardSequenceNumber() != seq_before) { changed = 1; break; }
    }
    if (!changed) {
        INPUT ins[4];
        ZeroMemory(ins, sizeof(ins));
        ins[0].type = INPUT_KEYBOARD; ins[0].ki.wVk = VK_CONTROL;
        ins[1].type = INPUT_KEYBOARD; ins[1].ki.wVk = VK_INSERT;
        ins[2].type = INPUT_KEYBOARD; ins[2].ki.wVk = VK_INSERT; ins[2].ki.dwFlags = KEYEVENTF_KEYUP;
        ins[3].type = INPUT_KEYBOARD; ins[3].ki.wVk = VK_CONTROL; ins[3].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(4, ins, sizeof(INPUT));
        for (int i = 0; i < 35; ++i) {
            Sleep(15);
            if (GetClipboardSequenceNumber() != seq_before) { changed = 1; break; }
        }
    }
    char *selected = changed ? GetClipboardTextCopy() : NULL;
    if (changed && (!selected || !selected[0])) {
        for (int i = 0; i < 30; ++i) {
            Sleep(20);
            free(selected);
            selected = GetClipboardTextCopy();
            if (selected && selected[0]) break;
        }
    }
    if (prev) {
        RestoreClipboardText(prev);
        free(prev);
    }
    return selected;
}

static int ClampInt(int v, int minv, int maxv) {
    if (v < minv) return minv;
    if (v > maxv) return maxv;
    return v;
}

static int HasVisibleText(const char *s) {
    if (!s) return 0;
    for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
        if (*p > ' ') return 1;
    }
    return 0;
}

static void ShowWaitingOverlay(POINT anchor) {
    const char *dots = (g_wait_dots == 1) ? "." : (g_wait_dots == 2) ? ".." : "...";
    char wait_txt[2300];
    if (g_wait_prefix[0]) {
        snprintf(wait_txt, sizeof(wait_txt), "wait%s\n%s", dots, g_wait_prefix);
    } else {
        snprintf(wait_txt, sizeof(wait_txt), "wait%s", dots);
    }
    ShowOverlayText(wait_txt, anchor);
}

static int StepOpacityTier(int current, int direction) {
    static const int tiers[6] = {5, 10, 30, 100, 180, 255};
    if (direction > 0) {
        for (int i = 0; i < 6; ++i) {
            if (tiers[i] > current) return tiers[i];
        }
        return tiers[5];
    }
    for (int i = 5; i >= 0; --i) {
        if (tiers[i] < current) return tiers[i];
    }
    return tiers[0];
}

static void MoveCtrl(HWND hwnd, int id, int x, int y, int w, int h) {
    HWND c = GetDlgItem(hwnd, id);
    if (c) SetWindowPos(c, NULL, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
}
