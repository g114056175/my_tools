#include "Audio.hpp"
#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shlobj.h>
#include <dwmapi.h>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <functional>
#include <iomanip>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {
constexpr COLORREF bg=RGB(18,26,38), card=RGB(13,29,46), waveBg=RGB(7,17,31), outline=RGB(36,67,91);
constexpr COLORREF text=RGB(226,238,250), muted=RGB(146,165,187), cyan=RGB(56,189,248), orange=RGB(245,158,11);
constexpr COLORREF gray=RGB(72,91,113), green=RGB(35,131,93), red=RGB(163,55,69), blue=RGB(24,86,124), amber=RGB(136,89,26);
constexpr int ID_SOURCE=100, ID_WINDOW=101, ID_FORMAT=102, ID_QUALITY=103, ID_START=104, ID_END=105;
constexpr UINT WM_JOB_DONE=WM_APP+1, WM_TRIM_EDIT=WM_APP+2;
struct R { int l=0,t=0,r=0,b=0; int w()const{return r-l;} int h()const{return b-t;} bool hit(int x,int y)const{return x>=l&&x<r&&y>=t&&y<b;} };
R box(int x,int y,int w,int h){return {x,y,x+w,y+h};}
RECT winRect(R r){return {r.l,r.t,r.r,r.b};}
int clampi(int n,int lo,int hi){return std::clamp(n,lo,hi);}
std::wstring timeText(double sec,int precision=2){
    sec=std::max(0.0,sec); int whole=int(sec); int fraction=int(std::round((sec-whole)*std::pow(10,precision)));
    int unit=int(std::pow(10,precision)); if(fraction>=unit){whole++;fraction=0;}
    std::wostringstream s; s<<std::setfill(L'0')<<std::setw(2)<<whole/60<<L":"<<std::setw(2)<<whole%60;
    if(precision)s<<L"."<<std::setw(precision)<<fraction; return s.str();
}
std::wstring number(double n,int decimals=2){std::wostringstream s;s<<std::fixed<<std::setprecision(decimals)<<n;return s.str();}
std::wstring errorWide(const std::exception& e){int n=MultiByteToWideChar(CP_UTF8,0,e.what(),-1,nullptr,0); if(n<=0)return L"操作失敗";std::wstring w(size_t(n),0);MultiByteToWideChar(CP_UTF8,0,e.what(),-1,w.data(),n);w.pop_back();return w;}
std::wstring tempPath(){wchar_t buf[MAX_PATH];GetTempPathW(MAX_PATH,buf);return (std::filesystem::path(buf)/L"VoiceCaptureLiteNative"/L"capture.wav").wstring();}
void clearFile(const std::wstring& path){std::error_code ec;std::filesystem::remove(std::filesystem::path(path),ec);}
void replaceFile(const std::wstring& from,const std::wstring& to){if(!MoveFileExW(from.c_str(),to.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH))throw std::runtime_error("Cannot replace working audio file");}
std::wstring extLower(const std::wstring& path){std::wstring e=std::filesystem::path(path).extension().wstring();std::transform(e.begin(),e.end(),e.begin(),towlower);return e;}
std::wstring downloads(){PWSTR p=nullptr;std::wstring out; if(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Downloads,0,nullptr,&p))){out=p;CoTaskMemFree(p);}return out.empty()?L".":out;}
void fill(HDC dc,R r,COLORREF c){RECT q=winRect(r);HBRUSH b=CreateSolidBrush(c);FillRect(dc,&q,b);DeleteObject(b);}
void roundRect(HDC dc,R r,int radius,COLORREF inside,COLORREF edge=CLR_INVALID){
    HBRUSH b=CreateSolidBrush(inside);HPEN p=CreatePen(PS_SOLID,1,edge==CLR_INVALID?inside:edge);
    auto oldB=SelectObject(dc,b),oldP=SelectObject(dc,p);RoundRect(dc,r.l,r.t,r.r,r.b,radius,radius);SelectObject(dc,oldB);SelectObject(dc,oldP);DeleteObject(b);DeleteObject(p);
}
void line(HDC dc,int x1,int y1,int x2,int y2,COLORREF c,int thick=1){HPEN p=CreatePen(PS_SOLID,thick,c);auto old=SelectObject(dc,p);MoveToEx(dc,x1,y1,nullptr);LineTo(dc,x2,y2);SelectObject(dc,old);DeleteObject(p);}
void shade(HDC dc,R r){if(r.w()<=0||r.h()<=0)return;HDC layer=CreateCompatibleDC(dc);HBITMAP bmp=CreateCompatibleBitmap(dc,r.w(),r.h());auto old=SelectObject(layer,bmp);fill(layer,box(0,0,r.w(),r.h()),RGB(12,18,31));BLENDFUNCTION blend{AC_SRC_OVER,0,145,0};AlphaBlend(dc,r.l,r.t,r.w(),r.h(),layer,0,0,r.w(),r.h(),blend);SelectObject(layer,old);DeleteObject(bmp);DeleteDC(layer);}
void label(HDC dc,const std::wstring& s,R r,COLORREF c,UINT align=DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS){SetBkMode(dc,TRANSPARENT);SetTextColor(dc,c);RECT q=winRect(r);DrawTextW(dc,s.c_str(),int(s.size()),&q,align);}
struct Button {std::wstring key,title;R rect;COLORREF color=blue,edge=outline;bool enabled=true;};
struct WindowEntry {HWND hwnd=nullptr;DWORD pid=0;std::wstring title,process;std::wstring display() const{return title+L" · "+process+L" ("+std::to_wstring(pid)+L")";}};
BOOL CALLBACK enumerate(HWND hwnd,LPARAM opaque){
    auto& out=*reinterpret_cast<std::vector<WindowEntry>*>(opaque);
    if(!IsWindowVisible(hwnd))return TRUE; int len=GetWindowTextLengthW(hwnd);if(len<=0)return TRUE;
    LONG_PTR style=GetWindowLongPtrW(hwnd,GWL_EXSTYLE); if((style&WS_EX_TOOLWINDOW)&&!(style&WS_EX_APPWINDOW))return TRUE;
    if(GetWindow(hwnd,GW_OWNER)&&!(style&WS_EX_APPWINDOW))return TRUE;
    int cloaked=0;if(SUCCEEDED(DwmGetWindowAttribute(hwnd,DWMWA_CLOAKED,&cloaked,sizeof cloaked))&&cloaked)return TRUE;
    RECT rect{};if(!GetWindowRect(hwnd,&rect)||rect.right<=rect.left||rect.bottom<=rect.top)return TRUE;
    DWORD pid=0;GetWindowThreadProcessId(hwnd,&pid);if(pid==GetCurrentProcessId())return TRUE;
    std::wstring title(size_t(len+1),0);int read=GetWindowTextW(hwnd,title.data(),len+1);title.resize(size_t(std::max(0,read)));if(title.empty())return TRUE;
    std::wstring process=L"未知程序";HANDLE h=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);
    if(h){wchar_t name[MAX_PATH];DWORD size=MAX_PATH;if(QueryFullProcessImageNameW(h,0,name,&size))process=std::filesystem::path(name).stem().wstring();CloseHandle(h);}
    out.push_back({hwnd,pid,title,process});return TRUE;
}
class App {
    HWND hwnd_=nullptr,source_=nullptr,window_=nullptr,format_=nullptr,quality_=nullptr,startEdit_=nullptr,endEdit_=nullptr;
    HBRUSH controlBrush_=CreateSolidBrush(RGB(27,42,59)); HFONT font_=nullptr,mono_=nullptr;
    int W_=920,H_=480;double dpi_=1;
    bool processCap_=false,trim_=false,recording_=false,stopping_=false,busy_=false,closing_=false,updatingEdits_=false,navVisible_=false;
    int drag_=0; double dragX_=0,dragStart_=0,dragLength_=0,navStart_=0,navLength_=0,navAnchor_=0;
    double duration_=0,viewStart_=0,viewLength_=0,selectionStart_=0,selectionEnd_=0,position_=0;
    std::vector<float> peaks_;float peakMax_=1;
    audio::Wave wave_;audio::Player player_;audio::Recorder recorder_;
    std::wstring temp_=tempPath(),fileLabel_=L"錄音",jobLabel_,status_=L"就緒",focusKey_;
    std::vector<WindowEntry> windows_;std::vector<Button> buttons_;
    R card_,waveRect_,navRect_,playRect_,trimRow_,exportRow_;
    std::thread job_; std::function<void()> jobApply_;std::wstring jobError_;
    int jobKind_=0;std::wstring pending_,exportTarget_;audio::Wave jobWave_;std::vector<float> jobPeaks_;
    double recordTime_=0;
    uint64_t recordStartMs_=0,pauseStartMs_=0,pausedMs_=0;
    static LRESULT CALLBACK proc(HWND h,UINT m,WPARAM w,LPARAM l){App* a=(App*)GetWindowLongPtrW(h,GWLP_USERDATA);if(m==WM_NCCREATE){a=(App*)((CREATESTRUCTW*)l)->lpCreateParams;a->hwnd_=h;SetWindowLongPtrW(h,GWLP_USERDATA,(LONG_PTR)a);}return a?a->message(m,w,l):DefWindowProcW(h,m,w,l);}
    static LRESULT CALLBACK editProc(HWND h,UINT m,WPARAM w,LPARAM l){if(m==WM_KEYDOWN&&w==VK_RETURN){PostMessageW(GetParent(h),WM_TRIM_EDIT,0,0);SetFocus(GetParent(h));return 0;}return CallWindowProcW((WNDPROC)GetPropW(h,L"oldproc"),h,m,w,l);}
    static LRESULT CALLBACK comboProc(HWND h,UINT m,WPARAM w,LPARAM l){
        auto old=(WNDPROC)GetPropW(h,L"oldproc");LRESULT result=CallWindowProcW(old,h,m,w,l);
        if(m==WM_PAINT||m==WM_PRINTCLIENT){
            HDC dc=m==WM_PAINT?GetDC(h):(HDC)w;RECT r{};GetClientRect(h,&r);int width=r.right,height=r.bottom;
            bool active=IsWindowEnabled(h)&&(GetFocus()==h||SendMessageW(h,CB_GETDROPPEDSTATE,0,0));
            fill(dc,box(0,0,width,height),bg);
            roundRect(dc,box(0,0,width,height),9,RGB(27,42,59),active?RGB(66,163,205):outline);
            int selected=int(SendMessageW(h,CB_GETCURSEL,0,0));
            if(selected>=0){int length=int(SendMessageW(h,CB_GETLBTEXTLEN,selected,0));if(length>=0&&length<32768){
                std::wstring value(size_t(length+1),L'\0');SendMessageW(h,CB_GETLBTEXT,selected,(LPARAM)value.data());value.resize(size_t(length));
                App* app=(App*)GetWindowLongPtrW(GetParent(h),GWLP_USERDATA);auto previous=SelectObject(dc,app?app->font_:GetStockObject(DEFAULT_GUI_FONT));
                label(dc,value,box(12,1,std::max(0,width-39),height-2),IsWindowEnabled(h)?text:muted);
                SelectObject(dc,previous);
            }}
            COLORREF arrow=active?cyan:IsWindowEnabled(h)?muted:gray;
            line(dc,width-22,height/2-2,width-17,height/2+3,arrow,2);
            line(dc,width-17,height/2+3,width-12,height/2-2,arrow,2);
            if(m==WM_PAINT)ReleaseDC(h,dc);
        }
        if(m==WM_SETFOCUS||m==WM_KILLFOCUS||m==WM_ENABLE)InvalidateRect(h,nullptr,FALSE);
        return result;
    }
    void combo(HWND& h,int id){h=CreateWindowExW(0,L"COMBOBOX",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST|CBS_OWNERDRAWFIXED|CBS_HASSTRINGS|WS_VSCROLL,0,0,1,200,hwnd_,(HMENU)(INT_PTR)id,GetModuleHandleW(nullptr),nullptr);SendMessageW(h,WM_SETFONT,(WPARAM)font_,TRUE);auto old=(WNDPROC)SetWindowLongPtrW(h,GWLP_WNDPROC,(LONG_PTR)comboProc);SetPropW(h,L"oldproc",(HANDLE)old);}
    void edit(HWND& h,int id){h=CreateWindowExW(0,L"EDIT",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|WS_BORDER|ES_AUTOHSCROLL,0,0,1,1,hwnd_,(HMENU)(INT_PTR)id,GetModuleHandleW(nullptr),nullptr);SendMessageW(h,WM_SETFONT,(WPARAM)font_,TRUE);auto old=(WNDPROC)SetWindowLongPtrW(h,GWLP_WNDPROC,(LONG_PTR)editProc);SetPropW(h,L"oldproc",(HANDLE)old);}
    void move(HWND h,R r,bool show=true){if(!h)return;ShowWindow(h,show?SW_SHOW:SW_HIDE);if(show)MoveWindow(h,int(r.l*dpi_),int(r.t*dpi_),int(r.w()*dpi_),int(r.h()*dpi_),TRUE);}
    void button(const wchar_t* key,const wchar_t* title,R r,COLORREF c=blue,COLORREF edge=outline,bool enabled=true){buttons_.push_back({key,title,r,c,edge,enabled});}
    void layout();void paint();void paintWave(HDC dc);void paintNav(HDC dc);
    void refreshWindows();void controls();void loadWave(const std::wstring& label,std::vector<float> known={});
    void setView(double start,double length);void updateSelection();void updateEdits();double rangeStart()const{return trim_?selectionStart_:0;}double rangeEnd()const{return trim_?selectionEnd_:duration_;}
    double xTime(double x)const{return std::clamp(viewStart_+(x-waveRect_.l-12)/std::max(1,waveRect_.w()-24)*viewLength_,0.0,duration_);}
    double timeX(double t)const{return waveRect_.l+12+(t-viewStart_)/std::max(.001,viewLength_)*(waveRect_.w()-24);}
    void seek(double t);void click(const std::wstring& key);void beginJob(int kind,const std::wstring& pending,const std::wstring& target,std::function<void()> work);
    void finishJob();void finishRecording();void importFile(const std::wstring& path);void exportFile();void error(const std::wstring& s){status_=s;MessageBoxW(hwnd_,s.c_str(),L"聲音擷取",MB_OK|MB_ICONWARNING);InvalidateRect(hwnd_,nullptr,FALSE);}
    void pasteFile();
    void tabFocus(bool backward);
    bool confirm(const std::wstring& title,const std::wstring& msg){return MessageBoxW(hwnd_,msg.c_str(),title.c_str(),MB_OKCANCEL|MB_ICONWARNING|MB_DEFBUTTON2)==IDOK;}
    std::wstring openDialog();std::wstring saveDialog(bool mp3);
    void mouseDown(int x,int y,int clicks);void mouseMove(int x,int y);void mouseUp();void wheel(int x,int delta,bool ctrl);
    LRESULT message(UINT m,WPARAM w,LPARAM l);
public:
    App()=default;~App(){recorder_.stop();recorder_.finish();if(job_.joinable())job_.join();player_.close();if(font_)DeleteObject(font_);if(mono_)DeleteObject(mono_);DeleteObject(controlBrush_);}
    int run(HINSTANCE inst,int show,const std::wstring& file);
};

