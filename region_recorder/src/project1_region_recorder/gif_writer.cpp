#include "project1_region_recorder/gif_writer.h"

#include <algorithm>
#include <array>

namespace lc {

GifWriter::~GifWriter() { Close(); }

bool GifWriter::Open(const std::wstring& path, int width, int height, uint64_t sizeLimitBytes,
                     std::wstring& error) {
    Close();
    width_ = width;
    height_ = height;
    limitBytes_ = sizeLimitBytes;
    HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(&factory_));
    if (SUCCEEDED(hr)) hr = factory_->CreateStream(&stream_);
    if (SUCCEEDED(hr)) hr = stream_->InitializeFromFilename(path.c_str(), GENERIC_WRITE);
    if (SUCCEEDED(hr)) hr = factory_->CreateEncoder(GUID_ContainerFormatGif, nullptr, &encoder_);
    if (SUCCEEDED(hr)) hr = encoder_->Initialize(stream_.Get(), WICBitmapEncoderNoCache);
    if (SUCCEEDED(hr)) hr = factory_->CreatePalette(&palette_);

    std::array<WICColor, 256> colors{};
    for (int index = 0; index < 256; ++index) {
        const int r = ((index >> 5) & 7) * 255 / 7;
        const int g = ((index >> 2) & 7) * 255 / 7;
        const int b = (index & 3) * 255 / 3;
        colors[static_cast<size_t>(index)] = 0xff000000u | static_cast<WICColor>(r << 16) |
                                             static_cast<WICColor>(g << 8) |
                                             static_cast<WICColor>(b);
    }
    if (SUCCEEDED(hr)) hr = palette_->InitializeCustom(colors.data(), colors.size());
    if (FAILED(hr)) {
        error = L"Unable to initialize the GIF encoder: " + HrText(hr);
        Close();
        return false;
    }
    return true;
}

uint64_t GifWriter::CurrentSize() const {
    if (!stream_) return 0;
    STATSTG status{};
    if (FAILED(stream_->Stat(&status, STATFLAG_NONAME))) return 0;
    return static_cast<uint64_t>(status.cbSize.QuadPart);
}

bool GifWriter::HasRoomForAnotherFrame() const {
    // GIF LZW can occasionally be larger than its indexed input. Reserving two bytes per pixel
    // plus 64 KiB keeps the configured limit hard at the cost of stopping conservatively.
    const uint64_t worstFrame = static_cast<uint64_t>(width_) * height_ * 2 + 4'096;
    const uint64_t current = CurrentSize();
    return current < limitBytes_ && worstFrame + 65'536 < limitBytes_ - current;
}

bool GifWriter::AddBgraFrame(const std::vector<uint8_t>& bgra, int delayCentiseconds,
                             bool& limitReached, std::wstring& error) {
    limitReached = false;
    if (!encoder_ || bgra.size() < static_cast<size_t>(width_) * height_ * 4) return false;
    if (!HasRoomForAnotherFrame()) {
        limitReached = true;
        return false;
    }

    std::vector<BYTE> indexed(static_cast<size_t>(width_) * height_);
    for (size_t i = 0; i < indexed.size(); ++i) {
        const BYTE b = bgra[i * 4 + 0];
        const BYTE g = bgra[i * 4 + 1];
        const BYTE r = bgra[i * 4 + 2];
        indexed[i] = static_cast<BYTE>((r & 0xe0) | ((g & 0xe0) >> 3) | (b >> 6));
    }

    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    HRESULT hr = encoder_->CreateNewFrame(&frame, &options);
    if (SUCCEEDED(hr)) hr = frame->Initialize(options.Get());
    if (SUCCEEDED(hr)) hr = frame->SetSize(width_, height_);
    if (SUCCEEDED(hr)) hr = frame->SetResolution(96.0, 96.0);
    WICPixelFormatGUID format = GUID_WICPixelFormat8bppIndexed;
    if (SUCCEEDED(hr)) hr = frame->SetPixelFormat(&format);
    if (SUCCEEDED(hr) && format != GUID_WICPixelFormat8bppIndexed)
        hr = WINCODEC_ERR_UNSUPPORTEDPIXELFORMAT;
    if (SUCCEEDED(hr)) hr = frame->SetPalette(palette_.Get());

    ComPtr<IWICMetadataQueryWriter> metadata;
    if (SUCCEEDED(hr) && SUCCEEDED(frame->GetMetadataQueryWriter(&metadata)) && metadata) {
        PROPVARIANT delay{};
        PropVariantInit(&delay);
        delay.vt = VT_UI2;
        delay.uiVal = static_cast<USHORT>(std::clamp(delayCentiseconds, 1, 65535));
        metadata->SetMetadataByName(L"/grctlext/Delay", &delay);
        PROPVARIANT disposal{};
        PropVariantInit(&disposal);
        disposal.vt = VT_UI1;
        disposal.bVal = 1;
        metadata->SetMetadataByName(L"/grctlext/Disposal", &disposal);

        // Netscape loop extension: repeat indefinitely. Failure is non-fatal on older codecs.
        if (frames_ == 0) {
            char appName[] = "NETSCAPE2.0";
            PROPVARIANT app{};
            PropVariantInit(&app);
            app.vt = VT_LPSTR;
            app.pszVal = appName;
            metadata->SetMetadataByName(L"/appext/application", &app);
            BYTE loopData[] = {3, 1, 0, 0, 0};
            PROPVARIANT data{};
            PropVariantInit(&data);
            data.vt = VT_VECTOR | VT_UI1;
            data.caub.cElems = ARRAYSIZE(loopData);
            data.caub.pElems = loopData;
            metadata->SetMetadataByName(L"/appext/data", &data);
        }
    }

    if (SUCCEEDED(hr)) {
        hr = frame->WritePixels(height_, width_, static_cast<UINT>(indexed.size()), indexed.data());
    }
    if (SUCCEEDED(hr)) hr = frame->Commit();
    if (FAILED(hr)) {
        error = L"Writing the GIF frame failed: " + HrText(hr);
        return false;
    }
    ++frames_;
    if (CurrentSize() >= limitBytes_) limitReached = true;
    return true;
}

bool GifWriter::Close(std::wstring* error) {
    const HRESULT result = encoder_ ? encoder_->Commit() : S_OK;
    if (FAILED(result) && error) *error = L"Completing the GIF file failed: " + HrText(result);
    encoder_.Reset();
    palette_.Reset();
    stream_.Reset();
    factory_.Reset();
    width_ = height_ = 0;
    limitBytes_ = frames_ = 0;
    return SUCCEEDED(result);
}

}  // namespace lc
