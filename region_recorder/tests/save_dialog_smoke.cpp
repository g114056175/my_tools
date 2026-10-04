#include <windows.h>
#include <shlobj.h>
#include "project1_region_recorder/save_dialog.h"
#include <filesystem>
#include <iostream>

using namespace lc::recorder;
namespace {
lc::ComPtr<IFileSaveDialog> dialog;
lc::ComPtr<IShellItem> folderA, folderB;
bool passed=false;
std::wstring Name() {
    PWSTR name=nullptr;
    if(FAILED(dialog->GetFileName(&name))) return {};
    std::wstring value=name;CoTaskMemFree(name);return value;
}
void Touch(const std::wstring& path){
    HANDLE h=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(h!=INVALID_HANDLE_VALUE)CloseHandle(h);
}
}
int wmain(){
    CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    wchar_t temp[MAX_PATH]{};GetTempPathW(ARRAYSIZE(temp),temp);
    const std::wstring root=std::wstring(temp)+L"LC-dialog-test-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64());
    if(!CreateDirectoryW(root.c_str(),nullptr))return 2;
    const auto a=root+L"\\a",b=root+L"\\b";
    CreateDirectoryW(a.c_str(),nullptr);CreateDirectoryW(b.c_str(),nullptr);
    Touch(b+L"/capture_1.gif");Touch(b+L"/capture_9999.gif");
    RecordingNames names;std::wstring path;DWORD error=0;
    HRESULT hr=CoCreateInstance(CLSID_FileSaveDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dialog));
    if(SUCCEEDED(hr))hr=SHCreateItemFromParsingName(a.c_str(),nullptr,IID_PPV_ARGS(&folderA));
    if(SUCCEEDED(hr))hr=SHCreateItemFromParsingName(b.c_str(),nullptr,IID_PPV_ARGS(&folderB));
    if(SUCCEEDED(hr) && names.Suggest(a,L"capture",L".gif",path,error)){
        dialog->SetFolder(folderA.Get());dialog->SetFileName(RecordingNames::Leaf(path).c_str());
        dialog->SetOptions(FOS_FORCEFILESYSTEM|FOS_PATHMUSTEXIST|FOS_OVERWRITEPROMPT);
        lc::ComPtr<SaveNameEvents> events;events.Attach(new SaveNameEvents(names,L"capture",L".gif",RecordingNames::Leaf(path)));
        dialog->SetFolder(folderB.Get());events->OnFolderChange(dialog.Get());
        passed=Name()==L"capture_10000.gif";
        dialog->SetFileName(L"my clip.gif");dialog->SetFolder(folderA.Get());
        events->OnFolderChange(dialog.Get());
        passed=passed && Name()==L"my clip.gif";
    }
    dialog.Reset();folderA.Reset();folderB.Reset();
    std::filesystem::remove_all(root);
    CoUninitialize();
    std::cout<<"Native save dialog folder callback + custom filename preservation: "<<(passed?"PASS":"FAIL")<<'\n';
    return passed?0:1;
}
