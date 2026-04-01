static char *EncodeBase64NoCrlf(const BYTE *bytes, size_t size) {
    static const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t out_len;
    char *out;
    size_t i, j;
    if (!bytes || size == 0) return NULL;
    out_len = ((size + 2) / 3) * 4;
    out = (char *)malloc(out_len + 1);
    if (!out) return NULL;
    i = 0;
    j = 0;
    while (i + 2 < size) {
        unsigned int n = ((unsigned int)bytes[i] << 16) | ((unsigned int)bytes[i + 1] << 8) | (unsigned int)bytes[i + 2];
        out[j++] = kB64[(n >> 18) & 0x3F];
        out[j++] = kB64[(n >> 12) & 0x3F];
        out[j++] = kB64[(n >> 6) & 0x3F];
        out[j++] = kB64[n & 0x3F];
        i += 3;
    }
    if (i < size) {
        unsigned int n = (unsigned int)bytes[i] << 16;
        out[j++] = kB64[(n >> 18) & 0x3F];
        if (i + 1 < size) {
            n |= (unsigned int)bytes[i + 1] << 8;
            out[j++] = kB64[(n >> 12) & 0x3F];
            out[j++] = kB64[(n >> 6) & 0x3F];
            out[j++] = '=';
        } else {
            out[j++] = kB64[(n >> 12) & 0x3F];
            out[j++] = '=';
            out[j++] = '=';
        }
    }
    out[j] = 0;
    return out;
}

static char *ReadFileBase64(const char *path) {
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    DWORD size = 0;
    DWORD read = 0;
    BYTE *bytes = NULL;
    char *out = NULL;
    if (file == INVALID_HANDLE_VALUE) return NULL;
    size = GetFileSize(file, NULL);
    if (size == INVALID_FILE_SIZE || size == 0) {
        CloseHandle(file);
        return NULL;
    }
    bytes = (BYTE *)malloc(size);
    if (!bytes) {
        CloseHandle(file);
        return NULL;
    }
    if (!ReadFile(file, bytes, size, &read, NULL) || read != size) {
        CloseHandle(file);
        free(bytes);
        return NULL;
    }
    CloseHandle(file);
    out = EncodeBase64NoCrlf(bytes, (size_t)size);
    free(bytes);
    return out;
}

#define MAX_RAG_ATTACH_FILES 8
#define MAX_RAG_ATTACH_DEPTH 3
#define MAX_RAG_TEXT_CHARS 14000

static int g_rag_last_truncated = 0;

static void NormalizeRagReferenceTextInPlace(char *text) {
    char *src;
    char *dst;
    int blank_run = 0;
    if (!text || !text[0]) return;
    src = text;
    dst = text;
    while (*src) {
        if (src[0] == '$' && src[1] == '$') {
            src += 2;
            while (*src && !(src[0] == '$' && src[1] == '$')) src++;
            if (*src) src += 2;
            memcpy(dst, "[formula]", 9);
            dst += 9;
            continue;
        }
        if (src[0] == '$') {
            src++;
            while (*src && src[0] != '$') src++;
            if (*src == '$') src++;
            memcpy(dst, "(formula)", 9);
            dst += 9;
            continue;
        }
        if (src[0] == '\r') {
            src++;
            continue;
        }
        if (src[0] == '\n') {
            blank_run++;
            if (blank_run <= 2) *dst++ = *src;
            src++;
            continue;
        }
        blank_run = 0;
        if (src[0] == '*' && src[1] == '*') {
            src += 2;
            continue;
        }
        if (src[0] == '`') {
            src++;
            continue;
        }
        *dst++ = *src++;
    }
    *dst = 0;
}

static char *ReadFileBase64W(const wchar_t *path) {
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    LARGE_INTEGER size_li;
    DWORD read = 0;
    BYTE *bytes = NULL;
    char *out = NULL;
    if (file == INVALID_HANDLE_VALUE) return NULL;
    if (!GetFileSizeEx(file, &size_li) || size_li.QuadPart <= 0 || size_li.QuadPart > 20 * 1024 * 1024) {
        CloseHandle(file);
        return NULL;
    }
    bytes = (BYTE *)malloc((size_t)size_li.QuadPart);
    if (!bytes) {
        CloseHandle(file);
        return NULL;
    }
    if (!ReadFile(file, bytes, (DWORD)size_li.QuadPart, &read, NULL) || read != (DWORD)size_li.QuadPart) {
        CloseHandle(file);
        free(bytes);
        return NULL;
    }
    CloseHandle(file);
    out = EncodeBase64NoCrlf(bytes, (size_t)read);
    free(bytes);
    return out;
}

static int IsSupportedRagAttachExtensionW(const wchar_t *name) {
    const wchar_t *dot = wcsrchr(name, L'.');
    if (!dot) return 0;
    return _wcsicmp(dot, L".pdf") == 0 ||
           _wcsicmp(dot, L".txt") == 0 ||
           _wcsicmp(dot, L".md") == 0 ||
           _wcsicmp(dot, L".ppt") == 0 ||
           _wcsicmp(dot, L".pptx") == 0;
}

static const char *GetMimeTypeByPathW(const wchar_t *path) {
    const wchar_t *dot = wcsrchr(path, L'.');
    if (!dot) return "application/octet-stream";
    if (_wcsicmp(dot, L".pdf") == 0) return "application/pdf";
    if (_wcsicmp(dot, L".txt") == 0) return "text/plain";
    if (_wcsicmp(dot, L".md") == 0) return "text/markdown";
    if (_wcsicmp(dot, L".ppt") == 0) return "application/vnd.ms-powerpoint";
    if (_wcsicmp(dot, L".pptx") == 0) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    return "application/octet-stream";
}

static void CollectRagAttachFilesW(const wchar_t *path, wchar_t out_paths[][MAX_PATH], int *count, int depth) {
    DWORD attr;
    if (!path || !path[0] || !out_paths || !count || depth > MAX_RAG_ATTACH_DEPTH || *count >= MAX_RAG_ATTACH_FILES) return;
    attr = GetFileAttributesW(path);
    if (attr == INVALID_FILE_ATTRIBUTES) return;
    if (attr & FILE_ATTRIBUTE_DIRECTORY) {
        wchar_t pattern[MAX_PATH];
        WIN32_FIND_DATAW fd;
        HANDLE hfind;
        swprintf(pattern, MAX_PATH, L"%ls\\*", path);
        hfind = FindFirstFileW(pattern, &fd);
        if (hfind == INVALID_HANDLE_VALUE) return;
        do {
            wchar_t child[MAX_PATH];
            if (*count >= MAX_RAG_ATTACH_FILES) break;
            if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
            swprintf(child, MAX_PATH, L"%ls\\%ls", path, fd.cFileName);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                CollectRagAttachFilesW(child, out_paths, count, depth + 1);
            } else if (IsSupportedRagAttachExtensionW(fd.cFileName)) {
                wcsncpy(out_paths[*count], child, MAX_PATH - 1);
                out_paths[*count][MAX_PATH - 1] = 0;
                (*count)++;
            }
        } while (FindNextFileW(hfind, &fd));
        FindClose(hfind);
        return;
    }
    if (!IsSupportedRagAttachExtensionW(path)) return;
    wcsncpy(out_paths[*count], path, MAX_PATH - 1);
    out_paths[*count][MAX_PATH - 1] = 0;
    (*count)++;
}

static int LoadRagAttachFilesW(wchar_t out_paths[][MAX_PATH], int *out_count) {
    wchar_t path_w[1024];
    int count = 0;
    if (!out_paths || !out_count) return 0;
    *out_count = 0;
    if (!g_cfg.rag_enabled || !g_cfg.rag_source_path[0]) return 0;
    if (!Utf8ToWide(g_cfg.rag_source_path, path_w, (int)(sizeof(path_w) / sizeof(path_w[0])))) return 0;
    CollectRagAttachFilesW(path_w, out_paths, &count, 0);
    *out_count = count;
    return count > 0;
}

static void WideCopyAppend(wchar_t *dst, size_t dst_count, const wchar_t *src) {
    size_t i = 0;
    size_t j;
    if (!dst || dst_count == 0 || !src) return;
    while (i + 1 < dst_count && dst[i]) i++;
    j = 0;
    while (i + 1 < dst_count && src[j]) {
        dst[i++] = src[j++];
    }
    dst[i] = 0;
}

static int HasSupportedRagExtensionW(const wchar_t *name) {
    const wchar_t *dot = wcsrchr(name, L'.');
    if (!dot) return 0;
    return _wcsicmp(dot, L".txt") == 0 || _wcsicmp(dot, L".md") == 0;
}

static int ReadUtf8TextFileW(const wchar_t *path, char **out);

static int IsPdfExtensionW(const wchar_t *name) {
    const wchar_t *dot = wcsrchr(name, L'.');
    return dot && _wcsicmp(dot, L".pdf") == 0;
}

static char *ToUtf8BestEffort(const char *src) {
    int wneed;
    wchar_t *wtmp;
    int need;
    char *utf8;
    if (!src) return NULL;
    wneed = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, src, -1, NULL, 0);
    if (wneed > 0) {
        return _strdup(src);
    }
    wneed = MultiByteToWideChar(CP_ACP, 0, src, -1, NULL, 0);
    if (wneed <= 0) return _strdup(src);
    wtmp = (wchar_t *)malloc(sizeof(wchar_t) * wneed);
    if (!wtmp) return _strdup(src);
    if (MultiByteToWideChar(CP_ACP, 0, src, -1, wtmp, wneed) <= 0) {
        free(wtmp);
        return _strdup(src);
    }
    need = WideCharToMultiByte(CP_UTF8, 0, wtmp, -1, NULL, 0, NULL, NULL);
    if (need <= 0) {
        free(wtmp);
        return _strdup(src);
    }
    utf8 = (char *)malloc(need);
    if (!utf8) {
        free(wtmp);
        return _strdup(src);
    }
    WideCharToMultiByte(CP_UTF8, 0, wtmp, -1, utf8, need, NULL, NULL);
    free(wtmp);
    return utf8;
}

