#include "common/wgc_capture.h"

#include <roapi.h>
#include <winstring.h>
#include <windows.foundation.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstring>

namespace lc {
namespace {

using CaptureItem = ABI::Windows::Graphics::Capture::IGraphicsCaptureItem;
using FramePool = ABI::Windows::Graphics::Capture::IDirect3D11CaptureFramePool;
using FramePoolStatics2 = ABI::Windows::Graphics::Capture::IDirect3D11CaptureFramePoolStatics2;
using CaptureFrame = ABI::Windows::Graphics::Capture::IDirect3D11CaptureFrame;
using Direct3DDevice = ABI::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
using Direct3DSurface = ABI::Windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;

template <typename T>
HRESULT ActivationFactory(const wchar_t* className, T** result) {
    HSTRING_HEADER header{};
    HSTRING name{};
    const UINT32 length = static_cast<UINT32>(wcslen(className));
    HRESULT hr = WindowsCreateStringReference(className, length, &header, &name);
    if (FAILED(hr)) return hr;
    return RoGetActivationFactory(name, __uuidof(T), reinterpret_cast<void**>(result));
}

}  // namespace

WgcCapture::~WgcCapture() {
    Stop();
    winrtDevice_.Reset();
    context_.Reset();
    device_.Reset();
    if (roNeedsUninitialize_) RoUninitialize();
}

void WgcCapture::CloseInspectable(IInspectable* value) {
    if (!value) return;
    ComPtr<ABI::Windows::Foundation::IClosable> closable;
    if (SUCCEEDED(value->QueryInterface(IID_PPV_ARGS(&closable)))) closable->Close();
}

bool WgcCapture::SetCursorCaptureEnabled(bool enabled) {
    if (!session_) return false;
    ComPtr<ABI::Windows::Graphics::Capture::IGraphicsCaptureSession2> options;
    if (FAILED(session_->QueryInterface(IID_PPV_ARGS(&options)))) return false;
    return SUCCEEDED(options->put_IsCursorCaptureEnabled(enabled));
}

bool WgcCapture::GetCursorCaptureEnabled(bool& enabled) const {
    if (!session_) return false;
    ComPtr<ABI::Windows::Graphics::Capture::IGraphicsCaptureSession2> options;
    if (FAILED(session_->QueryInterface(IID_PPV_ARGS(&options)))) return false;
    boolean value=false;
    if (FAILED(options->get_IsCursorCaptureEnabled(&value))) return false;
    enabled=value!=0;
    return true;
}

void WgcCapture::Stop() {
    CloseInspectable(session_.Get());
    CloseInspectable(framePool_.Get());
    session_.Reset();
    framePool_.Reset();
    item_.Reset();
    staging_.Reset();
    stagingWidth_ = stagingHeight_ = 0;
    sourceWidth_ = sourceHeight_ = 0;
}

bool WgcCapture::CreateDevice(std::wstring& error) {
    // A D3D device is relatively expensive to create. Keep it alive between source switches.
    if (device_ && context_ && winrtDevice_) return true;

    UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
#ifdef _DEBUG
    flags |= D3D11_CREATE_DEVICE_DEBUG;
#endif
    D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
                                  D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0};
    D3D_FEATURE_LEVEL selected{};
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels,
                                   ARRAYSIZE(levels), D3D11_SDK_VERSION, &device_, &selected,
                                   &context_);
    if (FAILED(hr)) {
        hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
                               D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, ARRAYSIZE(levels),
                               D3D11_SDK_VERSION, &device_, &selected, &context_);
    }
    if (FAILED(hr)) {
        error = L"Unable to create a D3D11 device: " + HrText(hr);
        return false;
    }

    ComPtr<IDXGIDevice> dxgi;
    hr = device_.As(&dxgi);
    if (FAILED(hr)) {
        error = L"Unable to access the DXGI device: " + HrText(hr);
        return false;
    }
    ComPtr<IInspectable> inspectable;
    hr = CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), &inspectable);
    if (FAILED(hr)) {
        error = L"Unable to create the WinRT D3D device: " + HrText(hr);
        return false;
    }
    hr = inspectable.As(&winrtDevice_);
    if (FAILED(hr)) {
        error = L"Unable to query IDirect3DDevice: " + HrText(hr);
        return false;
    }
    return true;
}

