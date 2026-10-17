#include "../src/common/dxgi_pixels.h"

#include <cassert>
#include <cstdint>
#include <vector>

using lc::dxgi::CompositePointer;
using lc::dxgi::CopyCrop;
using lc::dxgi::PointerState;

namespace {

std::vector<std::uint8_t> Grid3x2(UINT pitch) {
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(pitch) * 2, 0xee);
    const std::uint8_t values[2][3] = {{1, 2, 3}, {4, 5, 6}};
    for (int y = 0; y < 2; ++y) {
        for (int x = 0; x < 3; ++x) {
            auto* pixel = bytes.data() + static_cast<std::size_t>(y) * pitch + x * 4;
            pixel[0] = values[y][x];
            pixel[1] = 0;
            pixel[2] = 0;
            pixel[3] = 17;
        }
    }
    return bytes;
}

std::uint8_t Red(const std::vector<std::uint8_t>& pixels, int width, int x, int y) {
    return pixels[(static_cast<std::size_t>(y) * width + x) * 4];
}

void AssertGrid(const std::vector<std::uint8_t>& actual, int width,
                std::initializer_list<std::uint8_t> expected) {
    assert(actual.size() == expected.size() * 4);
    int index = 0;
    for (const auto value : expected) {
        const int x = index % width;
        const int y = index / width;
        assert(Red(actual, width, x, y) == value);
        ++index;
    }
}

DXGI_OUTDUPL_FRAME_INFO Frame(LONGLONG time, BOOL visible, int x = 0, int y = 0) {
    DXGI_OUTDUPL_FRAME_INFO frame{};
    frame.LastMouseUpdateTime.QuadPart = time;
    frame.PointerPosition.Visible = visible;
    frame.PointerPosition.Position = {x, y};
    return frame;
}

void TestRotationsAndCrop() {
    const auto raw = Grid3x2(16);
    std::vector<std::uint8_t> output;

    CopyCrop(raw.data(), 16, {0, 0}, 3, 2, DXGI_MODE_ROTATION_IDENTITY, {0, 0, 3, 2}, output);
    AssertGrid(output, 3, {1, 2, 3, 4, 5, 6});

    CopyCrop(raw.data(), 16, {0, 0}, 3, 2, DXGI_MODE_ROTATION_ROTATE90, {0, 0, 2, 3}, output);
    AssertGrid(output, 2, {4, 1, 5, 2, 6, 3});

    CopyCrop(raw.data(), 16, {0, 0}, 3, 2, DXGI_MODE_ROTATION_ROTATE180, {0, 0, 3, 2}, output);
    AssertGrid(output, 3, {6, 5, 4, 3, 2, 1});

    CopyCrop(raw.data(), 16, {0, 0}, 3, 2, DXGI_MODE_ROTATION_ROTATE270, {0, 0, 2, 3}, output);
    AssertGrid(output, 2, {3, 6, 2, 5, 1, 4});

    CopyCrop(raw.data(), 16, {0, 0}, 3, 2, DXGI_MODE_ROTATION_IDENTITY, {1, 0, 3, 2}, output);
    AssertGrid(output, 2, {2, 3, 5, 6});
}

void TestColorAlpha() {
    std::vector<std::uint8_t> pixels(2 * 4, 0);
    pixels[0] = 100; pixels[1] = 110; pixels[2] = 120; pixels[3] = 255;
    pixels[4] = 100; pixels[5] = 110; pixels[6] = 120; pixels[7] = 255;

    PointerState pointer;
    pointer.visible = true;
    pointer.position = {1, 0};
    pointer.info.Type = DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR;
    pointer.info.Width = 1;
    pointer.info.Height = 1;
    pointer.info.Pitch = 4;
    pointer.shape = {10, 20, 30, 128};
    assert(CompositePointer(pixels, 2, 1, {0, 0, 2, 1}, pointer));
    assert(pixels[4] == 55 && pixels[5] == 65 && pixels[6] == 75 && pixels[7] == 255);
}

