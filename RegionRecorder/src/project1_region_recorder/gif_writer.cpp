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

bool GifWriter::HasRoomForAnotherFrame(int width, int height) const {
    // GIF LZW can occasionally be larger than its indexed input. Reserving two bytes per pixel
    // plus 64 KiB keeps the configured limit hard at the cost of stopping conservatively.
    const uint64_t worstFrame = static_cast<uint64_t>(width) * height * 2 + 4'096;
    const uint64_t current = CurrentSize();
    return current < limitBytes_ && worstFrame + 65'536 < limitBytes_ - current;
}

bool GifWriter::AddBgraFrame(const std::vector<uint8_t>& bgra, int delayCentiseconds,
                             bool& limitReached, std::wstring& error) {
    limitReached = false;
    if (!encoder_ || bgra.size() < static_cast<size_t>(width_) * height_ * 4) return false;
    const size_t frameBytes = static_cast<size_t>(width_) * height_ * 4;
    const int delay = std::clamp(delayCentiseconds, 1, 65535);
    if (!pendingPixels_.empty() && pendingDelay_ <= 65535 - delay &&
        previousRaw_.size() == frameBytes &&
        std::equal(previousRaw_.begin(), previousRaw_.end(), bgra.begin())) {
        pendingDelay_ += delay;
        return true;
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

    if (FAILED(hr)) {
        error = L"Preparing the GIF frame failed: " + HrText(hr);
        return false;
    }
    // Compare displayed RGB values, not palette indices: a local palette can change
    // its ordering between frames even when the visible colors remain identical.
    RECT dirty{0, 0, width_, height_};
    if (SUCCEEDED(hr) && canvas_.size() == indexed.size()) {
        dirty = {width_, height_, 0, 0};
        for (int y = 0; y < height_; ++y) {
            for (int x = 0; x < width_; ++x) {
                const size_t i = static_cast<size_t>(y) * width_ + x;
                if (canvas_[i] == (colors[indexed[i]] & 0xffffff)) continue;
                dirty.left = std::min(dirty.left, static_cast<LONG>(x));
                dirty.top = std::min(dirty.top, static_cast<LONG>(y));
                dirty.right = std::max(dirty.right, static_cast<LONG>(x + 1));
                dirty.bottom = std::max(dirty.bottom, static_cast<LONG>(y + 1));
            }
        }
        if (dirty.right <= dirty.left) {
            if (!pendingPixels_.empty() && pendingDelay_ <= 65535 - delay) {
                pendingDelay_ += delay;
                previousRaw_.assign(bgra.begin(), bgra.begin() + frameBytes);
                return true;
            }
            // Split very long holds before the GIF delay field overflows.
            dirty = {0, 0, 1, 1};
        }
    }
    const int frameWidth = dirty.right - dirty.left;
    const int frameHeight = dirty.bottom - dirty.top;
    if (!FlushPending(error)) return false;
    if (!HasRoomForAnotherFrame(frameWidth, frameHeight)) {
        limitReached = true;
        return false;
    }
    std::vector<BYTE> cropped(static_cast<size_t>(frameWidth) * frameHeight);
    std::array<int, 256> remap;
    remap.fill(-1);
    std::array<WICColor, 256> localColors{};
    UINT localCount = 0;
    size_t unchanged = 0;
    const bool haveCanvas = canvas_.size() == indexed.size();
    const auto isUnchanged = [&](size_t i) {
        return haveCanvas && canvas_[i] == (colors[indexed[i]] & 0xffffff);
    };
    for (int y = 0; y < frameHeight; ++y) {
        for (int x = 0; x < frameWidth; ++x) {
            const size_t i = static_cast<size_t>(y + dirty.top) * width_ + x + dirty.left;
            if (isUnchanged(i)) { ++unchanged; continue; }
            const BYTE original = indexed[i];
            if (remap[original] < 0) {
                remap[original] = static_cast<int>(localCount);
                localColors[localCount++] = colors[original];
            }
        }
    }
    // A transparent entry is optional. If changed pixels need all 256 colors,
    // keep them all and emit an opaque rectangle instead of reducing color quality.
    const bool transparent = unchanged != 0 && localCount < 256;
    if (!transparent) {
        remap.fill(-1);
        localCount = 0;
    }
    const int transparentIndex = transparent ? static_cast<int>(localCount) : -1;
    if (transparent) localColors[localCount++] = 0;
    {
        for (int y = 0; y < frameHeight; ++y) {
            for (int x = 0; x < frameWidth; ++x) {
                const size_t i = static_cast<size_t>(y + dirty.top) * width_ + x + dirty.left;
                if (transparent && isUnchanged(i)) {
                    cropped[static_cast<size_t>(y) * frameWidth + x] = static_cast<BYTE>(transparentIndex);
                    continue;
                }
                const BYTE original = indexed[i];
                if (remap[original] < 0) {
                    remap[original] = static_cast<int>(localCount);
                    localColors[localCount++] = colors[original];
                }
                cropped[static_cast<size_t>(y) * frameWidth + x] = static_cast<BYTE>(remap[original]);
            }
        }
        if (localCount == 1) localColors[localCount++] = 0xff000000;
    }

    pendingLeft_ = dirty.left; pendingTop_ = dirty.top;
    pendingWidth_ = frameWidth; pendingHeight_ = frameHeight;
    pendingDelay_ = delay; pendingTransparent_ = transparentIndex;
    pendingPixels_ = std::move(cropped);
    pendingColors_.assign(localColors.begin(), localColors.begin() + localCount);
    canvas_.resize(indexed.size());
    for (size_t i = 0; i < indexed.size(); ++i) canvas_[i] = colors[indexed[i]] & 0xffffff;
    previousRaw_.assign(bgra.begin(), bgra.begin() + frameBytes);
    return true;
}

bool GifWriter::FlushPending(std::wstring& error) {
    if (pendingPixels_.empty()) return true;
    HRESULT hr = palette_->InitializeCustom(pendingColors_.data(), static_cast<UINT>(pendingColors_.size()));
    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    if (SUCCEEDED(hr)) hr = encoder_->CreateNewFrame(&frame, &options);
    if (SUCCEEDED(hr)) hr = frame->Initialize(options.Get());
    if (SUCCEEDED(hr)) hr = frame->SetSize(pendingWidth_, pendingHeight_);
    if (SUCCEEDED(hr)) hr = frame->SetResolution(96.0, 96.0);
    WICPixelFormatGUID format = GUID_WICPixelFormat8bppIndexed;
    if (SUCCEEDED(hr)) hr = frame->SetPixelFormat(&format);
    if (SUCCEEDED(hr) && format != GUID_WICPixelFormat8bppIndexed)
        hr = WINCODEC_ERR_UNSUPPORTEDPIXELFORMAT;
    if (SUCCEEDED(hr)) hr = frame->SetPalette(palette_.Get());

    ComPtr<IWICMetadataQueryWriter> metadata;
    if (SUCCEEDED(hr)) hr = frame->GetMetadataQueryWriter(&metadata);
    if (SUCCEEDED(hr)) {
        PROPVARIANT position{};
        PropVariantInit(&position);
        position.vt = VT_UI2;
        position.uiVal = static_cast<USHORT>(pendingLeft_);
        hr = metadata->SetMetadataByName(L"/imgdesc/Left", &position);
        position.uiVal = static_cast<USHORT>(pendingTop_);
        if (SUCCEEDED(hr)) hr = metadata->SetMetadataByName(L"/imgdesc/Top", &position);
        PROPVARIANT delay{};
        PropVariantInit(&delay);
        delay.vt = VT_UI2;
        delay.uiVal = static_cast<USHORT>(pendingDelay_);
        if (SUCCEEDED(hr)) hr = metadata->SetMetadataByName(L"/grctlext/Delay", &delay);
        PROPVARIANT disposal{};
        PropVariantInit(&disposal);
        disposal.vt = VT_UI1;
        disposal.bVal = 1;
        if (SUCCEEDED(hr)) hr = metadata->SetMetadataByName(L"/grctlext/Disposal", &disposal);
        PROPVARIANT transparency{};
        PropVariantInit(&transparency);
        transparency.vt = VT_BOOL;
        transparency.boolVal = pendingTransparent_ >= 0 ? VARIANT_TRUE : VARIANT_FALSE;
        if (SUCCEEDED(hr)) hr = metadata->SetMetadataByName(L"/grctlext/TransparencyFlag", &transparency);
        if (pendingTransparent_ >= 0) {
            PROPVARIANT index{};
            PropVariantInit(&index);
            index.vt = VT_UI1;
            index.bVal = static_cast<BYTE>(pendingTransparent_);
            if (SUCCEEDED(hr)) hr = metadata->SetMetadataByName(L"/grctlext/TransparentColorIndex", &index);
        }

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
        hr = frame->WritePixels(pendingHeight_, pendingWidth_, static_cast<UINT>(pendingPixels_.size()), pendingPixels_.data());
    }
    if (SUCCEEDED(hr)) hr = frame->Commit();
    pendingPixels_.clear();
    pendingColors_.clear();
    pendingDelay_ = 0;
    if (FAILED(hr)) {
        error = L"Writing the GIF frame failed: " + HrText(hr);
        return false;
    }
    ++frames_;
    return true;
}

bool GifWriter::Close(std::wstring* error) {
    std::wstring ignored;
    const bool pendingOk = FlushPending(error ? *error : ignored);
    const HRESULT result = encoder_ ? encoder_->Commit() : S_OK;
    if (FAILED(result) && error && pendingOk) *error = L"Completing the GIF file failed: " + HrText(result);
    encoder_.Reset();
    palette_.Reset();
    stream_.Reset();
    factory_.Reset();
    width_ = height_ = 0;
    limitBytes_ = frames_ = 0;
    canvas_.clear();
    previousRaw_.clear();
    pendingPixels_.clear();
    pendingColors_.clear();
    pendingLeft_ = pendingTop_ = pendingWidth_ = pendingHeight_ = pendingDelay_ = 0;
    pendingTransparent_ = -1;
    return pendingOk && SUCCEEDED(result);
}

}  // namespace lc
