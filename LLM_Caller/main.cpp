#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <gdiplus.h>
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "gdiplus.lib")

#define APP_NAME "Helper"
#define CONFIG_FILE "config.ini"
#define MAX_REVIEW_MODELS 8
#define MAX_PROMPT_ROUTES 5
#define MAX_IMAGE_ROUTES 3
#define MAX_MODEL_ROUTES 16
#define SYSTEM_PROMPT_NONE_TAG "__NO_SYSTEM_PROMPT__"

static const char *k_msg_no_selected_text = "No selected text captured. Please re-select text and try again.";

static int TinyVsnprintf(char *dst, size_t dst_size, const char *fmt, va_list ap) {
    size_t out = 0;
    int total = 0;
    if (!fmt) {
        if (dst && dst_size) dst[0] = 0;
        return 0;
    }
    for (const char *p = fmt; *p; ++p) {
        if (*p != '%') {
            if (dst && out + 1 < dst_size) dst[out] = *p;
            out++;
            total++;
            continue;
        }
        p++;
        if (!*p) break;
        if (*p == '%') {
            if (dst && out + 1 < dst_size) dst[out] = '%';
            out++;
            total++;
            continue;
        }
        int precision = -1;
        if (*p == '.') {
            precision = 0;
            p++;
            while (*p >= '0' && *p <= '9') {
                precision = precision * 10 + (*p - '0');
                p++;
            }
        }
        int is_long = 0;
        if (*p == 'l') {
            is_long = 1;
            p++;
        }
        if (!*p) break;
        if (*p == 's') {
            const char *s = va_arg(ap, const char *);
            int n = 0;
            if (!s) s = "";
            while (s[n] && (precision < 0 || n < precision)) {
                if (dst && out + 1 < dst_size) dst[out] = s[n];
                out++;
                total++;
                n++;
            }
            continue;
        }
        if (*p == 'c') {
            int c = va_arg(ap, int);
            if (dst && out + 1 < dst_size) dst[out] = (char)c;
            out++;
            total++;
            continue;
        }
        if (*p == 'u' || *p == 'd' || *p == 'i') {
            unsigned long long u = 0;
            int neg = 0;
            if (*p == 'u') {
                u = is_long ? (unsigned long long)va_arg(ap, unsigned long) : (unsigned long long)va_arg(ap, unsigned int);
            } else {
                long long v = is_long ? (long long)va_arg(ap, long) : (long long)va_arg(ap, int);
                if (v < 0) {
                    neg = 1;
                    u = (unsigned long long)(-v);
                } else {
                    u = (unsigned long long)v;
                }
            }
            char tmp[32];
            int t = 0;
            do {
                tmp[t++] = (char)('0' + (u % 10));
                u /= 10;
            } while (u && t < (int)sizeof(tmp));
            if (neg) {
                if (dst && out + 1 < dst_size) dst[out] = '-';
                out++;
                total++;
            }
            while (t-- > 0) {
                if (dst && out + 1 < dst_size) dst[out] = tmp[t];
                out++;
                total++;
            }
            continue;
        }
        if (dst && out + 1 < dst_size) dst[out] = '%';
        out++;
        total++;
        if (dst && out + 1 < dst_size) dst[out] = *p;
        out++;
        total++;
    }
    if (dst && dst_size) {
        size_t term = (out < dst_size) ? out : (dst_size - 1);
        dst[term] = 0;
    }
    return total;
}

static int TinySnprintf(char *dst, size_t dst_size, const char *fmt, ...) {
    va_list ap;
    int n;
    va_start(ap, fmt);
    n = TinyVsnprintf(dst, dst_size, fmt, ap);
    va_end(ap);
    return n;
}