static void StripUnsupportedControlChars(char *s) {
    char *src;
    char *dst;
    if (!s) return;
    src = s;
    dst = s;
    while (*src) {
        unsigned char c = (unsigned char)*src;
        if (c < 32 && c != '\n' && c != '\r' && c != '\t') {
            src++;
            continue;
        }
        *dst++ = *src++;
    }
    *dst = 0;
}

static int ReadPdfTextWithPdftotextW(const wchar_t *path, char **out) {
    wchar_t exe_path[MAX_PATH];
    DWORD found;
    wchar_t temp_dir[MAX_PATH];
    wchar_t out_txt[MAX_PATH];
    wchar_t cmd[4096];
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    DWORD wait_rc;
    char *text = NULL;
    if (!out) return 0;
    *out = NULL;

    found = SearchPathW(NULL, L"pdftotext.exe", NULL, MAX_PATH, exe_path, NULL);
    if (found == 0 || found >= MAX_PATH) return 0;
    if (!GetTempPathW(MAX_PATH, temp_dir) || !temp_dir[0]) return 0;
    if (!GetTempFileNameW(temp_dir, L"rag", 0, out_txt)) return 0;
    {
        wchar_t *dot = wcsrchr(out_txt, L'.');
        if (dot) wcscpy(dot, L".txt");
    }

    swprintf(cmd, sizeof(cmd) / sizeof(cmd[0]),
             L"\"%ls\" -enc UTF-8 -nopgbrk \"%ls\" \"%ls\"",
             exe_path, path, out_txt);

    ZeroMemory(&si, sizeof(si));
    ZeroMemory(&pi, sizeof(pi));
    si.cb = sizeof(si);
    if (!CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        DeleteFileW(out_txt);
        return 0;
    }

    wait_rc = WaitForSingleObject(pi.hProcess, 30000);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    if (wait_rc != WAIT_OBJECT_0) {
        DeleteFileW(out_txt);
        return 0;
    }

    if (!ReadUtf8TextFileW(out_txt, &text) || !text || !HasVisibleText(text)) {
        free(text);
        DeleteFileW(out_txt);
        return 0;
    }
    StripUnsupportedControlChars(text);
    if (!HasVisibleText(text)) {
        free(text);
        DeleteFileW(out_txt);
        return 0;
    }

    DeleteFileW(out_txt);
    *out = text;
    return 1;
}

static int AppendTextWithCap(char **buf, size_t *len, size_t *cap, const char *text, size_t text_len, size_t max_total) {
    if (!buf || !len || !cap || !text) return 0;
    if (*len >= max_total) return 1;
    if (*len + text_len + 1 > max_total) {
        text_len = max_total - *len - 1;
    }
    if (*len + text_len + 1 > *cap) {
        size_t new_cap = *cap ? *cap : 1024;
        while (*len + text_len + 1 > new_cap) new_cap *= 2;
        char *n = (char *)realloc(*buf, new_cap);
        if (!n) return 0;
        *buf = n;
        *cap = new_cap;
    }
    memcpy(*buf + *len, text, text_len);
    *len += text_len;
    (*buf)[*len] = 0;
    return 1;
}

static int AppendRagTextWithCap(char **buf, size_t *len, size_t *cap, const char *text, size_t text_len, size_t max_total, int *truncated) {
    if (!buf || !len || !cap || !text) return 0;
    if (*len >= max_total) {
        if (truncated) *truncated = 1;
        return 1;
    }
    if (*len + text_len + 1 > max_total) {
        size_t allowed = max_total - *len - 1;
        if (allowed > 0 && allowed < text_len) {
            size_t cut = allowed;
            size_t start = (cut > 240) ? (cut - 240) : 0;
            for (size_t i = cut; i > start; --i) {
                if (text[i - 1] == '\n') {
                    cut = i;
                    break;
                }
            }
            while (cut > 0 && (((unsigned char)text[cut] & 0xC0) == 0x80)) cut--;
            text_len = cut;
        } else {
            text_len = allowed;
        }
        if (truncated) *truncated = 1;
    }
    return AppendTextWithCap(buf, len, cap, text, text_len, max_total);
}

static int AppendTextStrict(char **buf, size_t *len, size_t *cap, const char *text, size_t text_len, size_t max_total) {
    if (!buf || !len || !cap || !text) return 0;
    if (*len + text_len + 1 > max_total) return 0;
    return AppendTextWithCap(buf, len, cap, text, text_len, max_total);
}

static int ReadUtf8TextFileW(const wchar_t *path, char **out) {
    HANDLE file;
    LARGE_INTEGER size_li;
    DWORD read = 0;
    BYTE *bytes = NULL;
    char *utf8 = NULL;
    if (!out) return 0;
    *out = NULL;
    file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    if (!GetFileSizeEx(file, &size_li) || size_li.QuadPart <= 0 || size_li.QuadPart > 1024 * 1024) {
        CloseHandle(file);
        return 0;
    }
    bytes = (BYTE *)malloc((size_t)size_li.QuadPart + 2);
    if (!bytes) {
        CloseHandle(file);
        return 0;
    }
    if (!ReadFile(file, bytes, (DWORD)size_li.QuadPart, &read, NULL) || read != (DWORD)size_li.QuadPart) {
        CloseHandle(file);
        free(bytes);
        return 0;
    }
    CloseHandle(file);
    bytes[read] = 0;
    bytes[read + 1] = 0;
    if (read >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) {
        const wchar_t *wsrc = (const wchar_t *)(bytes + 2);
        int need = WideCharToMultiByte(CP_UTF8, 0, wsrc, -1, NULL, 0, NULL, NULL);
        if (need > 0) {
            utf8 = (char *)malloc(need);
            if (utf8) WideCharToMultiByte(CP_UTF8, 0, wsrc, -1, utf8, need, NULL, NULL);
        }
    } else if (read >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
        utf8 = _strdup((const char *)(bytes + 3));
    } else {
        int wneed = MultiByteToWideChar(CP_ACP, 0, (const char *)bytes, -1, NULL, 0);
        if (wneed > 0) {
            wchar_t *wtmp = (wchar_t *)malloc(sizeof(wchar_t) * wneed);
            if (wtmp && MultiByteToWideChar(CP_ACP, 0, (const char *)bytes, -1, wtmp, wneed) > 0) {
                int need = WideCharToMultiByte(CP_UTF8, 0, wtmp, -1, NULL, 0, NULL, NULL);
                if (need > 0) {
                    utf8 = (char *)malloc(need);
                    if (utf8) WideCharToMultiByte(CP_UTF8, 0, wtmp, -1, utf8, need, NULL, NULL);
                }
            }
            free(wtmp);
        }
        if (!utf8) utf8 = _strdup((const char *)bytes);
    }
    free(bytes);
    *out = utf8;
    return utf8 != NULL;
}

static int ReadPdfTextFileW(const wchar_t *path, char **out) {
    if (ReadPdfTextWithPdftotextW(path, out)) return 1;

    /*
     * Fallback parser is intentionally conservative: we avoid pushing noisy binary-like
     * fragments into RAG context because they can break JSON/quality. If pdftotext is
     * unavailable, caller will receive no PDF text and can surface a clear note instead.
     */
    if (out) *out = NULL;
    return 0;

    /* legacy experimental parser kept below but disabled */
    HANDLE file;
    LARGE_INTEGER size_li;
    DWORD read = 0;
    unsigned char *bytes = NULL;
    char *buf = NULL;
    size_t len = 0;
    size_t cap = 0;
    if (!out) return 0;
    *out = NULL;
    file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    if (!GetFileSizeEx(file, &size_li) || size_li.QuadPart <= 0 || size_li.QuadPart > 16 * 1024 * 1024) {
        CloseHandle(file);
        return 0;
    }
    bytes = (unsigned char *)malloc((size_t)size_li.QuadPart + 1);
    if (!bytes) {
        CloseHandle(file);
        return 0;
    }
    if (!ReadFile(file, bytes, (DWORD)size_li.QuadPart, &read, NULL) || read == 0) {
        CloseHandle(file);
        free(bytes);
        return 0;
    }
    CloseHandle(file);
    bytes[read] = 0;

    for (size_t i = 0; i < (size_t)read && len < 12000; ++i) {
        if (bytes[i] != '(') continue;
        i++;
        {
            int depth = 1;
            char token[2048];
            size_t tlen = 0;
            while (i < (size_t)read && depth > 0) {
                unsigned char c = bytes[i++];
                if (c == '\\' && i < (size_t)read) {
                    unsigned char e = bytes[i++];
                    char decoded;
                    if (e == 'n') decoded = '\n';
                    else if (e == 'r') decoded = '\r';
                    else if (e == 't') decoded = '\t';
                    else if (e == 'b') decoded = '\b';
                    else if (e == 'f') decoded = '\f';
                    else if (e == '(') decoded = '(';
                    else if (e == ')') decoded = ')';
                    else if (e == '\\') decoded = '\\';
                    else if (e >= '0' && e <= '7') {
                        int value = e - '0';
                        int count = 1;
                        while (count < 3 && i < (size_t)read && bytes[i] >= '0' && bytes[i] <= '7') {
                            value = value * 8 + (bytes[i] - '0');
                            ++i;
                            ++count;
                        }
                        decoded = (char)value;
                    } else {
                        decoded = (char)e;
                    }
                    if (depth == 1 && tlen + 1 < sizeof(token)) token[tlen++] = decoded;
                    continue;
                }
                if (c == '(') {
                    depth++;
                    continue;
                }
                if (c == ')') {
                    depth--;
                    if (depth == 0) break;
                    continue;
                }
                if (depth == 1 && tlen + 1 < sizeof(token)) token[tlen++] = (char)c;
            }
            if (tlen > 1) {
                int useful = 0;
                token[tlen] = 0;
                for (size_t k = 0; k < tlen; ++k) {
                    unsigned char tc = (unsigned char)token[k];
                    if ((tc >= '0' && tc <= '9') || (tc >= 'A' && tc <= 'Z') || (tc >= 'a' && tc <= 'z') || tc >= 0x80) {
                        useful = 1;
                        break;
                    }
                }
                if (useful) {
                    char *utf8_chunk;
                    token[tlen] = 0;
                    utf8_chunk = ToUtf8BestEffort(token);
                    if (utf8_chunk) {
                        StripUnsupportedControlChars(utf8_chunk);
                        if (HasVisibleText(utf8_chunk)) {
                            if (!AppendTextWithCap(&buf, &len, &cap, utf8_chunk, strlen(utf8_chunk), 12000)) {
                                free(utf8_chunk);
                                break;
                            }
                            if (!AppendTextWithCap(&buf, &len, &cap, "\n", 1, 12000)) {
                                free(utf8_chunk);
                                break;
                            }
                        }
                        free(utf8_chunk);
                    }
                }
            }
        }
    }

    free(bytes);
    if (!buf || !buf[0]) {
        free(buf);
        return 0;
    }
    *out = buf;
    return 1;
}