bool WgcCapture::StartForWindow(HWND window, std::wstring& error,
                                bool showSystemCaptureBorder) {
    Stop();
    if (!IsWindow(window)) {
        error = L"The selected window no longer exists.";
        return false;
    }
    if (!roNeedsUninitialize_) {
        HRESULT init = RoInitialize(RO_INIT_MULTITHREADED);
        if (FAILED(init) && init != RPC_E_CHANGED_MODE) {
            error = L"Windows Runtime initialization failed: " + HrText(init);
            return false;
        }
        roNeedsUninitialize_ = SUCCEEDED(init);
    }
    ComPtr<IGraphicsCaptureItemInterop> interop;
    HRESULT hr = ActivationFactory(RuntimeClass_Windows_Graphics_Capture_GraphicsCaptureItem,
                                   interop.GetAddressOf());
    if (FAILED(hr)) {
        error = L"Windows Graphics Capture is unavailable: " + HrText(hr);
        return false;
    }
    ComPtr<CaptureItem> item;
    hr = interop->CreateForWindow(window, __uuidof(CaptureItem),
                                  reinterpret_cast<void**>(item.GetAddressOf()));
    if (FAILED(hr)) {
        error = L"This window cannot be captured: " + HrText(hr);
        return false;
    }
    return StartItem(item.Get(), error, showSystemCaptureBorder);
}

bool WgcCapture::StartForMonitor(HMONITOR monitor, std::wstring& error, bool captureCursor) {
    Stop();
    if (!monitor) {
        error = L"No monitor was selected.";
        return false;
    }
    if (!roNeedsUninitialize_) {
        HRESULT init = RoInitialize(RO_INIT_MULTITHREADED);
        if (FAILED(init) && init != RPC_E_CHANGED_MODE) {
            error = L"Windows Runtime initialization failed: " + HrText(init);
            return false;
        }
        roNeedsUninitialize_ = SUCCEEDED(init);
    }
    ComPtr<IGraphicsCaptureItemInterop> interop;
    HRESULT hr = ActivationFactory(RuntimeClass_Windows_Graphics_Capture_GraphicsCaptureItem,
                                   interop.GetAddressOf());
    if (FAILED(hr)) {
        error = L"Windows Graphics Capture is unavailable: " + HrText(hr);
        return false;
    }
    ComPtr<CaptureItem> item;
    hr = interop->CreateForMonitor(monitor, __uuidof(CaptureItem),
                                   reinterpret_cast<void**>(item.GetAddressOf()));
    if (FAILED(hr)) {
        error = L"This monitor cannot be captured: " + HrText(hr);
        return false;
    }
    return StartItem(item.Get(), error, true, captureCursor);
}

bool WgcCapture::StartItem(IUnknown* itemUnknown, std::wstring& error,
                           bool showSystemCaptureBorder, bool captureCursor) {
    if (!CreateDevice(error)) return false;
    HRESULT hr = itemUnknown->QueryInterface(IID_PPV_ARGS(&item_));
    if (FAILED(hr)) {
        error = L"Unable to access the capture item: " + HrText(hr);
        return false;
    }
    ABI::Windows::Graphics::SizeInt32 size{};
    hr = item_->get_Size(&size);
    if (FAILED(hr) || size.Width <= 0 || size.Height <= 0) {
        error = L"The capture source has no usable size.";
        return false;
    }
    sourceWidth_ = size.Width;
    sourceHeight_ = size.Height;

    ComPtr<FramePoolStatics2> statics;
    hr = ActivationFactory(RuntimeClass_Windows_Graphics_Capture_Direct3D11CaptureFramePool,
                           statics.GetAddressOf());
    if (FAILED(hr)) {
        error = L"Unable to create a capture frame pool: " + HrText(hr);
        return false;
    }
    hr = statics->CreateFreeThreaded(
        winrtDevice_.Get(),
        ABI::Windows::Graphics::DirectX::DirectXPixelFormat_B8G8R8A8UIntNormalized, 2, size,
        &framePool_);
    if (FAILED(hr)) {
        error = L"Unable to allocate capture frames: " + HrText(hr);
        return false;
    }
    hr = framePool_->CreateCaptureSession(item_.Get(), &session_);
    if (FAILED(hr)) {
        error = L"Unable to create a capture session: " + HrText(hr);
        return false;
    }
    if (!showSystemCaptureBorder) {
        // IGraphicsCaptureSession3 is available on Windows builds that support
        // IsBorderRequired. Querying it keeps older Windows versions compatible.
        ComPtr<ABI::Windows::Graphics::Capture::IGraphicsCaptureSession3> session3;
        if (SUCCEEDED(session_.As(&session3))) session3->put_IsBorderRequired(false);
    }
    // Configure before the first frame, including after the recorder moves to another monitor.
    SetCursorCaptureEnabled(captureCursor);
    hr = session_->StartCapture();
    if (FAILED(hr)) {
        error = L"Unable to start screen capture: " + HrText(hr);
        return false;
    }
    return true;
}