void TestMonoAndXor() {
    std::vector<std::uint8_t> pixels(2 * 2 * 4, 0);
    for (int i = 0; i < 4; ++i) {
        pixels[i * 4 + 0] = static_cast<std::uint8_t>(10 + i);
        pixels[i * 4 + 1] = static_cast<std::uint8_t>(20 + i);
        pixels[i * 4 + 2] = static_cast<std::uint8_t>(30 + i);
        pixels[i * 4 + 3] = 255;
    }
    PointerState pointer;
    pointer.visible = true;
    pointer.info.Type = DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MONOCHROME;
    pointer.info.Width = 2;
    pointer.info.Height = 4;
    pointer.info.Pitch = 1;
    pointer.shape = {0x80, 0x40, 0x40, 0x80};
    assert(CompositePointer(pixels, 2, 2, {0, 0, 2, 2}, pointer));
    assert(pixels[0] == 10 && pixels[4] == 255);
    assert(pixels[8] == 255 && pixels[12] == 13);
}

void TestMaskedAndClipping() {
    std::vector<std::uint8_t> pixels(2 * 4, 100);
    pixels[3] = pixels[7] = 255;
    PointerState masked;
    masked.visible = true;
    masked.position = {0, 0};
    masked.info.Type = DXGI_OUTDUPL_POINTER_SHAPE_TYPE_MASKED_COLOR;
    masked.info.Width = 2;
    masked.info.Height = 1;
    masked.info.Pitch = 8;
    masked.shape = {1, 2, 3, 0, 0x10, 0x20, 0x30, 0xff};
    assert(CompositePointer(pixels, 2, 1, {0, 0, 2, 1}, masked));
    assert(pixels[0] == 1 && pixels[1] == 2 && pixels[2] == 3);
    assert(pixels[4] == 0x74 && pixels[5] == 0x44 && pixels[6] == 0x54);

    std::vector<std::uint8_t> clipped(2 * 2 * 4, 0);
    for (int i = 0; i < 4; ++i) clipped[i * 4 + 3] = 255;
    PointerState color;
    color.visible = true;
    color.position = {99, 199};
    color.info.Type = DXGI_OUTDUPL_POINTER_SHAPE_TYPE_COLOR;
    color.info.Width = 2;
    color.info.Height = 2;
    color.info.Pitch = 8;
    color.shape = {1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255};
    assert(CompositePointer(clipped, 2, 2, {100, 200, 102, 202}, color));
    assert(clipped[0] == 4 && clipped[4] == 0 && clipped[8] == 0 && clipped[12] == 0);
}

void TestPointerOwnership() {
    const auto monitorA = reinterpret_cast<HMONITOR>(static_cast<std::uintptr_t>(1));
    const auto monitorB = reinterpret_cast<HMONITOR>(static_cast<std::uintptr_t>(2));
    PointerState state;

    state.Update(monitorA, {10, 20, 110, 120}, Frame(10, TRUE, 3, 4));
    assert(state.visible && state.owner == monitorA && state.timestamp == 10);
    assert(state.position.x == 13 && state.position.y == 24);

    state.Update(monitorB, {100, 200, 200, 300}, Frame(9, TRUE, 50, 60));
    assert(state.owner == monitorA && state.timestamp == 10 && state.position.x == 13);

    state.Update(monitorB, {100, 200, 200, 300}, Frame(11, TRUE, 5, 6));
    assert(state.owner == monitorB && state.timestamp == 11 && state.position.x == 105 && state.position.y == 206);

    state.Update(monitorA, {10, 20, 110, 120}, Frame(12, FALSE));
    assert(state.visible && state.owner == monitorB);
    state.Update(monitorB, {100, 200, 200, 300}, Frame(13, FALSE));
    assert(!state.visible && state.owner == monitorB && state.timestamp == 13);
}

} // namespace

int wmain() {
    TestRotationsAndCrop();
    TestColorAlpha();
    TestMonoAndXor();
    TestMaskedAndClipping();
    TestPointerOwnership();
    return 0;
}