static void CollectRagTextFromPathW(const wchar_t *path, char **buf, size_t *len, size_t *cap, int depth) {
    DWORD attr;
    if (!path || !path[0] || !buf || !len || !cap || depth > 3 || *len >= MAX_RAG_TEXT_CHARS) return;
    attr = GetFileAttributesW(path);
    if (attr == INVALID_FILE_ATTRIBUTES) return;
    if (attr & FILE_ATTRIBUTE_DIRECTORY) {
        wchar_t pattern[MAX_PATH];
        WIN32_FIND_DATAW fd;
        HANDLE hfind;
        swprintf(pattern, MAX_PATH, L"%ls\\*", path);
        hfind = FindFirstFileW(pattern, &fd);
        if (hfind == INVALID_HANDLE_VALUE) return;
        do {
            wchar_t child[MAX_PATH];
            if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
            swprintf(child, MAX_PATH, L"%ls\\%ls", path, fd.cFileName);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                CollectRagTextFromPathW(child, buf, len, cap, depth + 1);
            } else if (HasSupportedRagExtensionW(fd.cFileName)) {
                CollectRagTextFromPathW(child, buf, len, cap, depth + 1);
            }
        } while (FindNextFileW(hfind, &fd));
        FindClose(hfind);
        return;
    }
    if (!HasSupportedRagExtensionW(path)) return;
    {
        char *file_text = NULL;
        char path_utf8[1024];
        const char *base_name;
        if (IsPdfExtensionW(path)) {
            if (!ReadPdfTextFileW(path, &file_text) || !file_text || !file_text[0]) {
                free(file_text);
                return;
            }
        } else if (!ReadUtf8TextFileW(path, &file_text) || !file_text || !file_text[0]) {
            free(file_text);
            return;
        }
        if (!WideToUtf8(path, path_utf8, sizeof(path_utf8))) {
            free(file_text);
            return;
        }
        NormalizeRagReferenceTextInPlace(file_text);
        base_name = strrchr(path_utf8, '\\');
        if (!base_name) base_name = path_utf8; else base_name++;
        AppendRagTextWithCap(buf, len, cap, "\n[Source: ", 10, MAX_RAG_TEXT_CHARS, &g_rag_last_truncated);
        AppendRagTextWithCap(buf, len, cap, base_name, strlen(base_name), MAX_RAG_TEXT_CHARS, &g_rag_last_truncated);
        AppendRagTextWithCap(buf, len, cap, "]\n", 2, MAX_RAG_TEXT_CHARS, &g_rag_last_truncated);
        AppendRagTextWithCap(buf, len, cap, file_text, strlen(file_text), MAX_RAG_TEXT_CHARS, &g_rag_last_truncated);
        AppendRagTextWithCap(buf, len, cap, "\n", 1, MAX_RAG_TEXT_CHARS, &g_rag_last_truncated);
        free(file_text);
    }
}

static char *LoadRagReferenceText(void) {
    wchar_t path_w[1024];
    char *buf = NULL;
    size_t len = 0, cap = 0;
    g_rag_last_truncated = 0;
    if (!g_cfg.rag_enabled || !g_cfg.rag_source_path[0]) return NULL;
    if (!Utf8ToWide(g_cfg.rag_source_path, path_w, (int)(sizeof(path_w) / sizeof(path_w[0])))) return NULL;
    CollectRagTextFromPathW(path_w, &buf, &len, &cap, 0);
    if (!buf || !buf[0]) {
        free(buf);
        return NULL;
    }
    return buf;
}

static char *BuildRagUserMessage(const char *base_msg) {
    char *rag_text = LoadRagReferenceText();
    char *out = NULL;
    size_t len = 0;
    size_t cap = 0;
    int ref_truncated = 0;
    const char *question = base_msg ? base_msg : "";
    const size_t max_total = 22000;
    if (!rag_text || !rag_text[0]) {
        free(rag_text);
        return _strdup(base_msg ? base_msg : "");
    }

    if (!AppendTextStrict(&out, &len, &cap,
                          "Use the following reference data from TXT/MD files when relevant.\n"
                          "Do not copy the reference verbatim unless explicitly requested.\n"
                          "Answer in concise Traditional Chinese and focus on the user's question.\n\n",
                          strlen("Use the following reference data from TXT/MD files when relevant.\n"
                                 "Do not copy the reference verbatim unless explicitly requested.\n"
                                 "Answer in concise Traditional Chinese and focus on the user's question.\n\n"),
                          max_total) ||
        !AppendTextStrict(&out, &len, &cap, "Question:\n", strlen("Question:\n"), max_total) ||
        !AppendTextStrict(&out, &len, &cap, question, strlen(question), max_total) ||
        !AppendTextStrict(&out, &len, &cap, "\n\nReference data:\n", strlen("\n\nReference data:\n"), max_total)) {
        free(out);
        free(rag_text);
        return _strdup(question);
    }

    if (!AppendRagTextWithCap(&out, &len, &cap, rag_text, strlen(rag_text), max_total, &ref_truncated)) {
        free(out);
        free(rag_text);
        return _strdup(question);
    }

    if ((g_rag_last_truncated || ref_truncated) &&
        !AppendTextStrict(&out, &len, &cap,
                          "\n\n[Note] Reference data was truncated to fit context window.",
                          strlen("\n\n[Note] Reference data was truncated to fit context window."),
                          max_total)) {
        /* keep output usable even if note cannot be appended */
    }

    free(rag_text);
    return out;
}

static int DecodeUtf8Codepoint(const unsigned char *s, unsigned int *cp, int *adv) {
    if (!s || !*s) return 0;
    if (s[0] < 0x80) {
        *cp = s[0];
        *adv = 1;
        return 1;
    }
    if ((s[0] & 0xE0) == 0xC0 && (s[1] & 0xC0) == 0x80) {
        *cp = ((s[0] & 0x1F) << 6) | (s[1] & 0x3F);
        *adv = 2;
        return 1;
    }
    if ((s[0] & 0xF0) == 0xE0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80) {
        *cp = ((s[0] & 0x0F) << 12) | ((s[1] & 0x3F) << 6) | (s[2] & 0x3F);
        *adv = 3;
        return 1;
    }
    if ((s[0] & 0xF8) == 0xF0 && (s[1] & 0xC0) == 0x80 && (s[2] & 0xC0) == 0x80 && (s[3] & 0xC0) == 0x80) {
        *cp = ((s[0] & 0x07) << 18) | ((s[1] & 0x3F) << 12) | ((s[2] & 0x3F) << 6) | (s[3] & 0x3F);
        *adv = 4;
        return 1;
    }
    *cp = s[0];
    *adv = 1;
    return 1;
}

static int IsEmojiCodepoint(unsigned int cp) {
    return (cp >= 0x1F300 && cp <= 0x1FAFF) ||
           (cp >= 0x2600 && cp <= 0x27BF) ||
           (cp >= 0xFE00 && cp <= 0xFE0F) ||
           (cp >= 0x1F1E6 && cp <= 0x1F1FF);
}

static void SanitizeAssistantOutput(char *text) {
    unsigned char *src;
    unsigned char *dst;
    if (!text || !text[0]) return;
    src = (unsigned char *)text;
    dst = (unsigned char *)text;
    while (*src) {
        unsigned int cp = 0;
        int adv = 1;
        DecodeUtf8Codepoint(src, &cp, &adv);
        if (cp == '|' || cp == 0xFF5C || IsEmojiCodepoint(cp)) {
            src += adv;
            continue;
        }
        for (int i = 0; i < adv && src[i]; ++i) *dst++ = src[i];
        src += adv;
    }
    *dst = 0;
}

static int DetectPromptSlot(const char *system_prompt) {
    if (!system_prompt || !system_prompt[0]) return 0;
    if (g_cfg.prompt_2[0] && strcmp(system_prompt, g_cfg.prompt_2) == 0) return 1;
    if (g_cfg.prompt_3[0] && strcmp(system_prompt, g_cfg.prompt_3) == 0) return 2;
    return 0;
}

static void SetMultiWaitStatusText(char *buf, size_t buf_size, const char *main_status, const char reviewer_status[][16], const int reviewer_slots[], int reviewer_count) {
    size_t used = 0;
    if (!buf || buf_size == 0) return;
    used += snprintf(buf + used, buf_size - used, "main: %s", main_status ? main_status : "wait");
    for (int i = 0; i < reviewer_count && used + 24 < buf_size; ++i) {
        int slot = (reviewer_slots && reviewer_slots[i] >= 0) ? (reviewer_slots[i] + 1) : (i + 1);
        used += snprintf(buf + used, buf_size - used, "\nside-%d: %s", slot, reviewer_status[i][0] ? reviewer_status[i] : "wait");
    }
}

