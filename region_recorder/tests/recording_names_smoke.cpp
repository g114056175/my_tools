#include "project1_region_recorder/recording_names.h"
#include <filesystem>
#include <iostream>
#include <stdexcept>

using lc::recorder::RecordingNames;
namespace {
void Require(bool okay, const char* message) { if (!okay) throw std::runtime_error(message); }
void Touch(const std::wstring& path) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                              CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    Require(file != INVALID_HANDLE_VALUE, "fixture creation failed");
    CloseHandle(file);
}
std::wstring Suggest(RecordingNames& names, const std::wstring& dir,
                     const std::wstring& base = L"capture", const std::wstring& ext = L".gif") {
    std::wstring result; DWORD error = 0;
    Require(names.Suggest(dir, base, ext, result, error), "name suggestion failed");
    return result;
}
void Expect(const std::wstring& path, const wchar_t* leaf) {
    Require(RecordingNames::Leaf(path) == leaf, "unexpected suggestion");
}
}
int wmain() {
    wchar_t temp[MAX_PATH]{}; GetTempPathW(ARRAYSIZE(temp), temp);
    const std::wstring root = std::wstring(temp) + L"LC-names-test-" +
        std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
    Require(CreateDirectoryW(root.c_str(), nullptr) != FALSE, "unique test directory unavailable");
    int status = 0;
    try {
        RecordingNames names;
        auto path = Suggest(names, root);
        Expect(path, L"capture_1.gif");
        Expect(Suggest(names, root), L"capture_1.gif");
        Require(names.ScanCount() == 0, "unused/cancelled suggestion enumerated directory");
        Touch(path); names.Saved(path, L"capture", L".gif");
        Expect(Suggest(names, root), L"capture_2.gif");
        Touch(root + L"/capture_9999.gif");
        Expect(Suggest(names, root), L"capture_2.gif");
        Require(names.ScanCount() == 0, "free cached name caused a scan");
        Touch(root + L"/capture_2.gif");
        Touch(root + L"/capture_999999.gif.bak");
        Touch(root + L"/capture_555555.mp4");
        Touch(root + L"/capture_888888x.gif");
        Touch(root + L"/other_999999.gif");
        Expect(Suggest(names, root), L"capture_10000.gif");
        Require(names.ScanCount() == 1, "collision must cause one enumeration");
        path = Suggest(names, root); Touch(path); names.Saved(path, L"capture", L".gif");
        Expect(Suggest(names, root), L"capture_10001.gif");
        Require(names.ScanCount() == 1, "subsequent save enumerated directory again");
        DeleteFileW(path.c_str());
        Expect(Suggest(names, root), L"capture_10001.gif");
        Expect(Suggest(names, root, L"CAPTURE"), L"CAPTURE_10001.gif");
        Expect(Suggest(names, root, L"capture", L".mp4"), L"capture_1.mp4");
        Expect(Suggest(names, root, L"clip"), L"clip_1.gif");
        const auto other = root + L"/other"; CreateDirectoryW(other.c_str(), nullptr);
        Expect(Suggest(names, other), L"capture_1.gif");
        path = other + L"/capture_42.gif"; Touch(path); names.Saved(path, L"capture", L".gif");
        Expect(Suggest(names, other), L"capture_43.gif");
        std::cout << "cache, cancel, max+1, custom names, case, directory/format isolation: PASS\n";

        const auto bulk = root + L"/bulk"; CreateDirectoryW(bulk.c_str(), nullptr);
        for (int i = 1; i <= 9999; ++i) Touch(bulk + L"/capture_" + std::to_wstring(i) + L".gif");
        const auto before = names.ScanCount();
        const auto start = GetTickCount64();
        path = Suggest(names, bulk); Expect(path, L"capture_10000.gif");
        Require(names.ScanCount() == before + 1, "9999 files required multiple scans");
        std::cout << "9999 files -> capture_10000.gif: one scan, " << GetTickCount64() - start << " ms\n";
        Touch(path); names.Saved(path, L"capture", L".gif");
        Expect(Suggest(names, bulk), L"capture_10001.gif");
        Require(names.ScanCount() == before + 1, "cached continuation rescanned 9999 files");
        Touch(bulk + L"/capture_10001.gif"); Touch(bulk + L"/capture_20000.gif");
        Expect(Suggest(names, bulk), L"capture_20001.gif");
        Require(names.ScanCount() == before + 2, "external collision did not rescan exactly once");
        std::cout << "external collision -> rescan -> capture_20001.gif: PASS\n";
        Touch(other + L"/capture_43.gif"); Touch(other + L"/capture_18446744073709551615.gif");
        DWORD error = 0;
        Require(!names.Suggest(other,L"capture",L".gif",path,error) && error == ERROR_ARITHMETIC_OVERFLOW,
                 "numeric overflow was not handled");
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; status = 1; }
    // Only this exclusively created test directory is removed.
    std::filesystem::remove_all(root);
    return status;
}
