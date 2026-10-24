#pragma once

#include <cstdint>
#include <vector>

namespace lc {

// Fits BGRA input into a fixed BGRA canvas without changing aspect ratio.
// The unused canvas area is opaque black.
void AspectFitBgra(const std::vector<uint8_t>& source, int sourceWidth, int sourceHeight,
                   std::vector<uint8_t>& destination, int destinationWidth,
                   int destinationHeight);

}  // namespace lc