static int TinySwprintf(wchar_t *dst, size_t dst_count, const wchar_t *fmt, ...) {
    size_t out = 0;
    int total = 0;
    va_list ap;
    va_start(ap, fmt);
    for (const wchar_t *p = fmt; p && *p; ++p) {
        if (*p != L'%') {
            if (dst && out + 1 < dst_count) dst[out] = *p;
            out++;
            total++;
            continue;
        }
        p++;
        if (!*p) break;
        if (*p == L'%') {
            if (dst && out + 1 < dst_count) dst[out] = L'%';
            out++;
            total++;
            continue;
        }
        if (*p == L'l' && p[1] == L's') {
            const wchar_t *s = va_arg(ap, const wchar_t *);
            int n = 0;
            if (!s) s = L"";
            p++;
            while (s[n]) {
                if (dst && out + 1 < dst_count) dst[out] = s[n];
                out++;
                total++;
                n++;
            }
            continue;
        }
        if (*p == L'd' || *p == L'i' || *p == L'u') {
            unsigned long long u = 0;
            int neg = 0;
            if (*p == L'u') {
                u = (unsigned long long)va_arg(ap, unsigned int);
            } else {
                long long v = (long long)va_arg(ap, int);
                if (v < 0) {
                    neg = 1;
                    u = (unsigned long long)(-v);
                } else {
                    u = (unsigned long long)v;
                }
            }
            wchar_t tmp[32];
            int t = 0;
            do {
                tmp[t++] = (wchar_t)(L'0' + (u % 10));
                u /= 10;
            } while (u && t < (int)(sizeof(tmp) / sizeof(tmp[0])));
            if (neg) {
                if (dst && out + 1 < dst_count) dst[out] = L'-';
                out++;
                total++;
            }
            while (t-- > 0) {
                if (dst && out + 1 < dst_count) dst[out] = tmp[t];
                out++;
                total++;
            }
            continue;
        }
        if (dst && out + 1 < dst_count) dst[out] = L'%';
        out++;
        total++;
        if (dst && out + 1 < dst_count) dst[out] = *p;
        out++;
        total++;
    }
    if (dst && dst_count) {
        size_t term = (out < dst_count) ? out : (dst_count - 1);
        dst[term] = 0;
    }
    va_end(ap);
    return total;
}

static int TinyToLowerA(int c) {
    return (c >= 'A' && c <= 'Z') ? (c + ('a' - 'A')) : c;
}

static wchar_t TinyToLowerW(wchar_t c) {
    return (c >= L'A' && c <= L'Z') ? (wchar_t)(c + (L'a' - L'A')) : c;
}

static int TinyStrnicmp(const char *a, const char *b, size_t n) {
    size_t i;
    if (!a) a = "";
    if (!b) b = "";
    for (i = 0; i < n; ++i) {
        int ca = TinyToLowerA((unsigned char)a[i]);
        int cb = TinyToLowerA((unsigned char)b[i]);
        if (ca != cb) return ca - cb;
        if (a[i] == 0) return 0;
    }
    return 0;
}

static int TinyStricmp(const char *a, const char *b) {
    size_t i = 0;
    if (!a) a = "";
    if (!b) b = "";
    for (;;) {
        int ca = TinyToLowerA((unsigned char)a[i]);
        int cb = TinyToLowerA((unsigned char)b[i]);
        if (ca != cb) return ca - cb;
        if (a[i] == 0) return 0;
        ++i;
    }
}

static int TinyWcsicmp(const wchar_t *a, const wchar_t *b) {
    size_t i = 0;
    if (!a) a = L"";
    if (!b) b = L"";
    for (;;) {
        wchar_t ca = TinyToLowerW(a[i]);
        wchar_t cb = TinyToLowerW(b[i]);
        if (ca != cb) return (int)ca - (int)cb;
        if (a[i] == 0) return 0;
        ++i;
    }
}

#define snprintf TinySnprintf
#define vsnprintf TinyVsnprintf
#define swprintf TinySwprintf
#define _stricmp TinyStricmp
#define _strnicmp TinyStrnicmp
#define _wcsicmp TinyWcsicmp

#define HOTKEY_SEND_SELECTED  1
#define HOTKEY_SEND_PROMPT2   4
#define HOTKEY_SET_TL         2
#define HOTKEY_SET_BR         3
#define HOTKEY_TOGGLE_VISIBLE 5
#define HOTKEY_OPACITY_UP     6
#define HOTKEY_OPACITY_DOWN   7
#define HOTKEY_OPEN_SETTINGS  8
#define HOTKEY_EXIT_APP       9
#define HOTKEY_CANCEL_REQ     10
#define HOTKEY_SEND_PROMPT3   11
#define HOTKEY_SCROLL_UP      12
#define HOTKEY_SCROLL_DOWN    13
#define HOTKEY_MODEL_ROUTE_BASE 100

#define ID_EDIT_PROMPT 401
#define ID_EDIT_PROMPT4 108
#define ID_EDIT_PROMPT5 109
#define ID_BTN_SAVE 1
#define ID_BTN_ASK 3
#define ID_BTN_RESET 4
#define ID_BTN_TAB_BASIC 360
#define ID_BTN_TAB_ADV 361
#define ID_CHK_DARK_THEME 304
#define ID_CHK_STREAM 305
#define ID_HKCAP_PREVIEW 710
#define ID_HKCAP_SAVE 711
#define ID_HKCAP_CANCEL 712

