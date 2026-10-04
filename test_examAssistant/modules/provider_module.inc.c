static ProviderKind DetectProviderKind(const char *endpoint, const char *api_key) {
    if ((api_key && strncmp(api_key, "sk-ant-", 7) == 0) ||
        (endpoint && strstr(endpoint, "api.anthropic.com") != NULL)) {
        return PROVIDER_ANTHROPIC;
    }
    return ((api_key && strncmp(api_key, "AIza", 4) == 0) ||
            (endpoint && strstr(endpoint, "generativelanguage.googleapis.com") != NULL))
               ? PROVIDER_GOOGLE_GEMINI
               : PROVIDER_OPENAI_COMPAT;
}

static void BuildGoogleEndpoint(char *out, int out_size, const char *model) {
    snprintf(out, out_size,
             "https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent",
             model && model[0] ? model : "gemini-2.0-flash");
}

static void ResolveProviderRequestInfo(ProviderRequestInfo *info, const char *endpoint, const char *api_key, const char *model, int stream_enabled) {
    if (!info) return;
    ZeroMemory(info, sizeof(*info));
    info->kind = DetectProviderKind(endpoint, api_key);
    info->use_stream = stream_enabled && info->kind == PROVIDER_OPENAI_COMPAT;
    strncpy(info->endpoint, endpoint ? endpoint : "", sizeof(info->endpoint) - 1);
    info->endpoint[sizeof(info->endpoint) - 1] = 0;
    NormalizeEndpoint(info->endpoint);
    if (info->kind == PROVIDER_GOOGLE_GEMINI) {
        BuildGoogleEndpoint(info->endpoint, sizeof(info->endpoint), model);
    } else if (info->kind == PROVIDER_ANTHROPIC) {
        strncpy(info->endpoint, "https://api.anthropic.com/v1/messages", sizeof(info->endpoint) - 1);
        info->endpoint[sizeof(info->endpoint) - 1] = 0;
    }
}

static void NormalizeFriendlyEndpointAlias(char *s, int s_size) {
    char buf[512];
    int start = 0;
    int end;
    if (!s || s_size <= 0) return;
    strncpy(buf, s, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = 0;
    end = (int)strlen(buf);
    while (buf[start] == ' ' || buf[start] == '\t' || buf[start] == '\r' || buf[start] == '\n') start++;
    while (end > start && (buf[end - 1] == ' ' || buf[end - 1] == '\t' || buf[end - 1] == '\r' || buf[end - 1] == '\n')) end--;
    buf[end] = 0;
    if (_stricmp(buf + start, "openai") == 0) {
        strncpy(s, "https://api.openai.com/v1/chat/completions", s_size - 1);
    } else if (_stricmp(buf + start, "openrouter") == 0) {
        strncpy(s, "https://openrouter.ai/api/v1/chat/completions", s_size - 1);
    } else if (_stricmp(buf + start, "google") == 0) {
        strncpy(s, "https://generativelanguage.googleapis.com", s_size - 1);
    } else if (_stricmp(buf + start, "anthropic") == 0 || _stricmp(buf + start, "claude") == 0) {
        strncpy(s, "https://api.anthropic.com/v1/messages", s_size - 1);
    }
    s[s_size - 1] = 0;
    NormalizeEndpoint(s);
}

static char *ExtractJsonStringByKey(const char *json, const char *key) {
    const char *p = strstr(json, key);
    char *out;
    size_t cap = 256;
    size_t idx = 0;
    if (!p) return NULL;
    p = strchr(p, ':');
    if (!p) return NULL;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    if (*p != '\"') return NULL;
    p++;
    out = (char *)malloc(cap);
    if (!out) return NULL;
    while (*p) {
        char ch = 0;
        if (*p == '\\') {
            p++;
            if (*p == 'n') ch = '\n';
            else if (*p == 'r') ch = '\r';
            else if (*p == 't') ch = '\t';
            else if (*p) ch = *p;
            else break;
            p++;
        } else if (*p == '\"') {
            break;
        } else {
            ch = *p++;
        }
        if (idx + 1 >= cap) {
            size_t new_cap = cap * 2;
            char *n = (char *)realloc(out, new_cap);
            if (!n) {
                free(out);
                return NULL;
            }
            out = n;
            cap = new_cap;
        }
        out[idx++] = ch;
    }
    out[idx] = 0;
    return out;
}

static char *ExtractProviderText(const ProviderRequestInfo *info, const char *json) {
    if (info && info->kind == PROVIDER_GOOGLE_GEMINI) {
        return ExtractJsonStringByKey(json, "\"text\"");
    }
    if (info && info->kind == PROVIDER_ANTHROPIC) {
        return ExtractJsonStringByKey(json, "\"text\"");
    }
    return ExtractJsonStringByKey(json, "\"content\"");
}
