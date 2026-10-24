static void CopyJoinedText(char *dst, size_t dst_size, const char *prefix, const char *suffix) {
    if (!dst || dst_size == 0) return;
    if (!prefix) prefix = "";
    if (!suffix) suffix = "";
    snprintf(dst, dst_size, "%s%s", prefix, suffix);
}

static void ConfigDefaults(AppConfig *cfg) {
    static const char *kTwPrefix = "Reply in Traditional Chinese. ";
    static const char *kQuickPrompt = "Test LLM prompt: please reply alive.";
    memset(cfg, 0, sizeof(*cfg));
    strcpy(cfg->endpoint, "");
    strcpy(cfg->api_key, "");
    strcpy(cfg->model, "");
    CopyJoinedText(cfg->system_prompt, sizeof(cfg->system_prompt), kTwPrefix,
                   "You are a strict exam-answering assistant. Determine question type first. If multiple-choice, output one answer per question with numbering, each on a new line, for example: 1. (A) 2. (B)(D). If non-multiple-choice, output concise direct answers with numbering, one line per question. The number of output lines must equal the number of questions; never omit any question. If information is insufficient or ambiguous, output 'insufficient information' for that item. Do not guess. Output final answers only.");
    strcpy(cfg->quick_prompt, kQuickPrompt);
    for (int i = 0; i < MAX_PROMPT_ROUTES; ++i) {
        cfg->route_prompt_endpoint[i][0] = 0;
        cfg->route_prompt_api_key[i][0] = 0;
        cfg->route_prompt_model[i][0] = 0;
        cfg->route_prompt_text[i][0] = 0;
    }
    for (int i = 0; i < MAX_IMAGE_ROUTES; ++i) {
        cfg->route_image_endpoint[i][0] = 0;
        cfg->route_image_api_key[i][0] = 0;
        cfg->route_image_model[i][0] = 0;
        cfg->route_image_prompt[i][0] = 0;
    }
    cfg->model_route_count = 0;
    for (int i = 0; i < MAX_MODEL_ROUTES; ++i) {
        cfg->model_route_kind[i] = 0;
        cfg->model_route_endpoint[i][0] = 0;
        cfg->model_route_api_key[i][0] = 0;
        cfg->model_route_model[i][0] = 0;
        cfg->model_route_prompt[i][0] = 0;
        cfg->model_route_hotkey[i][0] = 0;
    }
    cfg->rag_enabled = 0;
    strcpy(cfg->rag_source_path, "");
    cfg->ensemble_enabled = 0;
    strcpy(cfg->ensemble_primary_endpoint, "");
    strcpy(cfg->ensemble_primary_api_key, "");
    strcpy(cfg->ensemble_primary_model, "");
    cfg->ensemble_reviewer_count = 0;
    CopyJoinedText(cfg->ensemble_side_prompt[0], sizeof(cfg->ensemble_side_prompt[0]), kTwPrefix, "Give direct answers only. No explanation.");
    CopyJoinedText(cfg->ensemble_side_prompt[1], sizeof(cfg->ensemble_side_prompt[1]), kTwPrefix, "Answer briefly with direct answers first, minimal explanation.");
    CopyJoinedText(cfg->ensemble_side_prompt[2], sizeof(cfg->ensemble_side_prompt[2]), kTwPrefix, "Solve carefully and provide the likely answer with short supporting reasoning.");
    CopyJoinedText(cfg->ensemble_main_prompt[0], sizeof(cfg->ensemble_main_prompt[0]), kTwPrefix, "Based on the other model answers, give the final answer only. Mark disagreement only if present.");
    CopyJoinedText(cfg->ensemble_main_prompt[1], sizeof(cfg->ensemble_main_prompt[1]), kTwPrefix, "Based on the other model answers, summarize the best final answer and briefly mention disagreement if present.");
    CopyJoinedText(cfg->ensemble_main_prompt[2], sizeof(cfg->ensemble_main_prompt[2]), kTwPrefix, "Based on the other model answers, provide the final answer, explain the main reason briefly, and clearly mark disagreement if present.");
    cfg->overlay_enabled = 1;
    cfg->overlay_visible = 1;
    cfg->opacity = 180;
    cfg->theme_light = 1;
    cfg->stream = 1;
    strcpy(cfg->hk_send, "Ctrl+Q");
    strcpy(cfg->hk_send2, "Ctrl+W");
    strcpy(cfg->hk_send3, "Ctrl+E");
    strcpy(cfg->hk_send4, "");
    strcpy(cfg->hk_send5, "");
    strcpy(cfg->hk_tl, "Ctrl+Alt+1");
    strcpy(cfg->hk_br, "Ctrl+Alt+2");
    strcpy(cfg->hk_img2, "");
    strcpy(cfg->hk_img3, "");
    strcpy(cfg->hk_toggle_enable, "Ctrl+Alt+E");
    strcpy(cfg->hk_toggle_visible, "Alt+V");
    strcpy(cfg->hk_opacity_up, "Ctrl+Alt+Right");
    strcpy(cfg->hk_opacity_down, "Ctrl+Alt+Left");
    strcpy(cfg->hk_scroll_up, "Ctrl+Alt+Up");
    strcpy(cfg->hk_scroll_down, "Ctrl+Alt+Down");
    strcpy(cfg->hk_open_settings, "Ctrl+Alt+S");
    strcpy(cfg->hk_exit, "Ctrl+Alt+X");
    strcpy(cfg->hk_cancel, "Ctrl+R");
}

