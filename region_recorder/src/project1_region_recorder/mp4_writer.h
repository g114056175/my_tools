#pragma once

#include <mfidl.h>
#include <mfreadwrite.h>

#include <cstdint>
#include <string>
#include <vector>

#include "common/com_helpers.h"

namespace lc {

class Mp4Writer {
   public:
    ~Mp4Writer();
    bool Open(const std::wstring& path, int width, int height, int nominalFps, std::wstring& error);
    bool WriteBgra(const std::vector<uint8_t>& bgra, int64_t time100ns, int64_t duration100ns,
                   std::wstring& error);
    bool Close(std::wstring* error = nullptr);
    uint64_t CurrentSize() const;
    bool IsOpen() const { return writer_ != nullptr; }

   private:
    ComPtr<IMFSinkWriter> writer_;
    ComPtr<IMFByteStream> stream_;
    DWORD streamIndex_ = 0;
    int width_ = 0;
    int height_ = 0;
    bool mfStarted_ = false;
};

}  // namespace lc