static int IsLikelyRequestError(const char *text) {
    if (!text || !text[0]) return 1;
    return strncmp(text, "HTTP ", 5) == 0 ||
           strstr(text, "failed") != NULL ||
           strstr(text, "Invalid endpoint") != NULL ||
           strstr(text, "WinHttp") != NULL;
}

static char *BuildImageUserMessage(const char *base_text) {
    char *msg = BuildUserMessage(base_text ? base_text : "", "");
    if (!msg) return NULL;
    if (!HasVisibleText(msg)) {
        free(msg);
        msg = _strdup("Please analyze the attached screenshot and answer based on the visible content.");
        if (!msg) return NULL;
    }
    {
        char *with_rag = BuildRagUserMessage(msg);
        free(msg);
        return with_rag;
    }
}

static char *BuildUserMessage(const char *user_text, const char *region) {
    char *templated;
    if (region && strcmp(region, "__RAW__") == 0) {
        return BuildRagUserMessage(user_text ? user_text : "");
    }
    const char *tpl = g_cfg.user_template[0] ? g_cfg.user_template : "{{text}}";
    size_t out_cap = strlen(tpl) + (user_text ? strlen(user_text) : 0) + (region ? strlen(region) : 0) + 64;
    char *out = (char *)malloc(out_cap);
    if (!out) return NULL;
    out[0] = 0;
    const char *p = tpl;
    while (*p) {
        if (strncmp(p, "{{text}}", 8) == 0) {
            strcat(out, user_text ? user_text : "");
            p += 8;
        } else if (strncmp(p, "{{region}}", 10) == 0) {
            strcat(out, region ? region : "");
            p += 10;
        } else {
            size_t len = strlen(out);
            out[len] = *p;
            out[len + 1] = 0;
            p++;
        }
    }
    templated = BuildRagUserMessage(out);
    free(out);
    return templated;
}

static char *JsonEscape(const char *s) {
    size_t len = 0;
    for (const char *p = s; *p; ++p) {
        if (*p == '\"' || *p == '\\') len += 2;
        else if (*p == '\n' || *p == '\r' || *p == '\t') len += 2;
        else len += 1;
    }
    char *out = (char *)malloc(len + 1);
    if (!out) return NULL;
    char *o = out;
    for (const char *p = s; *p; ++p) {
        if (*p == '\"') { *o++ = '\\'; *o++ = '\"'; }
        else if (*p == '\\') { *o++ = '\\'; *o++ = '\\'; }
        else if (*p == '\n') { *o++ = '\\'; *o++ = 'n'; }
        else if (*p == '\r') { *o++ = '\\'; *o++ = 'r'; }
        else if (*p == '\t') { *o++ = '\\'; *o++ = 't'; }
        else { *o++ = *p; }
    }
    *o = 0;
    return out;
}

static char *ExtractDeltaContent(const char *json) {
    const char *d = strstr(json, "\"delta\"");
    if (!d) return NULL;
    const char *p = strstr(d, "\"content\"");
    if (!p) return NULL;
    p = strchr(p, ':');
    if (!p) return NULL;
    p++;
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    if (*p != '\"') return NULL;
    p++;
    size_t cap = 256;
    size_t idx = 0;
    char *out = (char *)malloc(cap);
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

static void StripThinkBlocks(char *text) {
    if (!text || !text[0]) return;
    char *src = text;
    char *dst = text;
    while (*src) {
        if (strncmp(src, "<think>", 7) == 0) {
            src += 7;
            while (*src && strncmp(src, "</think>", 8) != 0) src++;
            if (*src) src += 8;
            continue;
        }
        *dst++ = *src++;
    }
    *dst = 0;
    while (*text == '\n' || *text == '\r' || *text == ' ') {
        memmove(text, text + 1, strlen(text));
    }
}

static void NormalizePlainTextOutput(char *text) {
    char *src;
    char *dst;
    int line_start = 1;
    if (!text || !text[0]) return;
    src = text;
    dst = text;
    while (*src) {
        if (src[0] == '*' && src[1] == '*') {
            src += 2;
            continue;
        }
        if (src[0] == '_' && src[1] == '_') {
            src += 2;
            continue;
        }
        if (src[0] == '`') {
            src++;
            continue;
        }
        if (line_start) {
            while (*src == '#') src++;
            if (src[0] == '-' && src[1] == ' ') src += 2;
        }
        *dst = *src;
        line_start = (*src == '\n' || *src == '\r') ? 1 : 0;
        dst++;
        src++;
    }
    *dst = 0;
    SanitizeAssistantOutput(text);
}

static int IsUsableModelAnswer(const char *text) {
    if (!text || !text[0]) return 0;
    if (IsLikelyRequestError(text)) return 0;
    if (strstr(text, "LLM response had no content field.") != NULL) return 0;
    return HasVisibleText(text);
}

static void DetermineModelStatus(const char *text, char *out, size_t out_size) {
    if (!out || out_size == 0) return;
    out[0] = 0;
    if (!text || !text[0]) {
        strncpy(out, "err", out_size - 1);
        out[out_size - 1] = 0;
        return;
    }
    if (strstr(text, "WinHTTP 12002") != NULL) {
        strncpy(out, "timeout", out_size - 1);
        out[out_size - 1] = 0;
        return;
    }
    if (IsLikelyRequestError(text) || strstr(text, "LLM response had no content field.") != NULL) {
        strncpy(out, "err", out_size - 1);
        out[out_size - 1] = 0;
        return;
    }
    strncpy(out, "done", out_size - 1);
    out[out_size - 1] = 0;
}

typedef struct EnsembleCallTask {
    LlmTargetConfig target;
    const char *user_text;
    const char *region;
    const char *image_path;
    const char *system_prompt;
    int req_id;
    int recv_timeout_ms;
    RequestTiming *timing;
    char *answer;
    char status[16];
    int usable;
} EnsembleCallTask;

static char *QueryEnsembleTarget(const LlmTargetConfig *target, const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, int *used_image, RequestTiming *timing, int recv_timeout_ms);

static DWORD WINAPI EnsembleCallThread(LPVOID param) {
    EnsembleCallTask *task = (EnsembleCallTask *)param;
    if (!task) return 0;
    task->answer = QueryEnsembleTarget(&task->target,
                                       task->user_text,
                                       task->region,
                                       task->image_path,
                                       task->system_prompt,
                                       task->req_id,
                                       NULL,
                                       task->timing,
                                       task->recv_timeout_ms);
    if (!task->answer) task->answer = _strdup("Model did not return a result.");
    task->usable = IsUsableModelAnswer(task->answer);
    DetermineModelStatus(task->answer, task->status, sizeof(task->status));
    return 0;
}

static void ResolveTargetConfig(LlmTargetConfig *out, const LlmTargetConfig *target) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (target && target->endpoint[0] && target->model[0]) {
        *out = *target;
        return;
    }
    strncpy(out->endpoint, g_cfg.endpoint, sizeof(out->endpoint) - 1);
    strncpy(out->api_key, g_cfg.api_key, sizeof(out->api_key) - 1);
    strncpy(out->model, g_cfg.model, sizeof(out->model) - 1);
    out->stream = g_cfg.stream;
}

static void ResolvePrimaryEnsembleTarget(LlmTargetConfig *target) {
    ResolveTargetConfig(target, NULL);
    if (g_cfg.ensemble_primary_endpoint[0]) {
        strncpy(target->endpoint, g_cfg.ensemble_primary_endpoint, sizeof(target->endpoint) - 1);
        target->endpoint[sizeof(target->endpoint) - 1] = 0;
    }
    if (g_cfg.ensemble_primary_api_key[0]) {
        strncpy(target->api_key, g_cfg.ensemble_primary_api_key, sizeof(target->api_key) - 1);
        target->api_key[sizeof(target->api_key) - 1] = 0;
    }
    if (g_cfg.ensemble_primary_model[0]) {
        strncpy(target->model, g_cfg.ensemble_primary_model, sizeof(target->model) - 1);
        target->model[sizeof(target->model) - 1] = 0;
    }
    target->stream = 0;
}

static int FillReviewerTarget(int index, LlmTargetConfig *target) {
    if (!target || index < 0 || index >= g_cfg.ensemble_reviewer_count) return 0;
    memset(target, 0, sizeof(*target));
    strncpy(target->endpoint, g_cfg.ensemble_reviewer_endpoint[index], sizeof(target->endpoint) - 1);
    strncpy(target->api_key, g_cfg.ensemble_reviewer_api_key[index], sizeof(target->api_key) - 1);
    strncpy(target->model, g_cfg.ensemble_reviewer_model[index], sizeof(target->model) - 1);
    target->stream = 0;
    return target->endpoint[0] && target->model[0];
}

static char *SendLLMRequestForTargetWithTimeout(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, const LlmTargetConfig *target, RequestTiming *timing, int recv_timeout_ms);
static char *QueryEnsembleTarget(const LlmTargetConfig *target, const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, int *used_image, RequestTiming *timing, int recv_timeout_ms);

static char *QueryEnsembleTarget(const LlmTargetConfig *target, const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, int *used_image, RequestTiming *timing, int recv_timeout_ms) {
    char *result = NULL;
    if (used_image) *used_image = (image_path && image_path[0]) ? 1 : 0;
    result = SendLLMRequestForTargetWithTimeout(user_text, region, image_path, system_prompt, req_id, target, timing, recv_timeout_ms);
    if (image_path && image_path[0] && IsLikelyRequestError(result)) {
        free(result);
        if (used_image) *used_image = 0;
        if (user_text && user_text[0]) {
            result = SendLLMRequestForTargetWithTimeout(user_text, region, "", system_prompt, req_id, target, timing, recv_timeout_ms);
        } else {
            result = _strdup("Skipped image-only request because this model may not support images.");
        }
    }
    return result;
}

