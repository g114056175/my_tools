#pragma once
#ifndef UNICODE
#define UNICODE
#endif
#include <windows.h>
#include <mmsystem.h>
#include <atomic>
#include <cstdint>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace audio {
struct Wave {
    std::wstring path;
    uint32_t rate = 0, dataBytes = 0;
    uint16_t channels = 0, format = 1, bits = 16;
    uint64_t dataOffset = 0;
    uint32_t frameBytes() const { return channels * (bits / 8u); }
    uint64_t frames() const { return frameBytes() ? dataBytes / frameBytes() : 0; }
    double duration() const { return rate ? double(frames()) / rate : 0; }
};
Wave openWave(const std::wstring& path);
std::vector<float> peaks(const Wave& wave);
void exportWave(const Wave& wave, double begin, double end, const std::wstring& path);
void importAudio(const std::wstring& source, const std::wstring& target, bool preserveNativeWav = true);
void exportMp3(const Wave& wave, double begin, double end, const std::wstring& path, int kbps);
bool processCaptureAvailable();

class Player {
    struct Slot { WAVEHDR header{}; std::vector<char> bytes; bool queued = false; bool prepared = false; };
    HWAVEOUT device_ = nullptr;
    std::ifstream file_;
    Wave wave_;
    Slot slots_[4];
    uint64_t first_ = 0, end_ = 0, read_ = 0;
    bool playing_ = false, range_ = false;
    double position_ = 0;
    void reset(double start, double end);
    void fill(Slot& slot);
public:
    ~Player() { close(); }
    void open(const Wave& wave);
    void close();
    void play(double start, double end);
    void pause();
    void seek(double seconds, double end);
    void tick();
    double position() const { return position_; }
    bool playing() const { return playing_; }
};

class Recorder {
    std::thread worker_;
    std::atomic<bool> stop_{false}, paused_{false}, running_{false}, done_{false};
    mutable std::mutex mutex_;
    std::vector<float> peaks_;
    double duration_ = 0;
    std::wstring error_;
    std::wstring output_;
    std::atomic<uint32_t> rate_{44100};
    void run(bool process, DWORD pid);
public:
    ~Recorder();
    void start(const std::wstring& output, bool process, DWORD pid);
    void stop() { stop_ = true; }
    void pause(bool value) { paused_ = value; }
    bool paused() const { return paused_; }
    bool running() const { return running_; }
    bool done() const { return done_; }
    void finish();
    double snapshot(std::vector<float>& peaks) const;
    std::wstring error() const;
    uint32_t rate() const { return rate_; }
};
}
