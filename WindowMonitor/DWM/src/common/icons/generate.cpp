// Regenerate the checked-in ICO assets using the same artwork as the app windows:
// clang++ -std=c++20 -I . common/icons/generate.cpp -o build/generate_icons.exe -lgdiplus -lgdi32 -luser32 -lole32
// build/generate_icons.exe common/icons
#include "common/native_theme.h"
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <vector>

#pragma pack(push, 1)
struct IconHeader { WORD reserved = 0, type = 1, count = 0; };
struct IconEntry {
    BYTE width, height, colors = 0, reserved = 0;
    WORD planes = 1, bits = 32;
    DWORD bytes = 0, offset = 0;
};
#pragma pack(pop)

void WriteIcon(const std::filesystem::path& path, bool monitor, COLORREF accent) {
    const int sizes[] = {16, 20, 24, 32, 40, 48, 64, 128, 256};
    std::vector<IconEntry> entries;
    std::vector<std::vector<BYTE>> images;
    DWORD offset = sizeof(IconHeader) + sizeof(IconEntry) * std::size(sizes);
    for (int size : sizes) {
        HICON icon = lc::ui::AppIcon(monitor, size, accent);
        ICONINFO info{};
        if (!icon || !GetIconInfo(icon, &info)) throw std::runtime_error("Cannot render icon");
        BITMAPINFO bitmap{};
        bitmap.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        bitmap.bmiHeader.biWidth = size;
        bitmap.bmiHeader.biHeight = size;
        bitmap.bmiHeader.biPlanes = 1;
        bitmap.bmiHeader.biBitCount = 32;
        const DWORD pixels = size * size * 4;
        std::vector<BYTE> bgra(pixels);
        HDC dc = GetDC(nullptr);
        const int rows = GetDIBits(dc, info.hbmColor, 0, size,
            bgra.data(), &bitmap, DIB_RGB_COLORS);
        ReleaseDC(nullptr, dc);
        DeleteObject(info.hbmColor);
        DeleteObject(info.hbmMask);
        DestroyIcon(icon);
        if (rows != size) throw std::runtime_error("Cannot read icon bitmap");
        // Windows supports lossless PNG entries in ICO files, keeping all sizes small.
        Gdiplus::Bitmap png(size, size, -size * 4, PixelFormat32bppARGB,
            bgra.data() + (size - 1) * size * 4);
        const CLSID encoder{0x557cf406, 0x1a04, 0x11d3, {0x9a, 0x73, 0, 0, 0xf8, 0x1e, 0xf3, 0x2e}};
        IStream* stream{};
        if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)))
            throw std::runtime_error("Cannot create icon stream");
        if (png.Save(stream, &encoder, nullptr) != Gdiplus::Ok)
            throw std::runtime_error("Cannot encode icon PNG");
        STATSTG stat{};
        stream->Stat(&stat, STATFLAG_NONAME);
        std::vector<BYTE> data(static_cast<size_t>(stat.cbSize.QuadPart));
        LARGE_INTEGER start{};
        stream->Seek(start, STREAM_SEEK_SET, nullptr);
        ULONG read{};
        const HRESULT result = stream->Read(data.data(), static_cast<ULONG>(data.size()), &read);
        stream->Release();
        if (FAILED(result) || read != data.size()) throw std::runtime_error("Cannot read icon PNG");
        IconEntry entry{};
        entry.width = entry.height = static_cast<BYTE>(size == 256 ? 0 : size);
        entry.bytes = static_cast<DWORD>(data.size());
        entry.offset = offset;
        offset += entry.bytes;
        entries.push_back(entry);
        images.push_back(std::move(data));
    }
    std::ofstream file(path, std::ios::binary);
    file.exceptions(std::ios::badbit | std::ios::failbit);
    IconHeader header{};
    header.count = static_cast<WORD>(entries.size());
    file.write(reinterpret_cast<const char*>(&header), sizeof(header));
    file.write(reinterpret_cast<const char*>(entries.data()), entries.size() * sizeof(IconEntry));
    for (const auto& data : images)
        file.write(reinterpret_cast<const char*>(data.data()), data.size());
}

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    Gdiplus::GdiplusStartupInput input;
    ULONG_PTR token{};
    if (Gdiplus::GdiplusStartup(&token, &input, nullptr) != Gdiplus::Ok) return 1;
    const std::filesystem::path directory(argv[1]);
    WriteIcon(directory / "recorder.ico", false, lc::ui::Accent);
    WriteIcon(directory / "wgc.ico", true, RGB(57, 196, 178));
    WriteIcon(directory / "dwm.ico", true, lc::ui::Accent);
    Gdiplus::GdiplusShutdown(token);
}
