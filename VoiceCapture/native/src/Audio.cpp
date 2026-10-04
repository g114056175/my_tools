#include "Audio.hpp"
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfobjects.h>
#include <mfreadwrite.h>
#include <propvarutil.h>
#include <functiondiscoverykeys_devpkey.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <memory>
#include <optional>
#include <stdexcept>

namespace audio {
namespace {
void check(HRESULT hr, const char* what) { if (FAILED(hr)) throw std::runtime_error(std::string(what) + " (HRESULT " + std::to_string((unsigned)hr) + ")"); }
void mmcheck(MMRESULT r, const char* what) { if (r) throw std::runtime_error(std::string(what) + " (MMRESULT " + std::to_string(r) + ")"); }
template<class T> struct Com {
    T* p = nullptr;
    Com()=default;
    Com(const Com&)=delete;
    Com& operator=(const Com&)=delete;
    Com(Com&& other) noexcept : p(other.p) {other.p=nullptr;}
    Com& operator=(Com&& other) noexcept {if(this!=&other){if(p)p->Release();p=other.p;other.p=nullptr;}return *this;}
    ~Com() { if (p) p->Release(); }
    T** put() { if (p) p->Release(); p = nullptr; return &p; }
    T* operator->() const { return p; }
    operator bool() const { return p != nullptr; }
};
struct Apartment { HRESULT hr; explicit Apartment(DWORD kind = COINIT_MULTITHREADED) : hr(CoInitializeEx(nullptr, kind)) { if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) check(hr, "CoInitializeEx"); } ~Apartment() { if (SUCCEEDED(hr)) CoUninitialize(); } };
struct MediaRuntime { MediaRuntime() { check(MFStartup(MF_VERSION), "MFStartup"); } ~MediaRuntime() { MFShutdown(); } };
FILE* fileOpen(const std::wstring& p, const wchar_t* mode) { FILE* f = _wfopen(p.c_str(), mode); if (!f) throw std::runtime_error("Cannot open audio file"); return f; }
void writeExact(FILE* f, const void* p, size_t n) { if (fwrite(p, 1, n, f) != n) throw std::runtime_error("Audio write failed"); }
void readExact(FILE* f, void* p, size_t n) { if (fread(p, 1, n, f) != n) throw std::runtime_error("Audio read failed"); }
uint16_t u16(FILE* f) { uint8_t b[2]; readExact(f,b,2); return uint16_t(b[0] | b[1]<<8); }
uint32_t u32(FILE* f) { uint8_t b[4]; readExact(f,b,4); return uint32_t(b[0] | b[1]<<8 | b[2]<<16 | b[3]<<24); }
void put16(FILE* f, uint16_t v) { uint8_t b[2] = {uint8_t(v),uint8_t(v>>8)}; writeExact(f,b,2); }
void put32(FILE* f, uint32_t v) { uint8_t b[4] = {uint8_t(v),uint8_t(v>>8),uint8_t(v>>16),uint8_t(v>>24)}; writeExact(f,b,4); }
class Writer {
    FILE* f_ = nullptr; uint32_t bytes_ = 0; uint32_t rate_; uint16_t channels_,format_,bits_; bool finished_ = false;
    void header() {
        if(fseek(f_,0,SEEK_SET)) throw std::runtime_error("WAV seek failed"); writeExact(f_,"RIFF",4); put32(f_,(format_==3?48u:36u)+bytes_); writeExact(f_,"WAVEfmt ",8);
        put32(f_,16); put16(f_,format_); put16(f_,channels_); put32(f_,rate_); put32(f_,rate_*channels_*bits_/8);
        put16(f_,channels_*bits_/8); put16(f_,bits_);
        if(format_==3){writeExact(f_,"fact",4);put32(f_,4);put32(f_,bytes_/(channels_*bits_/8));}
        writeExact(f_,"data",4); put32(f_,bytes_);
    }
public:
    Writer(const std::wstring& path, uint32_t rate, uint16_t channels,uint16_t format=1,uint16_t bits=16) : rate_(rate),channels_(channels),format_(format),bits_(bits) {
        std::filesystem::create_directories(std::filesystem::path(path).parent_path());
        f_=fileOpen(path,L"wb+"); try { header(); } catch(...) { fclose(f_); f_=nullptr; throw; }
    }
    ~Writer() { if(f_) { try { finish(); } catch(...) { if(f_) fclose(f_); f_=nullptr; } } }
    void finish() {
        if(finished_) return;
        if(!f_) throw std::runtime_error("WAV writer is closed");
        header(); if(fclose(f_)!=0) { f_=nullptr; throw std::runtime_error("Audio close failed"); }
        f_=nullptr; finished_=true;
    }
    void append(const void* p, size_t n) {
        if (n > UINT32_MAX-(format_==3?48u:36u)-bytes_) throw std::runtime_error("WAV 4 GiB limit reached");
        writeExact(f_,p,n); bytes_+=uint32_t(n);
    }
    void silence(uint64_t frames) {
        const char z[65536]{}; uint64_t n=frames*channels_*bits_/8;
        while(n) { size_t chunk=size_t(std::min<uint64_t>(n,sizeof z)); append(z,chunk); n-=chunk; }
    }
};
uint64_t frameAt(const Wave& w,double t) { return uint64_t(std::clamp(std::llround(t*w.rate),0ll,(long long)w.frames())); }
void copyFrames(const Wave& w,uint64_t first,uint64_t count, Writer& writer) {
    std::unique_ptr<FILE,decltype(&fclose)> f(fileOpen(w.path,L"rb"),fclose);
    if (_fseeki64(f.get(),static_cast<long long>(w.dataOffset+first*w.frameBytes()),SEEK_SET)) throw std::runtime_error("WAV seek failed");
    char buf[65536]; uint64_t left=count*w.frameBytes();
    while(left) { size_t n=size_t(std::min<uint64_t>(left,sizeof buf)); readExact(f.get(),buf,n); writer.append(buf,n); left-=n; }
}
void setGuid(IMFMediaType* t,REFGUID key,REFGUID value) { check(t->SetGUID(key,value),"Media type GUID"); }
void setU32(IMFMediaType* t,REFGUID key,UINT32 value) { check(t->SetUINT32(key,value),"Media type field"); }
void mediaType(Com<IMFMediaType>& t, REFGUID subtype, UINT32 rate,UINT32 channels,UINT32 bits,UINT32 avg,UINT32 align) {
    check(MFCreateMediaType(t.put()),"MFCreateMediaType");
    setGuid(t.p,MF_MT_MAJOR_TYPE,MFMediaType_Audio); setGuid(t.p,MF_MT_SUBTYPE,subtype);
    setU32(t.p,MF_MT_AUDIO_SAMPLES_PER_SECOND,rate); setU32(t.p,MF_MT_AUDIO_NUM_CHANNELS,channels);
    if(bits) setU32(t.p,MF_MT_AUDIO_BITS_PER_SAMPLE,bits);
    if(avg) setU32(t.p,MF_MT_AUDIO_AVG_BYTES_PER_SECOND,avg);
    if(align) setU32(t.p,MF_MT_AUDIO_BLOCK_ALIGNMENT,align);
    if(subtype==MFAudioFormat_PCM && channels==2) setU32(t.p,MF_MT_AUDIO_CHANNEL_MASK,3);
}
}

