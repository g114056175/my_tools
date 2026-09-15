#pragma once

#include <windows.h>

#include <chrono>
#include <filesystem>
#include <stdexcept>
#include <system_error>
#include <string>
#include <cwctype>

// A small transactional editing session.  The source file is never touched by
// begin/apply; only commit replaces it, and the draft is retained on errors.
class EditSession final {
public:
    EditSession() = default;
    EditSession(const EditSession&) = delete;
    EditSession& operator=(const EditSession&) = delete;
    EditSession(EditSession&&) = delete;
    EditSession& operator=(EditSession&&) = delete;

    ~EditSession() noexcept { cleanupDraft(); }

    void begin(const std::wstring& original) {
        if (active_) throw std::logic_error("an edit session is already active");
        if (original.empty()) throw std::invalid_argument("original path is empty");

        const std::filesystem::path source = std::filesystem::absolute(original);
        const auto parent = source.parent_path();
        const auto stamp = GetTickCount64();
        const auto pid = static_cast<unsigned long>(GetCurrentProcessId());
        std::filesystem::path candidate;
        bool copied = false;
        for (unsigned long long n = 0; n != 1000; ++n) {
            candidate = parent / (L".edit-" + std::to_wstring(pid) + L"-" +
                                  std::to_wstring(stamp) +
                                  (n ? L"-" + std::to_wstring(n) : L"") + L".wav");
            if (CopyFileW(source.c_str(), candidate.c_str(), TRUE) != FALSE) {
                copied = true;
                break;
            }
            const DWORD error = GetLastError();
            if (error != ERROR_FILE_EXISTS && error != ERROR_ALREADY_EXISTS)
                throw systemError("could not create edit draft", error);
        }
        if (!copied) throw std::runtime_error("could not create a unique edit draft");

        original_ = source.wstring();
        draft_ = candidate.wstring();
        active_ = true;
    }

    bool active() const noexcept { return active_; }
    const std::wstring& path() const noexcept { return draft_; }

    // Replaces the draft atomically.  pending is consumed on success.
    void apply(const std::wstring& pending) {
        requireActive();
        if (pending.empty()) throw std::invalid_argument("pending path is empty");
        const std::filesystem::path pendingPath = std::filesystem::absolute(pending);
        if (samePath(pendingPath, std::filesystem::path(draft_)) || samePath(pendingPath, std::filesystem::path(original_)))
            throw std::invalid_argument("pending path cannot be original or active draft");
        if (MoveFileExW(pendingPath.c_str(), draft_.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == FALSE)
            throw systemError("could not replace edit draft", GetLastError());
    }

    void commit() {
        requireActive();
        if (MoveFileExW(draft_.c_str(), original_.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == FALSE)
            throw systemError("could not commit edit", GetLastError());
        active_ = false;
    }

    void cancel() {
        requireActive();
        if (DeleteFileW(draft_.c_str()) == FALSE) {
            const DWORD error = GetLastError();
            if (error != ERROR_FILE_NOT_FOUND) throw systemError("could not cancel edit", error);
        }
        active_ = false;
    }

private:
    static std::runtime_error systemError(const char* message, DWORD error) {
        return std::system_error(static_cast<int>(error), std::system_category(), message);
    }

    static bool samePath(const std::filesystem::path& left, const std::filesystem::path& right) {
        std::wstring a = left.lexically_normal().wstring();
        std::wstring b = right.lexically_normal().wstring();
        if (a.size() != b.size()) return false;
        for (size_t i = 0; i < a.size(); ++i)
            if (std::towlower(a[i]) != std::towlower(b[i])) return false;
        return true;
    }

    void requireActive() const {
        if (!active_) throw std::logic_error("no active edit session");
    }
    void cleanupDraft() noexcept {
        if (!draft_.empty() && active_) DeleteFileW(draft_.c_str());
    }

    std::wstring original_;
    std::wstring draft_;
    bool active_ = false;
};
