#pragma once

#include <shobjidl.h>
#include "common/com_helpers.h"
#include "project1_region_recorder/recording_names.h"

namespace lc::recorder {

// Use the modern Windows dialog so folder changes can update an untouched
// suggestion without changing the user's explicit filename.
class SaveNameEvents final : public IFileDialogEvents {
public:
    SaveNameEvents(RecordingNames& names, std::wstring base, std::wstring extension,
                   std::wstring suggestion)
        : names_(names), base_(std::move(base)), extension_(std::move(extension)),
          suggestion_(std::move(suggestion)) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** value) override {
        if (!value) return E_POINTER;
        *value = nullptr;
        if (id != IID_IUnknown && id != IID_IFileDialogEvents) return E_NOINTERFACE;
        *value = static_cast<IFileDialogEvents*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = --references_;
        if (!left) delete this;
        return left;
    }
    bool IsSuggested(IFileDialog* dialog) {
        PWSTR name = nullptr;
        if (FAILED(dialog->GetFileName(&name))) return false;
        const bool same = _wcsicmp(name, suggestion_.c_str()) == 0;
        CoTaskMemFree(name);
        return same;
    }
    HRESULT STDMETHODCALLTYPE OnFolderChange(IFileDialog* dialog) override {
        if (!IsSuggested(dialog)) return S_OK;
        ComPtr<IShellItem> folder;
        PWSTR directory = nullptr;
        if (SUCCEEDED(dialog->GetFolder(&folder)) &&
            SUCCEEDED(folder->GetDisplayName(SIGDN_FILESYSPATH, &directory))) {
            std::wstring path; DWORD error = 0;
            if (names_.Suggest(directory, base_, extension_, path, error)) {
                suggestion_ = RecordingNames::Leaf(path);
                dialog->SetFileName(suggestion_.c_str());
            }
            CoTaskMemFree(directory);
        }
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnFileOk(IFileDialog* dialog) override {
        suggestedResult = IsSuggested(dialog);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnFolderChanging(IFileDialog*, IShellItem*) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnSelectionChange(IFileDialog*) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnShareViolation(IFileDialog*, IShellItem*, FDE_SHAREVIOLATION_RESPONSE* response) override {
        *response = FDESVR_DEFAULT; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE OnTypeChange(IFileDialog*) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE OnOverwrite(IFileDialog* dialog, IShellItem*, FDE_OVERWRITE_RESPONSE* response) override {
        *response = FDEOR_DEFAULT;
        if (IsSuggested(dialog)) {
            // A file appeared while the dialog was open. Never offer to overwrite
            // a generated name; refresh it and leave the dialog available to save.
            OnFolderChange(dialog);
            *response = FDEOR_REFUSE;
        }
        return S_OK;
    }
    bool suggestedResult = false;
private:
    ULONG references_ = 1;
    RecordingNames& names_;
    std::wstring base_, extension_, suggestion_;
};

} // namespace lc::recorder