#define ID_LBL_ENDPOINT 900
#define ID_LBL_APIKEY 901
#define ID_LBL_MODEL 902
#define ID_LBL_SYSTEM 903
#define ID_LBL_TEMPLATE 904
#define ID_LBL_QUICK 905
#define ID_LBL_HOTKEYS 906
#define ID_LBL_SEND 908
#define ID_LBL_SETTL 909
#define ID_LBL_SETBR 910
#define ID_LBL_TOGGLEVIS 911
#define ID_LBL_OPP 912
#define ID_LBL_OPM 913
#define ID_LBL_OPENSET 914
#define ID_LBL_OPACITY 915
#define ID_LBL_THEME 916
#define ID_LBL_EXIT 917
#define ID_LBL_CANCEL 918
#define ID_LBL_SEND2 919
#define ID_LBL_SEND3 920
#define ID_LBL_PROMPT2 921
#define ID_LBL_PROMPT3 922
#define ID_LBL_RAG 923
#define ID_LBL_RAG_PATH 924
#define ID_LBL_MULTI 925
#define ID_LBL_PRIMARY_EP 926
#define ID_LBL_PRIMARY_KEY 927
#define ID_LBL_PRIMARY_MODEL 928
#define ID_LBL_REVIEWER 929
#define ID_LBL_SCROLLUP 930
#define ID_LBL_SCROLLDOWN 931
#define ID_LBL_MERGE1 932
#define ID_LBL_MERGE2 933
#define ID_LBL_MERGE3 934
#define ID_LBL_ROUTE_KIND 935
#define ID_LBL_ROUTE_SLOT 936
#define ID_LBL_ROUTE_EP 937
#define ID_LBL_ROUTE_KEY 938
#define ID_LBL_ROUTE_MODEL 939
#define ID_LBL_ROUTE_PROMPT 940
#define ID_LBL_PROMPT4 941
#define ID_LBL_PROMPT5 942
#define ID_LBL_SEND4 943
#define ID_LBL_SEND5 944
#define ID_LBL_IMAGE2 945
#define ID_LBL_IMAGE3 946

#define ID_CHK_RAG_ENABLED 306
#define ID_EDIT_RAG_PATH 307
#define ID_BTN_BROWSE_RAG 308
#define ID_CHK_MULTI_LLM 309
#define ID_EDIT_PRIMARY_EP 310
#define ID_EDIT_PRIMARY_KEY 311
#define ID_EDIT_PRIMARY_MODEL 312
#define ID_BTN_TEST_PRIMARY 313
#define ID_CMB_REVIEWER_SLOT 314
#define ID_BTN_ADD_REVIEWER 315
#define ID_BTN_REMOVE_REVIEWER 316
#define ID_EDIT_REVIEWER_EP 317
#define ID_EDIT_REVIEWER_KEY 318
#define ID_EDIT_REVIEWER_MODEL 319
#define ID_BTN_TEST_REVIEWER 320
#define ID_EDIT_SIDE_PROMPT1 321
#define ID_EDIT_SIDE_PROMPT2 322
#define ID_EDIT_SIDE_PROMPT3 323
#define ID_EDIT_MAIN_PROMPT1 324
#define ID_EDIT_MAIN_PROMPT2 325
#define ID_EDIT_MAIN_PROMPT3 326
#define ID_CMB_ROUTE_KIND 330
#define ID_CMB_ROUTE_SLOT 331
#define ID_EDIT_ROUTE_EP 332
#define ID_EDIT_ROUTE_KEY 333
#define ID_EDIT_ROUTE_MODEL 334
#define ID_EDIT_ROUTE_PROMPT 335
#define ID_BTN_TEST_ROUTE 336
#define ID_EDIT_ROUTE_HOTKEY 337
#define ID_BTN_ROUTE_ADD 338
#define ID_BTN_ROUTE_REMOVE 339
#define ID_BTN_API_AUTO 340
#define ID_BTN_ROUTE_API_AUTO 341

#define WM_APP_RESPONSE (WM_APP + 1)
#define WM_APP_TRAY (WM_APP + 2)
#define WM_APP_STREAM (WM_APP + 3)
#define TRAY_UID 9001

