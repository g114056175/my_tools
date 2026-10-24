#include "common/image_utils.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace lc {

void AspectFitBgra(const std::vector<uint8_t>& source, int sourceWidth, int sourceHeight,
                   std::vector<uint8_t>& destination, int destinationWidth,
                   int destinationHeight) {
    destination.assign(static_cast<size_t>(destinationWidth) * destinationHeight * 4, 0);
    for (size_t i = 3; i < destination.size(); i += 4) destination[i] = 255;
    if (sourceWidth <= 0 || sourceHeight <= 0 || destinationWidth <= 0 ||
        destinationHeight <= 0 ||
        source.size() < static_cast<size_t>(sourceWidth) * sourceHeight * 4) return;

    if (sourceWidth == destinationWidth && sourceHeight == destinationHeight) {
        destination = source;
        return;
    }

    const double scale = std::min(static_cast<double>(destinationWidth) / sourceWidth,
                                  static_cast<double>(destinationHeight) / sourceHeight);
    const int drawWidth = std::max(1, static_cast<int>(std::lround(sourceWidth * scale)));
    const int drawHeight = std::max(1, static_cast<int>(std::lround(sourceHeight * scale)));
    const int offsetX = (destinationWidth - drawWidth) / 2;
    const int offsetY = (destinationHeight - drawHeight) / 2;

    // Bilinear scaling is used only when the ROI changes size. The common same-size path above
    // remains a single vector copy.
    for (int y = 0; y < drawHeight; ++y) {
        const double sy = (y + 0.5) * sourceHeight / drawHeight - 0.5;
        const int y0 = std::clamp(static_cast<int>(std::floor(sy)), 0, sourceHeight - 1);
        const int y1 = std::min(y0 + 1, sourceHeight - 1);
        const double fy = std::clamp(sy - y0, 0.0, 1.0);
        for (int x = 0; x < drawWidth; ++x) {
            const double sx = (x + 0.5) * sourceWidth / drawWidth - 0.5;
            const int x0 = std::clamp(static_cast<int>(std::floor(sx)), 0, sourceWidth - 1);
            const int x1 = std::min(x0 + 1, sourceWidth - 1);
            const double fx = std::clamp(sx - x0, 0.0, 1.0);
            const auto* p00 = &source[(static_cast<size_t>(y0) * sourceWidth + x0) * 4];
            const auto* p10 = &source[(static_cast<size_t>(y0) * sourceWidth + x1) * 4];
            const auto* p01 = &source[(static_cast<size_t>(y1) * sourceWidth + x0) * 4];
            const auto* p11 = &source[(static_cast<size_t>(y1) * sourceWidth + x1) * 4];
            auto* out = &destination[(static_cast<size_t>(offsetY + y) * destinationWidth +
                                      offsetX + x) * 4];
            for (int c = 0; c < 4; ++c) {
                const double top = p00[c] + (p10[c] - p00[c]) * fx;
                const double bottom = p01[c] + (p11[c] - p01[c]) * fx;
                out[c] = static_cast<uint8_t>(std::clamp(top + (bottom - top) * fy, 0.0, 255.0));
            }
        }
    }
}

}  // namespace lc
