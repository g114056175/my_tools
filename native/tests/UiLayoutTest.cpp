#define wWinMain VoiceCaptureMain
#include "../src/Main.cpp"

#include <iostream>
#include <stdexcept>
#include <fstream>
#include <atomic>

namespace {

void check(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

struct TestWindow {
    HWND hwnd = nullptr;
    App app;
};

bool overlaps(const R& a, const R& b) {
    return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

void checkTimeRoundtrip() {
    for (double value : {0.001, 1.234, 59.999, 60.001, 123.456}) {
        double parsed = 0;
        check(parseTime(timeText(value), parsed), "time text did not parse");
        check(std::abs(parsed - value) < .011, "time text roundtrip drifted");
    }
    double sampleExact = 12345.0 / 44100.0, parsed = 0;
    check(parseTime(timeText(sampleExact), parsed), "sample time did not parse");
    check(std::abs(parsed - sampleExact) < .011, "sample position was rounded unexpectedly");
}

int nextDialogResult=IDCANCEL, dialogCount=0;
std::wstring lastDialogTitle;
LRESULT CALLBACK dialogHook(int code, WPARAM w, LPARAM l) {
    if (code == HCBT_ACTIVATE && IsWindow((HWND)w)) {
        wchar_t cls[32]{}; GetClassNameW((HWND)w, cls, 32);
        if (std::wstring(cls) == L"#32770") {
            wchar_t title[256]{};GetWindowTextW((HWND)w,title,256);lastDialogTitle=title;
            ++dialogCount;PostMessageW((HWND)w, WM_COMMAND, nextDialogResult, 0);
        }
    }
    return CallNextHookEx(nullptr, code, w, l);
}
struct DialogResponder {
    HHOOK hook=SetWindowsHookExW(WH_CBT,dialogHook,nullptr,GetCurrentThreadId());
    DialogResponder(){check(hook!=nullptr,"could not install confirmation hook");}
    ~DialogResponder(){UnhookWindowsHookEx(hook);}
};
std::vector<char> readBytes(const std::filesystem::path& path){
    std::ifstream in(path,std::ios::binary);check(bool(in),"cannot read test file");
    return {std::istreambuf_iterator<char>(in),std::istreambuf_iterator<char>()};
}

void writeWave(const std::filesystem::path& path) {
    const uint32_t dataBytes = 88200u * 2u * 2u;
    std::ofstream out(path, std::ios::binary);
    auto u16=[&](uint16_t v){out.put(char(v));out.put(char(v>>8));};
    auto u32=[&](uint32_t v){for(int i=0;i<4;i++)out.put(char(v>>(8*i)));};
    out.write("RIFF",4);u32(36+dataBytes);out.write("WAVEfmt ",8);u32(16);u16(1);u16(2);u32(44100);u32(176400);u16(4);u16(16);out.write("data",4);u32(dataBytes);
    for(uint32_t i=0;i<88200;i++){int16_t l=int16_t((i%1000)-500),r=int16_t(500-(i%1000));u16(uint16_t(l));u16(uint16_t(r));}
}

R childRect(HWND parent, HWND child) {
    RECT r{};
    check(GetWindowRect(child, &r) != FALSE, "GetWindowRect failed");
    POINT p{r.left, r.top};
    ScreenToClient(parent, &p);
    return box(p.x, p.y, r.right - r.left, r.bottom - r.top);
}

void checkDisjoint(const std::vector<R>& rects, const char* message) {
    for (size_t i = 0; i < rects.size(); ++i)
        for (size_t j = i + 1; j < rects.size(); ++j)
            check(!overlaps(rects[i], rects[j]), message);
}

struct AppLayoutTest {
static void checkButtons(const App& app) {
    for (size_t i = 0; i < app.buttons_.size(); ++i) {
        const auto& a = app.buttons_[i];
        if (!a.enabled) continue;
        check(a.rect.l >= 0 && a.rect.t >= 0 && a.rect.r <= app.W_ && a.rect.b <= app.H_,
              "enabled button leaves client area");
        for (size_t j = i + 1; j < app.buttons_.size(); ++j) {
            const auto& b = app.buttons_[j];
            if (b.enabled) check(!overlaps(a.rect, b.rect), "enabled buttons overlap");
        }
    }
}

static void checkControls(const TestWindow& window) {
    const App& app = window.app;
    std::vector<R> visible;
    for (HWND child : {app.startEdit_, app.endEdit_, app.gainEdit_, app.format_, app.quality_}) {
        if (!child || !(GetWindowLongPtrW(child, GWL_STYLE) & WS_VISIBLE)) continue;
        R r = childRect(window.hwnd, child);
        check(r.l >= 0 && r.t >= 0 && r.r <= app.W_ && r.b <= app.H_,
              "visible control leaves client area");
        visible.push_back(r);
    }
    checkDisjoint(visible, "visible child controls overlap");
    for(const auto& r:visible)for(const auto& b:app.buttons_)
        check(!overlaps(r,b.rect),"child control overlaps button");
    if(app.trim_){
        std::vector<R> labels{box(330,app.card_.b+20,38,27),box(486,app.card_.b+20,38,27),
            box(638,app.card_.b+20,app.W_-658,27),box(104,app.trimRow_.t,48,29),box(app.W_-225,app.trimRow_.t,205,29)};
        for(const auto& labelRect:labels)for(const auto& r:visible)
            check(!overlaps(labelRect,r),"label overlaps child control");
    }
}

static void checkSize(TestWindow& window, int width, int height, bool editing) {
    SetWindowPos(window.hwnd, nullptr, 0, 0, width, height,
                 SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    check(window.app.W_ == width && window.app.H_ == height, "client size was not applied");
    window.app.trim_ = editing;
    window.app.layout();
    checkButtons(window.app);
    checkControls(window);
    check(window.app.playRect_.l >= 0 && window.app.playRect_.b <= height,
          "play control leaves client area");
    R timeLabel = box(window.app.W_ - 225, editing ? window.app.trimRow_.t : window.app.card_.b + 17,
                      205, editing ? 29 : 34);
    check(timeLabel.l >= 0 && timeLabel.t >= 0 && timeLabel.r <= window.app.W_ && timeLabel.b <= window.app.H_,
          "playback time label leaves client area");
    std::vector<R> labels{timeLabel};
    if (editing) labels.push_back(box(638, window.app.card_.b + 20, window.app.W_ - 658, 27));
    checkDisjoint(labels, "time labels overlap");
    for (const auto& b : window.app.buttons_) if (b.enabled)
        for (const auto& labelRect : labels) check(!overlaps(b.rect, labelRect), "button overlaps time label");
    if (editing) {
        for (const wchar_t* key : {L"keepEdit", L"cancelTrim", L"remove", L"mute", L"confirmTrim", L"gain"}) {
            bool found = false;
            for (const auto& b : window.app.buttons_) if (b.key == key && b.enabled) found = true;
            check(found, "editing control is missing");
        }
    }
}

static void checkNavToggle(TestWindow& window, bool editing) {
    window.app.trim_ = editing;
    window.app.setView(0, window.app.duration_); window.app.layout();
    R full = window.app.waveRect_;
    check(!window.app.navVisible_, "navigator should be hidden at full view");
    window.app.setView(30, 20); window.app.layout();
    check(window.app.navVisible_, "navigator should be visible when zoomed");
    check(window.app.waveRect_.l == full.l && window.app.waveRect_.t == full.t &&
          window.app.waveRect_.r == full.r && window.app.waveRect_.b == full.b,
          "wave rectangle moved when navigator visibility changed");
    check(window.app.navRect_.h() == 11, "navigator height is not 11px");
    int plotBottom = window.app.waveRect_.t + std::max(30, window.app.waveRect_.h() - 30);
    check(plotBottom + 24 <= window.app.navRect_.t, "ruler overlaps navigator");
}

static void pump(TestWindow& window) {
    const ULONGLONG deadline = GetTickCount64() + 10000;
    MSG msg{};
    while (window.app.busy_ && GetTickCount64() < deadline) {
        if (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg); DispatchMessageW(&msg);
        } else Sleep(2);
    }
    check(!window.app.busy_, "audio edit job exceeded 10 seconds");
}

static void integration(TestWindow& window, const std::filesystem::path& scratch) {
    const auto source = scratch / L"source.wav";
    writeWave(source);
    window.app.temp_ = source.wstring();
    window.app.loadWave(L"test");
    const auto original = readBytes(source);
    DialogResponder responder;
    window.app.click(L"trim"); pump(window);
    check(window.app.trim_&&window.app.editSession_.active(), "trim did not enter edit session");
    check(dialogCount==0,"entering editor requested confirmation");
    auto range=[&](double first,double last){window.app.selectionStart_=first;window.app.selectionEnd_=last;window.app.updateEdits();};
    const double exact=12345.0/44100.0;
    range(exact,1.0);check(window.app.updateSelection(),"displayed time not accepted");
    check(window.app.selectionStart_==exact,"display rounding changed sample-accurate selection");
    for(const wchar_t* bad:{L"invalid",L"01:60",L"nan",L"-1",L"1:2:3"}){
        double parsed=0;check(!parseTime(bad,parsed),"invalid time accepted");
    }
    SetWindowTextW(window.app.startEdit_,L"invalid");
    window.app.click(L"mute");check(!window.app.busy_,"invalid time started an edit");
    check(readBytes(source)==original,"invalid time changed source");
    auto apply=[&](const wchar_t* action,double first,double last){
        range(first,last);int before=dialogCount;
        window.app.click(action); pump(window);
        check(window.app.trim_&&window.app.editSession_.active(),"edit action ended session");
        check(window.app.jobError_.empty(),"edit job failed");
        check(dialogCount==before,"individual edit requested confirmation");
        check(readBytes(source)==original,"source WAV bytes changed during draft edit");
    };
    apply(L"mute",.25,.75);
    SetWindowTextW(window.app.gainEdit_,L"+3");apply(L"gain",.9,1.2);
    apply(L"remove",.4,.6);apply(L"confirmTrim",.2,1.4);
    const auto discardedDraft=readBytes(window.app.editSession_.path());
    check(discardedDraft!=original,"edit actions did not change the draft");
    for(const wchar_t* key:{L"keepEdit",L"cancelTrim"}){
        nextDialogResult=IDCANCEL;int before=dialogCount;window.app.click(key);
        check(dialogCount==before+1,"exit edit did not ask for confirmation");
        check(window.app.trim_&&window.app.editSession_.active(),"declining confirmation ended session");
        check(readBytes(window.app.editSession_.path())==discardedDraft,"declining confirmation changed draft");
        check(readBytes(source)==original,"declining confirmation changed original");
    }
    int before=dialogCount;SendMessageW(window.hwnd,WM_CLOSE,0,0);
    check(dialogCount==before+1&&IsWindow(window.hwnd)&&window.app.trim_,"close did not respect declined cancel confirmation");
    nextDialogResult=IDOK;before=dialogCount;window.app.click(L"cancelTrim");
    check(dialogCount==before+1&&lastDialogTitle==L"取消編輯","cancel confirmation missing");
    check(!window.app.trim_&&!window.app.editSession_.active(),"confirmed cancel did not end session");
    check(readBytes(source)==original,"confirmed cancel changed original bytes");
    check(window.app.duration_==2.0,"cancel did not restore original duration");

    nextDialogResult=IDCANCEL;window.app.click(L"trim");before=dialogCount;
    SendMessageW(window.hwnd,WM_CLOSE,0,0);pump(window);
    check(dialogCount==before+1&&IsWindow(window.hwnd)&&window.app.trim_,"close during pending edit bypassed confirmation");
    apply(L"confirmTrim",.2,1.6);SetWindowTextW(window.app.gainEdit_,L"-3");apply(L"gain",.3,.8);
    const auto keptDraft=readBytes(window.app.editSession_.path());
    range(.1,.2);nextDialogResult=IDOK;before=dialogCount;window.app.click(L"keepEdit");
    check(dialogCount==before+1&&lastDialogTitle==L"保留編輯","keep confirmation missing");
    check(!window.app.trim_&&!window.app.editSession_.active(),"confirmed keep did not end session");
    check(readBytes(source)==keptDraft,"keep did not save the complete draft");
    check(std::abs(window.app.duration_-1.4)<.0001,"keep saved the selection instead of complete edited audio");
}

    static void run() {
        checkTimeRoundtrip();
        auto scratch = std::filesystem::temp_directory_path() /
                       (L"VoiceCaptureLayoutTest-" + std::to_wstring(GetCurrentProcessId()));
        std::error_code ec;
        scratch = std::filesystem::temp_directory_path() /
                  (L"VoiceCaptureLayoutTest-" + std::to_wstring(GetTickCount64()));
        std::filesystem::create_directories(scratch);
        TestWindow window;
        window.app.temp_ = (scratch / L"capture.wav").wstring();
        window.app.dpi_ = 1;
        HINSTANCE instance = GetModuleHandleW(nullptr);
        WNDCLASSW klass{}; klass.hInstance = instance; klass.lpfnWndProc = App::proc;
        klass.lpszClassName = L"VoiceCaptureLayoutTestWindow";
        klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        RegisterClassW(&klass);
        window.hwnd = CreateWindowExW(0, klass.lpszClassName, L"VoiceCapture layout test",
                                      WS_POPUP, 0, 0, 780, 470, nullptr, nullptr,
                                      instance, &window.app);
        check(window.hwnd != nullptr, "CreateWindowExW failed");
        ShowWindow(window.hwnd, SW_HIDE); UpdateWindow(window.hwnd);
        window.app.duration_ = 120; window.app.viewStart_ = 0; window.app.viewLength_ = 120;
        window.app.selectionStart_ = 0; window.app.selectionEnd_ = 120; window.app.position_ = 0;
        window.app.peaks_.assign(256, .75f); window.app.peakMax_ = 1; window.app.layout();

        integration(window, scratch);
        window.app.duration_ = 120; window.app.viewStart_ = 0; window.app.viewLength_ = 120;
        window.app.selectionStart_ = 0; window.app.selectionEnd_ = 120; window.app.position_ = 0;
        window.app.peaks_.assign(256, .75f); window.app.peakMax_ = 1; window.app.layout();

        for (auto size : {std::pair{780, 470}, std::pair{920, 480}, std::pair{1280, 760}}) {
            checkSize(window, size.first, size.second, false);
            checkNavToggle(window, false);
            checkSize(window, size.first, size.second, true);
            checkNavToggle(window, true);
        }

        window.app.trim_ = false;
        window.app.setView(0, window.app.duration_);
        window.app.layout();
        R waveFull = window.app.waveRect_;
        check(!window.app.navVisible_, "navigator should be hidden at full view");
        window.app.setView(30, 20);
        window.app.layout();
        check(window.app.navVisible_, "navigator should be visible when zoomed");
        check(window.app.waveRect_.l == waveFull.l && window.app.waveRect_.t == waveFull.t &&
              window.app.waveRect_.r == waveFull.r && window.app.waveRect_.b == waveFull.b,
              "wave rectangle moved when navigator visibility changed");
        check(window.app.navRect_.h() == 11, "navigator height is not 11px");
        int plotBottom = window.app.waveRect_.t + std::max(30, window.app.waveRect_.h() - 30);
        check(plotBottom + 24 <= window.app.navRect_.t, "ruler overlaps navigator");

        window.app.setView(30, 20);
        window.app.layout();
        double start = window.app.viewStart_, length = window.app.viewLength_;
        int x = window.app.waveRect_.l + window.app.waveRect_.w() / 2;
        int y = window.app.waveRect_.b - 5;
        window.app.mouseDown(x, y, 1);
        check(window.app.drag_ == 4, "wave bottom drag did not start resize");
        window.app.mouseMove(x + 70, window.app.navRect_.t + 5);
        check(window.app.drag_ == 4, "drag changed to navigator panning across reserved lane");
        check(std::abs(window.app.viewStart_ - start) < .000001 && window.app.viewLength_ != length,
              "cross-lane drag did not resize around the original view");
        window.app.mouseUp();

        DestroyWindow(window.hwnd); window.hwnd = nullptr;
        UnregisterClassW(klass.lpszClassName, instance);
    }
};
} // namespace

int wmain() {
    try {
        AppLayoutTest::run();
        std::wcout << L"UI layout tests passed\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "UI layout test failed: " << e.what() << "\n";
        return 1;
    }
}
