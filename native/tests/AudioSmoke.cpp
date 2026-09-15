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
static void writeTiny(const std::wstring& path, uint16_t format, uint16_t channels, const void* samples, size_t bytes) {
    FILE* f=_wfopen(path.c_str(),L"wb"); require(f,"tiny fixture open");
    fwrite("RIFF",1,4,f); put32(f,unsigned(36+bytes)); fwrite("WAVEfmt ",1,8,f); put32(f,16);
    put16(f,format); put16(f,channels); put32(f,1000); put32(f,unsigned(1000*channels*(format==1?2:4)));
    put16(f,unsigned(channels*(format==1?2:4))); put16(f,format==1?16:32); fwrite("data",1,4,f); put32(f,unsigned(bytes));
    fwrite(samples,1,bytes,f); fclose(f);
}
static std::vector<int16_t> readPcm16(const audio::Wave& w) {
    FILE* f=_wfopen(w.path.c_str(),L"rb"); require(f,"read fixture"); _fseeki64(f,w.dataOffset,SEEK_SET);
    std::vector<int16_t> v(w.dataBytes/2); require(fread(v.data(),2,v.size(),f)==v.size(),"read samples"); fclose(f); return v;
}
static std::vector<float> readFloat(const audio::Wave& w) {
    FILE* f=_wfopen(w.path.c_str(),L"rb"); require(f,"read float fixture"); _fseeki64(f,w.dataOffset,SEEK_SET);
    std::vector<float> v(w.dataBytes/4); require(fread(v.data(),4,v.size(),f)==v.size(),"read float samples"); fclose(f); return v;
}
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
        // Exact sample-level coverage for range removal and gain/mute, including stereo and float32.
        const int16_t tiny[] = {100, -100, 200, -200, 300, -300, 400, -400};
        auto tinyIn=(dir/L"tiny-pcm.wav").wstring(); writeTiny(tinyIn,1,2,tiny,sizeof tiny); auto tinyW=audio::openWave(tinyIn);
        auto tinyRemoved=(dir/L"tiny-removed.wav").wstring(); audio::removeRegion(tinyW,.001,.003,tinyRemoved);
        auto removed=readPcm16(audio::openWave(tinyRemoved)); require(removed==std::vector<int16_t>({100,-100,400,-400}),"remove joins stereo frames");
        auto tinyGain=(dir/L"tiny-gain.wav").wstring(); audio::adjustGain(tinyW,.001,.003,tinyGain,6.020599913); auto gained=readPcm16(audio::openWave(tinyGain));
        require(gained[0]==100&&gained[1]==-100&&gained[2]==400&&gained[3]==-400&&gained[4]==600&&gained[5]==-600&&gained[6]==400&&gained[7]==-400,"pcm gain and outside samples");
        auto tinyMute=(dir/L"tiny-mute.wav").wstring(); audio::adjustGain(tinyW,0,.001,tinyMute,0,true); auto muted=readPcm16(audio::openWave(tinyMute));
        require(muted[0]==0&&muted[1]==0&&muted[2]==200&&muted[3]==-200,"pcm mute boundary");
        bool rejected=false; try { audio::removeRegion(tinyW,0,tinyW.duration(),(dir/L"bad.wav").wstring()); } catch(const std::exception&) { rejected=true; } require(rejected,"cannot remove all samples");
        rejected=false; try { audio::adjustGain(tinyW,0,.001,(dir/L"bad-gain.wav").wstring(),25); } catch(const std::exception&) { rejected=true; } require(rejected,"gain range validation");
        const float tinyFloat[] = {.1f,-.2f,.3f,-.4f,.5f,-.6f,.7f,-.8f}; auto tinyFloatIn=(dir/L"tiny-float.wav").wstring();
        writeTiny(tinyFloatIn,3,2,tinyFloat,sizeof tinyFloat); auto tinyFloatW=audio::openWave(tinyFloatIn); auto tinyFloatOut=(dir/L"tiny-float-gain.wav").wstring();
        audio::adjustGain(tinyFloatW,.001,.003,tinyFloatOut,6.020599913); auto floatEdited=readFloat(audio::openWave(tinyFloatOut));
        require(std::abs(floatEdited[0]-.1f)<1e-6f&&std::abs(floatEdited[1]+.2f)<1e-6f&&std::abs(floatEdited[2]-.6f)<1e-6f&&std::abs(floatEdited[5]+1.f)<1e-6f,"float gain and hard limit");
        auto floatRemoved=(dir/L"tiny-float-removed.wav").wstring(); audio::removeRegion(tinyFloatW,.001,.003,floatRemoved);
        auto fr=readFloat(audio::openWave(floatRemoved)); require(fr.size()==4&&fr[0]==.1f&&fr[1]==-.2f&&fr[2]==.7f&&fr[3]==-.8f,"float remove");
        auto floatMute=(dir/L"tiny-float-mute.wav").wstring(); audio::adjustGain(tinyFloatW,.001,.003,floatMute,0,true); auto fm=readFloat(audio::openWave(floatMute));
        require(fm[0]==.1f&&fm[1]==-.2f&&fm[2]==0&&fm[3]==0&&fm[4]==0&&fm[5]==0,"float mute");
        auto endRemoved=(dir/L"tiny-end-removed.wav").wstring(); audio::removeRegion(tinyW,.003,tinyW.duration(),endRemoved);
        require(readPcm16(audio::openWave(endRemoved))==std::vector<int16_t>({100,-100,200,-200,300,-300}),"remove at end");
        const int16_t loud[] = {30000,-30000,12000,-12000}; auto loudIn=(dir/L"loud.wav").wstring(); writeTiny(loudIn,1,2,loud,sizeof loud);
        auto loudOut=(dir/L"loud-out.wav").wstring(); audio::adjustGain(audio::openWave(loudIn),0,.001,loudOut,6); auto lo=readPcm16(audio::openWave(loudOut)); require(lo[0]==32767&&lo[1]==-32768,"pcm hard limit");
        auto negOut=(dir/L"negative.wav").wstring(); audio::adjustGain(audio::openWave(loudIn),.001,.002,negOut,-6); auto no=readPcm16(audio::openWave(negOut)); require(no[2]==6014&&no[3]==-6014,"negative gain");
        bool bad=false; try { audio::adjustGain(tinyW,.001,.001,(dir/L"empty.wav").wstring(),1); } catch(const std::exception&) { bad=true; } require(bad,"empty range validation");
        bad=false; try { audio::adjustGain(tinyW,NAN,.001,(dir/L"nan.wav").wstring(),1); } catch(const std::exception&) { bad=true; } require(bad,"nonfinite range validation");
        const float special[] = {NAN, INFINITY, 0.25f, -0.5f}; auto specialIn=(dir/L"special.wav").wstring(); writeTiny(specialIn,3,2,special,sizeof special);
        auto specialOut=(dir/L"special-out.wav").wstring(); audio::adjustGain(audio::openWave(specialIn),.001,.002,specialOut,0); auto so=readFloat(audio::openWave(specialOut)); require(std::isnan(so[0])&&std::isinf(so[1])&&so[2]==.25f,"zero gain preserves special samples");
        std::vector<int16_t> longSamples(40000*2); for(size_t i=0;i<longSamples.size();i++) longSamples[i]=int16_t(i%30000); auto longIn=(dir/L"long.wav").wstring(); writeTiny(longIn,1,2,longSamples.data(),longSamples.size()*2);
        auto longOut=(dir/L"long-out.wav").wstring(); audio::removeRegion(audio::openWave(longIn),10.0,20.0,longOut); auto lw=audio::openWave(longOut); require(lw.frames()==30000&&readPcm16(lw).front()==longSamples.front()&&readPcm16(lw).back()==longSamples.back(),"streaming region edit");
        wprintf(L"PASS PCM16/float32 WAV, peaks, trim, MF import, MP3 128/192/320, player\n");return 0;
    }catch(const std::exception& e){fprintf(stderr,"FAIL %s\n",e.what());return 1;}
}
