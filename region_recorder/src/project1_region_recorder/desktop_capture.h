#pragma once

#include "common/wgc_capture.h"

#include <algorithm>
#include <cstring>
#include <memory>

namespace lc {

// Coordinates and cached crops are physical desktop pixels, including negative origins.
// Every intersecting monitor has its own WGC session. A quiet monitor retains its last
// frame while another updates; no output is emitted until all sources have a first frame.
class DesktopCapture {
public:
    bool Capture(const RECT& region, bool cursor, std::vector<uint8_t>& output,
                 int& width, int& height, std::wstring& error) {
        error.clear();
        std::vector<Monitor> monitors;
        if (!EnumDisplayMonitors(nullptr, nullptr, Enumerate, reinterpret_cast<LPARAM>(&monitors))) {
            error = L"Unable to enumerate desktop monitors.";
            return false;
        }
        std::erase_if(monitors, [&region](const Monitor& m) {
            RECT intersection{};
            return !IntersectRect(&intersection, &region, &m.bounds);
        });
        if (monitors.empty()) {
            error = L"The selected region does not intersect a connected monitor.";
            return false;
        }
        // Keep capture sessions across ROI changes on the same monitors. New monitors
        // start independently; disconnected/non-intersecting ones are released here.
        std::erase_if(sources_, [&monitors](const auto& source) {
            return std::none_of(monitors.begin(), monitors.end(), [&source](const Monitor& m) {
                return source->monitor.handle == m.handle &&
                       EqualRect(&source->monitor.bounds, &m.bounds);
            });
        });
        bool ready = true;
        for (const auto& monitor : monitors) {
            auto found = std::find_if(sources_.begin(), sources_.end(), [&monitor](const auto& s) {
                return s->monitor.handle == monitor.handle;
            });
            if (found == sources_.end()) {
                auto source = std::make_unique<Source>();
                source->monitor = monitor;
                if (!source->capture.StartForMonitor(monitor.handle, error, cursor)) return false;
                sources_.push_back(std::move(source));
                found = std::prev(sources_.end());
            }
            auto& source = **found;
            RECT crop{};
            IntersectRect(&crop, &region, &monitor.bounds);
            if (!EqualRect(&crop, &source.crop)) {
                source.crop = crop;
                source.pixels.clear();
            }
            RECT relative{crop.left - monitor.bounds.left, crop.top - monitor.bounds.top,
                          crop.right - monitor.bounds.left, crop.bottom - monitor.bounds.top};
            int w = 0, h = 0;
            if (source.capture.CaptureLatest(source.latest, w, h, &relative) &&
                w == crop.right - crop.left && h == crop.bottom - crop.top)
                source.pixels.swap(source.latest);
            ready = ready && !source.pixels.empty();
        }
        if (!ready) return false;
        width = region.right - region.left;
        height = region.bottom - region.top;
        if (width <= 0 || height <= 0) return false;
        // Areas between physically offset monitors have no desktop content: use black.
        output.assign(static_cast<size_t>(width) * height * 4, 0);
        for (size_t i = 3; i < output.size(); i += 4) output[i] = 255;
        for (const auto& source : sources_) {
            const int cropWidth = source->crop.right - source->crop.left;
            const int cropHeight = source->crop.bottom - source->crop.top;
            const int x = source->crop.left - region.left, y = source->crop.top - region.top;
            for (int row = 0; row < cropHeight; ++row)
                std::memcpy(output.data() + (static_cast<size_t>(y + row) * width + x) * 4,
                            source->pixels.data() + static_cast<size_t>(row) * cropWidth * 4,
                            static_cast<size_t>(cropWidth) * 4);
        }
        return true;
    }

    void Stop() { sources_.clear(); }

private:
    struct Monitor { HMONITOR handle{}; RECT bounds{}; };
    struct Source {
        Monitor monitor;
        RECT crop{};
        WgcCapture capture;
        std::vector<uint8_t> pixels, latest;
    };
    static BOOL CALLBACK Enumerate(HMONITOR monitor, HDC, LPRECT, LPARAM parameter) {
        MONITORINFO info{};
        info.cbSize = sizeof(info);
        if (GetMonitorInfoW(monitor, &info))
            reinterpret_cast<std::vector<Monitor>*>(parameter)->push_back({monitor, info.rcMonitor});
        return TRUE;
    }
    std::vector<std::unique_ptr<Source>> sources_;
};

}  // namespace lc
