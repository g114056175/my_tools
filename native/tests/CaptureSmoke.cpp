#include "../src/Audio.hpp"
#include <chrono>
#include <filesystem>
#include <iostream>
#include <thread>
int wmain(int argc,wchar_t** argv){
    if(argc<2)return 2;
    std::filesystem::path folder=argv[1];std::filesystem::create_directories(folder);
    audio::Recorder recorder;auto path=(folder/L"capture-check.wav").wstring();
    recorder.start(path,false,0);std::this_thread::sleep_for(std::chrono::milliseconds(350));
    recorder.pause(true);std::this_thread::sleep_for(std::chrono::milliseconds(250));
    recorder.pause(false);std::this_thread::sleep_for(std::chrono::milliseconds(350));recorder.stop();recorder.finish();
    auto err=recorder.error();if(!err.empty()){std::wcerr<<err<<L"\n";return 1;}
    try{auto wav=audio::openWave(path);double seconds=wav.duration();std::wcout<<L"captured "<<seconds<<L" seconds\n";return seconds>.4&&seconds<1.0?0:1;}
    catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
