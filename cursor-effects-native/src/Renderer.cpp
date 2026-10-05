#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <d2d1_1.h>
#include <dcomp.h>
#include <cmath>
#include <new>
#include <algorithm>
#include <initguid.h>
#include <d2d1effects.h>
#include "reference-ring-profile.h"

template<class T> static void release(T*& p){if(p){p->Release();p=nullptr;}}
#define TRY(call) do {HRESULT code=(call);if(FAILED(code))return code;} while(0)
// One compact interop batch per frame. Positions are physical desktop pixels.
struct DrawCommand {int kind;float x,y,x2,y2,width,angle,alpha,startAge,endAge;};
// Windows 10 D2D1_PRIMITIVE_BLEND_MAX (omitted by the pinned MinGW header).
static constexpr auto trailBlend=static_cast<D2D1_PRIMITIVE_BLEND>(4);
// Small procedural ring buffers are freed after GPU cache initialization.
// Windows-owned buffers avoid linking the general C++ allocation/runtime stack.
struct PixelBuffer {
    BYTE* bytes=nullptr;UINT length=0;
    PixelBuffer()=default;PixelBuffer(const PixelBuffer&)=delete;PixelBuffer& operator=(const PixelBuffer&)=delete;
    ~PixelBuffer(){if(bytes)HeapFree(GetProcessHeap(),0,bytes);}
    HRESULT allocate(UINT count){auto next=static_cast<BYTE*>(HeapAlloc(GetProcessHeap(),0,count));if(!next)return E_OUTOFMEMORY;if(bytes)HeapFree(GetProcessHeap(),0,bytes);bytes=next;length=count;return S_OK;}
};
struct Renderer {
    ID3D11Device* d3d=nullptr;IDXGIDevice* dxgi=nullptr;
    ID2D1Factory1* factory=nullptr;ID2D1Device* device=nullptr;ID2D1DeviceContext* dc=nullptr;
    IDCompositionDevice* comp=nullptr;IDCompositionTarget* target=nullptr;IDCompositionVisual* visual=nullptr;IDCompositionSurface* surface=nullptr;
    ID2D1SolidColorBrush* cyan=nullptr;ID2D1SolidColorBrush* white=nullptr;ID2D1StrokeStyle* round=nullptr;ID2D1PathGeometry* triangle=nullptr;
    ID2D1LinearGradientBrush* trailGradient=nullptr;D2D1_COLOR_F trailStops[33]={};
    ID2D1Bitmap1* whiteRingBody=nullptr;
    ID2D1Bitmap1* ringGuide=nullptr;
    ID2D1Effect* ringClip=nullptr;ID2D1Effect* ringProduct=nullptr;ID2D1Effect* ringTint=nullptr;
    D2D1_SIZE_U ringSize={192,192};
    UINT trailColor=0x45edff,rippleColor=0x45edff,particleColor=0xc4fcff;
    int width=0,height=0;bool hardware=false;
    ~Renderer(){if(dc)dc->SetTarget(nullptr);release(surface);release(trailGradient);release(ringTint);release(ringProduct);release(ringClip);release(ringGuide);release(whiteRingBody);release(triangle);release(round);release(white);release(cyan);release(visual);release(target);release(comp);release(dc);release(device);release(factory);release(dxgi);release(d3d);}
    static D2D1_COLOR_F color(UINT rgb){return D2D1::ColorF(((rgb>>16)&255)/255.f,((rgb>>8)&255)/255.f,(rgb&255)/255.f);}
    static float trailLight(float age){
        age=(std::max)(0.f,(std::min)(1.f,age));constexpr float a=1349.f/65535,b=27563.f/65535,m=.28235295f;
        return age<a?1:age<b?1+(m-1)*(age-a)/(b-a):m*(1-age)/(1-b);
    }
    static float lightToSDR(float light){return 1.6f*light/(.6f+light);}
    static D2D1_COLOR_F trailColorAt(UINT rgb,float age){
        auto c=color(rgb);float light=trailLight(age),r=lightToSDR(c.r*light),g=lightToSDR(c.g*light),b=lightToSDR(c.b*light);
        float alpha=(std::max)(r,(std::max)(g,b));
        // A valid premultiplied desktop color: do not use the Unity additive
        // shader's constant alpha=1, which would leave a black opaque tail.
        return alpha>0?D2D1::ColorF(r/alpha,g/alpha,b/alpha,alpha):D2D1::ColorF(0,0);
    }
    HRESULT createTrailGradient(UINT rgb,ID2D1LinearGradientBrush** output,D2D1_COLOR_F* colors){
        D2D1_GRADIENT_STOP stops[33];for(int i=0;i<33;i++){colors[i]=trailColorAt(rgb,i/32.f);stops[i]={i/32.f,colors[i]};}
        ID2D1GradientStopCollection* collection=nullptr;
        TRY(dc->CreateGradientStopCollection(stops,33,D2D1_GAMMA_1_0,D2D1_EXTEND_MODE_CLAMP,&collection));
        HRESULT hr=dc->CreateLinearGradientBrush(D2D1::LinearGradientBrushProperties(D2D1::Point2F(0,0),D2D1::Point2F(1,0)),collection,output);release(collection);return hr;
    }
    HRESULT appearance(UINT trail,UINT ripple,UINT particle){
        trail&=0xffffff;ripple&=0xffffff;particle&=0xffffff;
        // Only the trail gradient is cached/rebuilt on an actual color change.
        if(trail!=trailColor||!trailGradient){
            ID2D1LinearGradientBrush* next=nullptr;D2D1_COLOR_F nextStops[33];
            TRY(createTrailGradient(trail,&next,nextStops));
            release(trailGradient);trailGradient=next;memcpy(trailStops,nextStops,sizeof(trailStops));
        }
        trailColor=trail;rippleColor=ripple;particleColor=particle;
        cyan->SetColor(color(trail));white->SetColor(color(particle));return S_OK;
    }
    HRESULT createRingSprites(){
        // Reconstruct the reference's thin annulus and circumferential gradient
        // procedurally. These 192px caches are created once, never per frame.
        // The mesh's outer/inner radius ratio is 1.063668; the horizontal
        // gradient runs around the circumference, not across the ring width.
        PixelBuffer ringBodyPixels;TRY(ringBodyPixels.allocate(192*192*4));
        PixelBuffer guidePixels;TRY(guidePixels.allocate(192*192*4));
        for(int y=0;y<192;y++)for(int x=0;x<192;x++){
            double px=x-95.5,py=y-95.5,radius=std::sqrt(px*px+py*py),angle=std::atan2(py,px);
            // Preserve the source UV gradient and compiled alpha clip. Screen
            // stroke width is calibrated thinner from the supplied screenshots;
            // source world-unit to pixel scaling is not available.
            const double outer=70*(1+.063668*.55);
            double u=std::fmod(.9995+(95.625-angle*180/3.14159265359)/360*.999,1.0);if(u<0)u+=1;
            double v=(std::max)(0.0,(std::min)(1.0,(radius-70)/(outer-70))),uu=u*16,vv=v*8;
            int ix=(std::min)(15,(int)uu),iy=(std::min)(7,(int)vv);double fx=uu-ix,fy=vv-iy;
            double a0=referenceRingAlpha[iy][ix]*(1-fx)+referenceRingAlpha[iy][ix+1]*fx,a1=referenceRingAlpha[iy+1][ix]*(1-fx)+referenceRingAlpha[iy+1][ix+1]*fx;
            double mainAlpha=(a0*(1-fy)+a1*fy)/255;
            double edge=(std::max)(0.0,(std::min)(1.0,(std::min)(radius-70+.5,outer-radius+.5)));
            BYTE a=(BYTE)(255*mainAlpha*edge);int i=(y*192+x)*4;
            for(int c=0;c<4;c++){ringBodyPixels.bytes[i+c]=a;guidePixels.bytes[i+c]=(BYTE)(255*mainAlpha);}
        }
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        TRY(dc->CreateBitmap(ringSize,ringBodyPixels.bytes,192*4,&props,&whiteRingBody));
        TRY(dc->CreateBitmap(ringSize,guidePixels.bytes,192*4,&props,&ringGuide));
        // Threshold samples the texture alpha, never rasterized mesh coverage.
        // Keeping the two separate preserves AA on the thin radial edges.
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&ringClip));ringClip->SetInput(0,ringGuide);
        TRY(ringClip->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));TRY(ringClip->SetValue(D2D1_COLORMATRIX_PROP_CLAMP_OUTPUT,TRUE));
        TRY(dc->CreateEffect(CLSID_D2D1ArithmeticComposite,&ringProduct));ringProduct->SetInput(0,whiteRingBody);ringProduct->SetInputEffect(1,ringClip);TRY(ringProduct->SetValue(D2D1_ARITHMETICCOMPOSITE_PROP_COEFFICIENTS,D2D1_VECTOR_4F{1,0,0,0}));
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&ringTint));ringTint->SetInputEffect(0,ringProduct);TRY(ringTint->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));
        return S_OK;
    }
    HRESULT initialize(HWND hwnd){
        HRESULT hr=D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&d3d,nullptr,nullptr);
        hardware=SUCCEEDED(hr);
        if(FAILED(hr))hr=D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_WARP,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&d3d,nullptr,nullptr);
        TRY(hr);TRY(d3d->QueryInterface(IID_PPV_ARGS(&dxgi)));
        D2D1_FACTORY_OPTIONS opts={};TRY(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED,__uuidof(ID2D1Factory1),&opts,reinterpret_cast<void**>(&factory)));
        TRY(factory->CreateDevice(dxgi,&device));TRY(device->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE,&dc));dc->SetDpi(96,96);
        TRY(dc->CreateSolidColorBrush(D2D1::ColorF(69/255.f,237/255.f,1),&cyan));TRY(dc->CreateSolidColorBrush(D2D1::ColorF(196/255.f,252/255.f,1),&white));
        D2D1_STROKE_STYLE_PROPERTIES stroke={D2D1_CAP_STYLE_ROUND,D2D1_CAP_STYLE_ROUND,D2D1_CAP_STYLE_ROUND,D2D1_LINE_JOIN_ROUND,10,D2D1_DASH_STYLE_SOLID,0};
        TRY(factory->CreateStrokeStyle(stroke,nullptr,0,&round));TRY(factory->CreatePathGeometry(&triangle));
        ID2D1GeometrySink* sink=nullptr;TRY(triangle->Open(&sink));sink->BeginFigure(D2D1::Point2F(0,-1),D2D1_FIGURE_BEGIN_FILLED);sink->AddLine(D2D1::Point2F(.86f,.5f));sink->AddLine(D2D1::Point2F(-.86f,.5f));sink->EndFigure(D2D1_FIGURE_END_CLOSED);hr=sink->Close();release(sink);TRY(hr);
        TRY(createRingSprites());
        TRY(appearance(trailColor,rippleColor,particleColor));
        TRY(DCompositionCreateDevice(dxgi,__uuidof(IDCompositionDevice),reinterpret_cast<void**>(&comp)));
        TRY(comp->CreateTargetForHwnd(hwnd,TRUE,&target));TRY(comp->CreateVisual(&visual));TRY(target->SetRoot(visual));return comp->Commit();
    }
    HRESULT setSurface(int w,int h){
        if(w==width&&h==height&&surface)return S_OK;
        // Discard prior pixel storage at rest; no full-desktop backing texture.
        IDCompositionSurface* next=nullptr;TRY(comp->CreateSurface(w,h,DXGI_FORMAT_B8G8R8A8_UNORM,DXGI_ALPHA_MODE_PREMULTIPLIED,&next));
        HRESULT hr=visual->SetContent(next);if(FAILED(hr)){release(next);return hr;}release(surface);surface=next;width=w;height=h;return S_OK;
    }
    void commands(const DrawCommand* list,int count,float ox,float oy){
        const auto base=D2D1::Matrix3x2F::Translation(ox,oy);
        dc->SetTransform(base);dc->SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        for(int i=0;i<count;i++){
            const auto& c=list[i];float alpha=(std::max)(0.f,(std::min)(1.f,c.alpha));
            if((c.kind!=0&&c.kind!=2&&c.kind!=6)||alpha==0||(c.kind==2&&c.width<=0))continue;
            // Adjacent round caps describe one continuous
            // trail, not extra light sources. Keep their greatest coverage
            // instead of accumulating brightness at every input sample.
            dc->SetPrimitiveBlend(c.kind==0?trailBlend:D2D1_PRIMITIVE_BLEND_SOURCE_OVER);
            cyan->SetOpacity(alpha);white->SetOpacity(alpha);dc->SetTransform(base);
            if(c.kind==0){
                auto a=D2D1::Point2F(c.x,c.y),b=D2D1::Point2F(c.x2,c.y2);float delta=c.endAge-c.startAge;
                if(std::abs(delta)<.0001f){auto tint=trailColorAt(trailColor,(c.startAge+c.endAge)*.5f);cyan->SetColor(tint);cyan->SetOpacity(alpha);dc->DrawLine(a,b,cyan,c.width,round);}
                else{
                    // One cached gradient for all segments. Extending its axis
                    // maps both endpoint ages onto the reference life curve;
                    // no gradient objects, textures or blur created per frame.
                    float dx=(b.x-a.x)/delta,dy=(b.y-a.y)/delta;
                    trailGradient->SetStartPoint(D2D1::Point2F(a.x-c.startAge*dx,a.y-c.startAge*dy));
                    trailGradient->SetEndPoint(D2D1::Point2F(a.x+(1-c.startAge)*dx,a.y+(1-c.startAge)*dy));
                    trailGradient->SetOpacity(alpha);dc->DrawLine(a,b,trailGradient,c.width,round);
                }
            }
            else if(c.kind==2){
                float flash=(std::max)(0.f,(std::min)(1.f,c.x2)),tone=c.y2>0?(std::min)(1.f,c.y2):1.f;auto tint=color(particleColor);
                white->SetColor(D2D1::ColorF(tint.r*tone*(1-flash)+flash,tint.g*tone*(1-flash)+flash,tint.b*tone*(1-flash)+flash));
                dc->SetTransform(D2D1::Matrix3x2F::Scale(c.width,c.width)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);dc->FillGeometry(triangle,white);
            }
            else if(c.kind==6){
                if(c.width>1)continue;
                float flash=(std::max)(0.f,(std::min)(1.f,c.y2)),scale=c.x2/70.f;
                // DXBC: discard when MainTex.a * particleAlpha < threshold.
                // The command carries threshold / particleAlpha; user opacity
                // is applied afterward and cannot alter the dissolve timing.
                D2D1_MATRIX_5X4_F clip={};clip._41=clip._42=clip._43=clip._44=4096;clip._51=clip._52=clip._53=clip._54=1-c.width*4096;
                ringClip->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,clip);
                // PREMULTIPLIED color matrix unpremultiplies its input and
                // premultiplies the result. Apply opacity only to the alpha
                // row, avoiding a second alpha multiplication of the RGB.
                // The gain approximates the reference HDR material on SDR.
                auto tintColor=color(rippleColor);D2D1_MATRIX_5X4_F tint={};tint._11=1.8f*(tintColor.r*(1-flash)+flash);tint._22=1.8f*(tintColor.g*(1-flash)+flash);tint._33=1.8f*(tintColor.b*(1-flash)+flash);tint._44=alpha;ringTint->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,tint);
                dc->SetTransform(D2D1::Matrix3x2F::Translation(-96,-96)*D2D1::Matrix3x2F::Scale(scale,scale)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);
                dc->DrawImage(ringTint,nullptr,nullptr,D2D1_INTERPOLATION_MODE_LINEAR,D2D1_COMPOSITE_MODE_SOURCE_OVER);
            }
        }
        dc->SetTransform(D2D1::Matrix3x2F::Identity());dc->SetPrimitiveBlend(D2D1_PRIMITIVE_BLEND_SOURCE_OVER);
    }
    HRESULT render(int x,int y,int w,int h,const DrawCommand* list,int count){
        TRY(setSurface(w,h));IDXGISurface* dxSurface=nullptr;POINT offset={};TRY(surface->BeginDraw(nullptr,__uuidof(IDXGISurface),reinterpret_cast<void**>(&dxSurface),&offset));
        ID2D1Bitmap1* bitmap=nullptr;auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_TARGET|D2D1_BITMAP_OPTIONS_CANNOT_DRAW,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED));
        HRESULT hr=dc->CreateBitmapFromDxgiSurface(dxSurface,&props,&bitmap);release(dxSurface);
        if(SUCCEEDED(hr)){
            dc->SetTarget(bitmap);dc->BeginDraw();dc->SetTransform(D2D1::Matrix3x2F::Identity());dc->PushAxisAlignedClip(D2D1::RectF((float)offset.x,(float)offset.y,(float)offset.x+w,(float)offset.y+h),D2D1_ANTIALIAS_MODE_ALIASED);dc->Clear(D2D1::ColorF(0,0));commands(list,count,(float)offset.x-x,(float)offset.y-y);dc->PopAxisAlignedClip();hr=dc->EndDraw();dc->SetTarget(nullptr);
        }
        release(bitmap);HRESULT end=surface->EndDraw();if(SUCCEEDED(hr))hr=end;TRY(hr);TRY(visual->SetOffsetX((float)x));TRY(visual->SetOffsetY((float)y));return comp->Commit();
    }
    HRESULT capture(int w,int h,const DrawCommand* list,int count,BYTE* pixels){
        ID2D1Bitmap1* image=nullptr;ID2D1Bitmap1* readable=nullptr;
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_TARGET,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED));
        HRESULT hr=dc->CreateBitmap(D2D1::SizeU(w,h),nullptr,0,&props,&image);
        if(SUCCEEDED(hr)){dc->SetTarget(image);dc->BeginDraw();dc->Clear(D2D1::ColorF(0,0));commands(list,count,0,0);hr=dc->EndDraw();dc->SetTarget(nullptr);}
        props.bitmapOptions=D2D1_BITMAP_OPTIONS_CPU_READ|D2D1_BITMAP_OPTIONS_CANNOT_DRAW;
        if(SUCCEEDED(hr))hr=dc->CreateBitmap(D2D1::SizeU(w,h),nullptr,0,&props,&readable);
        if(SUCCEEDED(hr))hr=readable->CopyFromBitmap(nullptr,image,nullptr);
        D2D1_MAPPED_RECT map={};if(SUCCEEDED(hr)){hr=readable->Map(D2D1_MAP_OPTIONS_READ,&map);if(SUCCEEDED(hr)){for(int y=0;y<h;y++)memcpy(pixels+y*w*4,map.bits+y*map.pitch,w*4);readable->Unmap();}}
        release(readable);release(image);return hr;
    }
};
static void destroy(Renderer* renderer){if(renderer){renderer->~Renderer();HeapFree(GetProcessHeap(),0,renderer);}}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorCreate(HWND hwnd,Renderer** output){
    if(!output||!hwnd)return E_INVALIDARG;*output=nullptr;void* memory=HeapAlloc(GetProcessHeap(),0,sizeof(Renderer));if(!memory)return E_OUTOFMEMORY;auto r=new(memory)Renderer();HRESULT hr=r->initialize(hwnd);if(FAILED(hr)){destroy(r);return hr;}*output=r;return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorRender(Renderer* r,int x,int y,int w,int h,const DrawCommand* commands,int count){if(!r||w<1||h<1||count<0||count>2048||(!commands&&count))return E_INVALIDARG;return r->render(x,y,w,h,commands,count);}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorCapture(Renderer* r,int w,int h,const DrawCommand* commands,int count,BYTE* pixels){if(!r||!pixels||w<1||h<1||w>4096||h>4096||count<0||count>2048)return E_INVALIDARG;return r->capture(w,h,commands,count,pixels);}
extern "C" __declspec(dllexport) int __cdecl CursorHardware(Renderer* r){return r&&r->hardware?1:0;}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorAppearance(Renderer* r,UINT trail,UINT ripple,UINT particle){return r?r->appearance(trail,ripple,particle):E_INVALIDARG;}
extern "C" __declspec(dllexport) void __cdecl CursorDestroy(Renderer* r){destroy(r);}
