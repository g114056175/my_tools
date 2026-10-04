#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <d2d1_1.h>
#include <dcomp.h>
#include <wincodec.h>
#include <cmath>
#include <new>
#include <algorithm>

template<class T> static void release(T*& p){if(p){p->Release();p=nullptr;}}
#define TRY(call) do {HRESULT code=(call);if(FAILED(code))return code;} while(0)
// One compact interop batch per frame. Positions are physical desktop pixels.
struct DrawCommand {int kind;float x,y,x2,y2,width,angle,alpha;};
// Windows 10 D2D1_PRIMITIVE_BLEND_MAX (omitted by the pinned MinGW header).
static constexpr auto trailBlend=static_cast<D2D1_PRIMITIVE_BLEND>(4);
// Two embedded sprites plus one cached white glow variant; recolor only on
// appearance changes, with a temporary buffer released immediately afterward.
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
    ID2D1SolidColorBrush* cyan=nullptr;ID2D1SolidColorBrush* white=nullptr;ID2D1SolidColorBrush* ring=nullptr;ID2D1StrokeStyle* round=nullptr;ID2D1PathGeometry* triangle=nullptr;
    ID2D1Bitmap1* lineGlow=nullptr;ID2D1Bitmap1* triangleGlow=nullptr;ID2D1Bitmap1* whiteTriangleGlow=nullptr;
    ID2D1Bitmap1* ringBody=nullptr;ID2D1Bitmap1* ringGlow=nullptr;ID2D1Bitmap1* whiteRingBody=nullptr;ID2D1Bitmap1* whiteRingGlow=nullptr;
    PixelBuffer linePixels,trianglePixels,ringBodyPixels,ringGlowPixels;D2D1_SIZE_U lineSize={},triangleSize={},ringSize={192,192};
    UINT trailColor=0x45edff,rippleColor=0x45edff,particleColor=0xc4fcff;
    int width=0,height=0;bool hardware=false;
    ~Renderer(){if(dc)dc->SetTarget(nullptr);release(surface);release(whiteRingBody);release(whiteRingGlow);release(ringBody);release(ringGlow);release(whiteTriangleGlow);release(triangleGlow);release(lineGlow);release(triangle);release(round);release(ring);release(white);release(cyan);release(visual);release(target);release(comp);release(dc);release(device);release(factory);release(dxgi);release(d3d);}
    HRESULT load(BYTE* bytes,UINT length,ID2D1Bitmap1** output,PixelBuffer& pixels,D2D1_SIZE_U& size){
        IWICImagingFactory* wic=nullptr;IWICStream* stream=nullptr;IWICBitmapDecoder* decoder=nullptr;IWICBitmapFrameDecode* frame=nullptr;IWICFormatConverter* converter=nullptr;
        HRESULT hr=CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&wic));
        if(SUCCEEDED(hr))hr=wic->CreateStream(&stream);
        if(SUCCEEDED(hr))hr=stream->InitializeFromMemory(bytes,length);
        if(SUCCEEDED(hr))hr=wic->CreateDecoderFromStream(stream,nullptr,WICDecodeMetadataCacheOnLoad,&decoder);
        if(SUCCEEDED(hr))hr=decoder->GetFrame(0,&frame);
        if(SUCCEEDED(hr))hr=wic->CreateFormatConverter(&converter);
        if(SUCCEEDED(hr))hr=converter->Initialize(frame,GUID_WICPixelFormat32bppPBGRA,WICBitmapDitherTypeNone,nullptr,0,WICBitmapPaletteTypeCustom);
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        if(SUCCEEDED(hr))hr=converter->GetSize(&size.width,&size.height);
        if(SUCCEEDED(hr)&&(size.width==0||size.height==0||size.width>4096||size.height>4096))hr=E_INVALIDARG;
        if(SUCCEEDED(hr))hr=pixels.allocate(size.width*size.height*4);
        if(SUCCEEDED(hr))hr=converter->CopyPixels(nullptr,size.width*4,pixels.length,pixels.bytes);
        if(SUCCEEDED(hr))hr=dc->CreateBitmap(size,pixels.bytes,size.width*4,&props,output);
        release(converter);release(frame);release(decoder);release(stream);release(wic);return hr;
    }
    static D2D1_COLOR_F color(UINT rgb){return D2D1::ColorF(((rgb>>16)&255)/255.f,((rgb>>8)&255)/255.f,(rgb&255)/255.f);}
    HRESULT tint(const PixelBuffer& original,D2D1_SIZE_U size,UINT rgb,UINT baseline,ID2D1Bitmap1** output){
        PixelBuffer storage;TRY(storage.allocate(original.length));auto pixels=storage.bytes;memcpy(pixels,original.bytes,original.length);
        for(UINT i=0;i<original.length;i+=4)for(int c=0;c<3;c++)pixels[i+c]=(BYTE)(std::min)((UINT)pixels[i+3],((UINT)pixels[i+c]*((rgb>>(c*8))&255)+((baseline>>(c*8))&255)/2)/((baseline>>(c*8))&255));
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        return dc->CreateBitmap(size,pixels,size.width*4,&props,output);
    }
    HRESULT appearance(UINT trail,UINT ripple,UINT particle){
        trail&=0xffffff;ripple&=0xffffff;particle&=0xffffff;
        // Recolor the cached sprites only after an actual color change, never
        // during animation or slider updates. No per-frame bitmap blur/readback.
        ID2D1Bitmap1* nextLine=nullptr;ID2D1Bitmap1* nextTriangle=nullptr;ID2D1Bitmap1* nextRing=nullptr;ID2D1Bitmap1* nextRingGlow=nullptr;HRESULT hr=S_OK;
        if(trail!=trailColor)hr=tint(linePixels,lineSize,trail,0x45edff,&nextLine);
        if(SUCCEEDED(hr)&&particle!=particleColor)hr=tint(trianglePixels,triangleSize,particle,0xc4fcff,&nextTriangle);
        if(SUCCEEDED(hr)&&ripple!=rippleColor)hr=tint(ringBodyPixels,ringSize,ripple,0xffffff,&nextRing);
        if(SUCCEEDED(hr)&&ripple!=rippleColor)hr=tint(ringGlowPixels,ringSize,ripple,0xffffff,&nextRingGlow);
        if(FAILED(hr)){release(nextLine);release(nextTriangle);release(nextRing);release(nextRingGlow);return hr;}
        if(nextLine){release(lineGlow);lineGlow=nextLine;}if(nextTriangle){release(triangleGlow);triangleGlow=nextTriangle;}
        if(nextRing){release(ringBody);ringBody=nextRing;}if(nextRingGlow){release(ringGlow);ringGlow=nextRingGlow;}
        trailColor=trail;rippleColor=ripple;particleColor=particle;cyan->SetColor(color(trail));ring->SetColor(color(ripple));white->SetColor(color(particle));return S_OK;
    }
    HRESULT createRingSprites(){
        // Reconstruct the reference's thin annulus and circumferential gradient
        // procedurally. These 192px caches are created once, never per frame.
        // The mesh's outer/inner radius ratio is 1.063668; the horizontal
        // gradient runs around the circumference, not across the ring width.
        TRY(ringBodyPixels.allocate(192*192*4));TRY(ringGlowPixels.allocate(192*192*4));
        for(int y=0;y<192;y++)for(int x=0;x<192;x++){
            double px=x-95.5,py=y-95.5,radius=std::sqrt(px*px+py*py),angle=std::atan2(py,px);
            double arc=std::pow((std::max)(0.0,.5+.5*std::cos(angle)),1.6);
            double edge=(std::max)(0.0,(std::min)(1.0,(std::min)(radius-70+.5,70*1.063668-radius+.5)));
            double distance=radius-72.2284;BYTE a=(BYTE)(255*arc*edge),g=(BYTE)(255*arc*.34*std::exp(-distance*distance/12.5));int i=(y*192+x)*4;
            for(int c=0;c<4;c++){ringBodyPixels.bytes[i+c]=a;ringGlowPixels.bytes[i+c]=g;}
        }
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        TRY(dc->CreateBitmap(ringSize,ringBodyPixels.bytes,192*4,&props,&whiteRingBody));TRY(dc->CreateBitmap(ringSize,ringGlowPixels.bytes,192*4,&props,&whiteRingGlow));
        TRY(tint(ringBodyPixels,ringSize,rippleColor,0xffffff,&ringBody));return tint(ringGlowPixels,ringSize,rippleColor,0xffffff,&ringGlow);
    }
    HRESULT initialize(HWND hwnd,BYTE* line,UINT lineSize,BYTE* tri,UINT triSize){
        HRESULT hr=D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&d3d,nullptr,nullptr);
        hardware=SUCCEEDED(hr);
        if(FAILED(hr))hr=D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_WARP,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&d3d,nullptr,nullptr);
        TRY(hr);TRY(d3d->QueryInterface(IID_PPV_ARGS(&dxgi)));
        D2D1_FACTORY_OPTIONS opts={};TRY(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED,__uuidof(ID2D1Factory1),&opts,reinterpret_cast<void**>(&factory)));
        TRY(factory->CreateDevice(dxgi,&device));TRY(device->CreateDeviceContext(D2D1_DEVICE_CONTEXT_OPTIONS_NONE,&dc));dc->SetDpi(96,96);
        TRY(dc->CreateSolidColorBrush(D2D1::ColorF(69/255.f,237/255.f,1),&cyan));TRY(dc->CreateSolidColorBrush(D2D1::ColorF(196/255.f,252/255.f,1),&white));
        TRY(dc->CreateSolidColorBrush(D2D1::ColorF(69/255.f,237/255.f,1),&ring));
        D2D1_STROKE_STYLE_PROPERTIES stroke={D2D1_CAP_STYLE_ROUND,D2D1_CAP_STYLE_ROUND,D2D1_CAP_STYLE_ROUND,D2D1_LINE_JOIN_ROUND,10,D2D1_DASH_STYLE_SOLID,0};
        TRY(factory->CreateStrokeStyle(stroke,nullptr,0,&round));TRY(factory->CreatePathGeometry(&triangle));
        ID2D1GeometrySink* sink=nullptr;TRY(triangle->Open(&sink));sink->BeginFigure(D2D1::Point2F(0,-1),D2D1_FIGURE_BEGIN_FILLED);sink->AddLine(D2D1::Point2F(.86f,.5f));sink->AddLine(D2D1::Point2F(-.86f,.5f));sink->EndFigure(D2D1_FIGURE_END_CLOSED);hr=sink->Close();release(sink);TRY(hr);
        TRY(load(line,lineSize,&lineGlow,linePixels,this->lineSize));TRY(load(tri,triSize,&triangleGlow,trianglePixels,triangleSize));
        // A single cached white version of the fragment glow supports the
        // short birth flash. No per-frame recoloring, blur, or readback.
        PixelBuffer flashPixels;TRY(flashPixels.allocate(trianglePixels.length));
        for(UINT i=0;i<trianglePixels.length;i+=4){BYTE alpha=trianglePixels.bytes[i+3];flashPixels.bytes[i]=flashPixels.bytes[i+1]=flashPixels.bytes[i+2]=flashPixels.bytes[i+3]=alpha;}
        auto flashProps=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        TRY(dc->CreateBitmap(triangleSize,flashPixels.bytes,triangleSize.width*4,&flashProps,&whiteTriangleGlow));
        TRY(createRingSprites());
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
            if(alpha==0||((c.kind==2||c.kind==5)&&c.width<=0))continue;
            // Adjacent round caps and glow sprites describe one continuous
            // trail, not extra light sources. Keep their greatest coverage
            // instead of accumulating brightness at every input sample.
            dc->SetPrimitiveBlend(c.kind==0||c.kind==3?trailBlend:(c.kind>=3?D2D1_PRIMITIVE_BLEND_ADD:D2D1_PRIMITIVE_BLEND_SOURCE_OVER));
            cyan->SetOpacity(alpha);white->SetOpacity(alpha);ring->SetOpacity(alpha);dc->SetTransform(base);
            if(c.kind==0)dc->DrawLine(D2D1::Point2F(c.x,c.y),D2D1::Point2F(c.x2,c.y2),cyan,c.width,round);
            else if(c.kind==1||c.kind==4)dc->DrawEllipse(D2D1::Ellipse(D2D1::Point2F(c.x,c.y),c.x2,c.x2),ring,c.width);
            else if(c.kind==2){
                float flash=(std::max)(0.f,(std::min)(1.f,c.x2)),tone=c.y2>0?(std::min)(1.f,c.y2):1.f;auto tint=color(particleColor);
                white->SetColor(D2D1::ColorF(tint.r*tone*(1-flash)+flash,tint.g*tone*(1-flash)+flash,tint.b*tone*(1-flash)+flash));
                dc->SetTransform(D2D1::Matrix3x2F::Scale(c.width,c.width)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);dc->FillGeometry(triangle,white);
            }
            else if(c.kind==3){
                float size=c.width,len=c.x2;dc->SetTransform(D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);
                auto source=D2D1::RectF(0,0,64,128);auto dest=D2D1::RectF(-32*size,-32*size,0,32*size);dc->DrawBitmap(lineGlow,dest,alpha,D2D1_INTERPOLATION_MODE_LINEAR,&source);
                source=D2D1::RectF(64,0,128,128);dest=D2D1::RectF(0,-32*size,len,32*size);dc->DrawBitmap(lineGlow,dest,alpha,D2D1_INTERPOLATION_MODE_LINEAR,&source);
                source=D2D1::RectF(128,0,192,128);dest=D2D1::RectF(len,-32*size,len+32*size,32*size);dc->DrawBitmap(lineGlow,dest,alpha,D2D1_INTERPOLATION_MODE_LINEAR,&source);
            }else if(c.kind==5){
                float size=c.width,flash=(std::max)(0.f,(std::min)(1.f,c.x2)),tone=c.y2>0?(std::min)(1.f,c.y2):1.f;
                dc->SetTransform(D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);auto dest=D2D1::RectF(-32*size,-32*size,32*size,32*size);
                if(flash<1)dc->DrawBitmap(triangleGlow,dest,alpha*tone*(1-flash),D2D1_INTERPOLATION_MODE_LINEAR);
                if(flash>0)dc->DrawBitmap(whiteTriangleGlow,dest,alpha*flash,D2D1_INTERPOLATION_MODE_LINEAR);
            }else if(c.kind==6||c.kind==7){
                float flash=(std::max)(0.f,(std::min)(1.f,c.y2)),scale=c.x2/70.f;
                dc->SetTransform(D2D1::Matrix3x2F::Scale(scale,scale)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);auto dest=D2D1::RectF(-96,-96,96,96);
                if(flash<1)dc->DrawBitmap(c.kind==6?ringBody:ringGlow,dest,alpha*(1-flash),D2D1_INTERPOLATION_MODE_LINEAR);
                if(flash>0)dc->DrawBitmap(c.kind==6?whiteRingBody:whiteRingGlow,dest,alpha*flash,D2D1_INTERPOLATION_MODE_LINEAR);
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
extern "C" __declspec(dllexport) HRESULT __cdecl CursorCreate(HWND hwnd,BYTE* line,UINT lineSize,BYTE* tri,UINT triSize,Renderer** output){
    if(!output||!hwnd||!line||!tri||!lineSize||!triSize)return E_INVALIDARG;*output=nullptr;void* memory=HeapAlloc(GetProcessHeap(),0,sizeof(Renderer));if(!memory)return E_OUTOFMEMORY;auto r=new(memory)Renderer();HRESULT hr=r->initialize(hwnd,line,lineSize,tri,triSize);if(FAILED(hr)){destroy(r);return hr;}*output=r;return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorRender(Renderer* r,int x,int y,int w,int h,const DrawCommand* commands,int count){if(!r||w<1||h<1||count<0||count>2048||(!commands&&count))return E_INVALIDARG;return r->render(x,y,w,h,commands,count);}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorCapture(Renderer* r,int w,int h,const DrawCommand* commands,int count,BYTE* pixels){if(!r||!pixels||w<1||h<1||w>4096||h>4096||count<0||count>2048)return E_INVALIDARG;return r->capture(w,h,commands,count,pixels);}
extern "C" __declspec(dllexport) int __cdecl CursorHardware(Renderer* r){return r&&r->hardware?1:0;}
extern "C" __declspec(dllexport) HRESULT __cdecl CursorAppearance(Renderer* r,UINT trail,UINT ripple,UINT particle){return r?r->appearance(trail,ripple,particle):E_INVALIDARG;}
extern "C" __declspec(dllexport) void __cdecl CursorDestroy(Renderer* r){destroy(r);}