static char *RunEnsembleRequest(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, RequestTiming *timing) {
    const int side_timeout_ms = 45000;
    const int merge_timeout_ms = 60000;
    LlmTargetConfig primary;
    int reviewer_slots[MAX_REVIEW_MODELS];
    int reviewer_active_count = 0;
    int reviewer_usable[MAX_REVIEW_MODELS] = {0};
    int primary_usable = 0;
    char *primary_answer = NULL;
    char *review_answers[MAX_REVIEW_MODELS] = {0};
    char *review_summary = NULL;
    char *final_prompt = NULL;
    char *final_answer = NULL;
    char status_text[2048];
    char reviewer_status[MAX_REVIEW_MODELS][16] = {{0}};
    char main_status[16] = "wait";
    int prompt_slot = DetectPromptSlot(system_prompt);
    const char *side_prompt = (system_prompt && system_prompt[0]) ? system_prompt : g_cfg.system_prompt;
    const char *main_prompt = g_cfg.ensemble_main_prompt[prompt_slot];
    EnsembleCallTask tasks[MAX_REVIEW_MODELS + 1];
    HANDLE handles[MAX_REVIEW_MODELS + 1] = {0};
    int task_count = 0;
    size_t summary_cap = 2048, summary_len = 0;
    for (int i = 0; i < g_cfg.ensemble_reviewer_count && reviewer_active_count < MAX_REVIEW_MODELS; ++i) {
        if (IsReviewerUsableAt(&g_cfg, i)) {
            reviewer_slots[reviewer_active_count++] = i;
        }
    }
    ResolvePrimaryEnsembleTarget(&primary);
    if (!primary.endpoint[0] || !primary.model[0]) {
        return DupPrintf("Multi-LLM is enabled, but the primary model config is incomplete.");
    }
    SetMultiWaitStatusText(status_text, sizeof(status_text), main_status, reviewer_status, reviewer_slots, reviewer_active_count);
    strncpy(g_wait_prefix, status_text, sizeof(g_wait_prefix) - 1);
    g_wait_prefix[sizeof(g_wait_prefix) - 1] = 0;
    memset(tasks, 0, sizeof(tasks));

    tasks[task_count].target = primary;
    tasks[task_count].user_text = user_text;
    tasks[task_count].region = region;
    tasks[task_count].image_path = image_path;
    tasks[task_count].system_prompt = side_prompt;
    tasks[task_count].req_id = req_id;
    tasks[task_count].recv_timeout_ms = side_timeout_ms;
    tasks[task_count].timing = timing;
    handles[task_count] = CreateThread(NULL, 0, EnsembleCallThread, &tasks[task_count], 0, NULL);
    task_count++;

    for (int i = 0; i < reviewer_active_count; ++i) {
        LlmTargetConfig reviewer;
        if (!FillReviewerTarget(reviewer_slots[i], &reviewer)) continue;
        tasks[task_count].target = reviewer;
        tasks[task_count].user_text = user_text;
        tasks[task_count].region = region;
        tasks[task_count].image_path = image_path;
        tasks[task_count].system_prompt = side_prompt;
        tasks[task_count].req_id = req_id;
        tasks[task_count].recv_timeout_ms = side_timeout_ms;
        tasks[task_count].timing = timing;
        handles[task_count] = CreateThread(NULL, 0, EnsembleCallThread, &tasks[task_count], 0, NULL);
        task_count++;
    }

    for (int i = 0; i < task_count; ++i) {
        if (handles[i]) {
            WaitForSingleObject(handles[i], INFINITE);
            CloseHandle(handles[i]);
        }
    }

    primary_answer = tasks[0].answer ? tasks[0].answer : _strdup("Primary model did not return a result.");
    tasks[0].answer = NULL;
    primary_usable = IsUsableModelAnswer(primary_answer);
    DetermineModelStatus(primary_answer, main_status, sizeof(main_status));

    for (int i = 0; i < reviewer_active_count; ++i) {
        int ti = i + 1;
        if (ti < task_count) {
            review_answers[i] = tasks[ti].answer ? tasks[ti].answer : _strdup("Reviewer did not return a result.");
            tasks[ti].answer = NULL;
            reviewer_usable[i] = IsUsableModelAnswer(review_answers[i]);
            DetermineModelStatus(review_answers[i], reviewer_status[i], sizeof(reviewer_status[i]));
        } else {
            review_answers[i] = _strdup("Reviewer was not started.");
            reviewer_usable[i] = 0;
            strcpy(reviewer_status[i], "err");
        }
    }

    SetMultiWaitStatusText(status_text, sizeof(status_text), main_status, reviewer_status, reviewer_slots, reviewer_active_count);
    strncpy(g_wait_prefix, status_text, sizeof(g_wait_prefix) - 1);
    g_wait_prefix[sizeof(g_wait_prefix) - 1] = 0;
    review_summary = (char *)malloc(summary_cap);
    if (!review_summary) {
        free(primary_answer);
        return _strdup("Failed to allocate ensemble buffer.");
    }
    review_summary[0] = 0;
    summary_len = 0;
    {
        const char *label = "Primary answer:\n";
        AppendTextWithCap(&review_summary, &summary_len, &summary_cap, label, strlen(label), 24000);
        if (primary_usable) {
            AppendTextWithCap(&review_summary, &summary_len, &summary_cap, primary_answer, strlen(primary_answer), 24000);
        } else {
            AppendTextWithCap(&review_summary, &summary_len, &summary_cap, "(unavailable)", 13, 24000);
        }
        AppendTextWithCap(&review_summary, &summary_len, &summary_cap, "\n\n", 2, 24000);
    }
    for (int i = 0; i < reviewer_active_count; ++i) {
        char header[64];
        snprintf(header, sizeof(header), "Side %d answer:\n", reviewer_slots[i] + 1);
        AppendTextWithCap(&review_summary, &summary_len, &summary_cap, header, strlen(header), 24000);
        if (reviewer_usable[i]) {
            AppendTextWithCap(&review_summary, &summary_len, &summary_cap, review_answers[i], strlen(review_answers[i]), 24000);
        } else {
            AppendTextWithCap(&review_summary, &summary_len, &summary_cap, "(unavailable)", 13, 24000);
        }
        AppendTextWithCap(&review_summary, &summary_len, &summary_cap, "\n\n", 2, 24000);
    }
    final_prompt = DupPrintf(
        "Question:\n%s\n\n"
        "Candidate answers from multiple models:\n%s\n"
        "Please produce:\n"
        "1. Best final answer\n"
        "2. If there is disagreement, mark it clearly\n"
        "3. Briefly mention the likely alternative if needed\n"
        "4. Keep the answer concise\n",
        user_text ? user_text : "",
        review_summary ? review_summary : "");
    {
        char participants[256] = "";
        int first = 1;
        for (int i = 0; i < reviewer_active_count; ++i) {
            if (!reviewer_usable[i]) continue;
            char seg[24];
            snprintf(seg, sizeof(seg), first ? "side%d" : ",side%d", reviewer_slots[i] + 1);
            first = 0;
            strncat(participants, seg, sizeof(participants) - strlen(participants) - 1);
        }
        if (!participants[0]) strcpy(participants, "primary");
        snprintf(main_status, sizeof(main_status), "merge");
        snprintf(status_text, sizeof(status_text), "merge %s\nwait...", participants);
        strncpy(g_wait_prefix, status_text, sizeof(g_wait_prefix) - 1);
        g_wait_prefix[sizeof(g_wait_prefix) - 1] = 0;
    }
    final_answer = QueryEnsembleTarget(&primary, final_prompt, "__RAW__", image_path, main_prompt, req_id, NULL, timing, merge_timeout_ms);
    if (!IsUsableModelAnswer(final_answer)) {
        free(final_answer);
        final_answer = NULL;
        for (int i = 0; i < reviewer_active_count; ++i) {
            LlmTargetConfig fallback_target;
            if (!reviewer_usable[i]) continue;
            if (!FillReviewerTarget(reviewer_slots[i], &fallback_target)) continue;
            final_answer = QueryEnsembleTarget(&fallback_target, final_prompt, "__RAW__", image_path, main_prompt, req_id, NULL, timing, merge_timeout_ms);
            if (IsUsableModelAnswer(final_answer)) break;
            free(final_answer);
            final_answer = NULL;
        }
    }
    if (!final_answer) {
        for (int i = 0; i < reviewer_active_count; ++i) {
            if (reviewer_usable[i] && review_answers[i]) {
                final_answer = _strdup(review_answers[i]);
                break;
            }
        }
    }
    if (!final_answer) final_answer = _strdup(primary_usable ? primary_answer : "Multi-LLM aggregation failed: no usable model response.");
    for (int i = 0; i < MAX_REVIEW_MODELS; ++i) free(review_answers[i]);
    free(primary_answer);
    free(review_summary);
    free(final_prompt);
    return final_answer;
}

static void AppendChunkPreview(RequestTiming *timing, const char *buf, DWORD read) {
    int i;
    int take;
    int col = 0;
    if (!timing || !buf || read == 0) return;
    if (timing->chunk_preview_count >= 3) return;
    if (timing->chunk_preview_len >= (int)sizeof(timing->chunk_preview) - 32) return;
    take = (int)read;
    if (take > 120) take = 120;
    timing->chunk_preview_len += snprintf(
        timing->chunk_preview + timing->chunk_preview_len,
        sizeof(timing->chunk_preview) - timing->chunk_preview_len,
        "\n[ch%d] ",
        timing->chunk_preview_count + 1);
    for (i = 0; i < take && timing->chunk_preview_len < (int)sizeof(timing->chunk_preview) - 1; ++i) {
        unsigned char c = (unsigned char)buf[i];
        if (c == '\r' || c == '\n' || c == '\t') c = ' ';
        if (c < 32) c = '.';
        timing->chunk_preview[timing->chunk_preview_len++] = (char)c;
        col++;
        if ((c == ',' || c == ':' || c == ']' || c == '}') && timing->chunk_preview_len < (int)sizeof(timing->chunk_preview) - 1) {
            timing->chunk_preview[timing->chunk_preview_len++] = ' ';
            col++;
        }
        if (col >= 82 && timing->chunk_preview_len < (int)sizeof(timing->chunk_preview) - 6) {
            timing->chunk_preview[timing->chunk_preview_len++] = '\n';
            timing->chunk_preview[timing->chunk_preview_len++] = ' ';
            timing->chunk_preview[timing->chunk_preview_len++] = ' ';
            col = 0;
        }
    }
    timing->chunk_preview[timing->chunk_preview_len] = 0;
    timing->chunk_preview_count++;
}