bool WgcCapture::EnsureStaging(int width, int height) {
    if (staging_ && stagingWidth_ == width && stagingHeight_ == height) return true;
    staging_.Reset();
    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = static_cast<UINT>(width);
    desc.Height = static_cast<UINT>(height);
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    const HRESULT hr = device_->CreateTexture2D(&desc, nullptr, &staging_);
    if (FAILED(hr)) return false;
    stagingWidth_ = width;
    stagingHeight_ = height;
    return true;
}

bool WgcCapture::CaptureLatest(std::vector<uint8_t>& bgra, int& width, int& height,
                               const RECT* sourceRect) {
    if (!framePool_ || !context_) return false;

    ComPtr<CaptureFrame> frame;
    // Drain the tiny frame pool so slow callers always process the newest available frame.
    for (int i = 0; i < 3; ++i) {
        ComPtr<CaptureFrame> next;
        const HRESULT hr = framePool_->TryGetNextFrame(&next);
        if (FAILED(hr) || !next) break;
        if (frame) CloseInspectable(frame.Get());
        frame = std::move(next);
    }
    if (!frame) return false;

    ABI::Windows::Graphics::SizeInt32 content{};
    if (FAILED(frame->get_ContentSize(&content)) || content.Width <= 0 || content.Height <= 0)
        return false;

    ComPtr<Direct3DSurface> surface;
    if (FAILED(frame->get_Surface(&surface)) || !surface) return false;
    ComPtr<Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess> access;
    if (FAILED(surface.As(&access))) return false;
    ComPtr<ID3D11Texture2D> texture;
    if (FAILED(access->GetInterface(__uuidof(ID3D11Texture2D),
                                    reinterpret_cast<void**>(texture.GetAddressOf()))))
        return false;

    D3D11_TEXTURE2D_DESC textureDescription{};
    texture->GetDesc(&textureDescription);
    const int availableWidth = std::min<int>(content.Width, textureDescription.Width);
    const int availableHeight = std::min<int>(content.Height, textureDescription.Height);

    RECT crop{0, 0, availableWidth, availableHeight};
    if (sourceRect) crop = *sourceRect;
    crop.left = std::clamp<LONG>(crop.left, 0, availableWidth);
    crop.top = std::clamp<LONG>(crop.top, 0, availableHeight);
    crop.right = std::clamp<LONG>(crop.right, crop.left, availableWidth);
    crop.bottom = std::clamp<LONG>(crop.bottom, crop.top, availableHeight);
    width = crop.right - crop.left;
    height = crop.bottom - crop.top;
    if (width <= 0 || height <= 0 || !EnsureStaging(width, height)) return false;

    D3D11_BOX box{};
    box.left = static_cast<UINT>(crop.left);
    box.top = static_cast<UINT>(crop.top);
    box.right = static_cast<UINT>(crop.right);
    box.bottom = static_cast<UINT>(crop.bottom);
    box.front = 0;
    box.back = 1;
    context_->CopySubresourceRegion(staging_.Get(), 0, 0, 0, 0, texture.Get(), 0, &box);

    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(context_->Map(staging_.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return false;
    bgra.resize(static_cast<size_t>(width) * height * 4);
    for (int y = 0; y < height; ++y) {
        std::memcpy(bgra.data() + static_cast<size_t>(y) * width * 4,
                    static_cast<const uint8_t*>(mapped.pData) +
                        static_cast<size_t>(y) * mapped.RowPitch,
                    static_cast<size_t>(width) * 4);
    }
    context_->Unmap(staging_.Get(), 0);

    // Release every reference to the old pool surface before recreating it.
    const bool sourceResized = content.Width != sourceWidth_ || content.Height != sourceHeight_;
    texture.Reset();
    access.Reset();
    surface.Reset();
    CloseInspectable(frame.Get());
    frame.Reset();
    if (sourceResized) {
        sourceWidth_ = content.Width;
        sourceHeight_ = content.Height;
        staging_.Reset();
        stagingWidth_ = stagingHeight_ = 0;
        ABI::Windows::Graphics::SizeInt32 newSize{content.Width, content.Height};
        framePool_->Recreate(
            winrtDevice_.Get(),
            ABI::Windows::Graphics::DirectX::DirectXPixelFormat_B8G8R8A8UIntNormalized, 2,
            newSize);
    }
    return true;
}

}  // namespace lc