Wave openWave(const std::wstring& path) {
    std::unique_ptr<FILE,decltype(&fclose)> f(fileOpen(path,L"rb"),fclose);
    char tag[4]; readExact(f.get(),tag,4); if(memcmp(tag,"RIFF",4)) throw std::runtime_error("Not a RIFF WAV");
    u32(f.get()); readExact(f.get(),tag,4); if(memcmp(tag,"WAVE",4)) throw std::runtime_error("Not a WAV");
    Wave w; w.path=path; uint16_t format=0,bits=0;
    while(true) {
        if(fread(tag,1,4,f.get())!=4) break;
        uint32_t size=u32(f.get()); auto pos=_ftelli64(f.get());
        if(!memcmp(tag,"fmt ",4)) {
            if(size<16) throw std::runtime_error("Incomplete WAV fmt");
            format=u16(f.get()); w.channels=u16(f.get()); w.rate=u32(f.get()); u32(f.get()); u16(f.get()); bits=u16(f.get());
            if(format==WAVE_FORMAT_EXTENSIBLE&&size>=40){u16(f.get());u16(f.get());u32(f.get());GUID subtype{};readExact(f.get(),&subtype,sizeof subtype);
                const GUID base={0,0,0x10,{0x80,0,0,0xaa,0,0x38,0x9b,0x71}};
                if(subtype.Data2==base.Data2&&subtype.Data3==base.Data3&&memcmp(subtype.Data4,base.Data4,8)==0)format=uint16_t(subtype.Data1);
            }
        } else if(!memcmp(tag,"data",4)) {
            w.dataOffset=uint64_t(pos); auto total=std::filesystem::file_size(std::filesystem::path(path));
            w.dataBytes=uint32_t(std::min<uint64_t>(size,total>w.dataOffset?total-w.dataOffset:0)); break;
        }
        if(_fseeki64(f.get(),pos+size+(size&1),SEEK_SET)) break;
    }
    if(!((format==1&&bits==16)||(format==3&&bits==32)) || w.channels<1 || w.channels>8 || !w.rate || w.rate>384000 || !w.dataOffset)
        throw std::runtime_error("Only PCM16 or float32 WAV is supported");
    w.format=format;w.bits=bits;
    return w;
}
std::vector<float> peaks(const Wave& w) {
    std::unique_ptr<FILE,decltype(&fclose)> f(fileOpen(w.path,L"rb"),fclose); _fseeki64(f.get(),w.dataOffset,SEEK_SET);
    uint64_t buckets=std::clamp<uint64_t>(uint64_t(std::ceil(w.duration()*1000)),200,2000000);
    uint64_t framesPer=std::max<uint64_t>(1,(w.frames()+buckets-1)/buckets);
    std::vector<float> out; out.reserve(size_t(std::min<uint64_t>(buckets,w.frames())));
    const size_t frameBytes=w.frameBytes(); std::vector<char> buffer(size_t(std::min<uint64_t>(framesPer,32768))*frameBytes);
    uint64_t remain=w.frames();
    while(remain) {
        uint64_t nframes=std::min(remain,framesPer); float peak=0;
        while(nframes) {
            size_t part=size_t(std::min<uint64_t>(nframes,buffer.size()/frameBytes)); readExact(f.get(),buffer.data(),part*frameBytes);
            if(w.format==1){const auto* samples=(const int16_t*)buffer.data();for(size_t i=0;i<part*w.channels;i++)peak=std::max(peak,std::abs(float(samples[i])/32768.f));}
            else {const auto* samples=(const float*)buffer.data();for(size_t i=0;i<part*w.channels;i++)if(std::isfinite(samples[i]))peak=std::max(peak,std::min(1.f,std::abs(samples[i])));}
            nframes-=part;
        }
        out.push_back(peak); remain-=std::min(remain,framesPer);
    }
    return out;
}
void exportWave(const Wave& w,double begin,double end,const std::wstring& path) {
    if(end<=begin || begin<0 || end>w.duration()+0.0005) throw std::runtime_error("Invalid trim range");
    if(_wcsicmp(std::filesystem::absolute(std::filesystem::path(w.path)).lexically_normal().c_str(),std::filesystem::absolute(std::filesystem::path(path)).lexically_normal().c_str())==0)
        throw std::runtime_error("Cannot overwrite working WAV while reading it");
    uint64_t first=frameAt(w,begin),last=frameAt(w,end); if(last<=first) throw std::runtime_error("Select at least one sample");
    Writer out(path,w.rate,w.channels,w.format,w.bits); copyFrames(w,first,last-first,out);
}
namespace {
void rejectSamePath(const Wave& w, const std::wstring& path) {
    if(_wcsicmp(std::filesystem::absolute(std::filesystem::path(w.path)).lexically_normal().c_str(),
                std::filesystem::absolute(std::filesystem::path(path)).lexically_normal().c_str())==0)
        throw std::runtime_error("Cannot overwrite working WAV while reading it");
    if(!w.frameBytes() || w.dataBytes % w.frameBytes()) throw std::runtime_error("Invalid WAV frame data");
}
std::pair<uint64_t,uint64_t> editRange(const Wave& w, double begin, double end) {
    if(!std::isfinite(begin) || !std::isfinite(end) || end<=begin || begin<0 || end>w.duration()+0.0005)
        throw std::runtime_error("Invalid edit range");
    uint64_t first=frameAt(w,begin), last=frameAt(w,end);
    if(last<=first) throw std::runtime_error("Select at least one sample");
    return {first,last};
}
}
void removeRegion(const Wave& w,double begin,double end,const std::wstring& path) {
    rejectSamePath(w,path); auto [first,last]=editRange(w,begin,end);
    if(first==0 && last==w.frames()) throw std::runtime_error("Cannot remove the entire WAV");
    Writer out(path,w.rate,w.channels,w.format,w.bits);
    copyFrames(w,0,first,out); copyFrames(w,last,w.frames()-last,out); out.finish();
}
void adjustGain(const Wave& w,double begin,double end,const std::wstring& path,double db,bool mute) {
    rejectSamePath(w,path); auto [first,last]=editRange(w,begin,end);
    if(!mute && (!std::isfinite(db) || db < -60.0 || db > 24.0))
        throw std::runtime_error("Gain must be between -60 and 24 dB");
    if(!mute && db==0.0) { Writer out(path,w.rate,w.channels,w.format,w.bits); copyFrames(w,0,w.frames(),out); out.finish(); return; }
    const double gain=mute?0.0:std::pow(10.0,db/20.0);
    Writer out(path,w.rate,w.channels,w.format,w.bits);
    std::unique_ptr<FILE,decltype(&fclose)> f(fileOpen(w.path,L"rb"),fclose);
    if(_fseeki64(f.get(),static_cast<long long>(w.dataOffset),SEEK_SET)) throw std::runtime_error("WAV seek failed");
    const size_t bytesPerFrame=w.frameBytes();
    std::vector<char> buffer(std::max<size_t>(bytesPerFrame,65536/bytesPerFrame*bytesPerFrame));
    uint64_t frame=0, remaining=w.frames();
    while(remaining) {
        size_t count=std::min<uint64_t>(remaining,buffer.size()/bytesPerFrame);
        readExact(f.get(),buffer.data(),count*bytesPerFrame);
        uint64_t regionBegin=frame, regionEnd=frame+count;
        if(regionEnd>first && regionBegin<last) {
            size_t beginIn=size_t(std::max<uint64_t>(first,regionBegin)-regionBegin);
            size_t endIn=size_t(std::min<uint64_t>(last,regionEnd)-regionBegin);
            size_t samples= (endIn-beginIn)*w.channels;
            if(w.format==1) {
                auto* p=reinterpret_cast<int16_t*>(buffer.data()) + beginIn*w.channels;
                for(size_t i=0;i<samples;i++) {
                    long v=mute?0L:std::lround(double(p[i])*gain);
                    p[i]=int16_t(std::clamp(v,-32768L,32767L));
                }
            } else {
                auto* p=reinterpret_cast<float*>(buffer.data()) + beginIn*w.channels;
                for(size_t i=0;i<samples;i++) {
                    double v=mute?0.0:(std::isfinite(p[i])?double(p[i])*gain:0.0);
                    p[i]=float(std::clamp(v,-1.0,1.0));
                }
            }
        }
        out.append(buffer.data(),count*bytesPerFrame); frame+=count; remaining-=count;
    }
    out.finish();
}
void importAudio(const std::wstring& source,const std::wstring& target,bool preserveNativeWav) {
    if(_wcsicmp(std::filesystem::absolute(std::filesystem::path(source)).lexically_normal().c_str(),std::filesystem::absolute(std::filesystem::path(target)).lexically_normal().c_str())==0)
        throw std::runtime_error("Input and working path must differ");
    if(preserveNativeWav&&_wcsicmp(std::filesystem::path(source).extension().c_str(),L".wav")==0) {
        std::optional<Wave> existing;
        try { existing=openWave(source); } catch(const std::runtime_error&) { /* Media Foundation handles other WAV formats. */ }
        if(existing&&existing->channels==2&&(existing->rate==44100||existing->rate==48000)) {
            std::filesystem::create_directories(std::filesystem::path(target).parent_path());
            if(!CopyFileW(source.c_str(),target.c_str(),FALSE))throw std::runtime_error("Cannot copy WAV input");
            return;
        }
    }
    Apartment apt; MediaRuntime mf; Com<IMFSourceReader> reader;
    check(MFCreateSourceReaderFromURL(source.c_str(),nullptr,reader.put()),"Open audio decoder");
    Com<IMFMediaType> type; mediaType(type,MFAudioFormat_PCM,44100,2,16,176400,4);
    check(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM,TRUE),"Select audio stream");
    check(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM,nullptr,type.p),"Set PCM output");
    Writer out(target,44100,2);
    for(;;) {
        DWORD stream=0,flags=0; LONGLONG timestamp=0; Com<IMFSample> sample;
        check(reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM,0,&stream,&flags,&timestamp,sample.put()),"Decode audio");
        if(flags&MF_SOURCE_READERF_ERROR) throw std::runtime_error("Audio decoder error");
        if(sample) {
            Com<IMFMediaBuffer> buffer; check(sample->ConvertToContiguousBuffer(buffer.put()),"Decode buffer");
            BYTE* data=nullptr; DWORD max=0,len=0; check(buffer->Lock(&data,&max,&len),"Lock decode buffer");
            try { out.append(data,len); } catch(...) { buffer->Unlock(); throw; } buffer->Unlock();
        }
        if(flags&MF_SOURCE_READERF_ENDOFSTREAM) break;
    }
}
void exportMp3(const Wave& w,double begin,double end,const std::wstring& path,int kbps) {
    if(kbps!=128 && kbps!=192 && kbps!=320) throw std::runtime_error("Invalid MP3 bitrate");
    if((w.rate!=44100&&w.rate!=48000) || w.channels!=2) throw std::runtime_error("MP3 requires 44.1 or 48 kHz stereo WAV");
    uint64_t first=frameAt(w,begin),last=frameAt(w,end); if(last<=first) throw std::runtime_error("Invalid MP3 range");
    Apartment apt; MediaRuntime mf; Com<IMFSinkWriter> sink;
    check(MFCreateSinkWriterFromURL(path.c_str(),nullptr,nullptr,sink.put()),"Create MP3 writer");
    Com<IMFMediaType> outType,inType; mediaType(outType,MFAudioFormat_MP3,w.rate,2,0,kbps*125,0);
    DWORD stream=0; check(sink->AddStream(outType.p,&stream),"Add MP3 stream");
    mediaType(inType,MFAudioFormat_PCM,w.rate,2,16,w.rate*4,4);
    check(sink->SetInputMediaType(stream,inType.p,nullptr),"Set MP3 input"); check(sink->BeginWriting(),"Start MP3 writer");
    std::unique_ptr<FILE,decltype(&fclose)> f(fileOpen(w.path,L"rb"),fclose);
    _fseeki64(f.get(),static_cast<long long>(w.dataOffset+first*w.frameBytes()),SEEK_SET); uint64_t left=(last-first)*w.frameBytes(),position=0;
    char raw[65536],converted[32768];
    while(left) {
        DWORD inputBytes=DWORD(std::min<uint64_t>(left,sizeof raw));inputBytes-=inputBytes%w.frameBytes();readExact(f.get(),raw,inputBytes);
        DWORD n=inputBytes;
        const char* samples=raw;
        if(w.format==3){n=inputBytes/2;const float* floats=(const float*)raw;auto* pcm=(int16_t*)converted;
            for(DWORD i=0;i<n/2;i++){float value=std::isfinite(floats[i])?std::clamp(floats[i],-1.f,1.f):0.f;pcm[i]=int16_t(std::clamp(std::lround(value*32768.f),-32768l,32767l));}
            samples=converted;
        }
        Com<IMFMediaBuffer> buffer; check(MFCreateMemoryBuffer(n,buffer.put()),"MP3 buffer");
        BYTE* ptr=nullptr; DWORD cap=0,len=0; check(buffer->Lock(&ptr,&cap,&len),"Lock MP3 buffer");
        memcpy(ptr,samples,n); buffer->Unlock(); check(buffer->SetCurrentLength(n),"MP3 buffer length");
        Com<IMFSample> sample; check(MFCreateSample(sample.put()),"MP3 sample");
        check(sample->AddBuffer(buffer.p),"MP3 sample buffer");
        check(sample->SetSampleTime(LONGLONG(position*10000000/(w.rate*4))),"MP3 time");
        check(sample->SetSampleDuration(LONGLONG(uint64_t(n)*10000000/(w.rate*4))),"MP3 duration");
        check(sink->WriteSample(stream,sample.p),"Encode MP3"); left-=inputBytes; position+=n;
    }
    check(sink->Finalize(),"Finalize MP3");
}

