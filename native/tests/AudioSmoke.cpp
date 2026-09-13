#include "../src/Audio.hpp"
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <thread>
#include <chrono>

static void put16(FILE* f,unsigned n){fputc(n&255,f);fputc((n>>8)&255,f);}
static void put32(FILE* f,unsigned n){put16(f,n);put16(f,n>>16);}
static void require(bool ok,const char* what){if(!ok)throw std::runtime_error(what);}
int wmain(int argc,wchar_t** argv){
    try{
        std::filesystem::path dir=argc>1?argv[1]:L".";std::filesystem::create_directories(dir);
        auto input=(dir/L"tone.wav").wstring();FILE* f=_wfopen(input.c_str(),L"wb");require(f,"fixture open");
        fwrite("RIFF",1,4,f);put32(f,36+44100*2*4);fwrite("WAVEfmt ",1,8,f);put32(f,16);put16(f,1);put16(f,2);put32(f,44100);put32(f,176400);put16(f,4);put16(f,16);fwrite("data",1,4,f);put32(f,44100*2*4);
        for(int i=0;i<88200;i++){short s=short(std::sin(i*2*3.141592653589793*440/44100)*11000);put16(f,s);put16(f,s);}fclose(f);
        auto w=audio::openWave(input);require(w.frames()==88200,"WAV frames");auto p=audio::peaks(w);require(!p.empty()&&p[0]>.1,"real peaks");
        auto trimmed=(dir/L"trim.wav").wstring();audio::exportWave(w,.25,1.25,trimmed);auto tw=audio::openWave(trimmed);require(tw.frames()==44100,"sample-accurate trim");
        auto imported=(dir/L"imported.wav").wstring();audio::importAudio(input,imported);auto iw=audio::openWave(imported);require(std::abs(iw.duration()-2)<.01,"Media Foundation WAV import");
        for(int bitrate:{128,192,320}){
            auto mp3=(dir/(L"tone-"+std::to_wstring(bitrate)+L".mp3")).wstring();audio::exportMp3(iw,.3,1.3,mp3,bitrate);
            require(std::filesystem::file_size(mp3)>1000,"MP3 output");
            auto decoded=(dir/(L"decoded-"+std::to_wstring(bitrate)+L".wav")).wstring();audio::importAudio(mp3,decoded);
            auto dw=audio::openWave(decoded);require(dw.duration()>.9&&dw.duration()<1.2,"MP3 roundtrip duration");
        }
        audio::Player player;player.open(iw);player.seek(.2,1.5);require(std::abs(player.position()-.2)<.01,"player seek");
        player.play(.2,1.5);std::this_thread::sleep_for(std::chrono::milliseconds(180));player.tick();require(player.position()>.25,"native playback clock");
        player.pause();double stopped=player.position();std::this_thread::sleep_for(std::chrono::milliseconds(70));player.tick();require(player.position()<stopped+.03,"player pause");player.close();
        auto floatPath=(dir/L"float-48k.wav").wstring();f=_wfopen(floatPath.c_str(),L"wb");require(f,"float fixture open");
        fwrite("RIFF",1,4,f);put32(f,36+48000*8);fwrite("WAVEfmt ",1,8,f);put32(f,16);put16(f,3);put16(f,2);put32(f,48000);put32(f,384000);put16(f,8);put16(f,32);fwrite("data",1,4,f);put32(f,48000*8);
        for(int i=0;i<48000;i++){float sample=float(std::sin(i*2*3.141592653589793*440/48000)*.25);fwrite(&sample,4,1,f);fwrite(&sample,4,1,f);}fclose(f);
        auto fw=audio::openWave(floatPath);require(fw.format==3&&fw.bits==32&&fw.rate==48000&&fw.frames()==48000,"float WAV header");
        auto fp=audio::peaks(fw);require(!fp.empty()&&fp[0]>.1,"float peaks");
        auto floatTrim=(dir/L"float-trim.wav").wstring();audio::exportWave(fw,.25,.75,floatTrim);auto ft=audio::openWave(floatTrim);require(ft.format==3&&ft.frames()==24000,"lossless float trim");
        auto floatImport=(dir/(L"fresh-passthrough-"+std::to_wstring(GetTickCount64()))/L"float-import.wav").wstring();audio::importAudio(floatPath,floatImport);auto fi=audio::openWave(floatImport);require(fi.format==3&&fi.frames()==48000,"float WAV import preserves data in new temp directory");
        auto floatDecoded=(dir/L"float-decoded.wav").wstring();audio::importAudio(floatTrim,floatDecoded,false);auto fd=audio::openWave(floatDecoded);require(fd.format==1&&std::abs(fd.duration()-.5)<.02,"Media Foundation reads float WAV with fact chunk");
        for(int bitrate:{128,192,320}){auto mp3=(dir/(L"float-"+std::to_wstring(bitrate)+L".mp3")).wstring();audio::exportMp3(fi,.1,.9,mp3,bitrate);require(std::filesystem::file_size(mp3)>1000,"float to MP3");}
        player.open(fi);player.play(.2,.8);std::this_thread::sleep_for(std::chrono::milliseconds(150));player.tick();require(player.position()>.25,"float playback");player.close();
        wprintf(L"PASS PCM16/float32 WAV, peaks, trim, MF import, MP3 128/192/320, player\n");return 0;
    }catch(const std::exception& e){fprintf(stderr,"FAIL %s\n",e.what());return 1;}
}
