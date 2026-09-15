#include "../src/EditSession.hpp"

#include <fstream>
#include <iostream>
#include <random>
#include <vector>

namespace {
void check(bool ok, const char* message) { if (!ok) throw std::runtime_error(message); }
std::vector<unsigned char> bytes(const std::filesystem::path& p) {
    std::ifstream in(p, std::ios::binary); return {std::istreambuf_iterator<char>(in), {}};
}
void writeBytes(const std::filesystem::path& p, std::initializer_list<unsigned char> data) {
    std::ofstream out(p, std::ios::binary); for (auto b : data) out.put(static_cast<char>(b));
}
HANDLE lockFile(const std::filesystem::path& p) {
    HANDLE h = CreateFileW(p.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h != INVALID_HANDLE_VALUE) {
        OVERLAPPED ov{};
        if (!LockFileEx(h, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, MAXDWORD, MAXDWORD, &ov)) {
            CloseHandle(h); return INVALID_HANDLE_VALUE;
        }
    }
    return h;
}
}

int main() {
    try {
        const auto root = std::filesystem::temp_directory_path() /
            (L"VoiceCapture-edit-session-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()));
        std::filesystem::create_directories(root);
        const auto original = root / L"original.wav";
        const auto pendingA = root / L"pending-a.wav";
        const auto pendingB = root / L"pending-b.wav";
        writeBytes(original, {1, 2, 3, 4}); writeBytes(pendingA, {5, 6}); writeBytes(pendingB, {7, 8, 9});
        const auto initial = bytes(original);
        {
            EditSession session;
            session.begin(original.wstring());
            check(session.active(), "begin did not activate");
            const auto draft = session.path(); check(std::filesystem::exists(draft), "draft missing");
            check(bytes(original) == initial, "begin changed original");
            session.apply(pendingA.wstring()); session.apply(pendingB.wstring());
            check(bytes(original) == initial, "apply changed original");
            bool reentered = false; try { session.begin(original.wstring()); } catch (...) { reentered = true; }
            check(reentered, "reentrant begin was accepted");
            session.cancel(); check(!session.active() && !std::filesystem::exists(draft), "cancel failed");
        }
        { EditSession session; bool inactive = false; try { session.commit(); } catch (...) { inactive = true; } check(inactive, "inactive commit accepted"); }
        {
            writeBytes(pendingB, {7, 8, 9});
            EditSession session; session.begin(original.wstring()); const auto draft = session.path();
            const auto expected = bytes(pendingB);
            const auto originalBeforeLock = bytes(original);
            HANDLE originalLock = lockFile(original);
            check(originalLock != INVALID_HANDLE_VALUE, "could not lock original");
            bool commitFailed = false; try { session.apply(pendingB.wstring()); session.commit(); } catch (...) { commitFailed = true; }
            if (!(commitFailed && session.active() && std::filesystem::exists(draft) && originalBeforeLock == initial)) {
                std::cerr << "commitFailed=" << commitFailed << " active=" << session.active()
                          << " draft=" << std::filesystem::exists(draft) << " original=" << originalBeforeLock.size() << " initial=" << initial.size() << "\n";
                throw std::runtime_error("locked original commit did not preserve session");
            }
            CloseHandle(originalLock);
            session.commit(); check(bytes(original) == expected && !std::filesystem::exists(draft), "commit after unlock failed");
        }
        {
            writeBytes(original, {1, 2, 3, 4}); writeBytes(pendingB, {7, 8, 9});
            EditSession session; session.begin(original.wstring()); const auto draft = session.path();
            HANDLE draftLock = lockFile(draft); check(draftLock != INVALID_HANDLE_VALUE, "could not lock draft");
            bool cancelFailed = false; try { session.cancel(); } catch (...) { cancelFailed = true; }
            check(cancelFailed && session.active() && std::filesystem::exists(draft), "locked draft cancel did not preserve session");
            CloseHandle(draftLock); session.cancel(); check(!session.active() && !std::filesystem::exists(draft), "cancel after unlock failed");
        }
        {
            writeBytes(pendingB, {7, 8, 9});
            EditSession session; session.begin(original.wstring()); const auto draft = session.path();
            session.apply(pendingB.wstring()); session.commit();
            check(!session.active() && bytes(original) == std::vector<unsigned char>({7, 8, 9}), "commit result incorrect");
            check(!std::filesystem::exists(draft), "committed draft remains");
        }
        // A failed apply leaves the previous draft usable.  The pending file is
        // intentionally missing and therefore cannot replace the draft.
        writeBytes(original, {1, 2, 3, 4});
        { EditSession session; session.begin(original.wstring()); const auto draft = session.path();
          bool failed = false; try { session.apply((root / L"missing.wav").wstring()); } catch (...) { failed = true; }
          check(failed && session.active() && std::filesystem::exists(draft), "failed apply lost draft"); session.cancel(); }
        {
            EditSession session; session.begin(original.wstring()); const auto draft = session.path();
            bool failed = false; try { session.apply((root / L"missing-again.wav").wstring()); } catch (...) { failed = true; }
            check(failed && session.active(), "failed apply did not preserve session");
            session.commit(); check(bytes(original) == initial && !std::filesystem::exists(draft), "commit after failed apply failed");
        }
        std::wstring destructorDraft;
        { EditSession session; session.begin(original.wstring()); destructorDraft = session.path(); check(std::filesystem::exists(destructorDraft), "destructor draft setup failed"); }
        check(!std::filesystem::exists(destructorDraft), "destructor did not clean draft");
        std::cout << "EditSession tests passed\n"; return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