static void InitConfigPath(void) {
    DWORD len = GetModuleFileNameA(NULL, g_config_path, MAX_PATH);
    if (len == 0 || len >= MAX_PATH) {
        strcpy(g_config_path, CONFIG_FILE);
        return;
    }
    for (int i = (int)len - 1; i >= 0; --i) {
        if (g_config_path[i] == '\\' || g_config_path[i] == '/') {
            g_config_path[i + 1] = 0;
            strncat(g_config_path, CONFIG_FILE, MAX_PATH - strlen(g_config_path) - 1);
            return;
        }
    }
    strcpy(g_config_path, CONFIG_FILE);
}

static char *DupPrintf(const char *fmt, ...) {
    char buf[2048];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    return _strdup(buf);
}

static void NormalizeEndpoint(char *s) {
    for (char *p = s; *p; ++p) {
        if (*p == '\\') *p = '/';
    }
}

static void EscapeIniValue(const char *src, char *dst, int dst_size) {
    int o = 0;
    for (int i = 0; src && src[i] && o + 2 < dst_size; ++i) {
        char c = src[i];
        if (c == '\\') {
            dst[o++] = '\\'; dst[o++] = '\\';
        } else if (c == '\n') {
            dst[o++] = '\\'; dst[o++] = 'n';
        } else if (c == '\r') {
            dst[o++] = '\\'; dst[o++] = 'r';
        } else {
            dst[o++] = c;
        }
    }
    dst[o] = 0;
}

