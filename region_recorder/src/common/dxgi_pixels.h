#pragma once
#include <windows.h>
#include <dxgi1_2.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <vector>

namespace lc::dxgi {
inline POINT TexturePoint(int x,int y,int width,int height,DXGI_MODE_ROTATION rotation) {
    switch(rotation) {
    case DXGI_MODE_ROTATION_ROTATE90:return {y,height-1-x};
    case DXGI_MODE_ROTATION_ROTATE180:return {width-1-x,height-1-y};
    case DXGI_MODE_ROTATION_ROTATE270:return {width-1-y,x};
    default:return {x,y};
    }
}
inline RECT TextureCrop(RECT crop,int width,int height,DXGI_MODE_ROTATION rotation) {
    const auto a=TexturePoint(crop.left,crop.top,width,height,rotation);
    const auto b=TexturePoint(crop.right-1,crop.bottom-1,width,height,rotation);
    return {std::min(a.x,b.x),std::min(a.y,b.y),std::max(a.x,b.x)+1,std::max(a.y,b.y)+1};
}
inline void CopyCrop(const uint8_t* data,UINT pitch,POINT origin,int rawWidth,int rawHeight,
                     DXGI_MODE_ROTATION rotation,RECT crop,std::vector<uint8_t>& output) {
    const int width=crop.right-crop.left,height=crop.bottom-crop.top;
    output.resize(static_cast<size_t>(width)*height*4);
    for(int y=0;y<height;++y) {
        if(rotation==DXGI_MODE_ROTATION_IDENTITY || rotation==DXGI_MODE_ROTATION_UNSPECIFIED) {
            std::memcpy(output.data()+static_cast<size_t>(y)*width*4,
                data+static_cast<size_t>(crop.top+y-origin.y)*pitch+(crop.left-origin.x)*4,
                static_cast<size_t>(width)*4);
        } else for(int x=0;x<width;++x) {
            const auto p=TexturePoint(crop.left+x,crop.top+y,rawWidth,rawHeight,rotation);
            std::memcpy(output.data()+(static_cast<size_t>(y)*width+x)*4,
                data+static_cast<size_t>(p.y-origin.y)*pitch+(p.x-origin.x)*4,4);
        }
        for(int x=0;x<width;++x) output[(static_cast<size_t>(y)*width+x)*4+3]=255;
    }
}
struct PointerState {
    bool visible=false;
    HMONITOR owner{};
    LONGLONG timestamp=0,shapeTimestamp=0;
    POINT position{}; // Desktop bitmap top-left; not the hotspot.
    DXGI_OUTDUPL_POINTER_SHAPE_INFO info{};
    std::vector<uint8_t> shape;
    void Update(HMONITOR monitor,const RECT& bounds,const DXGI_OUTDUPL_FRAME_INFO& frame) {
        if(!frame.LastMouseUpdateTime.QuadPart) return;
        if(!frame.PointerPosition.Visible && owner!=monitor) return;
        if(frame.PointerPosition.Visible && visible && owner!=monitor && timestamp>frame.LastMouseUpdateTime.QuadPart) return;
        visible=frame.PointerPosition.Visible!=FALSE;
        position={bounds.left+frame.PointerPosition.Position.x,bounds.top+frame.PointerPosition.Position.y};
        timestamp=frame.LastMouseUpdateTime.QuadPart;owner=monitor;
    }
};
inline bool CompositePointer(std::vector<uint8_t>& pixels,int width,int height,
                             const RECT& region,const PointerState& pointer) {
    if(!pointer.visible || pointer.shape.empty()) return true;
    const auto& info=pointer.info;
    const bool mono=info.Type==DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME;
    if(!mono && info.Type!=DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR && info.Type!=DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR) return false;
    const UINT cursorHeight=mono?info.Height/2:info.Height;
    if(!info.Width || !cursorHeight || (mono && info.Height%2) ||
       info.Pitch<(mono?(info.Width+7)/8:static_cast<uint64_t>(info.Width)*4) ||
       static_cast<uint64_t>(info.Pitch)*info.Height>pointer.shape.size()) return false;
    const int left=pointer.position.x-region.left,top=pointer.position.y-region.top;
    const int x0=std::max(0,-left),y0=std::max(0,-top);
    const int x1=std::min<int>(info.Width,width-left),y1=std::min<int>(cursorHeight,height-top);
    for(int y=y0;y<y1;++y) for(int x=x0;x<x1;++x) {
        auto* destination=pixels.data()+(static_cast<size_t>(top+y)*width+left+x)*4;
        if(mono) {
            const BYTE mask=static_cast<BYTE>(0x80>>(x%8));
            const bool andBit=pointer.shape[static_cast<size_t>(y)*info.Pitch+x/8]&mask;
            const bool xorBit=pointer.shape[static_cast<size_t>(y+cursorHeight)*info.Pitch+x/8]&mask;
            for(int c=0;c<3;++c) destination[c]=(andBit?destination[c]:0)^(xorBit?255:0);
        } else {
            const auto* source=pointer.shape.data()+static_cast<size_t>(y)*info.Pitch+x*4;
            if(info.Type==DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR) {
                for(int c=0;c<3;++c) destination[c]=source[3]?destination[c]^source[c]:source[c];
            } else for(int c=0;c<3;++c)
                destination[c]=static_cast<BYTE>((source[c]*source[3]+destination[c]*(255-source[3])+127)/255);
        }
        destination[3]=255;
    }
    return true;
}
} // namespace lc::dxgi