typedef struct AppConfig {
    char endpoint[512];
    char api_key[256];
    char model[128];
    char system_prompt[1024];
    char quick_prompt[2048];
    char prompt_2[1024];
    char prompt_3[1024];
    char prompt_4[1024];
    char prompt_5[1024];
    char user_template[2048];
    char route_prompt_endpoint[MAX_PROMPT_ROUTES][512];
    char route_prompt_api_key[MAX_PROMPT_ROUTES][256];
    char route_prompt_model[MAX_PROMPT_ROUTES][128];
    char route_prompt_text[MAX_PROMPT_ROUTES][1024];
    char route_image_endpoint[MAX_IMAGE_ROUTES][512];
    char route_image_api_key[MAX_IMAGE_ROUTES][256];
    char route_image_model[MAX_IMAGE_ROUTES][128];
    char route_image_prompt[MAX_IMAGE_ROUTES][1024];
    int model_route_count;
    int model_route_kind[MAX_MODEL_ROUTES];
    char model_route_endpoint[MAX_MODEL_ROUTES][512];
    char model_route_api_key[MAX_MODEL_ROUTES][256];
    char model_route_model[MAX_MODEL_ROUTES][128];
    char model_route_prompt[MAX_MODEL_ROUTES][1024];
    char model_route_hotkey[MAX_MODEL_ROUTES][64];
    int rag_enabled;
    char rag_source_path[1024];
    int ensemble_enabled;
    char ensemble_primary_endpoint[512];
    char ensemble_primary_api_key[256];
    char ensemble_primary_model[128];
    int ensemble_reviewer_count;
    char ensemble_reviewer_endpoint[MAX_REVIEW_MODELS][512];
    char ensemble_reviewer_api_key[MAX_REVIEW_MODELS][256];
    char ensemble_reviewer_model[MAX_REVIEW_MODELS][128];
    char ensemble_side_prompt[3][1024];
    char ensemble_main_prompt[3][1024];
    int overlay_enabled;
    int overlay_visible;
    int opacity;
    int theme_light;
    int stream;
    char hk_send[64];
    char hk_send2[64];
    char hk_send3[64];
    char hk_send4[64];
    char hk_send5[64];
    char hk_tl[64];
    char hk_br[64];
    char hk_img2[64];
    char hk_img3[64];
    char hk_toggle_enable[64];
    char hk_toggle_visible[64];
    char hk_opacity_up[64];
    char hk_opacity_down[64];
    char hk_scroll_up[64];
    char hk_scroll_down[64];
    char hk_open_settings[64];
    char hk_exit[64];
    char hk_cancel[64];
} AppConfig;

typedef struct LlmTargetConfig {
    char endpoint[512];
    char api_key[256];
    char model[128];
    int stream;
} LlmTargetConfig;

typedef struct RequestPayload {
    char *user_text;
    char region[128];
    char image_path[MAX_PATH];
    POINT anchor;
    int from_ask;
    int req_id;
    char system_prompt[1024];
    int use_target_override;
    LlmTargetConfig target;
    ULONGLONG start_ms;
} RequestPayload;

typedef struct RequestTiming {
    ULONGLONG api_start_ms;
    ULONGLONG send_done_ms;
    ULONGLONG recv_done_ms;
    ULONGLONG first_byte_ms;
    ULONGLONG read_done_ms;
    ULONGLONG done_ms;
    ULONGLONG bytes_read;
    ULONGLONG request_body_bytes;
    ULONGLONG input_text_bytes;
    int call_count;
    int chunk_preview_count;
    int chunk_preview_len;
    char chunk_preview[2048];
} RequestTiming;

typedef struct ResponsePayload {
    char *text;
    POINT anchor;
    int from_ask;
    int req_id;
} ResponsePayload;

typedef struct StreamPayload {
    char *text;
    POINT anchor;
    int req_id;
} StreamPayload;

typedef enum ProviderKind {
    PROVIDER_OPENAI_COMPAT = 0,
    PROVIDER_GOOGLE_GEMINI = 1,
    PROVIDER_ANTHROPIC = 2
} ProviderKind;

typedef struct ProviderRequestInfo {
    ProviderKind kind;
    int use_stream;
    char endpoint[512];
} ProviderRequestInfo;

static AppConfig g_cfg;
static HWND g_hwnd_main = NULL;
static HWND g_hwnd_overlay = NULL;
static HWND g_hwnd_capture = NULL;
static HWND g_hwnd_settings = NULL;
static char g_overlay_text[262144];
static wchar_t g_overlay_text_w[262144];
static char g_config_path[MAX_PATH] = CONFIG_FILE;
static int g_have_tl = 0;
static int g_have_br = 0;
static POINT g_tl = {0};
static POINT g_br = {0};
static int g_capture_active = 0;
static POINT g_capture_anchor = {0};
static POINT g_capture_current = {0};
static ULONGLONG g_capture_deadline = 0;
static char g_last_capture_path[MAX_PATH] = "";
static int g_tray_added = 0;
static int g_show_advanced = 0;
static int g_ask_inflight = 0;
static HANDLE g_singleton_mutex = NULL;
static int g_req_inflight = 0;
static int g_stream_has_output = 0;
static POINT g_wait_anchor = {0};
static int g_wait_dots = 1;
static char g_wait_prefix[2048] = "";
static int g_loading_controls = 0;
static int g_reviewer_edit_index = 0;
static HWND g_hwnd_hotkey_capture = NULL;
static HWND g_hwnd_hotkey_capture_owner = NULL;
static int g_hotkey_capture_target_id = 0;
static char g_hotkey_capture_value[64] = "";
static volatile LONG g_request_seq = 0;
static int g_active_request_id = -1;
static HINTERNET g_active_hrequest = NULL;
static CRITICAL_SECTION g_req_cs;
static ULONG_PTR g_gdiplus_token = 0;
static int g_overlay_scroll_px = 0;
static int g_overlay_content_height = 0;
static int g_settings_dirty = 0;