void App::layout(){
    buttons_.clear();
    if(processCap_){
        move(source_,box(72,20,180,31));move(window_,box(328,20,W_-455,31));
        button(L"refresh",L"↻  重新整理",box(W_-116,20,96,31),RGB(27,42,59),outline,!recording_&&!busy_);
    }
    button(L"record",recording_?L"■  結束錄製":L"●  開始錄製",box(20,57,126,35),recording_?red:green,recording_?RGB(239,123,135):RGB(70,186,141),!busy_);
    button(L"recordPause",recorder_.paused()?L"▶  繼續錄製":L"Ⅱ  暫停錄製",box(154,57,109,35),!recording_?RGB(28,44,64):recorder_.paused()?green:amber,!recording_?RGB(48,70,94):recorder_.paused()?RGB(70,186,141):RGB(223,168,73),recording_&&!stopping_);
    button(L"import",L"匯入音檔",box(W_-168,57,91,35),RGB(27,42,59),outline,!recording_&&!busy_);
    button(L"delete",L"清除",box(W_-69,57,49,35),RGB(27,42,59),outline,!recording_&&!busy_&&duration_>0);
    int bottomReserve=trim_?213:174;
    card_=box(20,110,W_-40,std::max(170,H_-110-bottomReserve));
    button(L"fit",L"全部",box(card_.r-278,card_.t+11,49,30),RGB(27,42,59),outline,duration_>0&&!recording_&&!busy_);
    button(L"suggested",L"建議 · 30 秒",box(card_.r-223,card_.t+11,106,30),RGB(27,42,59),outline,duration_>0&&!recording_&&!busy_);
    navVisible_=duration_>0&&!recording_&&viewLength_<duration_-.000001;
    waveRect_=box(card_.l+12,card_.t+47,card_.w()-24,card_.b-card_.t-(navVisible_?86:59));
    navRect_=box(card_.l+21,card_.b-28,card_.w()-42,16);
    playRect_=box(20,card_.b+16,100,36);
    button(L"play",player_.playing()?L"Ⅱ  暫停":L"▶  播放",playRect_,player_.playing()?amber:blue,player_.playing()?RGB(223,168,73):RGB(50,134,181),duration_>0&&!recording_&&!busy_);
    if(trim_){
        button(L"cancelTrim",L"取消裁切",box(128,card_.b+16,83,36),RGB(27,42,59),outline,duration_>0&&!busy_);
        button(L"confirmTrim",L"確定裁切",box(219,card_.b+16,89,36),blue,RGB(50,134,181),duration_>0&&!busy_);
    }else button(L"trim",L"裁切",box(128,card_.b+16,70,36),RGB(27,42,59),outline,duration_>0&&!busy_);
    trimRow_=box(20,card_.b+62,W_-40,29);exportRow_=box(20,card_.b+(trim_?107:68),W_-40,36);
    move(startEdit_,box(92,trimRow_.t,84,27),trim_);move(endEdit_,box(264,trimRow_.t,84,27),trim_);
    move(format_,box(57,exportRow_.t,91,35));move(quality_,box(196,exportRow_.t,146,35),SendMessageW(format_,CB_GETCURSEL,0,0)==1);
    button(L"export",trim_?L"匯出選取片段  ↗":L"匯出音檔  ↗",box(W_-(trim_?180:148),exportRow_.t,trim_?160:128,36),blue,RGB(50,134,181),duration_>0&&!recording_&&!busy_);
    InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::paintWave(HDC dc){
    roundRect(dc,waveRect_,11,waveBg);int innerL=waveRect_.l+12,innerR=waveRect_.r-12;
    int plotH=std::max(30,waveRect_.h()-30),plotT=waveRect_.t,plotB=plotT+plotH,mid=(plotT+plotB)/2;
    if(peaks_.empty()){label(dc,L"錄製或匯入音檔後，即可預覽與裁切",box(waveRect_.l+18,mid-18,waveRect_.w()-40,28),muted);return;}
    HRGN clip=CreateRectRgn(innerL,plotT,innerR,plotB);SelectClipRgn(dc,clip);DeleteObject(clip);
    int bars=std::max(1,(innerR-innerL)/5);size_t count=peaks_.size();
    for(int i=0;i<bars;i++){
        double t0=viewStart_+double(i)/bars*viewLength_,t1=viewStart_+double(i+1)/bars*viewLength_;
        size_t first=std::min(count-1,size_t(std::max(0.0,t0/std::max(.001,duration_)*count)));
        size_t last=std::clamp<size_t>(size_t(std::ceil(t1/std::max(.001,duration_)*count)),first+1,count);
        float peak=0;for(size_t j=first;j<last;j++)peak=std::max(peak,peaks_[j]);
        int h=std::max(2,int(peak/peakMax_*(plotH-26)));
        double t=(t0+t1)/2;COLORREF c=trim_&&(t<selectionStart_||t>selectionEnd_)?gray:t<=position_?orange:cyan;
        int x=innerL+i*5;roundRect(dc,box(x,mid-h/2,3,h),3,c);
    }
    if(trim_){
        int left=clampi(int(std::round(timeX(selectionStart_))),innerL,innerR),right=clampi(int(std::round(timeX(selectionEnd_))),innerL,innerR);
        shade(dc,box(innerL,plotT,left-innerL,plotH));
        shade(dc,box(right,plotT,innerR-right,plotH));
        line(dc,left,plotT+3,left,plotB-3,RGB(125,211,252),2);line(dc,right,plotT+3,right,plotB-3,RGB(125,211,252),2);
        line(dc,left,plotT+3,right,plotT+3,RGB(125,211,252));line(dc,left,plotB-3,right,plotB-3,RGB(125,211,252));
    }
    if(position_>=viewStart_&&position_<=viewStart_+viewLength_){int x=int(timeX(position_));line(dc,x,plotT+2,x,plotB-2,text,2);}
    SelectClipRgn(dc,nullptr);
    if(trim_)for(double t:{selectionStart_,selectionEnd_})if(t>=viewStart_-.0001&&t<=viewStart_+viewLength_+.0001){int x=int(std::round(timeX(t)));roundRect(dc,box(x-5,mid-19,10,38),6,RGB(125,211,252));line(dc,x,mid-8,x,mid+8,waveBg,2);}
    double rough=viewLength_/std::max(2.0,double(innerR-innerL)/105);double power=std::pow(10,std::floor(std::log10(std::max(.001,rough))));
    double step=10*power;for(double v:{1.,2.,5.,10.})if(v*power>=rough){step=v*power;break;}
    for(double t=std::ceil(viewStart_/step)*step;t<=viewStart_+viewLength_+.0001;t+=step){int x=int(timeX(t));if(x>innerR-42)break;label(dc,timeText(t,step<1?1:0),box(x,plotB+4,58,20),muted);}
}
void App::paintNav(HDC dc){
    if(!navVisible_)return;roundRect(dc,navRect_,5,RGB(22,45,78));
    int left=navRect_.l+int(double(navRect_.w())*viewStart_/duration_);
    int width=std::max(8,int(double(navRect_.w())*viewLength_/duration_));
    R thumb=box(left,navRect_.t,std::min(width,navRect_.r-left),navRect_.h());roundRect(dc,thumb,5,RGB(52,128,229));
    line(dc,thumb.l+3,thumb.t+3,thumb.l+3,thumb.b-3,text,2);line(dc,thumb.r-4,thumb.t+3,thumb.r-4,thumb.b-3,text,2);
}
void App::paint(){
    PAINTSTRUCT ps{};HDC screen=BeginPaint(hwnd_,&ps);RECT client{};GetClientRect(hwnd_,&client);
    HDC dc=CreateCompatibleDC(screen);HBITMAP bitmap=CreateCompatibleBitmap(screen,client.right,client.bottom);auto old=SelectObject(dc,bitmap);
    SetMapMode(dc,MM_ANISOTROPIC);SetWindowExtEx(dc,W_,H_,nullptr);SetViewportExtEx(dc,client.right,client.bottom,nullptr);
    fill(dc,box(0,0,W_,H_),bg);SelectObject(dc,font_);
    if(processCap_){label(dc,L"來源",box(20,20,45,31),muted);label(dc,L"視窗",box(270,20,52,31),muted);}
    else label(dc,L"錄製預設耳機／喇叭播放的所有聲音 · 不含麥克風",box(20,16,W_-40,27),muted);
    roundRect(dc,card_,14,card,outline);
    paintWave(dc);paintNav(dc);
    for(const auto& b:buttons_){COLORREF edge=GetFocus()==hwnd_&&focusKey_==b.key?cyan:b.enabled?b.edge:RGB(42,54,67);roundRect(dc,b.rect,9,b.enabled?b.color:RGB(30,43,59),edge);label(dc,b.title,b.rect,b.enabled?text:RGB(103,119,137),DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);}
    SelectObject(dc,mono_);label(dc,recording_?timeText(recordTime_):duration_>0?timeText(duration_):L"00:00.00",box(282,57,130,35),text);SelectObject(dc,font_);
    std::wstring meta=duration_>0?(recording_?L"錄製中":fileLabel_)+L" · "+number(duration_,2)+L" 秒 · "+number((recording_?recorder_.rate():wave_.rate)/1000.0,1)+L" kHz":L"拖入 MP3 / WAV，或開始錄製";
    label(dc,meta,box(card_.l+13,card_.t+12,card_.w()-310,29),muted);
    if(duration_>0)label(dc,L"顯示 "+number(viewLength_,viewLength_>=100?0:2)+L" 秒",box(card_.r-111,card_.t+12,99,29),muted,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
    SelectObject(dc,mono_);label(dc,timeText(position_)+L" / "+timeText(duration_),box(W_-225,card_.b+17,205,34),muted,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);SelectObject(dc,font_);
    if(trim_){label(dc,L"開始（秒）",box(20,trimRow_.t,70,27),muted);label(dc,L"結束（秒）",box(192,trimRow_.t,70,27),muted);
        label(dc,L"選取 "+number(selectionEnd_-selectionStart_)+L" 秒",box(366,trimRow_.t,160,27),RGB(125,211,252));}
    label(dc,L"輸出",box(20,exportRow_.t,32,35),muted);label(dc,L"音質",box(160,exportRow_.t,32,35),muted);
    bool mp3=SendMessageW(format_,CB_GETCURSEL,0,0)==1;
    if(!mp3)label(dc,wave_.format==3?L"Float 32-bit · 不壓縮":L"PCM 16-bit · 不壓縮",box(195,exportRow_.t,153,35),muted);
    if(duration_>0){double seconds=rangeEnd()-rangeStart();int q=int(SendMessageW(quality_,CB_GETCURSEL,0,0));int kbps=q==2?320:q==0?128:192;
        double bytes=mp3?seconds*kbps*125:seconds*wave_.rate*wave_.frameBytes()+44;
        label(dc,L"約 "+number(bytes/1048576,2)+L" MiB",box(mp3?352:350,exportRow_.t,160,35),muted);}
    label(dc,status_,box(20,H_-28,W_-40,20),muted);
    BitBlt(screen,0,0,client.right,client.bottom,dc,0,0,SRCCOPY);
    SelectObject(dc,old);DeleteObject(bitmap);DeleteDC(dc);EndPaint(hwnd_,&ps);
}

void App::refreshWindows(){
    DWORD previous=0;int selected=int(SendMessageW(window_,CB_GETCURSEL,0,0));if(selected>=0&&selected<int(windows_.size()))previous=windows_[selected].pid;
    windows_.clear();EnumWindows(enumerate,(LPARAM)&windows_);
    std::sort(windows_.begin(),windows_.end(),[](const auto& a,const auto& b){return _wcsicmp(a.title.c_str(),b.title.c_str())<0;});
    SendMessageW(window_,CB_RESETCONTENT,0,0);int newIndex=0;
    for(size_t i=0;i<windows_.size();i++){std::wstring display=windows_[i].display();SendMessageW(window_,CB_ADDSTRING,0,(LPARAM)display.c_str());if(windows_[i].pid==previous)newIndex=int(i);}
    if(!windows_.empty())SendMessageW(window_,CB_SETCURSEL,newIndex,0);
    InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::controls(){
    bool edit=!busy_&&!recording_&&duration_>0;
    if(source_)EnableWindow(source_,!busy_&&!recording_);
    if(window_)EnableWindow(window_,!busy_&&!recording_&&SendMessageW(source_,CB_GETCURSEL,0,0)==1);
    if(format_)EnableWindow(format_,edit);
    if(quality_)EnableWindow(quality_,edit&&SendMessageW(format_,CB_GETCURSEL,0,0)==1);
    if(startEdit_)EnableWindow(startEdit_,edit&&trim_);
    if(endEdit_)EnableWindow(endEdit_,edit&&trim_);
    layout();
}
void App::setView(double start,double length){
    if(duration_<=0){viewStart_=viewLength_=0;navVisible_=false;return;}
    viewLength_=std::clamp(length,std::min(5.0,duration_),duration_);
    viewStart_=std::clamp(start,0.0,std::max(0.0,duration_-viewLength_));
    bool visible=!recording_&&viewLength_<duration_-.000001;
    if(visible!=navVisible_)layout();else InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::updateEdits(){
    if(!trim_||updatingEdits_)return;updatingEdits_=true;
    if(GetFocus()!=startEdit_)SetWindowTextW(startEdit_,number(selectionStart_).c_str());
    if(GetFocus()!=endEdit_)SetWindowTextW(endEdit_,number(selectionEnd_).c_str());
    updatingEdits_=false;
}
void App::updateSelection(){
    if(!trim_||duration_<=0)return;
    wchar_t a[100]{},b[100]{};GetWindowTextW(startEdit_,a,100);GetWindowTextW(endEdit_,b,100);
    wchar_t *ea=nullptr,*eb=nullptr;double start=wcstod(a,&ea),end=wcstod(b,&eb);
    if(ea==a||eb==b||*ea||*eb||!std::isfinite(start)||!std::isfinite(end)||start<0||end<=start||end>duration_+.0005){status_=L"請輸入有效秒數：開始需早於結束，且不得超過音檔長度。";InvalidateRect(hwnd_,nullptr,FALSE);return;}
    player_.pause();selectionStart_=start;selectionEnd_=std::min(duration_,end);position_=std::clamp(position_,selectionStart_,selectionEnd_);
    player_.seek(position_,selectionEnd_);status_=L"已更新裁切範圍";InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::loadWave(const std::wstring& label,std::vector<float> known){
    wave_=audio::openWave(temp_);if(!wave_.frames())throw std::runtime_error("Working WAV has no samples");
    peaks_=known.empty()?audio::peaks(wave_):std::move(known);peakMax_=std::max(0.01f,*std::max_element(peaks_.begin(),peaks_.end()));
    player_.open(wave_);duration_=wave_.duration();viewStart_=0;viewLength_=std::min(duration_,30.0);
    trim_=false;selectionStart_=0;selectionEnd_=duration_;position_=0;fileLabel_=label;recordTime_=duration_;controls();
}
std::wstring App::openDialog(){
    wchar_t file[32768]{};OPENFILENAMEW dialog{};dialog.lStructSize=sizeof dialog;dialog.hwndOwner=hwnd_;dialog.lpstrFile=file;dialog.nMaxFile=32768;
    dialog.lpstrFilter=L"音訊檔案 (*.wav;*.mp3)\0*.wav;*.mp3\0WAV (*.wav)\0*.wav\0MP3 (*.mp3)\0*.mp3\0\0";
    dialog.Flags=OFN_FILEMUSTEXIST|OFN_PATHMUSTEXIST|OFN_EXPLORER;return GetOpenFileNameW(&dialog)?file:L"";
}
std::wstring App::saveDialog(bool mp3){
    wchar_t file[32768]{};SYSTEMTIME now{};GetLocalTime(&now);
    swprintf(file,32768,L"capture_%04d%02d%02d_%02d%02d%02d.%s",now.wYear,now.wMonth,now.wDay,now.wHour,now.wMinute,now.wSecond,mp3?L"mp3":L"wav");
    std::wstring dir=downloads();OPENFILENAMEW dialog{};dialog.lStructSize=sizeof dialog;dialog.hwndOwner=hwnd_;dialog.lpstrFile=file;dialog.nMaxFile=32768;
    dialog.lpstrFilter=mp3?L"MP3 音訊 (*.mp3)\0*.mp3\0\0":L"WAV 音訊 (*.wav)\0*.wav\0\0";
    dialog.lpstrDefExt=mp3?L"mp3":L"wav";dialog.lpstrInitialDir=dir.c_str();dialog.Flags=OFN_OVERWRITEPROMPT|OFN_PATHMUSTEXIST|OFN_EXPLORER;
    return GetSaveFileNameW(&dialog)?file:L"";
}
void App::beginJob(int kind,const std::wstring& pending,const std::wstring& target,std::function<void()> work){
    if(job_.joinable())job_.join();jobKind_=kind;pending_=pending;exportTarget_=target;jobError_.clear();busy_=true;player_.pause();controls();
    job_=std::thread([this,work=std::move(work)] {try{work();}catch(const std::exception& e){jobError_=errorWide(e);}PostMessageW(hwnd_,WM_JOB_DONE,0,0);});
}
void App::finishJob(){
    if(job_.joinable())job_.join();busy_=false;
    try{
        if(!jobError_.empty())throw std::runtime_error("Audio job failed");
        if(jobKind_==1||jobKind_==2){
            player_.close();replaceFile(pending_,temp_);loadWave(jobKind_==1?jobLabel_:fileLabel_,std::move(jobPeaks_));
            status_=jobKind_==1?L"匯入完成":L"裁切完成";
        }else if(jobKind_==3){replaceFile(pending_,exportTarget_);status_=L"已匯出："+exportTarget_;}
    }catch(const std::exception& e){
        if(jobError_.empty())jobError_=errorWide(e);
        if(!wave_.path.empty()&&!player_.playing()) {try{player_.open(wave_);}catch(...){}}
        error(jobError_);
    }
    clearFile(pending_);jobKind_=0;jobPeaks_.clear();controls();
    if(closing_)DestroyWindow(hwnd_);
}
void App::finishRecording(){
    recorder_.finish();recording_=false;stopping_=false;std::wstring err=recorder_.error();
    try{
        if(!err.empty())throw std::runtime_error("Capture failed");
        auto file=audio::openWave(pending_);if(!file.frames())throw std::runtime_error("No audio was captured");
        player_.close();replaceFile(pending_,temp_);
        std::vector<float> got;recorder_.snapshot(got);loadWave(L"錄音",std::move(got));status_=L"錄製完成";
    }catch(const std::exception& e){
        if(err.empty())err=errorWide(e);error(err);
        if(std::filesystem::exists(std::filesystem::path(temp_))){try{loadWave(fileLabel_);}catch(...){}}
    }
    clearFile(pending_);controls();if(closing_)DestroyWindow(hwnd_);
}
void App::importFile(const std::wstring& path){
    if(recording_||busy_)return;auto ext=extLower(path);if(ext!=L".wav"&&ext!=L".mp3"){status_=L"請選擇 MP3 或 WAV 音檔。";InvalidateRect(hwnd_,nullptr,FALSE);return;}
    if(_wcsicmp(path.c_str(),temp_.c_str())==0)return;
    if((duration_>0||std::filesystem::exists(std::filesystem::path(temp_)))&&!confirm(L"匯入音檔",L"匯入新的音檔會取代目前的工作音檔，未匯出的內容將無法復原。\n\n匯入的原始檔案不受影響。是否確定繼續？"))return;
    jobLabel_=std::filesystem::path(path).filename().wstring();status_=L"正在解碼音檔…";
    std::wstring pending=temp_+L".pending.wav";clearFile(pending);
    beginJob(1,pending,L"",[this,path,pending]{audio::importAudio(path,pending);jobWave_=audio::openWave(pending);jobPeaks_=audio::peaks(jobWave_);});
}
void App::exportFile(){
    if(duration_<=0||busy_||recording_)return;bool mp3=SendMessageW(format_,CB_GETCURSEL,0,0)==1;
    std::wstring target=saveDialog(mp3);if(target.empty())return;
    if(_wcsicmp(target.c_str(),temp_.c_str())==0){status_=L"請另選匯出位置。";InvalidateRect(hwnd_,nullptr,FALSE);return;}
    std::wstring pending=(std::filesystem::path(target).parent_path()/(L".vcl-"+std::to_wstring(GetTickCount64())+(mp3?L".mp3":L".wav"))).wstring();
    clearFile(pending);auto wave=wave_;double start=rangeStart(),end=rangeEnd();int q=int(SendMessageW(quality_,CB_GETCURSEL,0,0)),kbps=q==2?320:q==0?128:192;
    status_=L"正在匯出…";beginJob(3,pending,target,[wave,start,end,pending,mp3,kbps]{if(mp3)audio::exportMp3(wave,start,end,pending,kbps);else audio::exportWave(wave,start,end,pending);});
}
void App::pasteFile(){
    if(!OpenClipboard(hwnd_))return;std::wstring path;HANDLE h=GetClipboardData(CF_HDROP);
    if(h){wchar_t p[32768]{};if(DragQueryFileW((HDROP)h,0,p,32768))path=p;}
    else {h=GetClipboardData(CF_UNICODETEXT);if(h){auto* p=(wchar_t*)GlobalLock(h);if(p){path=p;GlobalUnlock(h);if(path.size()>1&&path.front()==L'"'&&path.back()==L'"')path=path.substr(1,path.size()-2);}}}
    CloseClipboard();if(!path.empty()&&std::filesystem::exists(std::filesystem::path(path)))importFile(path);
}
void App::tabFocus(bool backward){
    struct Target{HWND hwnd;std::wstring key;};std::vector<Target> order;
    if(source_&&IsWindowVisible(source_))order.push_back({source_,L""});
    if(window_&&IsWindowEnabled(window_))order.push_back({window_,L""});
    for(const auto& b:buttons_)if(b.enabled&&b.key!=L"export")order.push_back({nullptr,b.key});
    if(trim_){order.push_back({startEdit_,L""});order.push_back({endEdit_,L""});}
    if(format_&&IsWindowEnabled(format_))order.push_back({format_,L""});
    if(quality_&&IsWindowEnabled(quality_)&&IsWindowVisible(quality_))order.push_back({quality_,L""});
    for(const auto& b:buttons_)if(b.enabled&&b.key==L"export")order.push_back({nullptr,b.key});
    if(order.empty())return;
    HWND focused=GetFocus();int current=-1;
    for(size_t i=0;i<order.size();i++)if((order[i].hwnd&&order[i].hwnd==focused)||(!order[i].hwnd&&focused==hwnd_&&order[i].key==focusKey_)){current=int(i);break;}
    int next=current<0?(backward?int(order.size())-1:0):(current+(backward?-1:1)+int(order.size()))%int(order.size());
    focusKey_=order[next].key;SetFocus(order[next].hwnd?order[next].hwnd:hwnd_);InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::seek(double t){
    if(duration_<=0||recording_)return;
    t=std::clamp(t,rangeStart(),rangeEnd());player_.seek(t,rangeEnd());position_=t;InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::click(const std::wstring& key){
    if(key==L"refresh"){refreshWindows();status_=L"已重新整理視窗";}
    else if(key==L"record"){
        if(recording_){stopping_=true;recorder_.stop();status_=L"正在完成錄音…";controls();return;}
        if(busy_)return;
        bool process=processCap_&&SendMessageW(source_,CB_GETCURSEL,0,0)==1;DWORD pid=0;
        if(process){int idx=int(SendMessageW(window_,CB_GETCURSEL,0,0));if(idx<0||idx>=int(windows_.size())){status_=L"請先選擇視窗。";return;}pid=windows_[idx].pid;}
        if((duration_>0||std::filesystem::exists(std::filesystem::path(temp_)))&&!confirm(L"重新錄製",L"開始新的錄製會取代目前的工作音檔，未匯出的內容將無法復原。\n\n是否確定繼續？"))return;
        player_.close();duration_=0;position_=0;peaks_.clear();peakMax_=1;wave_={};trim_=false;viewStart_=viewLength_=0;
        pending_=temp_+L".pending.wav";clearFile(pending_);recording_=true;stopping_=false;recordStartMs_=GetTickCount64();pausedMs_=pauseStartMs_=0;recordTime_=0;
        recorder_.pause(false);recorder_.start(pending_,process,pid);status_=L"錄製中";controls();
    }
    else if(key==L"recordPause"){
        if(!recording_||stopping_)return;bool now=!recorder_.paused();recorder_.pause(now);
        if(now)pauseStartMs_=GetTickCount64();else {pausedMs_+=GetTickCount64()-pauseStartMs_;pauseStartMs_=0;}
        status_=now?L"錄製已暫停 · 暫停期間的聲音不會寫入":L"錄製中";controls();
    }
    else if(key==L"import"){auto path=openDialog();if(!path.empty())importFile(path);}
    else if(key==L"delete"){
        if(duration_<=0||busy_||recording_)return;
        if(!confirm(L"清除工作音檔",L"確定清除目前的工作音檔？未匯出的內容將無法復原。\n\n只刪除本工具的暫存副本，匯入的原始檔案不受影響。"))return;
        player_.close();clearFile(temp_);wave_={};peaks_.clear();duration_=position_=viewStart_=viewLength_=0;trim_=false;status_=L"工作音檔已清除";controls();
    }
    else if(key==L"play"){
        if(duration_<=0||recording_||busy_)return;
        if(player_.playing())player_.pause();else {double start=position_;if(start<rangeStart()||start>=rangeEnd()-.001)start=rangeStart();player_.play(start,rangeEnd());position_=start;}
        controls();
    }
    else if(key==L"trim"){
        if(duration_<=0||busy_)return;player_.pause();trim_=true;selectionStart_=0;selectionEnd_=duration_;
        setView(0,duration_);status_=L"拖曳波形左右把手調整範圍；播放只涵蓋選取部分。";controls();updateEdits();
    }
    else if(key==L"cancelTrim"){
        player_.pause();trim_=false;selectionStart_=0;selectionEnd_=duration_;status_=L"已取消裁切選取";controls();
    }
    else if(key==L"confirmTrim"){
        if(!trim_||busy_||duration_<=0)return;
        double first=selectionStart_,last=selectionEnd_;
        if(!confirm(L"確定裁切",L"保留 "+timeText(first)+L" 到 "+timeText(last)+L"，共 "+number(last-first)+L" 秒？\n\n確定後會取代工作音檔，框外內容將無法復原。若只想匯出選取部分，可直接按「匯出選取片段」。"))return;
        auto w=wave_;std::wstring pending=temp_+L".pending.wav";clearFile(pending);status_=L"正在裁切…";
        beginJob(2,pending,L"",[this,w,first,last,pending]{audio::exportWave(w,first,last,pending);jobPeaks_=audio::peaks(audio::openWave(pending));});
    }
    else if(key==L"fit")setView(0,duration_);
    else if(key==L"suggested")setView(position_,std::min(30.0,duration_));
    else if(key==L"export")exportFile();
    InvalidateRect(hwnd_,nullptr,FALSE);
}
void App::mouseDown(int x,int y,int clicks){
    for(const auto& b:buttons_)if(b.rect.hit(x,y)){if(b.enabled){focusKey_=b.key;SetFocus(hwnd_);click(b.key);}return;}
    if(duration_<=0||recording_||busy_)return;
    if(navVisible_&&navRect_.hit(x,y)){
        int thumbL=navRect_.l+int(navRect_.w()*viewStart_/duration_);
        int thumbR=navRect_.l+int(navRect_.w()*(viewStart_+viewLength_)/duration_);
        dragStart_=viewStart_;dragLength_=viewLength_;dragX_=x;
        if(std::abs(x-thumbL)<=8)drag_=6;else if(std::abs(x-thumbR)<=8)drag_=7;
        else if(x>=thumbL&&x<=thumbR)drag_=5;
        else {setView((x-navRect_.l)*duration_/navRect_.w()-viewLength_/2,viewLength_);drag_=5;dragStart_=viewStart_;}
        SetCapture(hwnd_);return;
    }
    if(!waveRect_.hit(x,y))return;
    if(y>=waveRect_.b-30){if(clicks>=2){setView(0,duration_);return;}drag_=4;dragX_=x;dragStart_=viewStart_;dragLength_=viewLength_;SetCapture(hwnd_);return;}
    double left=std::abs(x-timeX(selectionStart_)),right=std::abs(x-timeX(selectionEnd_));
    drag_=trim_&&std::min(left,right)<=13?(left<=right?2:3):1;SetCapture(hwnd_);mouseMove(x,y);
}
void App::mouseMove(int x,int y){
    if(drag_==0){
        bool resize=(waveRect_.hit(x,y)&&y>=waveRect_.b-30)||(trim_&&waveRect_.hit(x,y)&&std::min(std::abs(x-timeX(selectionStart_)),std::abs(x-timeX(selectionEnd_)))<=13);
        SetCursor(LoadCursorW(nullptr,resize?IDC_SIZEWE:waveRect_.hit(x,y)||navRect_.hit(x,y)?IDC_HAND:IDC_ARROW));return;
    }
    if(drag_==1)seek(xTime(x));
    else if(drag_==2||drag_==3){
        if(x<waveRect_.l+12)setView(viewStart_-viewLength_*.02,viewLength_);
        if(x>waveRect_.r-12)setView(viewStart_+viewLength_*.02,viewLength_);
        double t=xTime(x);
        if(drag_==2)selectionStart_=std::clamp(t,0.0,selectionEnd_-.001);
        else selectionEnd_=std::clamp(t,selectionStart_+.001,duration_);
        player_.pause();position_=std::clamp(position_,selectionStart_,selectionEnd_);player_.seek(position_,selectionEnd_);updateEdits();InvalidateRect(hwnd_,nullptr,FALSE);
    }
    else if(drag_==4){double factor=std::pow(2,std::clamp((x-dragX_)/160.0,-30.0,30.0));setView(dragStart_,dragLength_*factor);}
    else if(drag_==5){setView(dragStart_+(x-dragX_)*duration_/navRect_.w(),dragLength_);}
    else if(drag_==6){double end=dragStart_+dragLength_,start=std::clamp(dragStart_+(x-dragX_)*duration_/navRect_.w(),0.0,end-std::min(5.0,duration_));setView(start,end-start);}
    else if(drag_==7){double len=dragLength_+(x-dragX_)*duration_/navRect_.w();setView(dragStart_,len);}
}
void App::mouseUp(){drag_=0;if(GetCapture()==hwnd_)ReleaseCapture();layout();}
void App::wheel(int x,int delta,bool ctrl){
    if(duration_<=0||busy_||recording_)return;
    if(ctrl){double anchor=xTime(x),fraction=(anchor-viewStart_)/viewLength_,length=viewLength_*(delta>0?.8:1.25);setView(anchor-length*fraction,length);}
    else setView(viewStart_-(delta>0?1:-1)*viewLength_*.15,viewLength_);
}
LRESULT App::message(UINT m,WPARAM w,LPARAM l){
    try{
        switch(m){
        case WM_CREATE:{
            processCap_=audio::processCaptureAvailable();
            if(processCap_){combo(source_,ID_SOURCE);combo(window_,ID_WINDOW);SendMessageW(source_,CB_ADDSTRING,0,(LPARAM)L"系統音訊 · 預設播放裝置");SendMessageW(source_,CB_ADDSTRING,0,(LPARAM)L"指定視窗的音訊");SendMessageW(source_,CB_SETCURSEL,0,0);refreshWindows();}
            combo(format_,ID_FORMAT);combo(quality_,ID_QUALITY);SendMessageW(format_,CB_ADDSTRING,0,(LPARAM)L"WAV");SendMessageW(format_,CB_ADDSTRING,0,(LPARAM)L"MP3");SendMessageW(format_,CB_SETCURSEL,0,0);
            for(const wchar_t* item:{L"標準 · 128 kbps",L"中 · 192 kbps",L"高 · 320 kbps"})SendMessageW(quality_,CB_ADDSTRING,0,(LPARAM)item);
            SendMessageW(quality_,CB_SETCURSEL,1,0);edit(startEdit_,ID_START);edit(endEdit_,ID_END);
            SetTimer(hwnd_,1,33,nullptr);DragAcceptFiles(hwnd_,TRUE);controls();
            int dark=1;DwmSetWindowAttribute(hwnd_,20,&dark,sizeof dark);
            if(std::filesystem::exists(std::filesystem::path(temp_))){try{loadWave(L"上次工作音檔");}catch(...){}}
            return 0;
        }
        case WM_GETMINMAXINFO:{RECT desired{0,0,780,470};UINT dpi=GetDpiForWindow(hwnd_);if(!dpi)dpi=GetDpiForSystem();
            AdjustWindowRectExForDpi(&desired,DWORD(GetWindowLongPtrW(hwnd_,GWL_STYLE)),FALSE,DWORD(GetWindowLongPtrW(hwnd_,GWL_EXSTYLE)),dpi);
            auto* limits=(MINMAXINFO*)l;limits->ptMinTrackSize={desired.right-desired.left,desired.bottom-desired.top};return 0;}
        case WM_SIZE:{if(w==SIZE_MINIMIZED)return 0;RECT r{};GetClientRect(hwnd_,&r);W_=int((r.right-r.left)/dpi_);H_=int((r.bottom-r.top)/dpi_);layout();return 0;}
        case WM_DPICHANGED:{dpi_=double(HIWORD(w))/96.0;auto* suggested=(RECT*)l;SetWindowPos(hwnd_,nullptr,suggested->left,suggested->top,suggested->right-suggested->left,suggested->bottom-suggested->top,SWP_NOZORDER|SWP_NOACTIVATE);layout();return 0;}
        case WM_ERASEBKGND:return 1;
        case WM_PAINT:paint();return 0;
        case WM_MEASUREITEM:{auto* item=(MEASUREITEMSTRUCT*)l;item->itemHeight=29;return TRUE;}
        case WM_DRAWITEM:{auto* item=(DRAWITEMSTRUCT*)l;if(item->CtlType!=ODT_COMBOBOX)return FALSE;
            RECT r=item->rcItem;HBRUSH b=CreateSolidBrush(item->itemState&ODS_SELECTED?RGB(38,90,129):RGB(27,42,59));FillRect(item->hDC,&r,b);DeleteObject(b);
            if(item->itemID!=(UINT)-1){wchar_t s[1024]{};SendMessageW(item->hwndItem,CB_GETLBTEXT,item->itemID,(LPARAM)s);r.left+=8;SetBkMode(item->hDC,TRANSPARENT);SetTextColor(item->hDC,text);SelectObject(item->hDC,font_);DrawTextW(item->hDC,s,-1,&r,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);}
            return TRUE;}
        case WM_CTLCOLORLISTBOX:case WM_CTLCOLOREDIT:{HDC dc=(HDC)w;SetTextColor(dc,text);SetBkColor(dc,RGB(27,42,59));return (LRESULT)controlBrush_;}
        case WM_COMMAND:{int id=LOWORD(w),code=HIWORD(w);
            if(code==1&&l==0){switch(id){case 201:click(L"record");break;case 202:click(L"import");break;case 203:click(L"export");break;case 204:click(trim_?L"cancelTrim":L"trim");break;case 205:pasteFile();break;case 206:click(L"fit");break;case 207:click(L"suggested");break;}return 0;}
            if(code==CBN_SELCHANGE){if(id==ID_SOURCE||id==ID_FORMAT){controls();}else InvalidateRect(hwnd_,nullptr,FALSE);return 0;}
            if(code==EN_KILLFOCUS&&(id==ID_START||id==ID_END)&&!updatingEdits_){updateSelection();return 0;}break;}
        case WM_TRIM_EDIT:updateSelection();return 0;
        case WM_LBUTTONDOWN:mouseDown(int(GET_X_LPARAM(l)/dpi_),int(GET_Y_LPARAM(l)/dpi_),1);return 0;
        case WM_LBUTTONDBLCLK:mouseDown(int(GET_X_LPARAM(l)/dpi_),int(GET_Y_LPARAM(l)/dpi_),2);return 0;
        case WM_MOUSEMOVE:mouseMove(int(GET_X_LPARAM(l)/dpi_),int(GET_Y_LPARAM(l)/dpi_));return 0;
        case WM_LBUTTONUP:mouseUp();return 0;
        case WM_CAPTURECHANGED:drag_=0;return 0;
        case WM_MOUSEWHEEL:{POINT p{GET_X_LPARAM(l),GET_Y_LPARAM(l)};ScreenToClient(hwnd_,&p);wheel(int(p.x/dpi_),GET_WHEEL_DELTA_WPARAM(w),GET_KEYSTATE_WPARAM(w)&MK_CONTROL);return 0;}
        case WM_TIMER:{
            if(recording_){
                if(recorder_.done()){finishRecording();return 0;}
                uint64_t now=GetTickCount64();uint64_t pause=recorder_.paused()?now-pauseStartMs_:0;
                recordTime_=double(now-recordStartMs_-pausedMs_-pause)/1000;
                std::vector<float> live;double d=recorder_.snapshot(live);
                if(d>duration_){duration_=d;viewStart_=0;viewLength_=duration_;peaks_=std::move(live);peakMax_=peaks_.empty()?1:std::max(.01f,*std::max_element(peaks_.begin(),peaks_.end()));}
                InvalidateRect(hwnd_,nullptr,FALSE);return 0;
            }
            if(!busy_&&duration_>0){bool before=player_.playing();try{player_.tick();}catch(const std::exception& e){player_.close();status_=errorWide(e);controls();return 0;}double next=player_.position();
                if(next!=position_){position_=next;if(before&&(position_>viewStart_+viewLength_||position_<viewStart_))setView(position_-viewLength_*.1,viewLength_);InvalidateRect(hwnd_,nullptr,FALSE);}
                if(before!=player_.playing())controls();}
            return 0;
        }
        case WM_JOB_DONE:finishJob();return 0;
        case WM_DROPFILES:{HDROP drop=(HDROP)w;wchar_t path[32768]{};if(DragQueryFileW(drop,0,path,32768))importFile(path);DragFinish(drop);return 0;}
        case WM_KEYDOWN:{
            if(w==VK_SPACE){click(L"play");return 0;}
            if(w==VK_RETURN&&!focusKey_.empty()){click(focusKey_);return 0;}
            break;
        }
        case WM_CLOSE:{if(recording_){closing_=true;stopping_=true;recorder_.stop();status_=L"正在停止錄製；完成後會關閉。";controls();return 0;}
            if(busy_){closing_=true;status_=L"完成目前操作後會關閉。";return 0;}DestroyWindow(hwnd_);return 0;}
        case WM_DESTROY:KillTimer(hwnd_,1);PostQuitMessage(0);return 0;
        }
    }catch(const std::exception& e){error(errorWide(e));}
    return DefWindowProcW(hwnd_,m,w,l);
}
int App::run(HINSTANCE inst,int show,const std::wstring& file){
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    dpi_=double(GetDpiForSystem())/96.0;
    font_=CreateFontW(-14,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Microsoft JhengHei UI");
    mono_=CreateFontW(-14,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Consolas");
    WNDCLASSEXW c{};c.cbSize=sizeof c;c.style=CS_DBLCLKS|CS_HREDRAW|CS_VREDRAW;c.lpfnWndProc=proc;c.hInstance=inst;c.hIcon=LoadIconW(inst,MAKEINTRESOURCEW(1));c.hIconSm=c.hIcon;c.hCursor=LoadCursorW(nullptr,IDC_ARROW);c.lpszClassName=L"VoiceCaptureLiteNative";
    RegisterClassExW(&c);hwnd_=CreateWindowExW(WS_EX_ACCEPTFILES,c.lpszClassName,L"聲音擷取",WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN,CW_USEDEFAULT,CW_USEDEFAULT,int(960*dpi_),int(535*dpi_),nullptr,nullptr,inst,this);
    if(!hwnd_)return 1;ShowWindow(hwnd_,show);UpdateWindow(hwnd_);
    if(!file.empty())importFile(file);
    ACCEL keys[]={{BYTE(FVIRTKEY|FCONTROL),'R',201},{BYTE(FVIRTKEY|FCONTROL),'O',202},{BYTE(FVIRTKEY|FCONTROL),'S',203},{BYTE(FVIRTKEY|FCONTROL),'T',204},{BYTE(FVIRTKEY|FCONTROL),'V',205},{BYTE(FVIRTKEY|FCONTROL),'0',206},{BYTE(FVIRTKEY|FCONTROL),'1',207}};
    HACCEL accelerator=CreateAcceleratorTableW(keys,UINT(std::size(keys)));
    MSG msg{};while(GetMessageW(&msg,nullptr,0,0)>0){
        if(msg.message==WM_KEYDOWN&&msg.wParam==VK_TAB){tabFocus((GetKeyState(VK_SHIFT)&0x8000)!=0);continue;}
        bool editing=GetFocus()==startEdit_||GetFocus()==endEdit_;
        if(editing||!TranslateAcceleratorW(hwnd_,accelerator,&msg)){TranslateMessage(&msg);DispatchMessageW(&msg);}
    }
    DestroyAcceleratorTable(accelerator);return int(msg.wParam);
}
}
int WINAPI wWinMain(HINSTANCE inst,HINSTANCE,LPWSTR,int show){
    int argc=0;LPWSTR* args=CommandLineToArgvW(GetCommandLineW(),&argc);
    std::wstring file=argc>1?args[1]:L"";if(args)LocalFree(args);
    App app;return app.run(inst,show,file);
}