static int StreamChunkIndicatesDone(const char *text) {
    const char *p;
    if (!text || !text[0]) return 0;
    if (strstr(text, "[DONE]") != NULL) return 1;
    p = text;
    while ((p = strstr(p, "\"finish_reason\"")) != NULL) {
        const char *q = strchr(p, ':');
        if (!q) break;
        q++;
        while (*q == ' ' || *q == '\t' || *q == '\r' || *q == '\n') q++;
        if (_strnicmp(q, "null", 4) != 0) return 1;
        p = q;
    }
    return 0;
}

static int AppendStreamAccum(char **stream_acc, size_t *stream_acc_len, size_t *stream_acc_cap, const char *delta) {
    size_t dlen;
    char *n;
    size_t new_cap;
    if (!stream_acc || !stream_acc_len || !stream_acc_cap || !delta || !delta[0]) return 1;
    dlen = strlen(delta);
    if (*stream_acc_len + dlen + 1 <= *stream_acc_cap) {
        memcpy(*stream_acc + *stream_acc_len, delta, dlen);
        *stream_acc_len += dlen;
        (*stream_acc)[*stream_acc_len] = 0;
        return 1;
    }
    new_cap = *stream_acc_cap ? *stream_acc_cap : 256;
    while (*stream_acc_len + dlen + 1 > new_cap) new_cap *= 2;
    n = (char *)realloc(*stream_acc, new_cap);
    if (!n) return 0;
    *stream_acc = n;
    *stream_acc_cap = new_cap;
    memcpy(*stream_acc + *stream_acc_len, delta, dlen);
    *stream_acc_len += dlen;
    (*stream_acc)[*stream_acc_len] = 0;
    return 1;
}

static void ProcessSseLine(const char *line, size_t line_len, int *stream_done, char **stream_acc, size_t *stream_acc_len, size_t *stream_acc_cap, int req_id) {
    size_t data_pos;
    size_t data_len;
    char *json_line;
    char *delta;
    if (!line || line_len < 5 || !stream_done) return;
    if (strncmp(line, "data:", 5) != 0) return;
    data_pos = 5;
    while (data_pos < line_len && line[data_pos] == ' ') data_pos++;
    data_len = line_len - data_pos;
    if (data_len == 6 && strncmp(line + data_pos, "[DONE]", 6) == 0) {
        *stream_done = 1;
        return;
    }
    json_line = (char *)malloc(data_len + 1);
    if (!json_line) return;
    memcpy(json_line, line + data_pos, data_len);
    json_line[data_len] = 0;
    delta = ExtractDeltaContent(json_line);
    free(json_line);
    if (!delta || !delta[0]) {
        free(delta);
        return;
    }
    if (AppendStreamAccum(stream_acc, stream_acc_len, stream_acc_cap, delta)) {
        StreamPayload *sp = (StreamPayload *)malloc(sizeof(StreamPayload));
        if (sp) {
            sp->text = _strdup(*stream_acc ? *stream_acc : "");
            sp->anchor = g_wait_anchor;
            sp->req_id = req_id;
            PostMessage(g_hwnd_main, WM_APP_STREAM, 0, (LPARAM)sp);
        }
    }
    free(delta);
}

static int ShouldRetryWithoutStream(const char *result) {
    if (!result || !result[0]) return 1;
    if (strstr(result, "LLM response had no content field.") != NULL) return 1;
    if (strstr(result, "data: {") != NULL) return 1;
    if (strstr(result, "chat.completion.chunk") != NULL) return 1;
    if (IsLikelyRequestError(result)) return 1;
    return 0;
}

static const char *ResolveSystemPromptText(const char *system_prompt) {
    if (system_prompt) {
        if (strcmp(system_prompt, SYSTEM_PROMPT_NONE_TAG) == 0) return NULL;
        return system_prompt[0] ? system_prompt : NULL;
    }
    return g_cfg.system_prompt[0] ? g_cfg.system_prompt : NULL;
}