void Player::open(const Wave& w) {
    close(); wave_=w; file_.open(std::filesystem::path(w.path),std::ios::binary);
    if(!file_) throw std::runtime_error("Cannot open working WAV");
    WAVEFORMATEX format{}; format.wFormatTag=w.format; format.nChannels=w.channels; format.nSamplesPerSec=w.rate;
    format.wBitsPerSample=w.bits; format.nBlockAlign=w.frameBytes(); format.nAvgBytesPerSec=w.rate*format.nBlockAlign;
    try {
        mmcheck(waveOutOpen(&device_,WAVE_MAPPER,&format,0,0,CALLBACK_NULL),"Open playback device");
        mmcheck(waveOutPause(device_),"Pause playback device");
        size_t capacity=size_t(std::max<uint32_t>(1,w.rate/20))*w.frameBytes();
        for(auto& s:slots_) {
            s.bytes.resize(capacity); s.header.lpData=s.bytes.data(); s.header.dwBufferLength=DWORD(capacity);
            mmcheck(waveOutPrepareHeader(device_,&s.header,sizeof(WAVEHDR)),"Prepare playback buffer"); s.prepared=true;
        }
    } catch(...) { close(); throw; }
}
void Player::close() {
    if(device_) { waveOutReset(device_); for(auto& s:slots_) if(s.prepared) { waveOutUnprepareHeader(device_,&s.header,sizeof(WAVEHDR)); s.prepared=false; } waveOutClose(device_); }
    device_=nullptr; for(auto& s:slots_) {s.queued=false; s.bytes.clear(); s.header={};}
    if(file_.is_open()) file_.close(); wave_={}; playing_=range_=false; first_=end_=read_=0; position_=0;
}
void Player::fill(Slot& slot) {
    if(read_>=end_) return;
    size_t n=size_t(std::min<uint64_t>(end_-read_,slot.bytes.size()/wave_.frameBytes()))*wave_.frameBytes();
    file_.seekg(std::streamoff(wave_.dataOffset+read_*wave_.frameBytes())); file_.read(slot.bytes.data(),std::streamsize(n));
    if(size_t(file_.gcount())!=n) throw std::runtime_error("WAV changed during playback");
    slot.header.dwBufferLength=DWORD(n); slot.header.dwFlags&=~WHDR_DONE;
    mmcheck(waveOutWrite(device_,&slot.header,sizeof(WAVEHDR)),"Queue playback buffer"); slot.queued=true; read_+=n/wave_.frameBytes();
}
void Player::reset(double start,double end) {
    if(!device_) return;
    mmcheck(waveOutReset(device_),"Reset playback"); mmcheck(waveOutPause(device_),"Pause playback");
    first_=frameAt(wave_,start); end_=frameAt(wave_,end); read_=first_; playing_=false; range_=true;
    position_=double(first_)/wave_.rate; file_.clear();
    for(auto& s:slots_) { s.queued=false; fill(s); }
}
void Player::play(double start,double end) {
    if(!device_ || end<=start) return;
    if(!range_ || std::abs(position_-start)>.002 || end_!=frameAt(wave_,end) || position_>=end-.001) reset(start,end);
    mmcheck(waveOutRestart(device_),"Start playback"); playing_=true; tick();
}
void Player::pause() {
    if(!device_ || !playing_) return; tick(); mmcheck(waveOutPause(device_),"Pause playback"); playing_=false;
}
void Player::seek(double seconds,double end) {
    if(!device_) return; bool resume=playing_; reset(seconds,end); if(resume) { mmcheck(waveOutRestart(device_),"Resume playback"); playing_=true; tick(); }
}
void Player::tick() {
    if(!device_ || !range_) return;
    MMTIME time{}; time.wType=TIME_SAMPLES;
    if(waveOutGetPosition(device_,&time,sizeof time)==MMSYSERR_NOERROR) {
        uint64_t samples= time.wType==TIME_SAMPLES ? time.u.sample : time.wType==TIME_BYTES ? time.u.cb/wave_.frameBytes() : time.wType==TIME_MS ? uint64_t(time.u.ms)*wave_.rate/1000 : 0;
        position_=std::clamp((double(first_)+std::min<uint64_t>(samples,end_-first_))/wave_.rate,0.0,wave_.duration());
    }
    bool queued=false;
    for(auto& s:slots_) {
        if(s.queued && (s.header.dwFlags&WHDR_DONE)) { s.queued=false; fill(s); }
        queued |= s.queued;
    }
    if(playing_ && read_>=end_ && !queued) { position_=double(end_)/wave_.rate; playing_=false; }
}