static void LoadConfig(AppConfig *cfg);
static void SaveConfig(const AppConfig *cfg);
static void SaveBasicConfig(const AppConfig *cfg);
static void SaveAdvancedConfig(const AppConfig *cfg);
static void RegisterHotkeys(HWND hwnd, const AppConfig *cfg);
static void UnregisterHotkeys(HWND hwnd);
static int ParseHotkey(const char *text, UINT *mod, UINT *vk);
static void EnsureOverlayWindow(HWND hwnd_parent);
static void ShowOverlayText(const char *text, POINT anchor);
static void HideOverlay(void);
static void EnsureCaptureWindow(HWND hwnd_parent);
static void StartCaptureSelection(POINT anchor);
static void CancelCaptureSelection(void);
static int ConfirmCaptureSelection(POINT cursor, char *path, int path_size);
static char *GetSelectedText(void);
static DWORD WINAPI RequestThread(LPVOID param);
static char *SendLLMRequest(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, RequestTiming *timing);
static char *SendLLMRequestForTarget(const char *user_text, const char *region, const char *image_path, const char *system_prompt, int req_id, const LlmTargetConfig *target, RequestTiming *timing);
static char *ExtractDeltaContent(const char *json);
static void StripThinkBlocks(char *text);
static char *BuildUserMessage(const char *user_text, const char *region);
static void StartRequestEx(const char *text, const char *region, const char *image_path, POINT anchor, int from_ask, const char *system_prompt);
static void StartRequest(const char *text, const char *region, const char *image_path, POINT anchor, const char *system_prompt);
static void CancelCurrentRequest(const char *reason, POINT anchor);
static void InitConfigPath(void);
static ProviderKind DetectProviderKind(const char *endpoint, const char *api_key);
static void ResolveProviderRequestInfo(ProviderRequestInfo *info, const char *endpoint, const char *api_key, const char *model, int stream_enabled);
static char *ExtractProviderText(const ProviderRequestInfo *info, const char *json);
static void CreateSettingsWindow(HWND owner);
static void ApplyConfigToSettingsControls(HWND hwnd, const AppConfig *cfg);
static int IsHotkeyButtonId(int id);
static const char *HotkeyIdName(int id);
static int ValidateHotkeyControls(HWND hwnd, int changing_id, const char *new_value, char *err, int err_size);
static void OpenHotkeyCaptureDialog(HWND owner, int target_id);
static LRESULT CALLBACK HotkeyCaptureProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam);
static char *DupPrintf(const char *fmt, ...);
static void NormalizeEndpoint(char *s);
static void NormalizeFriendlyEndpointAlias(char *s, int s_size);
static void AddTrayIcon(HWND hwnd);
static void RemoveTrayIcon(HWND hwnd);
static void SetDlgItemTextUtf8(HWND hwnd, int id, const char *utf8);
static void GetDlgItemTextUtf8(HWND hwnd, int id, char *out, int out_size);
static void SetAdvancedVisible(HWND hwnd, int show);
static void BuildSettingsLayout(HWND hwnd);
static void RebuildPageControls(HWND hwnd);
static void CreateBasicPageControls(HWND hwnd);
static void CreateAdvancedPageControls(HWND hwnd);
static void ApplyRuntimeHotkeysFromControls(HWND hwnd);
static void ApplyRuntimeConfigFromControls(HWND hwnd);
static void SyncSettingsUiFromRuntime(void);
static void ShowCachedOverlayAt(POINT anchor);
static void ScrollOverlayByStep(int direction);
static int StepOpacityTier(int current, int direction);
static void MoveCtrl(HWND hwnd, int id, int x, int y, int w, int h);
static void ReleaseModifierKeys(void);
static int HasVisibleText(const char *s);
static void ShowWaitingOverlay(POINT anchor);
static void UpdateRagControlsEnabled(HWND hwnd);
static void BrowseRagSourcePath(HWND hwnd);
static void UpdateMultiLlmControls(HWND hwnd);
static void LoadReviewerEditor(HWND hwnd, int index);
static void SaveReviewerEditor(HWND hwnd, int index);
static void RefreshReviewerSlotCombo(HWND hwnd, int select_index);
static void StartRequestExTarget(const char *text, const char *region, const char *image_path, POINT anchor, int from_ask, const char *system_prompt, const LlmTargetConfig *target);
static void TriggerModelRouteAt(int route_index, POINT cursor);