static char *SendLLMRequestForTargetOnce(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, const LlmTargetConfig *target, RequestTiming *timing, int recv_timeout_ms) {
    ProviderRequestInfo provider;
    int use_stream;
    char endpoint[512];
    LlmTargetConfig resolved;
    const char *api_key;
    const char *model;
    ResolveTargetConfig(&resolved, target);
    if (timing) {
        if (timing->api_start_ms == 0) timing->api_start_ms = GetTickCount64();
        timing->call_count++;
    }
    if (!resolved.model[0]) {
        return _strdup("Model is empty in current config/route. Request blocked to avoid server-side default model fallback.");
    }
    if (!resolved.endpoint[0]) {
        return _strdup("Endpoint is empty in current config/route.");
    }
    strncpy(endpoint, resolved.endpoint, sizeof(endpoint) - 1);
    endpoint[sizeof(endpoint) - 1] = 0;
    api_key = resolved.api_key;
    model = resolved.model;
    ResolveProviderRequestInfo(&provider, endpoint, api_key, model, resolved.stream);
    strncpy(endpoint, provider.endpoint, sizeof(endpoint) - 1);
    endpoint[sizeof(endpoint) - 1] = 0;
    use_stream = provider.use_stream;
    char *user_msg = image_path && image_path[0] ? BuildImageUserMessage(user_text) : BuildUserMessage(user_text, region);
    if (!user_msg) return NULL;
    const char *system_text = ResolveSystemPromptText(system_prompt);
    char system_all[1600];
    char *sys_esc = NULL;
    if (system_text && system_text[0]) {
        snprintf(system_all, sizeof(system_all),
                 "%s\n\nOutput rule: Return final answer only. Do not output chain-of-thought, hidden reasoning, or <think> blocks.",
                 system_text);
        sys_esc = JsonEscape(system_all);
    }
    char *user_esc = JsonEscape(user_msg);
    char *img_b64 = NULL;
    free(user_msg);
    if ((system_text && system_text[0] && !sys_esc) || !user_esc) {
        free(sys_esc);
        free(user_esc);
        return NULL;
    }
    char *body = NULL;
    if (timing) {
        if (user_text) timing->input_text_bytes += (ULONGLONG)strlen(user_text);
    }
    if (image_path && image_path[0]) {
        size_t body_cap;
        char *img_url_esc;
        img_b64 = ReadFileBase64(image_path);
        if (!img_b64) {
            free(sys_esc);
            free(user_esc);
            return DupPrintf("Failed to read screenshot: %s", image_path);
        }
        body_cap = strlen(model) + strlen(user_esc) + strlen(img_b64) + (sys_esc ? strlen(sys_esc) : 0) + 512;
        body = (char *)malloc(body_cap);
        if (!body) {
            free(sys_esc);
            free(user_esc);
            free(img_b64);
            return NULL;
        }
        img_url_esc = (char *)malloc(strlen(img_b64) + 32);
        if (!img_url_esc) {
            free(sys_esc);
            free(user_esc);
            free(img_b64);
            free(body);
            return NULL;
        }
        strcpy(img_url_esc, "data:image/png;base64,");
        strcat(img_url_esc, img_b64);
        if (sys_esc) {
            snprintf(body, body_cap,
                     "{\"model\":\"%s\",\"messages\":[{\"role\":\"system\",\"content\":\"%s\"},"
                     "{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"%s\"},"
                     "{\"type\":\"image_url\",\"image_url\":{\"url\":\"%s\"}}]}],\"temperature\":0.2,\"max_tokens\":1024,\"stream\":%s}",
                     model, sys_esc, user_esc, img_url_esc, use_stream ? "true" : "false");
        } else {
            snprintf(body, body_cap,
                     "{\"model\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"%s\"},"
                     "{\"type\":\"image_url\",\"image_url\":{\"url\":\"%s\"}}]}],\"temperature\":0.2,\"max_tokens\":1024,\"stream\":%s}",
                     model, user_esc, img_url_esc, use_stream ? "true" : "false");
        }
        free(img_url_esc);
    } else {
        size_t body_cap = strlen(model) + strlen(user_esc) + (sys_esc ? strlen(sys_esc) : 0) + 256;
        body = (char *)malloc(body_cap);
        if (!body) {
            free(sys_esc);
            free(user_esc);
            return NULL;
        }
        if (sys_esc) {
            snprintf(body, body_cap,
                     "{\"model\":\"%s\",\"messages\":[{\"role\":\"system\",\"content\":\"%s\"},"
                     "{\"role\":\"user\",\"content\":\"%s\"}],\"temperature\":0.2,\"max_tokens\":1024,\"stream\":%s}",
                     model, sys_esc, user_esc, use_stream ? "true" : "false");
        } else {
            snprintf(body, body_cap,
                     "{\"model\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":\"%s\"}],\"temperature\":0.2,\"max_tokens\":1024,\"stream\":%s}",
                     model, user_esc, use_stream ? "true" : "false");
        }
    }
    if (provider.kind == PROVIDER_GOOGLE_GEMINI) {
        size_t body_cap;
        free(body);
        body = NULL;
        if (image_path && image_path[0] && !img_b64) {
            img_b64 = ReadFileBase64(image_path);
            if (!img_b64) return DupPrintf("Failed to read screenshot: %s", image_path);
        }
        body_cap = strlen(sys_esc ? sys_esc : "") + strlen(user_esc ? user_esc : "") + strlen(model) +
                   (img_b64 ? strlen(img_b64) : 0) + 512;
        body = (char *)malloc(body_cap);
        if (!body) {
            free(img_b64);
            free(sys_esc);
            free(user_esc);
            return NULL;
        }
        if (img_b64 && img_b64[0]) {
            if (sys_esc) {
                snprintf(body, body_cap,
                         "{\"system_instruction\":{\"parts\":[{\"text\":\"%s\"}]},"
                         "\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"%s\"},"
                         "{\"inline_data\":{\"mime_type\":\"image/png\",\"data\":\"%s\"}}]}],"
                         "\"generationConfig\":{\"temperature\":0.2,\"maxOutputTokens\":1024}}",
                         sys_esc, user_esc, img_b64);
            } else {
                snprintf(body, body_cap,
                         "{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"%s\"},"
                         "{\"inline_data\":{\"mime_type\":\"image/png\",\"data\":\"%s\"}}]}],"
                         "\"generationConfig\":{\"temperature\":0.2,\"maxOutputTokens\":1024}}",
                         user_esc, img_b64);
            }
        } else {
            if (sys_esc) {
                snprintf(body, body_cap,
                         "{\"system_instruction\":{\"parts\":[{\"text\":\"%s\"}]},"
                         "\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"%s\"}]}],"
                         "\"generationConfig\":{\"temperature\":0.2,\"maxOutputTokens\":1024}}",
                         sys_esc, user_esc);
            } else {
                snprintf(body, body_cap,
                         "{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"%s\"}]}],"
                         "\"generationConfig\":{\"temperature\":0.2,\"maxOutputTokens\":1024}}",
                         user_esc);
            }
        }
    }
    if (provider.kind == PROVIDER_ANTHROPIC) {
        size_t body_cap;
        free(body);
        body = NULL;
        if (image_path && image_path[0] && !img_b64) {
            img_b64 = ReadFileBase64(image_path);
            if (!img_b64) return DupPrintf("Failed to read screenshot: %s", image_path);
        }
        body_cap = strlen(model) + strlen(sys_esc ? sys_esc : "") + strlen(user_esc ? user_esc : "") +
                   (img_b64 ? strlen(img_b64) : 0) + 640;
        body = (char *)malloc(body_cap);
        if (!body) {
            free(img_b64);
            free(sys_esc);
            free(user_esc);
            return NULL;
        }
        if (img_b64 && img_b64[0]) {
            if (sys_esc) {
                snprintf(body, body_cap,
                         "{\"model\":\"%s\",\"max_tokens\":1024,\"temperature\":0.2,\"system\":\"%s\","
                         "\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"%s\"},"
                         "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"%s\"}}]}]}",
                         model, sys_esc, user_esc, img_b64);
            } else {
                snprintf(body, body_cap,
                         "{\"model\":\"%s\",\"max_tokens\":1024,\"temperature\":0.2,"
                         "\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"%s\"},"
                         "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"%s\"}}]}]}",
                         model, user_esc, img_b64);
            }
        } else {
            if (sys_esc) {
                snprintf(body, body_cap,
                         "{\"model\":\"%s\",\"max_tokens\":1024,\"temperature\":0.2,\"system\":\"%s\","
                         "\"messages\":[{\"role\":\"user\",\"content\":\"%s\"}]}",
                         model, sys_esc, user_esc);
            } else {
                snprintf(body, body_cap,
                         "{\"model\":\"%s\",\"max_tokens\":1024,\"temperature\":0.2,"
                         "\"messages\":[{\"role\":\"user\",\"content\":\"%s\"}]}",
                         model, user_esc);
            }
        }
    }
    free(sys_esc);
    free(user_esc);
    if (timing && body) timing->request_body_bytes += (ULONGLONG)strlen(body);
    WCHAR endpoint_w[512];
    if (MultiByteToWideChar(CP_UTF8, 0, endpoint, -1, endpoint_w, 512) == 0) {
        free(img_b64);
        free(body);
        return DupPrintf("Invalid endpoint encoding.");
    }
    URL_COMPONENTS url;
    ZeroMemory(&url, sizeof(url));
    url.dwStructSize = sizeof(url);
    WCHAR host_w[256];
    WCHAR path_w[1024];
    WCHAR extra_w[512];
    url.lpszHostName = host_w;
    url.dwHostNameLength = sizeof(host_w) / sizeof(WCHAR);
    url.lpszUrlPath = path_w;
    url.dwUrlPathLength = sizeof(path_w) / sizeof(WCHAR);
    url.lpszExtraInfo = extra_w;
    url.dwExtraInfoLength = sizeof(extra_w) / sizeof(WCHAR);
    if (!WinHttpCrackUrl(endpoint_w, 0, 0, &url)) {
        free(img_b64);
        free(body);
        return DupPrintf("Invalid endpoint URL: %s", endpoint);
    }
    if (url.dwHostNameLength >= (sizeof(host_w) / sizeof(WCHAR))) {
        free(img_b64);
        free(body);
        return DupPrintf("Host is too long.");
    }
    if (url.dwUrlPathLength >= (sizeof(path_w) / sizeof(WCHAR))) {
        free(img_b64);
        free(body);
        return DupPrintf("URL path is too long.");
    }
    if (url.dwExtraInfoLength >= (sizeof(extra_w) / sizeof(WCHAR))) {
        free(img_b64);
        free(body);
        return DupPrintf("URL query is too long.");
    }
    host_w[url.dwHostNameLength] = 0;
    path_w[url.dwUrlPathLength] = 0;
    extra_w[url.dwExtraInfoLength] = 0;
    WCHAR full_path_w[1536];
    full_path_w[0] = 0;
    WideCopyAppend(full_path_w, sizeof(full_path_w) / sizeof(WCHAR), path_w);
    if (extra_w[0]) WideCopyAppend(full_path_w, sizeof(full_path_w) / sizeof(WCHAR), extra_w);
    HINTERNET hSession = WinHttpOpen(L"LLMOverlay/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) {
        free(img_b64);
        free(body);
        return DupPrintf("WinHttpOpen failed: %lu", GetLastError());
    }
    WinHttpSetTimeouts(hSession, 10000, 10000, 30000, recv_timeout_ms > 0 ? recv_timeout_ms : 300000);
    HINTERNET hConnect = WinHttpConnect(hSession, host_w, url.nPort, 0);
    if (!hConnect) {
        DWORD err = GetLastError();
        WinHttpCloseHandle(hSession);
        free(img_b64);
        free(body);
        return DupPrintf("WinHttpConnect failed: %lu", err);
    }
    DWORD flags = (url.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", full_path_w, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        DWORD err = GetLastError();
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        free(img_b64);
        free(body);
        return DupPrintf("WinHttpOpenRequest failed: %lu", err);
    }
    WinHttpAddRequestHeaders(hRequest, L"Content-Type: application/json", -1, WINHTTP_ADDREQ_FLAG_ADD);
    EnterCriticalSection(&g_req_cs);
    if (req_id == g_active_request_id) {
        g_active_hrequest = hRequest;
    }
    LeaveCriticalSection(&g_req_cs);
    if (api_key[0] && provider.kind == PROVIDER_OPENAI_COMPAT) {
        char header_auth[512];
        snprintf(header_auth, sizeof(header_auth), "Authorization: Bearer %s", api_key);
        WCHAR header_auth_w[512];
        MultiByteToWideChar(CP_UTF8, 0, header_auth, -1, header_auth_w, 512);
        WinHttpAddRequestHeaders(hRequest, header_auth_w, -1, WINHTTP_ADDREQ_FLAG_ADD);
    } else if (api_key[0] && provider.kind == PROVIDER_GOOGLE_GEMINI) {
        char header_api[512];
        WCHAR header_api_w[512];
        snprintf(header_api, sizeof(header_api), "x-goog-api-key: %s", api_key);
        MultiByteToWideChar(CP_UTF8, 0, header_api, -1, header_api_w, 512);
        WinHttpAddRequestHeaders(hRequest, header_api_w, -1, WINHTTP_ADDREQ_FLAG_ADD);
    } else if (api_key[0] && provider.kind == PROVIDER_ANTHROPIC) {
        char header_api[768];
        WCHAR header_api_w[768];
        snprintf(header_api, sizeof(header_api), "x-api-key: %s\r\nanthropic-version: 2023-06-01", api_key);
        MultiByteToWideChar(CP_UTF8, 0, header_api, -1, header_api_w, 768);
        WinHttpAddRequestHeaders(hRequest, header_api_w, -1, WINHTTP_ADDREQ_FLAG_ADD);
    }
    BOOL ok = WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0, (LPVOID)body, (DWORD)strlen(body), (DWORD)strlen(body), 0);
    if (ok && timing) timing->send_done_ms = GetTickCount64();
    if (!ok || !WinHttpReceiveResponse(hRequest, NULL)) {
        DWORD err = GetLastError();
        int should_close_request = 0;
        EnterCriticalSection(&g_req_cs);
        if (g_active_hrequest == hRequest) {
            g_active_hrequest = NULL;
            should_close_request = 1;
        }
        LeaveCriticalSection(&g_req_cs);
        if (should_close_request) WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        free(img_b64);
        free(body);
        return DupPrintf("HTTP request failed (WinHTTP %lu). Endpoint: %s", err, endpoint);
    }
    if (timing) timing->recv_done_ms = GetTickCount64();
    DWORD status = 0, status_size = sizeof(status);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size, WINHTTP_NO_HEADER_INDEX);
    size_t total = 0;
    int stream_done = 0;
    char *resp = (char *)malloc(8192);
    char *stream_acc = NULL;
    size_t stream_acc_len = 0, stream_acc_cap = 0, parse_pos = 0;
    if (!resp) {
        int should_close_request = 0;
        EnterCriticalSection(&g_req_cs);
        if (g_active_hrequest == hRequest) {
            g_active_hrequest = NULL;
            should_close_request = 1;
        }
        LeaveCriticalSection(&g_req_cs);
        if (should_close_request) WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
        free(img_b64);
        free(body);
        return NULL;
    }
    resp[0] = 0;
    for (;;) {
        char read_buf[4096];
        DWORD read = 0;
        if (stream_done) break;
        if (!WinHttpReadData(hRequest, read_buf, sizeof(read_buf) - 1, &read) || read == 0) {
            break;
        }
        read_buf[read] = 0;
        {
            if (timing && timing->first_byte_ms == 0) timing->first_byte_ms = GetTickCount64();
            AppendChunkPreview(timing, read_buf, read);
            size_t new_total = total + read + 1;
            char *new_resp = (char *)realloc(resp, new_total);
            if (!new_resp) { break; }
            resp = new_resp;
            memcpy(resp + total, read_buf, read + 1);
            total += read;
            if (timing) timing->bytes_read += read;
            resp[total] = 0;
            if (use_stream) {
                if (StreamChunkIndicatesDone(resp)) {
                    stream_done = 1;
                }
                while (parse_pos < total) {
                    char *nl = strchr(resp + parse_pos, '\n');
                    size_t line_len;
                    if (!nl) {
                        if (!stream_done) break;
                        line_len = total - parse_pos;
                    } else {
                        line_len = (size_t)(nl - (resp + parse_pos));
                    }
                    while (line_len > 0 && (resp[parse_pos + line_len - 1] == '\r' || resp[parse_pos + line_len - 1] == '\n')) line_len--;
                    ProcessSseLine(resp + parse_pos, line_len, &stream_done, &stream_acc, &stream_acc_len, &stream_acc_cap, req_id);
                    if (!nl) {
                        parse_pos = total;
                    } else {
                        parse_pos = (size_t)(nl - resp) + 1;
                    }
                }
            }
        }
    }
    if (use_stream && parse_pos < total) {
        size_t line_len = total - parse_pos;
        while (line_len > 0 && (resp[parse_pos + line_len - 1] == '\r' || resp[parse_pos + line_len - 1] == '\n')) line_len--;
        ProcessSseLine(resp + parse_pos, line_len, &stream_done, &stream_acc, &stream_acc_len, &stream_acc_cap, req_id);
    }
    if (timing) timing->read_done_ms = GetTickCount64();
    {
        int should_close_request = 0;
        EnterCriticalSection(&g_req_cs);
        if (g_active_hrequest == hRequest) {
            g_active_hrequest = NULL;
            should_close_request = 1;
        }
        LeaveCriticalSection(&g_req_cs);
        if (should_close_request) WinHttpCloseHandle(hRequest);
    }
    WinHttpCloseHandle(hConnect); WinHttpCloseHandle(hSession);
    free(img_b64);
    free(body);
    char *content = NULL;
    if (use_stream) {
        if (stream_acc && stream_acc[0]) {
            content = _strdup(stream_acc);
        } else if (resp && (strstr(resp, "data: {") != NULL || strstr(resp, "chat.completion.chunk") != NULL)) {
            content = _strdup("LLM response had no content field.");
        } else {
            content = ExtractProviderText(&provider, resp);
        }
    } else {
        content = ExtractProviderText(&provider, resp);
    }
    if (!content) {
        if (status >= 400) {
            char *err = DupPrintf("HTTP %lu. Raw response: %.600s", (unsigned long)status, resp ? resp : "");
            free(resp); free(stream_acc); return err;
        }
        content = _strdup("LLM response had no content field.");
    }
    if (timing) timing->done_ms = GetTickCount64();
    if (content) {
        StripThinkBlocks(content);
        NormalizePlainTextOutput(content);
    }
    free(resp); free(stream_acc);
    return content;
}

