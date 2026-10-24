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
struct DrawCommand {int kind;float x,y,x2,y2,width,angle,alpha,startAge,endAge;int shape;};
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
    static constexpr int FragmentShapeCount=5;
    ID2D1SolidColorBrush* cyan=nullptr;ID2D1SolidColorBrush* white=nullptr;ID2D1StrokeStyle* round=nullptr;ID2D1PathGeometry* fragmentShapes[FragmentShapeCount]={};
    ID2D1LinearGradientBrush* trailGradient=nullptr;D2D1_COLOR_F trailStops[33]={};
    ID2D1Bitmap1* whiteRingBody=nullptr;
    ID2D1Bitmap1* ringGuide=nullptr;
    ID2D1Effect* ringClip=nullptr;ID2D1Effect* ringProduct=nullptr;ID2D1Effect* ringTint=nullptr;
    ID2D1Bitmap1* coreBody=nullptr;ID2D1Bitmap1* coreGlow=nullptr;ID2D1Bitmap1* fragmentGlow[FragmentShapeCount]={};ID2D1Effect* coreTint=nullptr;
    ID2D1Bitmap1* flashBody=nullptr;ID2D1Effect* flashTint=nullptr;
    D2D1_SIZE_U ringSize={384,384};
    UINT trailColor=0x45edff,rippleColor=0x45edff,particleColor=0xc4fcff;
    D2D1_COLOR_F waterStart={},waterEnd={},waterEdge={};
    int width=0,height=0;bool hardware=false;
    ~Renderer(){if(dc)dc->SetTarget(nullptr);release(surface);release(trailGradient);for(auto& bitmap:fragmentGlow)release(bitmap);release(coreGlow);release(coreTint);release(coreBody);release(flashTint);release(flashBody);release(ringTint);release(ringProduct);release(ringClip);release(ringGuide);release(whiteRingBody);for(auto& geometry:fragmentShapes)release(geometry);release(round);release(white);release(cyan);release(visual);release(target);release(comp);release(dc);release(device);release(factory);release(dxgi);release(d3d);}
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
        // Emissive normalization makes neutral colors translucent white.
        // Blend smoothly toward ordinary dark/gray ink for low-chroma colors;
        // its alpha still follows the same light curve and reaches zero.
        float chroma=(std::min)(1.f,8*((std::max)(c.r,(std::max)(c.g,c.b))-(std::min)(c.r,(std::min)(c.g,c.b)))),inverse=alpha>0?1/alpha:0;
        return D2D1::ColorF(r*inverse*chroma+c.r*(1-chroma),g*inverse*chroma+c.g*(1-chroma),b*inverse*chroma+c.b*(1-chroma),alpha*chroma+lightToSDR(light)*(1-chroma));
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
        // Three independent colors: shared trail/rim, pale water, fragments.
        // The UI derives linked colors once. No second hue algorithm here
        // that darkens the selected water again at the end of its lifetime.
        auto c=color(ripple);
        waterStart=D2D1::ColorF(c.r+.06f*(1-c.r),c.g+.06f*(1-c.g),c.b+.06f*(1-c.b));
        waterEnd=c;
        waterEdge=D2D1::ColorF(c.r*.90f,c.g*.95f,c.b);
        cyan->SetColor(color(trail));white->SetColor(color(particle));return S_OK;
    }
    HRESULT createRingSprites(){
        // Cached local masks, not a blurred desktop-sized surface. A higher
        // resolution retains antialiasing when the click is enlarged.
        // The mesh's outer/inner radius ratio is 1.063668; the horizontal
        // gradient runs around the circumference, not across the ring width.
        PixelBuffer ringBodyPixels;TRY(ringBodyPixels.allocate(384*384*4));
        PixelBuffer guidePixels;TRY(guidePixels.allocate(384*384*4));
        for(int y=0;y<384;y++)for(int x=0;x<384;x++){
            double px=x-191.5,py=y-191.5,radius=std::sqrt(px*px+py*py),angle=std::atan2(py,px);
            // Both cached arcs stay within the water's expansion envelope.
            const double outer=140,inner=140/1.095;
            // A gentle radial phase shift tapers arc ends instead of cutting
            // the whole stroke off on the same straight radial line.
            double u=std::fmod(.9995+(95.625-angle*180/3.14159265359)/360*.999+(radius-(inner+outer)*.5)*.0008,1.0);if(u<0)u+=1;
            double uu=u*16;int ix=(std::min)(15,(int)uu);double fx=uu-ix;
            double v=(std::max)(0.0,(std::min)(8.0,(radius-inner)/(outer-inner)*8));int row=(std::min)(7,(int)v);double fy=v-row;
            auto sample=[&](int column){return referenceRingAlpha[row][column]*(1-fy)+referenceRingAlpha[row+1][column]*fy;};
            double p0=sample((std::max)(0,ix-1)),p1=sample(ix),p2=sample(ix+1),p3=sample((std::min)(16,ix+2));
            double profile=(std::max)(0.0,(std::min)(1.0,(p1+.5*fx*(p2-p0+fx*(2*p0-5*p1+4*p2-p3+fx*(3*(p1-p2)+p3-p0))))/255));
            // Use the source's broad angular profile; no high-frequency
            // modulation that turns late arc ends into separate shards.
            double mainAlpha=(std::max)(0.0,(std::min)(1.0,std::pow(profile,.64)));
            double edge=(std::max)(0.0,(std::min)(1.0,(std::min)(radius-inner+1.5,outer-radius+1.5)/3));
            double halo=.18*std::exp(-.5*std::pow((radius-(inner+outer)*.5)/4.3,2));
            // A radial component in the dissolve field narrows the tips as
            // the angular threshold rises, rather than fading an equal-width
            // stroke. It is cached once; no per-frame geometry or blur pass.
            double radial=.35+.65*std::exp(-.5*std::pow((radius-(inner+outer)*.5)/((outer-inner)*.4),2));
            BYTE a=(BYTE)std::round(255*mainAlpha*(std::min)(1.0,edge+halo));int i=(y*384+x)*4;
            for(int c=0;c<4;c++){ringBodyPixels.bytes[i+c]=a;guidePixels.bytes[i+c]=(BYTE)std::round(255*mainAlpha*radial);}
        }
        auto props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED),96,96);
        TRY(dc->CreateBitmap(ringSize,ringBodyPixels.bytes,384*4,&props,&whiteRingBody));
        TRY(dc->CreateBitmap(ringSize,guidePixels.bytes,384*4,&props,&ringGuide));
        // Threshold samples the texture alpha, never rasterized mesh coverage.
        // Keeping the two separate preserves AA on the thin radial edges.
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&ringClip));ringClip->SetInput(0,ringGuide);
        TRY(ringClip->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));TRY(ringClip->SetValue(D2D1_COLORMATRIX_PROP_CLAMP_OUTPUT,TRUE));
        TRY(dc->CreateEffect(CLSID_D2D1ArithmeticComposite,&ringProduct));ringProduct->SetInput(0,whiteRingBody);ringProduct->SetInputEffect(1,ringClip);TRY(ringProduct->SetValue(D2D1_ARITHMETICCOMPOSITE_PROP_COEFFICIENTS,D2D1_VECTOR_4F{1,0,0,0}));
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&ringTint));ringTint->SetInputEffect(0,ringProduct);TRY(ringTint->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));
        // Cached inward coverage and complementary color weights for water.
        // A separate bounded blue halo may extend beyond the shared rim.
        PixelBuffer corePixels;TRY(corePixels.allocate(384*384*4));
        PixelBuffer glowPixels;TRY(glowPixels.allocate(384*384*4));
        for(int y=0;y<384;y++)for(int x=0;x<384;x++){
            double px=x-191.5,py=y-191.5,r=std::sqrt(px*px+py*py)/140;
            double t=(std::max)(0.0,(std::min)(1.0,(1-r)/.16));
            BYTE a=(BYTE)std::round(255*t*t*(3-2*t));int i=(y*384+x)*4;
            double angle=std::atan2(py,px),xx=px/140+.15,yy=py/140+.12;
            double balance=(std::max)(0.0,(std::min)(1.0,.35+.55*std::exp(-(xx*xx+yy*yy)/.405)+.10*std::sin(3*angle+.7)*r*r));
            // Complementary R/G weights sum to coverage, allowing cached
            // nonuniform palette water without another per-frame texture.
            BYTE weight=(BYTE)std::round(a*balance);corePixels.bytes[i]=0;corePixels.bytes[i+1]=a-weight;corePixels.bytes[i+2]=weight;corePixels.bytes[i+3]=a;
            double rays=.68+.17*std::cos(3*angle+.2)+.10*std::cos(5*angle-1.4)+.05*std::cos(9*angle+.8);
            double cutoff=(std::max)(0.0,(std::min)(1.0,(1.16-r)/.04));
            BYTE glow=(BYTE)std::round(255*.32*rays*std::exp(-.5*std::pow((r-.96)/(.055+.065*rays),2))*cutoff);
            for(int c=0;c<4;c++)glowPixels.bytes[i+c]=glow;
        }
        TRY(dc->CreateBitmap(ringSize,corePixels.bytes,384*4,&props,&coreBody));
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&coreTint));coreTint->SetInput(0,coreBody);
        TRY(coreTint->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));TRY(coreTint->SetValue(D2D1_COLORMATRIX_PROP_CLAMP_OUTPUT,TRUE));
        TRY(dc->CreateBitmap(ringSize,glowPixels.bytes,384*4,&props,&coreGlow));
        // Broad, smooth birth-flash fringe. Unlike the water mask, there is
        // no narrow inner edge that leaves a visible concentric partition.
        for(int y=0;y<384;y++)for(int x=0;x<384;x++){
            double px=x-191.5,py=y-191.5,r=std::sqrt(px*px+py*py)/140;
            double t=(std::max)(0.0,(std::min)(1.0,(1.18-r)/.45));
            BYTE a=(BYTE)std::round(255*t*t*(3-2*t));int i=(y*384+x)*4;
            double fringe=(std::max)(0.0,(std::min)(1.0,(r-.73)/.45));fringe=fringe*fringe*(3-2*fringe);
            BYTE whiteWeight=(BYTE)std::round(a*(1-fringe));corePixels.bytes[i]=0;corePixels.bytes[i+1]=a-whiteWeight;corePixels.bytes[i+2]=whiteWeight;corePixels.bytes[i+3]=a;
        }
        TRY(dc->CreateBitmap(ringSize,corePixels.bytes,384*4,&props,&flashBody));
        TRY(dc->CreateEffect(CLSID_D2D1ColorMatrix,&flashTint));flashTint->SetInput(0,flashBody);
        TRY(flashTint->SetValue(D2D1_COLORMATRIX_PROP_ALPHA_MODE,D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED));TRY(flashTint->SetValue(D2D1_COLORMATRIX_PROP_CLAMP_OUTPUT,TRUE));
        return S_OK;
    }
    HRESULT createFragmentShapes(){
        // Geometry and exterior glow are built once per device. The shared
        // particle clock, tint and opacity never create an asset per frame.
        PixelBuffer pixels;TRY(pixels.allocate(96*96*4));
        D2D1_BITMAP_PROPERTIES1 props=D2D1::BitmapProperties1(D2D1_BITMAP_OPTIONS_NONE,D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM,D2D1_ALPHA_MODE_PREMULTIPLIED));
        for(int shape=0;shape<FragmentShapeCount;shape++){
            D2D1_POINT_2F outline[64];int count=0;ID2D1GeometrySink* sink=nullptr;
            TRY(factory->CreatePathGeometry(&fragmentShapes[shape]));TRY(fragmentShapes[shape]->Open(&sink));
            if(shape==1){
                // Compact upright heart: size is normalized to the triangle's
                // visible area, rather than using its wider raw bounding box.
                const D2D1_POINT_2F keys[13]={{0,.88f},{-.18f,.66f},{-.95f,.10f},{-.95f,-.34f},{-.95f,-.94f},{-.25f,-1.06f},{0,-.52f},{.25f,-1.06f},{.95f,-.94f},{.95f,-.34f},{.95f,.10f},{.18f,.66f},{0,.88f}};
                auto scaled=[](D2D1_POINT_2F p){return D2D1::Point2F(p.x*.84f,p.y*.84f);};
                sink->BeginFigure(scaled(keys[0]),D2D1_FIGURE_BEGIN_FILLED);
                for(int curve=0;curve<4;curve++){
                    int k=curve*3;sink->AddBezier(D2D1::BezierSegment(scaled(keys[k+1]),scaled(keys[k+2]),scaled(keys[k+3])));
                    for(int step=0;step<16;step++){float t=step/16.f,u=1-t;outline[count++]=scaled(D2D1::Point2F(u*u*u*keys[k].x+3*u*u*t*keys[k+1].x+3*u*t*t*keys[k+2].x+t*t*t*keys[k+3].x,u*u*u*keys[k].y+3*u*u*t*keys[k+1].y+3*u*t*t*keys[k+2].y+t*t*t*keys[k+3].y));}
                }
            }else{
                const D2D1_POINT_2F triangle[3]={{0,-1},{.86f,.5f},{-.86f,.5f}};
                const D2D1_POINT_2F arrow[7]={{0,-1},{.82f,-.12f},{.32f,-.12f},{.32f,.88f},{-.32f,.88f},{-.32f,-.12f},{-.82f,-.12f}};
                const D2D1_POINT_2F lightning[6]={{.12f,-1},{-.72f,.14f},{-.12f,.14f},{-.38f,1},{.76f,-.22f},{.16f,-.22f}};
                if(shape==3){
                    count=10;for(int i=0;i<count;i++){double angle=-3.141592653589793/2+i*3.141592653589793/5;float radius=i%2?.44f:1.f;outline[i]=D2D1::Point2F(radius*(float)std::cos(angle),radius*(float)std::sin(angle));}
                }else{
                    count=shape==0?3:shape==2?7:6;for(int i=0;i<count;i++){auto p=shape==0?triangle[i]:shape==2?arrow[i]:lightning[i];float scale=shape==0?1.f:shape==2?.88f:.95f;outline[i]=D2D1::Point2F(p.x*scale,p.y*scale);}
                }
                sink->BeginFigure(outline[0],D2D1_FIGURE_BEGIN_FILLED);for(int i=1;i<count;i++)sink->AddLine(outline[i]);
            }
            sink->EndFigure(D2D1_FIGURE_END_CLOSED);HRESULT hr=sink->Close();release(sink);TRY(hr);
            for(int y=0;y<96;y++)for(int x=0;x<96;x++){
                double px=x-47.5,py=y-47.5,distance=1e6;bool inside=false;
                for(int j=0;j<count;j++){
                    int k=(j+1)%count;double ax=outline[j].x*24,ay=outline[j].y*24,bx=outline[k].x*24,by=outline[k].y*24,dx=bx-ax,dy=by-ay,qx=px-ax,qy=py-ay;
                    if((ay>py)!=(by>py)&&px<(bx-ax)*(py-ay)/(by-ay)+ax)inside=!inside;
                    double t=(std::max)(0.0,(std::min)(1.0,(qx*dx+qy*dy)/(dx*dx+dy*dy))),ex=qx-t*dx,ey=qy-t*dy;distance=(std::min)(distance,std::sqrt(ex*ex+ey*ey));
                }
                double cutoff=(std::max)(0.0,(std::min)(1.0,(10-distance)/3));BYTE a=(BYTE)std::round(255*.34*(inside?0:std::exp(-.5*std::pow(distance/3.6,2))*cutoff));int at=(y*96+x)*4;for(int c=0;c<4;c++)pixels.bytes[at+c]=a;
            }
            TRY(dc->CreateBitmap(D2D1::SizeU(96,96),pixels.bytes,96*4,&props,&fragmentGlow[shape]));
        }
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
        TRY(factory->CreateStrokeStyle(stroke,nullptr,0,&round));
        TRY(createFragmentShapes());
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
            if((c.kind!=0&&c.kind!=2&&c.kind!=6&&c.kind!=8&&c.kind!=9)||alpha==0||(c.kind==2&&c.width<=0)||((c.kind==8||c.kind==9)&&c.x2<=0))continue;
            // Adjacent round caps describe one continuous
            // trail, not extra light sources. Keep their greatest coverage
            // instead of accumulating brightness at every input sample.
            dc->SetPrimitiveBlend(c.kind==0?trailBlend:D2D1_PRIMITIVE_BLEND_SOURCE_OVER);
            white->SetOpacity(alpha);
            if(c.kind==0){
                dc->SetTransform(base);
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
                int shape=(std::max)(0,(std::min)(FragmentShapeCount-1,c.shape));
                float flash=(std::max)(0.f,(std::min)(1.f,c.x2)),tone=c.y2>0?.92f+.08f*(std::min)(1.f,c.y2):1.f;auto tint=color(particleColor);
                // Bright white body with a subtle palette-colored halo;
                // colored fragments keep their saturation instead of pastel.
                float haloFlash=flash*.55f;
                auto rotation=D2D1::Matrix3x2F::Rotation(c.angle),position=D2D1::Matrix3x2F::Translation(c.x,c.y);
                white->SetColor(D2D1::ColorF(tint.r*tone*(1-haloFlash)+haloFlash,tint.g*tone*(1-haloFlash)+haloFlash,tint.b*tone*(1-haloFlash)+haloFlash));
                dc->SetTransform(D2D1::Matrix3x2F::Translation(-48,-48)*D2D1::Matrix3x2F::Scale(c.width/24,c.width/24)*rotation*position*base);
                dc->SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);dc->FillOpacityMask(fragmentGlow[shape],white,nullptr,nullptr);dc->SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
                flash*=.985f;white->SetColor(D2D1::ColorF(tint.r*tone*(1-flash)+flash,tint.g*tone*(1-flash)+flash,tint.b*tone*(1-flash)+flash));
                dc->SetTransform(D2D1::Matrix3x2F::Scale(c.width,c.width)*rotation*position*base);dc->FillGeometry(fragmentShapes[shape],white);
            }
            else if(c.kind==8){
                // Slightly tinted white flash -> pale palette water -> clear.
                float flash=(std::max)(0.f,(std::min)(1.f,c.width)),u=(std::max)(0.f,(std::min)(1.f,c.y2*.25f/.17f)),progress=u*u*(3-2*u);
                auto tint=D2D1::ColorF(waterStart.r+(waterEnd.r-waterStart.r)*progress,waterStart.g+(waterEnd.g-waterStart.g)*progress,waterStart.b+(waterEnd.b-waterStart.b)*progress);
                float edgeMix=.70f*(1-progress);auto edge=D2D1::ColorF(tint.r+(waterEdge.r-tint.r)*edgeMix,tint.g+(waterEdge.g-tint.g)*edgeMix,tint.b+(waterEdge.b-tint.b)*edgeMix);
                float glowFlash=flash*.25f,glowAge=(std::max)(0.f,(std::min)(1.f,c.y2*.25f/.09f));
                auto glowTint=D2D1::ColorF(waterEdge.r+(1-waterEdge.r)*glowFlash,waterEdge.g+(1-waterEdge.g)*glowFlash,waterEdge.b+(1-waterEdge.b)*glowFlash);
                flash*=.96f;
                dc->SetTransform(D2D1::Matrix3x2F::Translation(-192,-192)*D2D1::Matrix3x2F::Scale(c.x2/140.f,c.x2/140.f)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);
                dc->SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);
                white->SetColor(glowTint);white->SetOpacity(alpha*(1-glowAge*glowAge*(3-2*glowAge)));dc->FillOpacityMask(coreGlow,white,nullptr,nullptr);
                D2D1_MATRIX_5X4_F water={};water._11=tint.r*(1-flash)+flash;water._12=tint.g*(1-flash)+flash;water._13=tint.b*(1-flash)+flash;
                float edgeFlash=flash*.84f;water._21=edge.r*(1-edgeFlash)+edgeFlash;water._22=edge.g*(1-edgeFlash)+edgeFlash;water._23=edge.b*(1-edgeFlash)+edgeFlash;water._44=alpha;coreTint->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,water);
                dc->DrawImage(coreTint,nullptr,nullptr,D2D1_INTERPOLATION_MODE_LINEAR,D2D1_COMPOSITE_MODE_SOURCE_OVER);
                dc->SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
            }
            else if(c.kind==9){
                D2D1_MATRIX_5X4_F light={};light._11=.97f+.03f*waterEdge.r;light._12=.97f+.03f*waterEdge.g;light._13=.97f+.03f*waterEdge.b;
                light._21=waterEdge.r;light._22=waterEdge.g;light._23=waterEdge.b;light._44=alpha;flashTint->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,light);
                dc->SetTransform(D2D1::Matrix3x2F::Translation(-192,-192)*D2D1::Matrix3x2F::Scale(c.x2/140.f,c.x2/140.f)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);
                dc->DrawImage(flashTint,nullptr,nullptr,D2D1_INTERPOLATION_MODE_LINEAR,D2D1_COMPOSITE_MODE_PLUS);
            }
            else if(c.kind==6){
                if(c.width>1)continue;
                float flash=(std::max)(0.f,(std::min)(1.f,c.y2)),scale=c.x2/140.f*(1-c.startAge);
                // DXBC: discard when MainTex.a * particleAlpha < threshold.
                // The command carries threshold / particleAlpha; user opacity
                // is applied afterward and cannot alter the dissolve timing.
                // Straight RGB stays white. Setting it to clipped alpha here
                // squared RGB during premultiplication, producing gray tips.
                D2D1_MATRIX_5X4_F clip={};clip._51=clip._52=clip._53=1;clip._44=4.5f;clip._54=.5f-c.width*4.5f;
                ringClip->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,clip);
                // PREMULTIPLIED color matrix unpremultiplies its input and
                // premultiplies the result. Apply opacity only to the alpha
                // row, avoiding a second alpha multiplication of the RGB.
                // The gain approximates the reference HDR material on SDR.
                // Source RGB multiplies material tint and particle color; a
                // white particle multiplier is not a white replacement stroke.
                auto tintColor=color(trailColor);float gain=1.25f*(.8f+.2f*flash);D2D1_MATRIX_5X4_F tint={};tint._11=(std::min)(1.f,gain*tintColor.r);tint._22=(std::min)(1.f,gain*tintColor.g);tint._33=(std::min)(1.f,gain*tintColor.b);tint._44=alpha;ringTint->SetValue(D2D1_COLORMATRIX_PROP_COLOR_MATRIX,tint);
                dc->SetTransform(D2D1::Matrix3x2F::Translation(-192,-192)*D2D1::Matrix3x2F::Scale(scale,scale)*D2D1::Matrix3x2F::Rotation(c.angle)*D2D1::Matrix3x2F::Translation(c.x,c.y)*base);
                dc->DrawImage(ringTint,nullptr,nullptr,D2D1_INTERPOLATION_MODE_HIGH_QUALITY_CUBIC,D2D1_COMPOSITE_MODE_PLUS);
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