static int ResolveRouteTargetConfig(int route_index, LlmTargetConfig *out_target) {
    if (!out_target) return 0;
    memset(out_target, 0, sizeof(*out_target));
    if (route_index >= 0 && route_index < MAX_PROMPT_ROUTES) {
        const char *ep = g_cfg.route_prompt_endpoint[route_index];
        const char *key = g_cfg.route_prompt_api_key[route_index];
        const char *model = g_cfg.route_prompt_model[route_index];
        if (!ep[0] || !model[0]) return 0;
        strncpy(out_target->endpoint, ep, sizeof(out_target->endpoint) - 1);
        strncpy(out_target->api_key, key, sizeof(out_target->api_key) - 1);
        strncpy(out_target->model, model, sizeof(out_target->model) - 1);
        out_target->stream = g_cfg.stream;
        return 1;
    }
    if (route_index >= 100 && route_index < 100 + MAX_IMAGE_ROUTES) {
        int idx = route_index - 100;
        if (!g_cfg.route_image_endpoint[idx][0] || !g_cfg.route_image_model[idx][0]) return 0;
        strncpy(out_target->endpoint, g_cfg.route_image_endpoint[idx], sizeof(out_target->endpoint) - 1);
        strncpy(out_target->api_key, g_cfg.route_image_api_key[idx], sizeof(out_target->api_key) - 1);
        strncpy(out_target->model, g_cfg.route_image_model[idx], sizeof(out_target->model) - 1);
        out_target->stream = g_cfg.stream;
        return 1;
    }
    return 0;
}

static const char *ResolveRoutePromptText(int route_index) {
    if (route_index >= 0 && route_index < MAX_PROMPT_ROUTES && g_cfg.route_prompt_text[route_index][0]) {
        return g_cfg.route_prompt_text[route_index];
    }
    if (route_index == 0) return g_cfg.system_prompt;
    if (route_index == 1 && g_cfg.prompt_2[0]) return g_cfg.prompt_2;
    if (route_index == 2 && g_cfg.prompt_3[0]) return g_cfg.prompt_3;
    if (route_index == 3 && g_cfg.prompt_4[0]) return g_cfg.prompt_4;
    if (route_index == 4 && g_cfg.prompt_5[0]) return g_cfg.prompt_5;
    return g_cfg.system_prompt;
}

static const char *ResolveImageRoutePromptText(int image_index) {
    if (image_index >= 0 && image_index < MAX_IMAGE_ROUTES && g_cfg.route_image_prompt[image_index][0]) {
        return g_cfg.route_image_prompt[image_index];
    }
    return g_cfg.system_prompt;
}

static void TriggerModelRouteAt(int route_index, POINT cursor) {
    LlmTargetConfig route_target;
    const char *route_prompt;
    if (route_index < 0 || route_index >= g_cfg.model_route_count) return;
    if (!g_cfg.model_route_endpoint[route_index][0] || !g_cfg.model_route_model[route_index][0]) return;

    memset(&route_target, 0, sizeof(route_target));
    strncpy(route_target.endpoint, g_cfg.model_route_endpoint[route_index], sizeof(route_target.endpoint) - 1);
    strncpy(route_target.api_key, g_cfg.model_route_api_key[route_index], sizeof(route_target.api_key) - 1);
    strncpy(route_target.model, g_cfg.model_route_model[route_index], sizeof(route_target.model) - 1);
    route_target.stream = g_cfg.stream;
    route_prompt = g_cfg.model_route_prompt[route_index][0] ? g_cfg.model_route_prompt[route_index] : g_cfg.system_prompt;

    if (g_cfg.model_route_kind[route_index] == 1) {
        char saved_path[MAX_PATH];
        if (ConfirmCaptureSelection(cursor, saved_path, sizeof(saved_path))) {
            g_wait_prefix[0] = 0;
            StartRequestExTarget("", "", saved_path, cursor, 0, route_prompt, &route_target);
        }
        return;
    }

    if (g_req_inflight) {
        ShowOverlayText("Request in progress. Please wait...", cursor);
        return;
    }
    char *text = GetSelectedText();
    if (HasVisibleText(text)) {
        g_wait_prefix[0] = 0;
        StartRequestExTarget(text, "", "", cursor, 0, route_prompt, &route_target);
    } else {
        g_wait_prefix[0] = 0;
            if (!HasVisibleText(g_overlay_text)) {
                ShowOverlayText(k_msg_no_selected_text, cursor);
            }
    }
    free(text);
}

// config helpers split into module file
#include "modules/config_module.inc.c"
// provider detection/alias/body parsing split into module file
#include "modules/provider_module.inc.c"

// hotkey parsing/format/registration split into module file
#include "modules/hotkey_module.inc.c"
// input/clipboard/waiting helpers split into module file
#include "modules/input_utils_module.inc.c"
// overlay drawing/window split into module file
#include "modules/overlay_module.inc.c"
// region capture overlay/saving split into module file
#include "modules/capture_module.inc.c"
// settings UI and dialogs split into module file
#include "modules/ui_settings_module.inc.c"
// LLM request/build/streaming split into module file
#include "modules/llm_request_module.inc.c"

