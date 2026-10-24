#pragma once

#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <limits>
#include <map>
#include <string>

namespace lc::recorder {

// UI-thread owned. The cache lives for this process; a restart probes _1 again.
// No directory enumeration occurs until the suggested path is already occupied.
class RecordingNames {
public:
    static std::wstring Directory(const std::wstring& path) {
        const auto split = path.find_last_of(L"\\/");
        return split == std::wstring::npos ? L"." : path.substr(0, split + 1);
    }
    static std::wstring Leaf(const std::wstring& path) {
        const auto split = path.find_last_of(L"\\/");
        return split == std::wstring::npos ? path : path.substr(split + 1);
    }
    bool Suggest(const std::wstring& directory, const std::wstring& base,
                 const std::wstring& extension, std::wstring& result, DWORD& error) {
        std::wstring prefix;
        if (!Prefix(directory, base, prefix, error)) return false;
        auto& next = next_[prefix + extension];
        if (next == 0) next = 1;
        for (;;) {
            result = prefix + std::to_wstring(next) + extension;
            if (GetFileAttributesW(result.c_str()) == INVALID_FILE_ATTRIBUTES) {
                error = GetLastError();
                if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
                    error = ERROR_SUCCESS;
                    return true;
                }
                return false;
            }
            uint64_t maximum = next;
            WIN32_FIND_DATAW data{};
            HANDLE search = FindFirstFileExW((prefix + L"*" + extension).c_str(),
                FindExInfoBasic, &data, FindExSearchNameMatch, nullptr, 0);
            ++scans_;
            if (search != INVALID_HANDLE_VALUE) {
                do {
                    uint64_t n = 0;
                    if (Number(data.cFileName, base, extension, n)) maximum = std::max(maximum, n);
                } while (FindNextFileW(search, &data));
                error = GetLastError();
                FindClose(search);
                if (error != ERROR_NO_MORE_FILES) return false;
            } else {
                error = GetLastError();
                if (error != ERROR_FILE_NOT_FOUND) return false;
            }
            if (maximum == std::numeric_limits<uint64_t>::max()) {
                error = ERROR_ARITHMETIC_OVERFLOW;
                return false;
            }
            next = maximum + 1;
        }
    }
    void Saved(const std::wstring& path, const std::wstring& base, const std::wstring& extension) {
        uint64_t n = 0;
        std::wstring prefix;
        DWORD error = 0;
        if (!Number(Leaf(path), base, extension, n) || !Prefix(Directory(path), base, prefix, error)) return;
        auto& next = next_[prefix + extension];
        next = std::max(next, n == std::numeric_limits<uint64_t>::max() ? n : n + 1);
    }
    uint64_t ScanCount() const { return scans_; }

private:
    struct IgnoreCase {
        bool operator()(const std::wstring& a, const std::wstring& b) const {
            return CompareStringOrdinal(a.c_str(), -1, b.c_str(), -1, TRUE) == CSTR_LESS_THAN;
        }
    };
    static bool Prefix(const std::wstring& directory, const std::wstring& base,
                       std::wstring& prefix, DWORD& error) {
        const DWORD count = GetFullPathNameW(directory.c_str(), 0, nullptr, nullptr);
        if (!count) { error = GetLastError(); return false; }
        std::wstring full(count, L'\0');
        const DWORD length = GetFullPathNameW(directory.c_str(), count, full.data(), nullptr);
        if (!length || length >= count) { error = ERROR_INVALID_NAME; return false; }
        full.resize(length);
        if (full.back() != L'\\' && full.back() != L'/') full += L'\\';
        prefix = full + base + L'_';
        return true;
    }
    static bool Number(const std::wstring& leaf, const std::wstring& base,
                       const std::wstring& extension, uint64_t& n) {
        const auto prefix = base + L'_';
        if (leaf.size() <= prefix.size() + extension.size() ||
            _wcsnicmp(leaf.c_str(), prefix.c_str(), prefix.size()) != 0 ||
            _wcsicmp(leaf.c_str() + leaf.size() - extension.size(), extension.c_str()) != 0) return false;
        n = 0;
        for (size_t i = prefix.size(); i < leaf.size() - extension.size(); ++i) {
            const wchar_t c = leaf[i];
            if (c < L'0' || c > L'9') return false;
            const auto digit = static_cast<uint64_t>(c - L'0');
            if (n > (std::numeric_limits<uint64_t>::max() - digit) / 10) return false;
            n = n * 10 + digit;
        }
        return n > 0;
    }
    std::map<std::wstring, uint64_t, IgnoreCase> next_;
    uint64_t scans_ = 0;
};

} // namespace lc::recorder
