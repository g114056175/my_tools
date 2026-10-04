static void NormalizeKeyToken(char *token) {
    for (char *p = token; *p; ++p) {
        if (*p >= 'a' && *p <= 'z') *p = (char)(*p - 32);
    }
}

static int ParsePositiveIntAscii(const char *s) {
    int v = 0;
    int has_digit = 0;
    if (!s) return -1;
    while (*s) {
        if (*s < '0' || *s > '9') return -1;
        has_digit = 1;
        v = v * 10 + (*s - '0');
        if (v > 1000000) return -1;
        ++s;
    }
    return has_digit ? v : -1;
}

static int ParseKeyName(const char *key, UINT *vk) {
    if (strlen(key) == 1) {
        char c = key[0];
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
            *vk = (UINT)c;
            return 1;
        }
    }
    if (strcmp(key, "UP") == 0) { *vk = VK_UP; return 1; }
    if (strcmp(key, "DOWN") == 0) { *vk = VK_DOWN; return 1; }
    if (strcmp(key, "LEFT") == 0) { *vk = VK_LEFT; return 1; }
    if (strcmp(key, "RIGHT") == 0) { *vk = VK_RIGHT; return 1; }
    if (strcmp(key, "SPACE") == 0) { *vk = VK_SPACE; return 1; }
    if (strcmp(key, "TAB") == 0) { *vk = VK_TAB; return 1; }
    if (strcmp(key, "ENTER") == 0) { *vk = VK_RETURN; return 1; }

    if (strncmp(key, "NUM", 3) == 0 && key[3] >= '0' && key[3] <= '9' && key[4] == 0) {
        *vk = VK_NUMPAD0 + (key[3] - '0');
        return 1;
    }
    if (strncmp(key, "NUMPAD", 6) == 0 && key[6] >= '0' && key[6] <= '9' && key[7] == 0) {
        *vk = VK_NUMPAD0 + (key[6] - '0');
        return 1;
    }
    if (strcmp(key, "NUMPLUS") == 0) { *vk = VK_ADD; return 1; }
    if (strcmp(key, "NUMMINUS") == 0) { *vk = VK_SUBTRACT; return 1; }
    if (strcmp(key, "NUMMUL") == 0) { *vk = VK_MULTIPLY; return 1; }
    if (strcmp(key, "NUMDIV") == 0) { *vk = VK_DIVIDE; return 1; }
    if (strcmp(key, "NUMDOT") == 0) { *vk = VK_DECIMAL; return 1; }

    if (strncmp(key, "VK_", 3) == 0) {
        int code = ParsePositiveIntAscii(key + 3);
        if (code > 0 && code <= 255) {
            *vk = (UINT)code;
            return 1;
        }
    }

    if (key[0] == 'F' && key[1] >= '1') {
        int n = ParsePositiveIntAscii(key + 1);
        if (n >= 1 && n <= 24) {
            *vk = VK_F1 + (n - 1);
            return 1;
        }
    }
    return 0;
}

