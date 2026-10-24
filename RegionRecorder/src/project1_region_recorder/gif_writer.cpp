#include "project1_region_recorder/gif_writer.h"

#include <algorithm>
#include <array>
#include <unordered_map>

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

    // A fixed RGB332 palette maps neutral dark gray to yellow/green because blue
    // has only four levels. Optimize all 256 colors for this frame instead. Each
    // frame receives its own local table so later scenes are not stuck with frame 1.
    ComPtr<IWICBitmap> bitmap;
    HRESULT hr = factory_->CreateBitmapFromMemory(
        width_, height_, GUID_WICPixelFormat32bppBGR, width_ * 4,
        static_cast<UINT>(static_cast<size_t>(width_) * height_ * 4),
        const_cast<BYTE*>(bgra.data()), &bitmap);
    if (SUCCEEDED(hr)) hr = palette_->InitializeFromBitmap(bitmap.Get(), 256, FALSE);
    std::array<WICColor, 256> colors{};
    UINT colorCount = 0;
    if (SUCCEEDED(hr)) hr = palette_->GetColors(static_cast<UINT>(colors.size()), colors.data(), &colorCount);
    if (SUCCEEDED(hr) && colorCount == 0) hr = E_FAIL;
    std::vector<BYTE> indexed(static_cast<size_t>(width_) * height_);
    if (SUCCEEDED(hr)) {
        // WIC's indexed converter can map (30,30,30) to (18,18,18) even when
        // the palette contains an exact match. Preserve palette colors exactly
        // and find nearest colors ourselves. The bounded 6-bit cache avoids an
        // unbounded per-frame RGB map for photographic/noisy content.
        std::unordered_map<uint32_t, BYTE> exact;
        for (UINT i = 0; i < colorCount; ++i) exact[colors[i] & 0xffffff] = static_cast<BYTE>(i);
        const auto nearest = [&](int r, int g, int b) {
            int best = 0, distance = INT_MAX;
            for (UINT i = 0; i < colorCount; ++i) {
                const int dr = r - static_cast<int>((colors[i] >> 16) & 255);
                const int dg = g - static_cast<int>((colors[i] >> 8) & 255);
                const int db = b - static_cast<int>(colors[i] & 255);
                const int d = dr * dr + dg * dg + db * db;
                if (d < distance) { best = static_cast<int>(i); distance = d; }
            }
            return static_cast<int16_t>(best);
        };
        std::array<int16_t, 256> gray{};
        gray.fill(-1);
        std::vector<int16_t> cache(64 * 64 * 64, -1);
        for (size_t i = 0; i < indexed.size(); ++i) {
            const int b = bgra[i * 4], g = bgra[i * 4 + 1], r = bgra[i * 4 + 2];
            const uint32_t rgb = static_cast<uint32_t>((r << 16) | (g << 8) | b);
            const auto found = exact.find(rgb);
            if (found != exact.end()) { indexed[i] = found->second; continue; }
            if (r == g && g == b) {
                if (gray[r] < 0) gray[r] = nearest(r, g, b);
                indexed[i] = static_cast<BYTE>(gray[r]);
            } else {
                auto& index = cache[((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)];
                if (index < 0) index = nearest((r & ~3) + 2, (g & ~3) + 2, (b & ~3) + 2);
                indexed[i] = static_cast<BYTE>(index);
            }
        }
    }

    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    if (SUCCEEDED(hr)) hr = encoder_->CreateNewFrame(&frame, &options);
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
