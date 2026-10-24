#include "project1_region_recorder/mp4_writer.h"

#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>

#include <algorithm>
#include <cstring>

namespace lc {

Mp4Writer::~Mp4Writer() { Close(); }

bool Mp4Writer::Open(const std::wstring& path, int width, int height, int nominalFps,
                     std::wstring& error) {
    Close();
    width_ = width & ~1;
    height_ = height & ~1;
    nominalFps = std::clamp(nominalFps, 1, 60);
    if (width_ < 2 || height_ < 2) {
        error = L"The output region is too small.";
        return false;
    }

    HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_FULL);
    if (FAILED(hr)) {
        error = L"Media Foundation startup failed: " + HrText(hr);
        return false;
    }
    mfStarted_ = true;

    ComPtr<IMFAttributes> attributes;
    MFCreateAttributes(&attributes, 2);
    if (attributes) {
        attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
        attributes->SetUINT32(MF_LOW_LATENCY, TRUE);
    }
    hr = MFCreateFile(MF_ACCESSMODE_READWRITE, MF_OPENMODE_DELETE_IF_EXIST, MF_FILEFLAGS_NONE,
                      path.c_str(), &stream_);
    if (SUCCEEDED(hr))
        hr = MFCreateSinkWriterFromURL(path.c_str(), stream_.Get(), attributes.Get(), &writer_);
    if (FAILED(hr)) {
        error = L"Unable to create the MP4 file: " + HrText(hr);
        Close();
        return false;
    }

    ComPtr<IMFMediaType> outputType;
    hr = MFCreateMediaType(&outputType);
    if (SUCCEEDED(hr)) hr = outputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    if (SUCCEEDED(hr)) hr = outputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
    const UINT32 bitrate = static_cast<UINT32>(std::clamp<int64_t>(
        static_cast<int64_t>(width_) * height_ * nominalFps / 5, 800'000, 20'000'000));
    if (SUCCEEDED(hr)) hr = outputType->SetUINT32(MF_MT_AVG_BITRATE, bitrate);
    if (SUCCEEDED(hr))
        hr = outputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (SUCCEEDED(hr)) hr = MFSetAttributeSize(outputType.Get(), MF_MT_FRAME_SIZE, width_, height_);
    if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(outputType.Get(), MF_MT_FRAME_RATE, nominalFps, 1);
    if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(outputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    if (SUCCEEDED(hr)) hr = writer_->AddStream(outputType.Get(), &streamIndex_);

    ComPtr<IMFMediaType> inputType;
    if (SUCCEEDED(hr)) hr = MFCreateMediaType(&inputType);
    if (SUCCEEDED(hr)) hr = inputType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    if (SUCCEEDED(hr)) hr = inputType->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
    if (SUCCEEDED(hr))
        hr = inputType->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    if (SUCCEEDED(hr)) hr = MFSetAttributeSize(inputType.Get(), MF_MT_FRAME_SIZE, width_, height_);
    if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(inputType.Get(), MF_MT_FRAME_RATE, nominalFps, 1);
    if (SUCCEEDED(hr)) hr = MFSetAttributeRatio(inputType.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    if (SUCCEEDED(hr))
        hr = inputType->SetUINT32(MF_MT_DEFAULT_STRIDE, static_cast<UINT32>(width_ * 4));
    if (SUCCEEDED(hr)) hr = writer_->SetInputMediaType(streamIndex_, inputType.Get(), nullptr);
    if (SUCCEEDED(hr)) hr = writer_->BeginWriting();
    if (FAILED(hr)) {
        error = L"The H.264 encoder could not be initialized: " + HrText(hr);
        Close();
        return false;
    }
    return true;
}

bool Mp4Writer::WriteBgra(const std::vector<uint8_t>& bgra, int64_t time100ns,
                          int64_t duration100ns, std::wstring& error) {
    if (!writer_) return false;
    if (bgra.size() != static_cast<size_t>(width_) * height_ * 4) {
        error = L"The MP4 frame does not match the encoder canvas.";
        return false;
    }
    const DWORD bytes = static_cast<DWORD>(static_cast<size_t>(width_) * height_ * 4);
    ComPtr<IMFMediaBuffer> buffer;
    HRESULT hr = MFCreateMemoryBuffer(bytes, &buffer);
    BYTE* destination = nullptr;
    DWORD maxLength = 0;
    if (SUCCEEDED(hr)) hr = buffer->Lock(&destination, &maxLength, nullptr);
    if (SUCCEEDED(hr)) {
        // WGC is top-down and MF_MT_DEFAULT_STRIDE is positive, which also declares top-down.
        // Keep the row order unchanged; flipping here would make the media type contradict data.
        std::memcpy(destination, bgra.data(), bytes);
        buffer->Unlock();
        destination = nullptr;
        hr = buffer->SetCurrentLength(bytes);
    }
    if (destination) buffer->Unlock();

    ComPtr<IMFSample> sample;
    if (SUCCEEDED(hr)) hr = MFCreateSample(&sample);
    if (SUCCEEDED(hr)) hr = sample->AddBuffer(buffer.Get());
    if (SUCCEEDED(hr)) hr = sample->SetSampleTime(time100ns);
    if (SUCCEEDED(hr)) hr = sample->SetSampleDuration(std::max<int64_t>(1, duration100ns));
    if (SUCCEEDED(hr)) hr = writer_->WriteSample(streamIndex_, sample.Get());
    if (FAILED(hr)) {
        error = L"Writing the MP4 frame failed: " + HrText(hr);
        return false;
    }
    return true;
}

uint64_t Mp4Writer::CurrentSize() const {
    QWORD length = 0;
    if (stream_) stream_->GetLength(&length);
    return length;
}

bool Mp4Writer::Close(std::wstring* error) {
    const HRESULT result = writer_ ? writer_->Finalize() : S_OK;
    if (FAILED(result) && error) *error = L"Completing the MP4 file failed: " + HrText(result);
    writer_.Reset();
    if (stream_) stream_->Close();
    stream_.Reset();
    if (mfStarted_) {
        MFShutdown();
        mfStarted_ = false;
    }
    width_ = height_ = 0;
    return SUCCEEDED(result);
}

}  // namespace lc