namespace {
struct ProcessActivation { DWORD type; struct { DWORD pid, mode; } process; };
class Completion final : public IActivateAudioInterfaceCompletionHandler {
    std::atomic<ULONG> refs_{2};
public:
    HANDLE event=CreateEventW(nullptr,TRUE,FALSE,nullptr);
    ProcessActivation payload{};
    PROPVARIANT variant{};
    HRESULT result=E_PENDING;
    IUnknown* unknown=nullptr;
    Completion(DWORD pid) { payload.type=1; payload.process.pid=pid; payload.process.mode=0;
        PropVariantInit(&variant); variant.vt=VT_BLOB; variant.blob.cbSize=sizeof(payload); variant.blob.pBlobData=(BYTE*)&payload; }
    ~Completion() { if(unknown) unknown->Release(); if(event) CloseHandle(event); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** out) override {
        if(!out) return E_POINTER; *out=nullptr;
        if(iid==IID_IUnknown || iid==__uuidof(IActivateAudioInterfaceCompletionHandler)) { *out=static_cast<IActivateAudioInterfaceCompletionHandler*>(this); AddRef(); return S_OK; }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override { ULONG n=--refs_; if(!n) delete this; return n; }
    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
        HRESULT activation=E_PENDING; HRESULT call=op->GetActivateResult(&activation,&unknown);
        result=FAILED(call)?call:activation; if(SUCCEEDED(result) && !unknown) result=E_FAIL;
        SetEvent(event); Release(); return S_OK;
    }
};
Com<IAudioClient> activateProcess(DWORD pid) {
    Com<IAudioClient> client; auto* c=new Completion(pid);
    if(!c->event) { c->Release(); c->Release(); throw std::runtime_error("CreateEvent failed"); }
    Com<IActivateAudioInterfaceAsyncOperation> op;
    HRESULT hr=ActivateAudioInterfaceAsync(L"VAD\\Process_Loopback",__uuidof(IAudioClient),&c->variant,c,op.put());
    if(FAILED(hr)) { c->Release(); c->Release(); check(hr,"Activate process audio"); }
    DWORD wait=WaitForSingleObject(c->event,10000);
    HRESULT activation=wait==WAIT_OBJECT_0?c->result:E_FAIL,query=S_OK;
    if(SUCCEEDED(activation)) query=c->unknown->QueryInterface(__uuidof(IAudioClient),(void**)client.put());
    c->Release(); if(wait!=WAIT_OBJECT_0) throw std::runtime_error("Process audio activation timed out");
    check(activation,"Process audio activation");check(query,"Process IAudioClient");
    return client;
}
int64_t qpc100ns() { LARGE_INTEGER t,f; QueryPerformanceCounter(&t); QueryPerformanceFrequency(&f); return int64_t(double(t.QuadPart)*10000000.0/f.QuadPart); }
uint64_t activeFrames(int64_t now,int64_t begin,int64_t paused,uint32_t rate) { return uint64_t(std::max<int64_t>(0,now-begin-paused)*rate/10000000); }
bool mixFloat32(const WAVEFORMATEX* f) {
    if(!f||f->nChannels!=2||f->wBitsPerSample!=32)return false;
    if(f->wFormatTag==WAVE_FORMAT_IEEE_FLOAT)return true;
    if(f->wFormatTag!=WAVE_FORMAT_EXTENSIBLE||f->cbSize<22)return false;
    const GUID& sub=((const WAVEFORMATEXTENSIBLE*)f)->SubFormat;
    const GUID expected={3,0,0x10,{0x80,0,0,0xaa,0,0x38,0x9b,0x71}};
    return sub==expected;
}
bool mixPcm16(const WAVEFORMATEX* f) {
    if(!f||f->nChannels!=2||f->wBitsPerSample!=16)return false;
    if(f->wFormatTag==WAVE_FORMAT_PCM)return true;
    if(f->wFormatTag!=WAVE_FORMAT_EXTENSIBLE||f->cbSize<22)return false;
    const GUID& sub=((const WAVEFORMATEXTENSIBLE*)f)->SubFormat;
    const GUID expected={1,0,0x10,{0x80,0,0,0xaa,0,0x38,0x9b,0x71}};
    return sub==expected;
}
std::wstring wideError(const std::exception& e) {
    const char* s=e.what(); int n=MultiByteToWideChar(CP_UTF8,0,s,-1,nullptr,0);
    if(n<=0) return L"音訊處理失敗"; std::wstring out(size_t(n),0); MultiByteToWideChar(CP_UTF8,0,s,-1,out.data(),n); out.pop_back(); return out;
}
}
bool processCaptureAvailable() {
    using RtlGetVersionFn=LONG(WINAPI*)(OSVERSIONINFOW*);
    auto fn=(RtlGetVersionFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"RtlGetVersion");
    OSVERSIONINFOW info{}; info.dwOSVersionInfoSize=sizeof info; return fn && fn(&info)==0 && info.dwBuildNumber>=20348;
}
Recorder::~Recorder() { stop(); finish(); }
void Recorder::start(const std::wstring& output,bool process,DWORD pid) {
    finish(); {std::scoped_lock lock(mutex_); peaks_.clear(); duration_=0; error_.clear();}
    output_=output; stop_=paused_=done_=false; running_=true;
    worker_=std::thread([this,process,pid] { try { run(process,pid); } catch(const std::exception& e) {std::scoped_lock lock(mutex_); error_=wideError(e);} running_=false; done_=true; });
}
void Recorder::finish() { if(worker_.joinable()) worker_.join(); }
double Recorder::snapshot(std::vector<float>& peaks) const { std::scoped_lock lock(mutex_); peaks=peaks_; return duration_; }
std::wstring Recorder::error() const { std::scoped_lock lock(mutex_); return error_; }
void Recorder::run(bool process,DWORD pid) {
    Apartment apt; Com<IAudioClient> client;
    if(process) client=activateProcess(pid);
    else {
        Com<IMMDeviceEnumerator> enumerator; Com<IMMDevice> device;
        check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),(void**)enumerator.put()),"Audio device enumerator");
        check(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,device.put()),"Default playback device");
        check(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,(void**)client.put()),"Activate playback device");
    }
    WAVEFORMATEX fallback{};fallback.wFormatTag=WAVE_FORMAT_PCM;fallback.nChannels=2;fallback.nSamplesPerSec=44100;
    fallback.wBitsPerSample=16;fallback.nBlockAlign=4;fallback.nAvgBytesPerSec=176400;
    WAVEFORMATEX* mix=nullptr;
    HRESULT mixResult=client->GetMixFormat(&mix);
    bool native=SUCCEEDED(mixResult)&&mix&&(mix->nSamplesPerSec==44100||mix->nSamplesPerSec==48000)
        &&(mixFloat32(mix)||mixPcm16(mix));
    WAVEFORMATEX* chosen=native?mix:&fallback;
    uint32_t rate=chosen->nSamplesPerSec,frameBytes=chosen->nBlockAlign;
    uint16_t wavFormat=native&&mixFloat32(chosen)?3:1,bits=wavFormat==3?32:16;
    rate_=rate;
    DWORD flags=AUDCLNT_STREAMFLAGS_LOOPBACK|AUDCLNT_STREAMFLAGS_EVENTCALLBACK;
    if(!native&&!process) flags|=AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM|AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    HRESULT initialized=client->Initialize(AUDCLNT_SHAREMODE_SHARED,flags,10000000,0,chosen,nullptr);
    if(mix)CoTaskMemFree(mix);
    check(initialized,"Initialize audio loopback");
    Com<IAudioCaptureClient> capture; check(client->GetService(__uuidof(IAudioCaptureClient),(void**)capture.put()),"Capture service");
    HANDLE event=CreateEventW(nullptr,FALSE,FALSE,nullptr); if(!event) throw std::runtime_error("Audio event failed");
    try {
        check(client->SetEventHandle(event),"Set audio event"); Writer writer(output_,rate,2,wavFormat,bits);
        int64_t begin=qpc100ns(), pauseBegin=0, pausedTicks=0; bool wasPaused=false;
        uint64_t written=0; float bucket=0; uint32_t bucketFrames=0;
        const uint32_t peakBucketFrames=std::max<uint32_t>(1,rate/50),maxSeconds=7200;
        const uint64_t maxFrames=uint64_t(rate)*maxSeconds;
        uint64_t lastDeviceEnd=0;bool haveFirstPacket=false,haveDevicePosition=false,resumePending=false;
#ifdef AUDIO_DIAGNOSTICS
        uint64_t debugGaps=0,debugSkips=0;uint32_t debugDiscontinuities=0;
#endif
        auto addSamples=[&](const BYTE* pcm,uint32_t frames,bool silent) {
            std::vector<float> ready;
            for(uint32_t i=0;i<frames;i++) {
                if(!silent){
                    if(wavFormat==3){const auto* samples=(const float*)pcm;for(int c=0;c<2;c++)if(std::isfinite(samples[i*2+c]))bucket=std::max(bucket,std::min(1.f,std::abs(samples[i*2+c])));}
                    else {const auto* samples=(const int16_t*)pcm;bucket=std::max(bucket,std::max(std::abs(float(samples[i*2])/32768.f),std::abs(float(samples[i*2+1])/32768.f)));}
                }
                if(++bucketFrames>=peakBucketFrames) { ready.push_back(bucket); bucket=0; bucketFrames=0; }
            }
            if(!ready.empty()) {std::scoped_lock lock(mutex_); peaks_.insert(peaks_.end(),ready.begin(),ready.end());}
        };
        auto addSilence=[&](uint64_t frames) {
            while(frames) {uint32_t n=uint32_t(std::min<uint64_t>(frames,rate)); writer.silence(n); addSamples(nullptr,n,true); written+=n; frames-=n;}
        };
        bool started=false;
        if(!stop_) {check(client->Start(),"Start audio capture"); started=true;}
        try {
            while(started && !stop_) {
                int64_t now=qpc100ns(); bool paused=paused_;
                if(paused!=wasPaused) {if(paused) pauseBegin=now; else {pausedTicks+=now-pauseBegin;resumePending=true;} wasPaused=paused;}
                WaitForSingleObject(event,100);
                now=qpc100ns(); paused=paused_;
                if(paused!=wasPaused) {if(paused) pauseBegin=now; else {pausedTicks+=now-pauseBegin;resumePending=true;} wasPaused=paused;}
                if(activeFrames(now,begin,pausedTicks+(wasPaused?now-pauseBegin:0),rate)>=maxFrames) break;
                UINT32 packets=0; check(capture->GetNextPacketSize(&packets),"Capture packet size");
                while(packets && !stop_) {
                    BYTE* data=nullptr; UINT32 frames=0; DWORD packetFlags=0; UINT64 deviceTime=0,qpcTime=0;
                    check(capture->GetBuffer(&data,&frames,&packetFlags,&deviceTime,&qpcTime),"Capture packet");
                    try {
#ifdef AUDIO_DIAGNOSTICS
                        if(packetFlags&AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY)debugDiscontinuities++;
#endif
                        if(!paused_) {
                            // Device position is an integer frame counter. The QPC timestamp
                            // is useful to place the first packet (or a resumed segment), but
                            // converting every packet's QPC independently produces ±1-frame
                            // gaps/overlaps and audible crackle on otherwise continuous audio.
                            bool validPosition=(packetFlags&AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)==0;
                            bool newSegment=!haveFirstPacket||resumePending;
                            uint32_t skip=0;
                            if(newSegment) {
                                if(qpcTime&&validPosition) {
                                    uint64_t target=std::min<uint64_t>(activeFrames(int64_t(qpcTime),begin,pausedTicks,rate),maxFrames);
                                    if(target>written)addSilence(target-written);
                                }
                                haveFirstPacket=true;resumePending=false;
                                haveDevicePosition=validPosition;
                            } else if(validPosition&&haveDevicePosition) {
                                if(deviceTime>lastDeviceEnd) {
                                    uint64_t gap=std::min<uint64_t>(deviceTime-lastDeviceEnd,maxFrames-written);
#ifdef AUDIO_DIAGNOSTICS
                                    debugGaps+=gap;
#endif
                                    addSilence(gap);
                                } else if(deviceTime<lastDeviceEnd) {
                                    skip=uint32_t(std::min<uint64_t>(frames,lastDeviceEnd-deviceTime));
#ifdef AUDIO_DIAGNOSTICS
                                    debugSkips+=skip;
#endif
                                }
                            } else {
                                haveDevicePosition=validPosition;
                            }
                            if(validPosition)lastDeviceEnd=newSegment?deviceTime+frames:std::max<uint64_t>(lastDeviceEnd,deviceTime+frames);
                            uint32_t n=uint32_t(std::min<uint64_t>(frames-skip,maxFrames-written));
                            if(n) {
                                bool silent=(packetFlags&AUDCLNT_BUFFERFLAGS_SILENT)!=0;
                                if(silent) writer.silence(n); else writer.append(data+skip*frameBytes,size_t(n)*frameBytes);
                                addSamples(silent?nullptr:data+skip*frameBytes,n,silent); written+=n;
                            }
                        }
                    } catch(...) {capture->ReleaseBuffer(frames); throw;}
                    capture->ReleaseBuffer(frames); check(capture->GetNextPacketSize(&packets),"Next capture packet");
                }
                {std::scoped_lock lock(mutex_); duration_=double(written)/rate;}
            }
        } catch(...) {if(started) client->Stop(); throw;}
        if(started) client->Stop();
        int64_t now=qpc100ns(); if(wasPaused) pausedTicks+=now-pauseBegin;
        uint64_t finalFrames=std::min<uint64_t>(maxFrames,activeFrames(now,begin,pausedTicks,rate));
        if(finalFrames>written) addSilence(finalFrames-written);
        if(bucketFrames) {std::scoped_lock lock(mutex_); peaks_.push_back(bucket);}
        {std::scoped_lock lock(mutex_); duration_=double(written)/rate;}
#ifdef AUDIO_DIAGNOSTICS
        fprintf(stderr,"capture alignment: gaps=%llu skipped=%llu discontinuityPackets=%u\n",(unsigned long long)debugGaps,(unsigned long long)debugSkips,debugDiscontinuities);
#endif
    } catch(...) {CloseHandle(event); throw;} CloseHandle(event);
}
}
