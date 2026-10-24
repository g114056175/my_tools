#pragma once

#include <algorithm>
#include <cstdint>

namespace lc::recorder {
struct RecordingLimits {
    uint64_t bytes;
    int64_t duration100ns;
};
// Decimal MB/GB. Fixed product policy, not user settings.
inline constexpr RecordingLimits LimitsFor(bool gif) {
    return gif ? RecordingLimits{300'000'000, 60LL * 10'000'000}
               : RecordingLimits{4'000'000'000, 30LL * 60 * 10'000'000};
}
inline uint64_t Mp4FinalizationReserve(int width, int height, uint64_t limit) {
    // Leave room for queued frames and the final MP4 index before stopping the encoder.
    const uint64_t rawFrame = static_cast<uint64_t>(width) * height * 4;
    return std::min(limit / 4, 16ULL * 1024 * 1024 + 2 * rawFrame);
}
}  // namespace lc::recorder
