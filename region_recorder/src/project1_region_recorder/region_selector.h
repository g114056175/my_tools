#pragma once

#include <windows.h>

namespace lc {

// Shows a translucent virtual-desktop overlay and returns a physical-pixel desktop rectangle.
bool SelectDesktopRegion(HINSTANCE instance, HWND owner, RECT& result);
void CancelDesktopRegionSelection();

constexpr int kRegionMarkerThickness = 3;
// A click-through cyan outline outside the ROI. At monitor edges it moves inward
// so it stays visible. The ROI itself never moves or shrinks.
void ShowRegionMarker(HINSTANCE instance, const RECT& region, bool excludeFromCapture = false);
void HideRegionMarker();

}  // namespace lc
