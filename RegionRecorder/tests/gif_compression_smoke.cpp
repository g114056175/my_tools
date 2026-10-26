#include "project1_region_recorder/gif_writer.h"
#include <iostream>
#include <stdexcept>

using lc::ComPtr;
namespace {
constexpr int W = 128, H = 64;
struct Sample { std::vector<uint8_t> pixels; int delay; };
void Check(HRESULT hr) { if (FAILED(hr)) throw std::runtime_error("WIC operation failed"); }
unsigned Metadata(IWICMetadataQueryReader* reader, const wchar_t* name) {
    PROPVARIANT value{};
    Check(reader->GetMetadataByName(name, &value));
    unsigned result = value.vt == VT_UI2 ? value.uiVal : value.vt == VT_BOOL ? value.boolVal != 0 : value.bVal;
    PropVariantClear(&value);
    return result;
}
std::vector<uint8_t> Pattern(int scene, bool grayscale = false) {
    std::vector<uint8_t> pixels(W * H * 4, 255);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        auto* p = pixels.data() + (y * W + x) * 4;
        if (grayscale) {
            const int gray = (x + y * W + scene) % 256;
            p[0] = p[1] = p[2] = static_cast<BYTE>(gray);
            if (scene && x == 0 && y == 0) p[0] = p[1] = p[2] = 0;
        } else {
            p[0] = p[1] = p[2] = 30;
            if (y % 12 == 3 && x > 12 && x < 110) { p[0] = 180; p[1] = 140; p[2] = 60; }
            if (x >= 8 + scene * 8 && x < 13 + scene * 8 && y > 15 && y < 24)
                p[0] = p[1] = p[2] = 255;
        }
    }
    return pixels;
}
void Run(const std::wstring& path, const std::vector<Sample>& source, UINT expectedFrames,
         bool expectTransparent, bool expectFullPalette) {
    lc::GifWriter writer;
    std::wstring error;
    if (!writer.Open(path, W, H, 1'000'000, error)) throw std::runtime_error("GIF open");
    for (const auto& sample : source) {
        bool limited = false;
        if (!writer.AddBgraFrame(sample.pixels, sample.delay, limited, error) || limited)
            throw std::runtime_error("GIF sample encoding");
    }
    if (!writer.Close(&error)) { std::wcerr << error; throw std::runtime_error("GIF close"); }

    ComPtr<IWICImagingFactory> factory;
    ComPtr<IWICBitmapDecoder> decoder;
    Check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
    Check(factory->CreateDecoderFromFilename(path.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &decoder));
    UINT count = 0; Check(decoder->GetFrameCount(&count));
    if (count != expectedFrames) throw std::runtime_error("Duplicate-frame merging");
    std::vector<uint8_t> canvas(W * H * 4, 255);
    unsigned time = 0, expectedEnd = 0;
    size_t sourceIndex = 0;
    bool foundTransparent = false, foundFullPalette = false;
    for (UINT index = 0; index < count; ++index) {
        ComPtr<IWICBitmapFrameDecode> frame;
        ComPtr<IWICMetadataQueryReader> metadata;
        ComPtr<IWICFormatConverter> converter;
        Check(decoder->GetFrame(index, &frame)); Check(frame->GetMetadataQueryReader(&metadata));
        const unsigned x = Metadata(metadata.Get(), L"/imgdesc/Left"), y = Metadata(metadata.Get(), L"/imgdesc/Top");
        const unsigned delay = Metadata(metadata.Get(), L"/grctlext/Delay");
        foundTransparent |= Metadata(metadata.Get(), L"/grctlext/TransparencyFlag") != 0;
        if (Metadata(metadata.Get(), L"/grctlext/Disposal") != 1) throw std::runtime_error("GIF disposal");
        ComPtr<IWICPalette> palette;
        Check(factory->CreatePalette(&palette)); Check(frame->CopyPalette(palette.Get()));
        UINT colors = 0; Check(palette->GetColorCount(&colors));
        foundFullPalette |= colors == 256;
        UINT width = 0, height = 0; Check(frame->GetSize(&width, &height));
        if (x + width > W || y + height > H) throw std::runtime_error("GIF bounds");
        Check(factory->CreateFormatConverter(&converter));
        Check(converter->Initialize(frame.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone,
                                    nullptr, 0, WICBitmapPaletteTypeCustom));
        std::vector<uint8_t> patch(static_cast<size_t>(width) * height * 4);
        Check(converter->CopyPixels(nullptr, width * 4, static_cast<UINT>(patch.size()), patch.data()));
        for (UINT row = 0; row < height; ++row) for (UINT column = 0; column < width; ++column) {
            const auto* p = patch.data() + (row * width + column) * 4;
            if (p[3]) for (int c = 0; c < 3; ++c) canvas[((y + row) * W + x + column) * 4 + c] = p[c];
        }
        for (unsigned end = time + delay; time < end; ++time) {
            while (time >= expectedEnd && sourceIndex < source.size()) expectedEnd += source[sourceIndex++].delay;
            if (sourceIndex == 0 || time >= expectedEnd) throw std::runtime_error("GIF duration");
            const auto& expected = source[sourceIndex - 1].pixels;
            for (size_t p = 0; p < canvas.size(); p += 4) for (int c = 0; c < 3; ++c)
                if (canvas[p + c] != expected[p + c]) throw std::runtime_error("GIF displayed colors changed");
        }
    }
    unsigned duration = 0; for (const auto& sample : source) duration += sample.delay;
    if (time != duration || foundTransparent != expectTransparent ||
        (expectFullPalette && !foundFullPalette)) throw std::runtime_error("GIF metadata/palette");
    decoder.Reset();
    DeleteFileW(path.c_str());
    std::cout << "samples=" << source.size() << " encoded=" << count << " duration=" << time
              << "cs transparent=" << foundTransparent << " 256-color=" << foundFullPalette << ": PASS\n";
}
}
int wmain() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    wchar_t temporary[MAX_PATH]{}; GetTempPathW(MAX_PATH, temporary);
    const auto path = std::wstring(temporary) + L"LC-gif-compression-" + std::to_wstring(GetCurrentProcessId()) + L".gif";
    try {
        std::vector<Sample> still;
        for (int i = 0; i < 72; ++i) still.push_back({Pattern(0), i % 6 == 5 ? 5 : 4});
        Run(path, still, 1, false, false);
        std::vector<Sample> moving;
        for (int i : {0, 1, 1, 3, 3, 0}) moving.push_back({Pattern(i), 5});
        Run(path, moving, 4, true, false);
        Run(path, {{Pattern(0, true), 5}, {Pattern(1, true), 5}, {Pattern(1, true), 5}}, 2, false, true);
    } catch (const std::exception& error) {
        DeleteFileW(path.c_str());
        std::cerr << error.what() << '\n';
        CoUninitialize();
        return 1;
    }
    CoUninitialize();
    return 0;
}