static void UnescapeIniValue(char *s) {
    if (!s) return;
    char *src = s, *dst = s;
    while (*src) {
        if (*src == '\\' && src[1]) {
            src++;
            if (*src == 'n') *dst++ = '\n';
            else if (*src == 'r') *dst++ = '\r';
            else *dst++ = *src;
            src++;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = 0;
}

static void EncodeIniUtf8Value(const char *src, char *dst, int dst_size) {
    int o = 0;
    for (int i = 0; src && src[i] && o + 4 < dst_size; ++i) {
        unsigned char c = (unsigned char)src[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' ||
            c == ':' || c == '/' || c == '\\') {
            dst[o++] = (char)c;
        } else {
            static const char hex[] = "0123456789ABCDEF";
            dst[o++] = '%';
            dst[o++] = hex[(c >> 4) & 0xF];
            dst[o++] = hex[c & 0xF];
        }
    }
    dst[o] = 0;
}

static int HexNibble(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

static void DecodeIniUtf8Value(char *s) {
    char *src = s;
    char *dst = s;
    while (src && *src) {
        if (src[0] == '%' && HexNibble((unsigned char)src[1]) >= 0 && HexNibble((unsigned char)src[2]) >= 0) {
            int hi = HexNibble((unsigned char)src[1]);
            int lo = HexNibble((unsigned char)src[2]);
            *dst++ = (char)((hi << 4) | lo);
            src += 3;
        } else {
            *dst++ = *src++;
        }
    }
    *dst = 0;
}

static int IsBlankText(const char *s) {
    if (!s) return 1;
    for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
        if (*p > ' ') return 0;
    }
    return 1;
}

static int IsReviewerAllEmptyAt(const AppConfig *cfg, int index) {
    if (!cfg || index < 0 || index >= cfg->ensemble_reviewer_count) return 1;
    return IsBlankText(cfg->ensemble_reviewer_endpoint[index]) &&
           IsBlankText(cfg->ensemble_reviewer_api_key[index]) &&
           IsBlankText(cfg->ensemble_reviewer_model[index]);
}

static int IsReviewerUsableAt(const AppConfig *cfg, int index) {
    if (!cfg || index < 0 || index >= cfg->ensemble_reviewer_count) return 0;
    return !IsBlankText(cfg->ensemble_reviewer_endpoint[index]) &&
           !IsBlankText(cfg->ensemble_reviewer_model[index]);
}

static void RemoveReviewerAt(AppConfig *cfg, int index) {
    if (!cfg || index < 0 || index >= cfg->ensemble_reviewer_count) return;
    for (int i = index; i + 1 < cfg->ensemble_reviewer_count; ++i) {
        strcpy(cfg->ensemble_reviewer_endpoint[i], cfg->ensemble_reviewer_endpoint[i + 1]);
        strcpy(cfg->ensemble_reviewer_api_key[i], cfg->ensemble_reviewer_api_key[i + 1]);
        strcpy(cfg->ensemble_reviewer_model[i], cfg->ensemble_reviewer_model[i + 1]);
    }
    if (cfg->ensemble_reviewer_count > 0) cfg->ensemble_reviewer_count--;
    if (cfg->ensemble_reviewer_count < 0) cfg->ensemble_reviewer_count = 0;
}

static int PruneEmptyReviewers(AppConfig *cfg) {
    int removed = 0;
    if (!cfg) return 0;
    for (int i = cfg->ensemble_reviewer_count - 1; i >= 0; --i) {
        if (IsReviewerAllEmptyAt(cfg, i)) {
            RemoveReviewerAt(cfg, i);
            removed++;
        }
    }
    return removed;
}

static void AddTrayIcon(HWND hwnd) {
    if (g_tray_added) return;
    NOTIFYICONDATAA nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = TRAY_UID;
    nid.uFlags = NIF_ICON | NIF_TIP | NIF_MESSAGE;
    nid.uCallbackMessage = WM_APP_TRAY;
    nid.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    strcpy(nid.szTip, APP_NAME);
    if (Shell_NotifyIconA(NIM_ADD, &nid)) {
        g_tray_added = 1;
    }
}

static void RemoveTrayIcon(HWND hwnd) {
    if (!g_tray_added) return;
    NOTIFYICONDATAA nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = hwnd;
    nid.uID = TRAY_UID;
    Shell_NotifyIconA(NIM_DELETE, &nid);
    g_tray_added = 0;
}

static void LoadConfig(AppConfig *cfg) {
    char tmpbuf[2048];
    ConfigDefaults(cfg);
    GetPrivateProfileStringA("API", "endpoint", cfg->endpoint, cfg->endpoint, sizeof(cfg->endpoint), g_config_path);
    GetPrivateProfileStringA("API", "api_key", cfg->api_key, cfg->api_key, sizeof(cfg->api_key), g_config_path);
    GetPrivateProfileStringA("API", "model", cfg->model, cfg->model, sizeof(cfg->model), g_config_path);
    GetPrivateProfileStringA("Prompt", "prompt", cfg->system_prompt, cfg->system_prompt, sizeof(cfg->system_prompt), g_config_path);
    if (!cfg->system_prompt[0]) {
        GetPrivateProfileStringA("Prompt", "prompt_1", cfg->system_prompt, cfg->system_prompt, sizeof(cfg->system_prompt), g_config_path);
    }
    GetPrivateProfileStringA("Prompt", "quick_prompt", cfg->quick_prompt, cfg->quick_prompt, sizeof(cfg->quick_prompt), g_config_path);
    GetPrivateProfileStringA("Prompt", "prompt_2", cfg->prompt_2, cfg->prompt_2, sizeof(cfg->prompt_2), g_config_path);
    GetPrivateProfileStringA("Prompt", "prompt_3", cfg->prompt_3, cfg->prompt_3, sizeof(cfg->prompt_3), g_config_path);
    GetPrivateProfileStringA("Prompt", "prompt_4", cfg->prompt_4, cfg->prompt_4, sizeof(cfg->prompt_4), g_config_path);
    GetPrivateProfileStringA("Prompt", "prompt_5", cfg->prompt_5, cfg->prompt_5, sizeof(cfg->prompt_5), g_config_path);
    GetPrivateProfileStringA("Prompt", "user_template", cfg->user_template, cfg->user_template, sizeof(cfg->user_template), g_config_path);
    UnescapeIniValue(cfg->system_prompt);
    UnescapeIniValue(cfg->prompt_2);
    UnescapeIniValue(cfg->prompt_3);
    UnescapeIniValue(cfg->prompt_4);
    UnescapeIniValue(cfg->prompt_5);
    UnescapeIniValue(cfg->user_template);
    for (int i = 0; i < MAX_PROMPT_ROUTES; ++i) {
        char key[64];
        snprintf(key, sizeof(key), "prompt_%d_endpoint", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_prompt_endpoint[i], sizeof(cfg->route_prompt_endpoint[i]), g_config_path);
        snprintf(key, sizeof(key), "prompt_%d_api_key", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_prompt_api_key[i], sizeof(cfg->route_prompt_api_key[i]), g_config_path);
        snprintf(key, sizeof(key), "prompt_%d_model", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_prompt_model[i], sizeof(cfg->route_prompt_model[i]), g_config_path);
        snprintf(key, sizeof(key), "prompt_%d_prompt", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_prompt_text[i], sizeof(cfg->route_prompt_text[i]), g_config_path);
        UnescapeIniValue(cfg->route_prompt_endpoint[i]);
        UnescapeIniValue(cfg->route_prompt_api_key[i]);
        UnescapeIniValue(cfg->route_prompt_model[i]);
        UnescapeIniValue(cfg->route_prompt_text[i]);
        NormalizeFriendlyEndpointAlias(cfg->route_prompt_endpoint[i], (int)sizeof(cfg->route_prompt_endpoint[i]));
    }
    for (int i = 0; i < MAX_IMAGE_ROUTES; ++i) {
        char key[64];
        snprintf(key, sizeof(key), "image_%d_endpoint", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_image_endpoint[i], sizeof(cfg->route_image_endpoint[i]), g_config_path);
        snprintf(key, sizeof(key), "image_%d_api_key", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_image_api_key[i], sizeof(cfg->route_image_api_key[i]), g_config_path);
        snprintf(key, sizeof(key), "image_%d_model", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_image_model[i], sizeof(cfg->route_image_model[i]), g_config_path);
        snprintf(key, sizeof(key), "image_%d_prompt", i + 1);
        GetPrivateProfileStringA("Routes", key, "", cfg->route_image_prompt[i], sizeof(cfg->route_image_prompt[i]), g_config_path);
        UnescapeIniValue(cfg->route_image_endpoint[i]);
        UnescapeIniValue(cfg->route_image_api_key[i]);
        UnescapeIniValue(cfg->route_image_model[i]);
        UnescapeIniValue(cfg->route_image_prompt[i]);
        NormalizeFriendlyEndpointAlias(cfg->route_image_endpoint[i], (int)sizeof(cfg->route_image_endpoint[i]));
    }
    cfg->model_route_count = 0;
    for (int i = 0; i < MAX_MODEL_ROUTES; ++i) {
        char key[64];
        snprintf(key, sizeof(key), "route_%d_kind", i + 1);
        cfg->model_route_kind[i] = GetPrivateProfileIntA("ModelRouter", key, 0, g_config_path) ? 1 : 0;
        snprintf(key, sizeof(key), "route_%d_endpoint", i + 1);
        GetPrivateProfileStringA("ModelRouter", key, "", cfg->model_route_endpoint[i], sizeof(cfg->model_route_endpoint[i]), g_config_path);
        snprintf(key, sizeof(key), "route_%d_api_key", i + 1);
        GetPrivateProfileStringA("ModelRouter", key, "", cfg->model_route_api_key[i], sizeof(cfg->model_route_api_key[i]), g_config_path);
        snprintf(key, sizeof(key), "route_%d_model", i + 1);
        GetPrivateProfileStringA("ModelRouter", key, "", cfg->model_route_model[i], sizeof(cfg->model_route_model[i]), g_config_path);
        snprintf(key, sizeof(key), "route_%d_prompt", i + 1);
        GetPrivateProfileStringA("ModelRouter", key, "", cfg->model_route_prompt[i], sizeof(cfg->model_route_prompt[i]), g_config_path);
        snprintf(key, sizeof(key), "route_%d_hotkey", i + 1);
        GetPrivateProfileStringA("ModelRouter", key, "", cfg->model_route_hotkey[i], sizeof(cfg->model_route_hotkey[i]), g_config_path);
        UnescapeIniValue(cfg->model_route_endpoint[i]);
        UnescapeIniValue(cfg->model_route_api_key[i]);
        UnescapeIniValue(cfg->model_route_model[i]);
        UnescapeIniValue(cfg->model_route_prompt[i]);
        UnescapeIniValue(cfg->model_route_hotkey[i]);
        NormalizeFriendlyEndpointAlias(cfg->model_route_endpoint[i], (int)sizeof(cfg->model_route_endpoint[i]));
        if (IsBlankText(cfg->model_route_endpoint[i]) && IsBlankText(cfg->model_route_api_key[i]) &&
            IsBlankText(cfg->model_route_model[i]) && IsBlankText(cfg->model_route_prompt[i]) &&
            IsBlankText(cfg->model_route_hotkey[i])) {
            cfg->model_route_kind[i] = -1;
        }
    }
    {
        int w = 0;
        for (int i = 0; i < MAX_MODEL_ROUTES; ++i) {
            if (cfg->model_route_kind[i] < 0) continue;
            if (w != i) {
                cfg->model_route_kind[w] = cfg->model_route_kind[i];
                strcpy(cfg->model_route_endpoint[w], cfg->model_route_endpoint[i]);
                strcpy(cfg->model_route_api_key[w], cfg->model_route_api_key[i]);
                strcpy(cfg->model_route_model[w], cfg->model_route_model[i]);
                strcpy(cfg->model_route_prompt[w], cfg->model_route_prompt[i]);
                strcpy(cfg->model_route_hotkey[w], cfg->model_route_hotkey[i]);
            }
            ++w;
        }
        cfg->model_route_count = w;
    }
    if (!cfg->route_image_endpoint[0][0]) GetPrivateProfileStringA("Routes", "image_endpoint", "", cfg->route_image_endpoint[0], sizeof(cfg->route_image_endpoint[0]), g_config_path);
    if (!cfg->route_image_api_key[0][0]) GetPrivateProfileStringA("Routes", "image_api_key", "", cfg->route_image_api_key[0], sizeof(cfg->route_image_api_key[0]), g_config_path);
    if (!cfg->route_image_model[0][0]) GetPrivateProfileStringA("Routes", "image_model", "", cfg->route_image_model[0], sizeof(cfg->route_image_model[0]), g_config_path);
    UnescapeIniValue(cfg->route_image_endpoint[0]);
    UnescapeIniValue(cfg->route_image_api_key[0]);
    UnescapeIniValue(cfg->route_image_model[0]);
    NormalizeFriendlyEndpointAlias(cfg->route_image_endpoint[0], (int)sizeof(cfg->route_image_endpoint[0]));
    cfg->rag_enabled = GetPrivateProfileIntA("RAG", "enabled", cfg->rag_enabled, g_config_path);
    GetPrivateProfileStringA("RAG", "source_path", cfg->rag_source_path, cfg->rag_source_path, sizeof(cfg->rag_source_path), g_config_path);
    DecodeIniUtf8Value(cfg->rag_source_path);
    cfg->ensemble_enabled = GetPrivateProfileIntA("Ensemble", "enabled", cfg->ensemble_enabled, g_config_path);
    GetPrivateProfileStringA("Ensemble", "primary_endpoint", cfg->ensemble_primary_endpoint, cfg->ensemble_primary_endpoint, sizeof(cfg->ensemble_primary_endpoint), g_config_path);
    GetPrivateProfileStringA("Ensemble", "primary_api_key", cfg->ensemble_primary_api_key, cfg->ensemble_primary_api_key, sizeof(cfg->ensemble_primary_api_key), g_config_path);
    GetPrivateProfileStringA("Ensemble", "primary_model", cfg->ensemble_primary_model, cfg->ensemble_primary_model, sizeof(cfg->ensemble_primary_model), g_config_path);
    UnescapeIniValue(cfg->ensemble_primary_endpoint);
    UnescapeIniValue(cfg->ensemble_primary_api_key);
    UnescapeIniValue(cfg->ensemble_primary_model);
    cfg->ensemble_reviewer_count = GetPrivateProfileIntA("Ensemble", "reviewer_count", 0, g_config_path);
    if (cfg->ensemble_reviewer_count < 0) cfg->ensemble_reviewer_count = 0;
    if (cfg->ensemble_reviewer_count > MAX_REVIEW_MODELS) cfg->ensemble_reviewer_count = MAX_REVIEW_MODELS;
    for (int i = 0; i < cfg->ensemble_reviewer_count; ++i) {
        char key[64];
        snprintf(key, sizeof(key), "reviewer_%d_endpoint", i + 1);
        GetPrivateProfileStringA("Ensemble", key, "", cfg->ensemble_reviewer_endpoint[i], sizeof(cfg->ensemble_reviewer_endpoint[i]), g_config_path);
        snprintf(key, sizeof(key), "reviewer_%d_api_key", i + 1);
        GetPrivateProfileStringA("Ensemble", key, "", cfg->ensemble_reviewer_api_key[i], sizeof(cfg->ensemble_reviewer_api_key[i]), g_config_path);
        snprintf(key, sizeof(key), "reviewer_%d_model", i + 1);
        GetPrivateProfileStringA("Ensemble", key, "", cfg->ensemble_reviewer_model[i], sizeof(cfg->ensemble_reviewer_model[i]), g_config_path);
        UnescapeIniValue(cfg->ensemble_reviewer_endpoint[i]);
        UnescapeIniValue(cfg->ensemble_reviewer_api_key[i]);
        UnescapeIniValue(cfg->ensemble_reviewer_model[i]);
    }
    for (int i = 0; i < 3; ++i) {
        char key[64];
        snprintf(key, sizeof(key), "side_prompt_%d", i + 1);
        GetPrivateProfileStringA("Ensemble", key, cfg->ensemble_side_prompt[i], cfg->ensemble_side_prompt[i], sizeof(cfg->ensemble_side_prompt[i]), g_config_path);
        UnescapeIniValue(cfg->ensemble_side_prompt[i]);
        snprintf(key, sizeof(key), "main_prompt_%d", i + 1);
        GetPrivateProfileStringA("Ensemble", key, cfg->ensemble_main_prompt[i], cfg->ensemble_main_prompt[i], sizeof(cfg->ensemble_main_prompt[i]), g_config_path);
        UnescapeIniValue(cfg->ensemble_main_prompt[i]);
    }
    cfg->overlay_enabled = GetPrivateProfileIntA("UI", "overlay_enabled", cfg->overlay_enabled, g_config_path);
    cfg->overlay_visible = GetPrivateProfileIntA("UI", "overlay_visible", cfg->overlay_visible, g_config_path);
    cfg->opacity = GetPrivateProfileIntA("UI", "opacity", cfg->opacity, g_config_path);
    cfg->theme_light = GetPrivateProfileIntA("UI", "theme_light", cfg->theme_light, g_config_path);
    cfg->stream = GetPrivateProfileIntA("UI", "stream", cfg->stream, g_config_path);
    GetPrivateProfileStringA("Hotkeys", "send_prompt_1", "", tmpbuf, sizeof(tmpbuf), g_config_path);
    if (tmpbuf[0]) {
        strncpy(cfg->hk_send, tmpbuf, sizeof(cfg->hk_send) - 1);
        cfg->hk_send[sizeof(cfg->hk_send) - 1] = 0;
    }
    else {
        GetPrivateProfileStringA("Hotkeys", "send_selected", "", tmpbuf, sizeof(tmpbuf), g_config_path);
        if (tmpbuf[0]) {
            strncpy(cfg->hk_send, tmpbuf, sizeof(cfg->hk_send) - 1);
            cfg->hk_send[sizeof(cfg->hk_send) - 1] = 0;
        }
    }
    GetPrivateProfileStringA("Hotkeys", "send_prompt_2", cfg->hk_send2, cfg->hk_send2, sizeof(cfg->hk_send2), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "send_prompt_3", cfg->hk_send3, cfg->hk_send3, sizeof(cfg->hk_send3), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "send_prompt_4", cfg->hk_send4, cfg->hk_send4, sizeof(cfg->hk_send4), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "send_prompt_5", cfg->hk_send5, cfg->hk_send5, sizeof(cfg->hk_send5), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "set_tl", cfg->hk_tl, cfg->hk_tl, sizeof(cfg->hk_tl), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "set_br", cfg->hk_br, cfg->hk_br, sizeof(cfg->hk_br), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "ask_image_2", cfg->hk_img2, cfg->hk_img2, sizeof(cfg->hk_img2), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "ask_image_3", cfg->hk_img3, cfg->hk_img3, sizeof(cfg->hk_img3), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "toggle_enable", cfg->hk_toggle_enable, cfg->hk_toggle_enable, sizeof(cfg->hk_toggle_enable), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "toggle_visible", cfg->hk_toggle_visible, cfg->hk_toggle_visible, sizeof(cfg->hk_toggle_visible), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "opacity_up", cfg->hk_opacity_up, cfg->hk_opacity_up, sizeof(cfg->hk_opacity_up), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "opacity_down", cfg->hk_opacity_down, cfg->hk_opacity_down, sizeof(cfg->hk_opacity_down), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "scroll_up", cfg->hk_scroll_up, cfg->hk_scroll_up, sizeof(cfg->hk_scroll_up), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "scroll_down", cfg->hk_scroll_down, cfg->hk_scroll_down, sizeof(cfg->hk_scroll_down), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "open_settings", cfg->hk_open_settings, cfg->hk_open_settings, sizeof(cfg->hk_open_settings), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "exit_app", cfg->hk_exit, cfg->hk_exit, sizeof(cfg->hk_exit), g_config_path);
    GetPrivateProfileStringA("Hotkeys", "cancel_request", cfg->hk_cancel, cfg->hk_cancel, sizeof(cfg->hk_cancel), g_config_path);
    if (cfg->system_prompt[0] == 0 || strcmp(cfg->system_prompt, "You are a concise helper.") == 0) {
        strcpy(cfg->system_prompt, "Debug mode: reply with exactly the user's text only. No extra words.");
    }
    if (strncmp(cfg->user_template, "Selected text:", 14) == 0) {
        strcpy(cfg->user_template, "{{text}}");
    }
}

static void SaveConfig(const AppConfig *cfg) {
    SaveBasicConfig(cfg);
    SaveAdvancedConfig(cfg);
}

static void SaveBasicConfig(const AppConfig *cfg) {
    char tmp[16];
    char p1_esc[2048];
    char quick_esc[2048];
    WritePrivateProfileStringA("API", "endpoint", cfg->endpoint, g_config_path);
    WritePrivateProfileStringA("API", "api_key", cfg->api_key, g_config_path);
    WritePrivateProfileStringA("API", "model", cfg->model, g_config_path);
    EscapeIniValue(cfg->system_prompt, p1_esc, sizeof(p1_esc));
    EscapeIniValue(cfg->quick_prompt, quick_esc, sizeof(quick_esc));
    WritePrivateProfileStringA("Prompt", "prompt", p1_esc, g_config_path);
    WritePrivateProfileStringA("Prompt", "quick_prompt", quick_esc, g_config_path);
    WritePrivateProfileStringA("Prompt", "prompt_1", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "prompt_2", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "prompt_3", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "prompt_4", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "prompt_5", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "system", NULL, g_config_path);
    WritePrivateProfileStringA("Prompt", "user_template", NULL, g_config_path);
    WritePrivateProfileStringA("Routes", NULL, NULL, g_config_path);
    snprintf(tmp, sizeof(tmp), "%d", cfg->overlay_enabled);
    WritePrivateProfileStringA("UI", "overlay_enabled", tmp, g_config_path);
    snprintf(tmp, sizeof(tmp), "%d", cfg->overlay_visible);
    WritePrivateProfileStringA("UI", "overlay_visible", tmp, g_config_path);
    snprintf(tmp, sizeof(tmp), "%d", cfg->opacity);
    WritePrivateProfileStringA("UI", "opacity", tmp, g_config_path);
    snprintf(tmp, sizeof(tmp), "%d", cfg->theme_light);
    WritePrivateProfileStringA("UI", "theme_light", tmp, g_config_path);
    snprintf(tmp, sizeof(tmp), "%d", cfg->stream);
    WritePrivateProfileStringA("UI", "stream", tmp, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_prompt_1", cfg->hk_send, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_prompt_2", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_prompt_3", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_prompt_4", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_prompt_5", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "send_selected", cfg->hk_send, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "set_tl", cfg->hk_tl, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "set_br", cfg->hk_br, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "ask_image_2", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "ask_image_3", NULL, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "toggle_enable", cfg->hk_toggle_enable, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "toggle_visible", cfg->hk_toggle_visible, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "opacity_up", cfg->hk_opacity_up, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "opacity_down", cfg->hk_opacity_down, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "scroll_up", cfg->hk_scroll_up, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "scroll_down", cfg->hk_scroll_down, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "open_settings", cfg->hk_open_settings, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "exit_app", cfg->hk_exit, g_config_path);
    WritePrivateProfileStringA("Hotkeys", "cancel_request", cfg->hk_cancel, g_config_path);
}

static void SaveAdvancedConfig(const AppConfig *cfg) {
    char tmp[16];
    char rag_path_esc[2048];
    char prompt_esc[2048];
    snprintf(tmp, sizeof(tmp), "%d", cfg->rag_enabled);
    WritePrivateProfileStringA("RAG", "enabled", tmp, g_config_path);
    EncodeIniUtf8Value(cfg->rag_source_path, rag_path_esc, sizeof(rag_path_esc));
    WritePrivateProfileStringA("RAG", "source_path", rag_path_esc, g_config_path);
    WritePrivateProfileStringA("Ensemble", NULL, NULL, g_config_path);
    {
        int pruned_count = 0;
        char ep_esc[1024];
        char key_esc[512];
        char model_esc[256];
        char ep_esc2[1024];
        char key_esc2[512];
        char model_esc2[256];
        char prompt_esc2[2048];
        char hotkey_esc2[128];
        for (int i = 0; i < cfg->model_route_count && i < MAX_MODEL_ROUTES; ++i) {
            if (IsBlankText(cfg->model_route_endpoint[i]) && IsBlankText(cfg->model_route_api_key[i]) &&
                IsBlankText(cfg->model_route_model[i]) && IsBlankText(cfg->model_route_prompt[i]) &&
                IsBlankText(cfg->model_route_hotkey[i])) {
                continue;
            }
            ++pruned_count;
            EscapeIniValue(cfg->model_route_endpoint[i], ep_esc2, sizeof(ep_esc2));
            EscapeIniValue(cfg->model_route_api_key[i], key_esc2, sizeof(key_esc2));
            EscapeIniValue(cfg->model_route_model[i], model_esc2, sizeof(model_esc2));
            EscapeIniValue(cfg->model_route_prompt[i], prompt_esc2, sizeof(prompt_esc2));
            EscapeIniValue(cfg->model_route_hotkey[i], hotkey_esc2, sizeof(hotkey_esc2));
            {
                char keyname[64];
                char num[16];
                snprintf(keyname, sizeof(keyname), "route_%d_kind", pruned_count);
                snprintf(num, sizeof(num), "%d", cfg->model_route_kind[i] ? 1 : 0);
                WritePrivateProfileStringA("ModelRouter", keyname, num, g_config_path);
                snprintf(keyname, sizeof(keyname), "route_%d_endpoint", pruned_count);
                WritePrivateProfileStringA("ModelRouter", keyname, ep_esc2, g_config_path);
                snprintf(keyname, sizeof(keyname), "route_%d_api_key", pruned_count);
                WritePrivateProfileStringA("ModelRouter", keyname, key_esc2, g_config_path);
                snprintf(keyname, sizeof(keyname), "route_%d_model", pruned_count);
                WritePrivateProfileStringA("ModelRouter", keyname, model_esc2, g_config_path);
                snprintf(keyname, sizeof(keyname), "route_%d_prompt", pruned_count);
                WritePrivateProfileStringA("ModelRouter", keyname, prompt_esc2, g_config_path);
                snprintf(keyname, sizeof(keyname), "route_%d_hotkey", pruned_count);
                WritePrivateProfileStringA("ModelRouter", keyname, hotkey_esc2, g_config_path);
            }
        }
        {
            char num[16];
            snprintf(num, sizeof(num), "%d", pruned_count);
            WritePrivateProfileStringA("ModelRouter", "route_count", num, g_config_path);
        }
        for (int i = pruned_count + 1; i <= MAX_MODEL_ROUTES; ++i) {
            char keyname[64];
            snprintf(keyname, sizeof(keyname), "route_%d_kind", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
            snprintf(keyname, sizeof(keyname), "route_%d_endpoint", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
            snprintf(keyname, sizeof(keyname), "route_%d_api_key", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
            snprintf(keyname, sizeof(keyname), "route_%d_model", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
            snprintf(keyname, sizeof(keyname), "route_%d_prompt", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
            snprintf(keyname, sizeof(keyname), "route_%d_hotkey", i);
            WritePrivateProfileStringA("ModelRouter", keyname, NULL, g_config_path);
        }
    }
}
