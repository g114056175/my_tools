#include "common/dxgi_capture.h"
#include <algorithm>
#include <limits>

namespace lc {
using Clock=std::chrono::steady_clock;
struct DxgiDesktopCapture::Source {
    HMONITOR monitor{};
    RECT bounds{},crop{};
    DXGI_MODE_ROTATION rotation=DXGI_MODE_ROTATION_IDENTITY;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<IDXGIOutputDuplication> duplication;
    ComPtr<ID3D11Texture2D> desktop,staging;
    D3D11_TEXTURE2D_DESC texture{};
    std::vector<uint8_t> pixels;
    Clock::time_point lostSince{},retryAfter{},firstFrameDeadline{};
    void ResetGpu() {
        duplication.Reset();staging.Reset();desktop.Reset();context.Reset();device.Reset();
        texture={};crop={};pixels.clear();
    }
};
namespace {
struct Monitor {HMONITOR handle;RECT bounds;};
BOOL CALLBACK Enumerate(HMONITOR monitor,HDC,LPRECT,LPARAM data) {
    MONITORINFO info{};info.cbSize=sizeof(info);
    if(GetMonitorInfoW(monitor,&info)) reinterpret_cast<std::vector<Monitor>*>(data)->push_back({monitor,info.rcMonitor});
    return TRUE;
}
std::wstring Failure(const wchar_t* operation,HRESULT hr){return std::wstring(L"DXGI ")+operation+L"："+HrText(hr);}
bool Recoverable(HRESULT hr) {
    return hr==DXGI_ERROR_ACCESS_LOST || hr==DXGI_ERROR_DEVICE_REMOVED || hr==DXGI_ERROR_DEVICE_RESET ||
        hr==DXGI_ERROR_SESSION_DISCONNECTED || hr==E_ACCESSDENIED;
}
struct AcquiredFrame {
    IDXGIOutputDuplication* duplication;bool held=true;
    ~AcquiredFrame(){if(held) duplication->ReleaseFrame();}
    HRESULT Release(){held=false;return duplication->ReleaseFrame();}
};
}
DxgiDesktopCapture::DxgiDesktopCapture()=default;
DxgiDesktopCapture::~DxgiDesktopCapture(){Stop();}
void DxgiDesktopCapture::Stop(){sources_.clear();pointer_={};}

bool DxgiDesktopCapture::Initialize(Source& source,std::wstring& error) {
    source.ResetGpu();
    ComPtr<IDXGIFactory1> factory;
    HRESULT hr=CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if(FAILED(hr)){error=Failure(L"無法建立顯示介面",hr);return false;}
    for(UINT adapterIndex=0;;++adapterIndex) {
        ComPtr<IDXGIAdapter1> adapter;
        hr=factory->EnumAdapters1(adapterIndex,&adapter);
        if(hr==DXGI_ERROR_NOT_FOUND) break;
        if(FAILED(hr)){error=Failure(L"無法列舉顯示卡",hr);return false;}
        for(UINT outputIndex=0;;++outputIndex) {
            ComPtr<IDXGIOutput> output;hr=adapter->EnumOutputs(outputIndex,&output);
            if(hr==DXGI_ERROR_NOT_FOUND) break;
            if(FAILED(hr)){error=Failure(L"無法列舉螢幕",hr);return false;}
            DXGI_OUTPUT_DESC desc{};
            if(FAILED(output->GetDesc(&desc)) || !desc.AttachedToDesktop || desc.Monitor!=source.monitor) continue;
            const D3D_FEATURE_LEVEL levels[]{D3D_FEATURE_LEVEL_11_0,D3D_FEATURE_LEVEL_10_1,D3D_FEATURE_LEVEL_10_0};
            hr=D3D11CreateDevice(adapter.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                levels,ARRAYSIZE(levels),D3D11_SDK_VERSION,&source.device,nullptr,&source.context);
            if(FAILED(hr)){error=Failure(L"無法建立擷取裝置",hr);return false;}
            ComPtr<IDXGIOutput1> output1;hr=output.As(&output1);
            if(SUCCEEDED(hr)) hr=output1->DuplicateOutput(source.device.Get(),&source.duplication);
            if(FAILED(hr)){error=Failure(L"無法開始桌面擷取",hr);return false;}
            source.rotation=desc.Rotation;source.bounds=desc.DesktopCoordinates;
            source.firstFrameDeadline=Clock::now()+std::chrono::seconds(5);return true;
        }
    }
    error=L"DXGI 找不到框選範圍的螢幕，請重新框選。";return false;
}

bool DxgiDesktopCapture::Poll(Source& source,const RECT& crop,std::wstring& error) {
    if(!source.duplication) {
        if(Clock::now()<source.retryAfter) return false;
        std::wstring detail;
        if(!Initialize(source,detail)) {
            if(source.lostSince==Clock::time_point{} || Clock::now()-source.lostSince>std::chrono::seconds(5)) error=detail;
            source.retryAfter=Clock::now()+std::chrono::milliseconds(100);return false;
        }
    }
    auto lost=[&](HRESULT hr) {
        source.ResetGpu();
        if(pointer_.owner==source.monitor) pointer_={};
        if(source.lostSince==Clock::time_point{}) source.lostSince=Clock::now();
        source.retryAfter=Clock::now()+std::chrono::milliseconds(100);
        if(Clock::now()-source.lostSince>std::chrono::seconds(5)) error=Failure(L"擷取連線中斷",hr);
        return false;
    };
    DXGI_OUTDUPL_FRAME_INFO frame{};ComPtr<IDXGIResource> resource;
    HRESULT hr=source.duplication->AcquireNextFrame(0,&frame,&resource);
    bool changed=false;
    if(hr!=DXGI_ERROR_WAIT_TIMEOUT) {
        if(Recoverable(hr)) return lost(hr);
        if(FAILED(hr)){error=Failure(L"無法讀取桌面畫格",hr);return false;}
        AcquiredFrame guard{source.duplication.Get()};
        pointer_.Update(source.monitor,source.bounds,frame);
        HRESULT copyResult=S_OK;
        if(frame.PointerShapeBufferSize && frame.LastMouseUpdateTime.QuadPart>=pointer_.shapeTimestamp) {
            std::vector<uint8_t> shape(frame.PointerShapeBufferSize);
            UINT required=0;DXGI_OUTDUPL_POINTER_SHAPE_INFO info{};
            copyResult=source.duplication->GetFramePointerShape(static_cast<UINT>(shape.size()),shape.data(),&required,&info);
            if(copyResult==DXGI_ERROR_MORE_DATA) {
                shape.resize(required);
                copyResult=source.duplication->GetFramePointerShape(required,shape.data(),&required,&info);
            }
            if(SUCCEEDED(copyResult)) {
                shape.resize(required);pointer_.shape=std::move(shape);pointer_.info=info;
                pointer_.shapeTimestamp=frame.LastMouseUpdateTime.QuadPart;
            }
        }
        ComPtr<ID3D11Texture2D> texture;
        if(SUCCEEDED(copyResult)) copyResult=resource.As(&texture);
        if(SUCCEEDED(copyResult)) {
            D3D11_TEXTURE2D_DESC desc{};texture->GetDesc(&desc);
            if(desc.Format!=DXGI_FORMAT_B8G8R8A8_UNORM){error=L"DXGI 回傳不支援的桌面像素格式。";return false;}
            if(!source.desktop || desc.Width!=source.texture.Width || desc.Height!=source.texture.Height) {
                source.desktop.Reset();source.staging.Reset();source.texture=desc;
                desc.Usage=D3D11_USAGE_DEFAULT;desc.BindFlags=0;desc.CPUAccessFlags=0;desc.MiscFlags=0;
                copyResult=source.device->CreateTexture2D(&desc,nullptr,&source.desktop);
            }
            if(SUCCEEDED(copyResult)){source.context->CopyResource(source.desktop.Get(),texture.Get());changed=true;}
        }
        const HRESULT released=guard.Release();
        if(Recoverable(copyResult)) return lost(copyResult);
        if(Recoverable(released)) return lost(released);
        if(FAILED(copyResult) || FAILED(released)) {
            error=Failure(L"無法複製桌面畫格",FAILED(copyResult)?copyResult:released);return false;
        }
    }
    if(!source.desktop) {
        if(Clock::now()>source.firstFrameDeadline) error=L"DXGI 未取得桌面畫格，請確認螢幕連線或重新錄製。";
        return false;
    }
    if(!changed && EqualRect(&crop,&source.crop) && !source.pixels.empty()) return true;
    const RECT relative{crop.left-source.bounds.left,crop.top-source.bounds.top,crop.right-source.bounds.left,crop.bottom-source.bounds.top};
    const RECT box=dxgi::TextureCrop(relative,source.texture.Width,source.texture.Height,source.rotation);
    if(box.left<0 || box.top<0 || box.right>static_cast<LONG>(source.texture.Width) || box.bottom>static_cast<LONG>(source.texture.Height)) return lost(DXGI_ERROR_ACCESS_LOST);
    D3D11_TEXTURE2D_DESC stagingDesc{};
    if(source.staging) source.staging->GetDesc(&stagingDesc);
    const UINT boxWidth=box.right-box.left,boxHeight=box.bottom-box.top;
    if(!source.staging || stagingDesc.Width!=boxWidth || stagingDesc.Height!=boxHeight) {
        source.staging.Reset();stagingDesc={};stagingDesc.Width=boxWidth;stagingDesc.Height=boxHeight;
        stagingDesc.MipLevels=stagingDesc.ArraySize=stagingDesc.SampleDesc.Count=1;
        stagingDesc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;stagingDesc.Usage=D3D11_USAGE_STAGING;stagingDesc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
        hr=source.device->CreateTexture2D(&stagingDesc,nullptr,&source.staging);
        if(FAILED(hr)){error=Failure(L"無法建立畫格緩衝區",hr);return false;}
    }
    const D3D11_BOX textureBox{static_cast<UINT>(box.left),static_cast<UINT>(box.top),0,static_cast<UINT>(box.right),static_cast<UINT>(box.bottom),1};
    source.context->CopySubresourceRegion(source.staging.Get(),0,0,0,0,source.desktop.Get(),0,&textureBox);
    D3D11_MAPPED_SUBRESOURCE mapped{};hr=source.context->Map(source.staging.Get(),0,D3D11_MAP_READ,0,&mapped);
    if(Recoverable(hr)) return lost(hr);
    if(FAILED(hr)){error=Failure(L"無法讀取畫格像素",hr);return false;}
    dxgi::CopyCrop(static_cast<const uint8_t*>(mapped.pData),mapped.RowPitch,{box.left,box.top},
        source.texture.Width,source.texture.Height,source.rotation,relative,source.pixels);
    source.context->Unmap(source.staging.Get(),0);source.crop=crop;source.lostSince={};return true;
}

bool DxgiDesktopCapture::Capture(const RECT& region,bool cursor,std::vector<uint8_t>& output,int& width,int& height,std::wstring& error) {
    error.clear();
    const int64_t w=static_cast<int64_t>(region.right)-region.left,h=static_cast<int64_t>(region.bottom)-region.top;
    if(w<=0 || h<=0 || w>INT_MAX || h>INT_MAX || static_cast<uint64_t>(w)*h>SIZE_MAX/4){error=L"DXGI 框選範圍尺寸無效。";return false;}
    std::vector<Monitor> monitors;
    if(!EnumDisplayMonitors(nullptr,nullptr,Enumerate,reinterpret_cast<LPARAM>(&monitors))){error=L"DXGI 無法列舉桌面螢幕。";return false;}
    std::erase_if(monitors,[&](const Monitor& m){RECT crop{};return !IntersectRect(&crop,&region,&m.bounds);});
    if(monitors.empty()){error=L"框選範圍沒有涵蓋已連接的螢幕。";return false;}
    std::erase_if(sources_,[&](const auto& s){return std::none_of(monitors.begin(),monitors.end(),
        [&](const Monitor& m){return s->monitor==m.handle && EqualRect(&s->bounds,&m.bounds);});});
    bool ready=true;
    for(const auto& monitor:monitors) {
        auto found=std::find_if(sources_.begin(),sources_.end(),[&](const auto& s){return s->monitor==monitor.handle;});
        if(found==sources_.end()) {
            auto source=std::make_unique<Source>();source->monitor=monitor.handle;source->bounds=monitor.bounds;
            sources_.push_back(std::move(source));found=std::prev(sources_.end());
        }
        RECT crop{};IntersectRect(&crop,&region,&monitor.bounds);
        if(!Poll(**found,crop,error)) ready=false;
        if(!error.empty()) return false;
    }
    if(!ready) return false;
    width=static_cast<int>(w);height=static_cast<int>(h);output.assign(static_cast<size_t>(width)*height*4,0);
    for(size_t i=3;i<output.size();i+=4) output[i]=255;
    for(const auto& source:sources_) {
        const int cropWidth=source->crop.right-source->crop.left,cropHeight=source->crop.bottom-source->crop.top;
        const int x=source->crop.left-region.left,y=source->crop.top-region.top;
        for(int row=0;row<cropHeight;++row) std::memcpy(output.data()+(static_cast<size_t>(y+row)*width+x)*4,
            source->pixels.data()+static_cast<size_t>(row)*cropWidth*4,static_cast<size_t>(cropWidth)*4);
    }
    if(cursor && !dxgi::CompositePointer(output,width,height,region,pointer_)){error=L"DXGI 回傳不支援的游標像素格式。";return false;}
    return true;
}
} // namespace lc