static LRESULT CALLBACK MainProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    switch (msg) {
    case WM_CREATE:
        InitConfigPath();
        LoadConfig(&g_cfg);
        g_settings_dirty = 0;
        RegisterHotkeys(hwnd, &g_cfg);
        CreateSettingsWindow(hwnd);
        SetWindowTextW(g_hwnd_settings, L"Helper");
        SetWindowTextW(g_hwnd_main, L"Helper");
        return 0;
    case WM_HOTKEY: {
        POINT cursor;
        GetCursorPos(&cursor);
        switch (wparam) {
        case HOTKEY_SEND_SELECTED: {
            if (g_req_inflight) {
                ShowOverlayText("Request in progress. Please wait...", cursor);
                break;
            }
            char *text = GetSelectedText();
            if (HasVisibleText(text)) {
                LlmTargetConfig route_target;
                g_wait_prefix[0] = 0;
                if (ResolveRouteTargetConfig(0, &route_target)) {
                    StartRequestExTarget(text, "", "", cursor, 0, ResolveRoutePromptText(0), &route_target);
                } else {
                    StartRequest(text, "", "", cursor, ResolveRoutePromptText(0));
                }
            } else {
                g_wait_prefix[0] = 0;
                    if (!HasVisibleText(g_overlay_text)) {
                        ShowOverlayText(k_msg_no_selected_text, cursor);
                    }
            }
            free(text);
            break;
        }
        case HOTKEY_SET_TL:
            StartCaptureSelection(cursor);
            break;
        case HOTKEY_SET_BR: {
            char saved_path[MAX_PATH];
            if (ConfirmCaptureSelection(cursor, saved_path, sizeof(saved_path))) {
                LlmTargetConfig route_target;
                g_wait_prefix[0] = 0;
                if (ResolveRouteTargetConfig(100, &route_target)) {
                    StartRequestExTarget("", "", saved_path, cursor, 0, ResolveImageRoutePromptText(0), &route_target);
                } else {
                    StartRequest("", "", saved_path, cursor, ResolveImageRoutePromptText(0));
                }
            }
            break;
        }
        case HOTKEY_TOGGLE_VISIBLE:
            g_cfg.overlay_visible = !g_cfg.overlay_visible;
            if (!g_cfg.overlay_visible) {
                HideOverlay();
            } else {
                g_wait_anchor = cursor;
                ShowCachedOverlayAt(cursor);
            }
            SyncSettingsUiFromRuntime();
            break;
        case HOTKEY_OPACITY_UP:
            g_cfg.opacity = StepOpacityTier(g_cfg.opacity, +1);
            if (g_hwnd_overlay) {
                SetLayeredWindowAttributes(g_hwnd_overlay, 0, (BYTE)g_cfg.opacity, LWA_ALPHA);
                InvalidateRect(g_hwnd_overlay, NULL, TRUE);
            }
            SyncSettingsUiFromRuntime();
            break;
        case HOTKEY_OPACITY_DOWN:
            g_cfg.opacity = StepOpacityTier(g_cfg.opacity, -1);
            if (g_hwnd_overlay) {
                SetLayeredWindowAttributes(g_hwnd_overlay, 0, (BYTE)g_cfg.opacity, LWA_ALPHA);
                InvalidateRect(g_hwnd_overlay, NULL, TRUE);
            }
            SyncSettingsUiFromRuntime();
            break;
        case HOTKEY_SCROLL_UP:
            ScrollOverlayByStep(-1);
            break;
        case HOTKEY_SCROLL_DOWN:
            ScrollOverlayByStep(+1);
            break;
        case HOTKEY_OPEN_SETTINGS:
            if (!g_hwnd_settings) break;
            if (IsWindowVisible(g_hwnd_settings)) {
                ShowWindow(g_hwnd_settings, SW_HIDE);
            } else {
                ShowWindow(g_hwnd_settings, SW_SHOW);
                ShowWindow(g_hwnd_settings, SW_RESTORE);
                SetForegroundWindow(g_hwnd_settings);
            }
            break;
        case HOTKEY_EXIT_APP:
            DestroyWindow(g_hwnd_main);
            break;
        case HOTKEY_CANCEL_REQ:
            CancelCurrentRequest("Request canceled.", cursor);
            break;
        default:
            if ((int)wparam >= HOTKEY_MODEL_ROUTE_BASE &&
                (int)wparam < HOTKEY_MODEL_ROUTE_BASE + MAX_MODEL_ROUTES) {
                TriggerModelRouteAt((int)wparam - HOTKEY_MODEL_ROUTE_BASE, cursor);
            }
            break;
        }
        return 0;
    }
    case WM_TIMER:
        if (wparam == 1 && g_req_inflight && !g_stream_has_output) {
            ShowWaitingOverlay(g_wait_anchor);
            g_wait_dots++;
            if (g_wait_dots > 3) g_wait_dots = 1;
            return 0;
        }
        if (wparam == 2 && g_capture_active) {
            POINT cursor;
            ULONGLONG now = GetTickCount64();
            GetCursorPos(&cursor);
            if (cursor.x != g_capture_current.x || cursor.y != g_capture_current.y) {
                g_capture_current = cursor;
                g_capture_deadline = now + 2000;
                if (g_hwnd_capture) InvalidateRect(g_hwnd_capture, NULL, TRUE);
            } else if (now >= g_capture_deadline) {
                CancelCaptureSelection();
            } else if (g_hwnd_capture) {
                InvalidateRect(g_hwnd_capture, NULL, TRUE);
            }
            return 0;
        }
        break;
    case WM_APP_STREAM: {
        StreamPayload *sp = (StreamPayload *)lparam;
        if (sp) {
            if (sp->req_id != g_active_request_id) {
                free(sp->text);
                free(sp);
                return 0;
            }
            if (sp->text && sp->text[0]) {
                g_stream_has_output = 1;
                ShowOverlayText(sp->text, g_wait_anchor);
            }
            free(sp->text);
            free(sp);
        }
        return 0;
    }
    case WM_APP_RESPONSE: {
        ResponsePayload *resp = (ResponsePayload *)lparam;
        if (!resp) return 0;
        if (resp->req_id != g_active_request_id) {
            free(resp->text);
            free(resp);
            return 0;
        }
        KillTimer(hwnd, 1);
        g_req_inflight = 0;
        g_wait_prefix[0] = 0;
        g_active_request_id = -1;
        if (resp && resp->text) {
            ShowOverlayText(resp->text, g_wait_anchor);
            if (resp->from_ask && g_hwnd_settings) {
                g_ask_inflight = 0;
                SetWindowTextA(GetDlgItem(g_hwnd_settings, ID_BTN_ASK), "Ask");
                EnableWindow(GetDlgItem(g_hwnd_settings, ID_BTN_ASK),
                             GetWindowTextLengthA(GetDlgItem(g_hwnd_settings, ID_EDIT_PROMPT)) > 0);
            }
            free(resp->text);
            free(resp);
        }
        return 0;
    }
    case WM_DESTROY:
        CancelCurrentRequest("", g_wait_anchor);
        CancelCaptureSelection();
        UnregisterHotkeys(hwnd);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wparam, lparam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrev, LPSTR lpCmdLine, int nCmdShow) {
    Gdiplus::GdiplusStartupInput gdiplus_input;
    HRESULT coinit_hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    g_singleton_mutex = CreateMutexA(NULL, TRUE, "LLMOverlayHelperSingleton");
    if (g_singleton_mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        MessageBoxA(NULL, "Helper is already running.", "Helper", MB_OK | MB_ICONINFORMATION);
        if (SUCCEEDED(coinit_hr)) CoUninitialize();
        CloseHandle(g_singleton_mutex);
        return 0;
    }
    if (Gdiplus::GdiplusStartup(&g_gdiplus_token, &gdiplus_input, NULL) != Gdiplus::Ok) {
        MessageBoxA(NULL, "Failed to initialize GDI+.", "Helper", MB_OK | MB_ICONERROR);
        if (g_singleton_mutex) {
            ReleaseMutex(g_singleton_mutex);
            CloseHandle(g_singleton_mutex);
            g_singleton_mutex = NULL;
        }
        if (SUCCEEDED(coinit_hr)) CoUninitialize();
        return 0;
    }

    InitializeCriticalSection(&g_req_cs);

    WNDCLASSW wc;
    ZeroMemory(&wc, sizeof(wc));
    wc.lpfnWndProc = MainProc;
    wc.hInstance = hInstance;
    wc.lpszClassName = L"LLMOverlayMainW";
    RegisterClassW(&wc);
    g_hwnd_main = CreateWindowW(wc.lpszClassName, L"HelperCore", 0,
                                0, 0, 0, 0,
                                HWND_MESSAGE, NULL, hInstance, NULL);
    ShowWindow(g_hwnd_settings, SW_SHOW);

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    if (g_singleton_mutex) {
        ReleaseMutex(g_singleton_mutex);
        CloseHandle(g_singleton_mutex);
        g_singleton_mutex = NULL;
    }
    if (g_gdiplus_token) {
        Gdiplus::GdiplusShutdown(g_gdiplus_token);
        g_gdiplus_token = 0;
    }
    if (SUCCEEDED(coinit_hr)) {
        CoUninitialize();
    }
    DeleteCriticalSection(&g_req_cs);
    return 0;
}
