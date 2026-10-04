#pragma once

#include <wincodec.h>

#include <cstdint>
#include <string>
#include <vector>

#include "common/com_helpers.h"

namespace lc {

class GifWriter {
   public:
    ~GifWriter();
    bool Open(const std::wstring& path, int width, int height, uint64_t sizeLimitBytes,
              std::wstring& error);
    // Returns false and sets limitReached when the conservative hard-size budget is exhausted.
    bool AddBgraFrame(const std::vector<uint8_t>& bgra, int delayCentiseconds, bool& limitReached,
                      std::wstring& error);
    bool Close(std::wstring* error = nullptr);
    uint64_t CurrentSize() const;
    bool IsOpen() const { return encoder_ != nullptr; }

   private:
    bool HasRoomForAnotherFrame() const;

    ComPtr<IWICImagingFactory> factory_;
    ComPtr<IWICStream> stream_;
    ComPtr<IWICBitmapEncoder> encoder_;
    ComPtr<IWICPalette> palette_;
    int width_ = 0;
    int height_ = 0;
    uint64_t limitBytes_ = 0;
    uint64_t frames_ = 0;
};

}  // namespace lc