static char *SendLLMRequestForTargetWithTimeout(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, const LlmTargetConfig *target, RequestTiming *timing, int recv_timeout_ms) {
    LlmTargetConfig resolved;
    ProviderRequestInfo info;
    char endpoint[512];
    char *result;
    ResolveTargetConfig(&resolved, target);
    strncpy(endpoint, resolved.endpoint, sizeof(endpoint) - 1);
    endpoint[sizeof(endpoint) - 1] = 0;
    ResolveProviderRequestInfo(&info, endpoint, resolved.api_key, resolved.model, resolved.stream);

    result = SendLLMRequestForTargetOnce(user_text, region, image_path, system_prompt, req_id, target, timing, recv_timeout_ms);
    if (!info.use_stream) return result;
    if (!ShouldRetryWithoutStream(result)) return result;

    {
        LlmTargetConfig fallback = resolved;
        char *retry;
        fallback.stream = 0;
        retry = SendLLMRequestForTargetOnce(user_text, region, image_path, system_prompt, req_id, &fallback, timing, recv_timeout_ms);
        if (IsUsableModelAnswer(retry)) {
            free(result);
            return retry;
        }
        free(retry);
    }
    return result;
}

static char *SendLLMRequestForTarget(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, const LlmTargetConfig *target, RequestTiming *timing) {
    return SendLLMRequestForTargetWithTimeout(user_text, region, image_path, system_prompt, req_id, target, timing, 300000);
}

static char *SendLLMRequest(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, RequestTiming *timing) {
    return SendLLMRequestForTarget(user_text, region, image_path, system_prompt, req_id, NULL, timing);
}

static DWORD WINAPI RequestThread(LPVOID param) {
    RequestPayload *req = (RequestPayload *)param;
    RequestTiming timing;
    memset(&timing, 0, sizeof(timing));
    char *result = req->use_target_override
        ? SendLLMRequestForTarget(req->user_text, req->region, req->image_path, req->system_prompt, req->req_id, &req->target, &timing)
        : SendLLMRequest(req->user_text, req->region, req->image_path, req->system_prompt, req->req_id, &timing);
    if (!result) result = _strdup("LLM request failed.");
    if (req->image_path[0]) {
        DeleteFileA(req->image_path);
    }
    ResponsePayload *resp = (ResponsePayload *)malloc(sizeof(ResponsePayload));
    if (resp) {
        resp->text = result;
        resp->anchor = req->anchor;
        resp->from_ask = req->from_ask;
        resp->req_id = req->req_id;
        PostMessage(g_hwnd_main, WM_APP_RESPONSE, 0, (LPARAM)resp);
    } else free(result);
    free(req->user_text);
    free(req);
    return 0;
}

static void StartRequestEx(const char *text, const char *region, const char *image_path, POINT anchor, int from_ask, const char *system_prompt) {
    StartRequestExTarget(text, region, image_path, anchor, from_ask, system_prompt, NULL);
}

static void StartRequestExTarget(const char *text, const char *region, const char *image_path, POINT anchor, int from_ask, const char *system_prompt, const LlmTargetConfig *target) {
    if (g_req_inflight) return;
    RequestPayload *req = (RequestPayload *)malloc(sizeof(RequestPayload));
    if (!req) return;
    req->user_text = _strdup(text ? text : "");
    strncpy(req->region, region ? region : "", sizeof(req->region) - 1);
    req->region[sizeof(req->region) - 1] = 0;
    strncpy(req->image_path, image_path ? image_path : "", sizeof(req->image_path) - 1);
    req->image_path[sizeof(req->image_path) - 1] = 0;
    req->anchor = anchor;
    req->from_ask = from_ask;
    req->req_id = (int)InterlockedIncrement(&g_request_seq);
    req->start_ms = GetTickCount64();
    strncpy(req->system_prompt, system_prompt ? system_prompt : g_cfg.system_prompt, sizeof(req->system_prompt) - 1);
    req->system_prompt[sizeof(req->system_prompt) - 1] = 0;
    req->use_target_override = target ? 1 : 0;
    if (target) req->target = *target;
    else memset(&req->target, 0, sizeof(req->target));
    g_active_request_id = req->req_id;
    g_req_inflight = 1;
    g_stream_has_output = 0;
    g_overlay_scroll_px = 0;
    g_overlay_content_height = 0;
    g_wait_anchor = anchor;
    g_wait_dots = 1;
    ShowWaitingOverlay(anchor);
    SetTimer(g_hwnd_main, 1, 500, NULL);
    {
        HANDLE h = CreateThread(NULL, 0, RequestThread, req, 0, NULL);
        if (h) CloseHandle(h);
    }
}

static void StartRequest(const char *text, const char *region, const char *image_path, POINT anchor, const char *system_prompt) {
    StartRequestExTarget(text, region, image_path, anchor, 0, system_prompt, NULL);
}

static void CancelCurrentRequest(const char *reason, POINT anchor) {
    HINTERNET hreq = NULL;
    EnterCriticalSection(&g_req_cs);
    hreq = g_active_hrequest;
    g_active_hrequest = NULL;
    g_active_request_id = -1;
    LeaveCriticalSection(&g_req_cs);

    if (hreq) {
        WinHttpCloseHandle(hreq);
    }

    if (g_req_inflight) {
        KillTimer(g_hwnd_main, 1);
        g_req_inflight = 0;
        g_stream_has_output = 0;
        g_wait_prefix[0] = 0;
        if (g_ask_inflight && g_hwnd_settings && IsWindow(g_hwnd_settings)) {
            g_ask_inflight = 0;
            if (GetDlgItem(g_hwnd_settings, ID_BTN_ASK)) {
                SetWindowTextA(GetDlgItem(g_hwnd_settings, ID_BTN_ASK), "Ask");
                EnableWindow(GetDlgItem(g_hwnd_settings, ID_BTN_ASK),
                             GetWindowTextLengthA(GetDlgItem(g_hwnd_settings, ID_EDIT_PROMPT)) > 0);
            }
        }
        if (reason && reason[0]) {
            ShowOverlayText(reason, anchor);
        }
    }
}