static int ParseHotkey(const char *text, UINT *mod, UINT *vk) {
    char buf[128];
    char *p;
    *mod = 0;
    *vk = 0;
    strncpy(buf, text, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = 0;
    p = buf;
    while (*p) {
        char token[64];
        char *tok;
        int ti = 0;
        while (*p == ' ') p++;
        while (*p && *p != '+') {
            if (ti + 1 < (int)sizeof(token)) token[ti++] = *p;
            p++;
        }
        while (ti > 0 && token[ti - 1] == ' ') ti--;
        token[ti] = 0;
        tok = token;
        if (tok[0] == 0) return 0;
        while (*tok == ' ') tok++;
        NormalizeKeyToken(tok);
        if (strcmp(tok, "CTRL") == 0 || strcmp(tok, "CONTROL") == 0) {
            *mod |= MOD_CONTROL;
        } else if (strcmp(tok, "ALT") == 0) {
            *mod |= MOD_ALT;
        } else if (strcmp(tok, "SHIFT") == 0) {
            *mod |= MOD_SHIFT;
        } else if (strcmp(tok, "WIN") == 0 || strcmp(tok, "WINDOWS") == 0) {
            *mod |= MOD_WIN;
        } else if (!ParseKeyName(tok, vk)) {
            return 0;
        }
        if (*p == '+') p++;
    }
    return *vk != 0;
}

static void UnregisterHotkeys(HWND hwnd) {
    UnregisterHotKey(hwnd, HOTKEY_SEND_SELECTED);
    UnregisterHotKey(hwnd, HOTKEY_SET_TL);
    UnregisterHotKey(hwnd, HOTKEY_SET_BR);
    UnregisterHotKey(hwnd, HOTKEY_TOGGLE_VISIBLE);
    UnregisterHotKey(hwnd, HOTKEY_OPACITY_UP);
    UnregisterHotKey(hwnd, HOTKEY_OPACITY_DOWN);
    UnregisterHotKey(hwnd, HOTKEY_OPEN_SETTINGS);
    UnregisterHotKey(hwnd, HOTKEY_EXIT_APP);
    UnregisterHotKey(hwnd, HOTKEY_CANCEL_REQ);
    UnregisterHotKey(hwnd, HOTKEY_SCROLL_UP);
    UnregisterHotKey(hwnd, HOTKEY_SCROLL_DOWN);
    for (int i = 0; i < MAX_MODEL_ROUTES; ++i) {
        UnregisterHotKey(hwnd, HOTKEY_MODEL_ROUTE_BASE + i);
    }
}

static void RegisterHotkeys(HWND hwnd, const AppConfig *cfg) {
    UINT mod = 0, vk = 0;
    UnregisterHotkeys(hwnd);
    if (ParseHotkey(cfg->hk_send, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_SEND_SELECTED, mod, vk);
    if (ParseHotkey(cfg->hk_tl, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_SET_TL, mod, vk);
    if (ParseHotkey(cfg->hk_br, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_SET_BR, mod, vk);
    if (ParseHotkey(cfg->hk_toggle_visible, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_TOGGLE_VISIBLE, mod, vk);
    if (ParseHotkey(cfg->hk_opacity_up, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_OPACITY_UP, mod, vk);
    if (ParseHotkey(cfg->hk_opacity_down, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_OPACITY_DOWN, mod, vk);
    if (ParseHotkey(cfg->hk_scroll_up, &mod, &vk)) {
        if (!RegisterHotKey(hwnd, HOTKEY_SCROLL_UP, mod, vk)) {
            RegisterHotKey(hwnd, HOTKEY_SCROLL_UP, MOD_CONTROL | MOD_ALT, VK_PRIOR);
        }
    }
    if (ParseHotkey(cfg->hk_scroll_down, &mod, &vk)) {
        if (!RegisterHotKey(hwnd, HOTKEY_SCROLL_DOWN, mod, vk)) {
            RegisterHotKey(hwnd, HOTKEY_SCROLL_DOWN, MOD_CONTROL | MOD_ALT, VK_NEXT);
        }
    }
    if (ParseHotkey(cfg->hk_open_settings, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_OPEN_SETTINGS, mod, vk);
    if (ParseHotkey(cfg->hk_exit, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_EXIT_APP, mod, vk);
    if (ParseHotkey(cfg->hk_cancel, &mod, &vk)) RegisterHotKey(hwnd, HOTKEY_CANCEL_REQ, mod, vk);
    for (int i = 0; i < cfg->model_route_count && i < MAX_MODEL_ROUTES; ++i) {
        if (ParseHotkey(cfg->model_route_hotkey[i], &mod, &vk)) {
            RegisterHotKey(hwnd, HOTKEY_MODEL_ROUTE_BASE + i, mod, vk);
        }
    }
}

static void BuildHotkeyString(UINT mod, UINT vk, char *out, size_t out_size) {
    char key[32] = {0};
    if ((vk >= 'A' && vk <= 'Z') || (vk >= '0' && vk <= '9')) {
        key[0] = (char)vk;
        key[1] = 0;
    } else if (vk >= VK_NUMPAD0 && vk <= VK_NUMPAD9) {
        snprintf(key, sizeof(key), "Num%u", (unsigned)(vk - VK_NUMPAD0));
    } else if (vk == VK_ADD) strcpy(key, "NumPlus");
    else if (vk == VK_SUBTRACT) strcpy(key, "NumMinus");
    else if (vk == VK_MULTIPLY) strcpy(key, "NumMul");
    else if (vk == VK_DIVIDE) strcpy(key, "NumDiv");
    else if (vk == VK_DECIMAL) strcpy(key, "NumDot");
    else if (vk >= VK_F1 && vk <= VK_F24) {
        snprintf(key, sizeof(key), "F%u", (unsigned)(vk - VK_F1 + 1));
    } else if (vk == VK_UP) strcpy(key, "Up");
    else if (vk == VK_DOWN) strcpy(key, "Down");
    else if (vk == VK_LEFT) strcpy(key, "Left");
    else if (vk == VK_RIGHT) strcpy(key, "Right");
    else if (vk == VK_SPACE) strcpy(key, "Space");
    else if (vk == VK_TAB) strcpy(key, "Tab");
    else if (vk == VK_RETURN) strcpy(key, "Enter");
    else snprintf(key, sizeof(key), "VK_%u", (unsigned)vk);

    out[0] = 0;
    if (mod & MOD_CONTROL) strncat(out, "Ctrl+", out_size - strlen(out) - 1);
    if (mod & MOD_ALT) strncat(out, "Alt+", out_size - strlen(out) - 1);
    if (mod & MOD_SHIFT) strncat(out, "Shift+", out_size - strlen(out) - 1);
    if (mod & MOD_WIN) strncat(out, "Win+", out_size - strlen(out) - 1);
    strncat(out, key, out_size - strlen(out) - 1);
}
