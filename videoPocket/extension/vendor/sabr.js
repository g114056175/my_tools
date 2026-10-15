// work/googlevideo-main2/dist/core/CompositeBuffer.js
var CompositeBuffer = class _CompositeBuffer {
  chunks;
  currentChunkOffset;
  currentChunkIndex;
  currentDataView;
  totalLength;
  constructor(chunks = []) {
    this.chunks = [];
    this.currentChunkOffset = this.currentChunkIndex = 0;
    this.currentDataView = void 0;
    this.totalLength = 0;
    for (const chunk of chunks)
      this.append(chunk);
  }
  /**
   * Appends a chunk or all chunks from another {@link CompositeBuffer} to this buffer.
   * Chunks using the same `ArrayBuffer` are merged into a single `Uint8Array` to reduce memory usage and keep the number of chunks low.
   * @param data - A `Uint8Array` to append, or another `CompositeBuffer` whose chunks will be appended individually.
   */
  append(data) {
    if (data instanceof Uint8Array) {
      if (this.canMergeWithLastChunk(data)) {
        const lastChunk = this.chunks[this.chunks.length - 1];
        this.chunks[this.chunks.length - 1] = new Uint8Array(lastChunk.buffer, lastChunk.byteOffset, lastChunk.length + data.length);
        this.resetFocus();
      } else
        this.chunks.push(data);
      this.totalLength += data.length;
    } else {
      for (const chunk of data.chunks)
        this.append(chunk);
    }
  }
  /**
   * Splits this buffer at a specified position.
   * @param position - Offset at which to split the buffer.
   * @returns Obj containing the bytes before `position` as `extractedBuffer` and the bytes from `position` onward as `remainingBuffer`.
   */
  split(position) {
    const extractedBuffer = new _CompositeBuffer();
    const remainingBuffer = new _CompositeBuffer();
    for (const chunk of this.chunks) {
      if (position >= chunk.length) {
        extractedBuffer.append(chunk);
        position -= chunk.length;
      } else if (position > 0) {
        extractedBuffer.append(new Uint8Array(chunk.buffer, chunk.byteOffset, position));
        remainingBuffer.append(new Uint8Array(chunk.buffer, chunk.byteOffset + position, chunk.length - position));
        position = 0;
      } else
        remainingBuffer.append(chunk);
    }
    return { extractedBuffer, remainingBuffer };
  }
  getLength() {
    return this.totalLength;
  }
  canReadBytes(position, length) {
    return position + length <= this.totalLength;
  }
  /**
   * Reads a single unsigned byte at the given position.
   */
  getUint8(position) {
    this.focus(position);
    return this.chunks[this.currentChunkIndex][position - this.currentChunkOffset];
  }
  /**
   * Moves the internal focus to the chunk containing the specified position.
   * If the position is before the currently focused chunk, focus is reset first.
   * Cached `currentDataView` is also invalidated.
   */
  focus(position) {
    if (!this.isFocused(position)) {
      for (position < this.currentChunkOffset && this.resetFocus(); this.currentChunkOffset + this.chunks[this.currentChunkIndex].length <= position && this.currentChunkIndex < this.chunks.length; ) {
        this.currentChunkOffset += this.chunks[this.currentChunkIndex].length;
        this.currentChunkIndex += 1;
      }
      this.currentDataView = void 0;
    }
  }
  /**
   * Checks whether the internal focus already covers the specified position.
   * @returns `true` if `position` is within the currently focused chunk.
   */
  isFocused(position) {
    return position >= this.currentChunkOffset && position < this.currentChunkOffset + this.chunks[this.currentChunkIndex].length;
  }
  /**
   * Resets the internal focus to the beginning of the buffer.
   */
  resetFocus() {
    this.currentDataView = void 0;
    this.currentChunkIndex = 0;
    this.currentChunkOffset = 0;
  }
  /**
   * Determines whether the given chunk can be merged with the last chunk.
   * Merging is possible when both reference the same buffer and the
   * new chunk starts exactly where the current last chunk ends.
   */
  canMergeWithLastChunk(chunk) {
    if (this.chunks.length === 0)
      return false;
    const lastChunk = this.chunks[this.chunks.length - 1];
    return lastChunk.buffer === chunk.buffer && lastChunk.byteOffset + lastChunk.length === chunk.byteOffset;
  }
};

// work/googlevideo-main2/dist/core/UmpReader.js
var UmpReader = class {
  callbacks;
  compositeBuffer;
  pendingType;
  pendingOffset;
  pendingTotalSize;
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.compositeBuffer = new CompositeBuffer();
  }
  async feed(chunk) {
    this.compositeBuffer.append(chunk);
    return this.parse();
  }
  async parse() {
    if (this.pendingType !== void 0) {
      if (this.compositeBuffer.totalLength === 0)
        return;
      const needed = this.pendingTotalSize - this.pendingOffset;
      const split = this.compositeBuffer.split(needed);
      if (!this.callbacks.onPartialPart)
        return;
      if (!this.callbacks.onPartialPart(this.pendingType, split.extractedBuffer, this.pendingOffset, this.pendingTotalSize))
        return;
      this.pendingOffset += split.extractedBuffer.totalLength;
      this.compositeBuffer = split.remainingBuffer;
      if (this.pendingOffset === this.pendingTotalSize) {
        this.pendingType = void 0;
        this.pendingTotalSize = void 0;
        this.pendingOffset = void 0;
      }
    }
    while (true) {
      let offset = 0;
      const [partType, newOffset] = this.readVarInt(offset);
      offset = newOffset;
      const [partSize, finalOffset] = this.readVarInt(offset);
      offset = finalOffset;
      if (partType < 0 || partSize < 0)
        break;
      if (!this.compositeBuffer.canReadBytes(offset, partSize)) {
        if (!(this.callbacks.onPartialPart && this.compositeBuffer.canReadBytes(offset, 1)))
          break;
        const remainingBuff = this.compositeBuffer.split(offset).remainingBuffer;
        if (this.callbacks.onPartialPart(partType, remainingBuff, 0, partSize)) {
          this.pendingType = partType;
          this.pendingOffset = remainingBuff.totalLength;
          this.pendingTotalSize = partSize;
          this.compositeBuffer = new CompositeBuffer();
        }
        break;
      }
      const payloadStart = this.compositeBuffer.split(offset).remainingBuffer;
      const finalSplit = payloadStart.split(partSize);
      await this.callbacks.onPart(partType, finalSplit.extractedBuffer);
      this.compositeBuffer = finalSplit.remainingBuffer;
    }
  }
  /**
   * Reads a specific varint from the current buffer offset.
   * @returns [decodedValue, updatedOffset] or [-1, originalOffset] if incomplete.
   */
  readVarInt(offset) {
    if (!this.compositeBuffer.canReadBytes(offset, 1)) {
      return [-1, offset];
    }
    const firstByte = this.compositeBuffer.getUint8(offset);
    const byteLength = firstByte < 128 ? 1 : firstByte < 192 ? 2 : firstByte < 224 ? 3 : firstByte < 240 ? 4 : 5;
    if (!this.compositeBuffer.canReadBytes(offset, byteLength))
      return [-1, offset];
    let value = 0;
    switch (byteLength) {
      case 1: {
        value = this.compositeBuffer.getUint8(offset++);
        break;
      }
      case 2: {
        const b1 = this.compositeBuffer.getUint8(offset++);
        const b2 = this.compositeBuffer.getUint8(offset++);
        value = b1 & 63 | b2 << 6;
        break;
      }
      case 3: {
        const b1 = this.compositeBuffer.getUint8(offset++);
        const b2 = this.compositeBuffer.getUint8(offset++);
        const b3 = this.compositeBuffer.getUint8(offset++);
        value = b1 & 31 | b2 << 5 | b3 << 13;
        break;
      }
      case 4: {
        const b1 = this.compositeBuffer.getUint8(offset++);
        const b2 = this.compositeBuffer.getUint8(offset++);
        const b3 = this.compositeBuffer.getUint8(offset++);
        const b4 = this.compositeBuffer.getUint8(offset++);
        value = b1 & 15 | b2 << 4 | b3 << 12 | b4 << 20;
        break;
      }
      default: {
        const dataOffset = offset + 1;
        this.compositeBuffer.focus(dataOffset);
        if (this.canReadFromCurrentChunk(dataOffset, 4)) {
          const relativeOffset = dataOffset - this.compositeBuffer.currentChunkOffset;
          value = this.getCurrentDataView().getUint32(relativeOffset, true);
        } else {
          const b1 = this.compositeBuffer.getUint8(dataOffset);
          const b2 = this.compositeBuffer.getUint8(dataOffset + 1);
          const b3 = this.compositeBuffer.getUint8(dataOffset + 2);
          const b4 = this.compositeBuffer.getUint8(dataOffset + 3);
          value = (b1 | b2 << 8 | b3 << 16 | b4 << 24) >>> 0;
        }
        offset += 5;
        break;
      }
    }
    return [value, offset];
  }
  /**
   * Checks if the specified bytes can be read from the current chunk.
   * @param offset - Position to start reading from.
   * @param length - Number of bytes to read.
   * @returns True if bytes can be read from current chunk, false otherwise.
   */
  canReadFromCurrentChunk(offset, length) {
    const activeChunk = this.compositeBuffer.chunks[this.compositeBuffer.currentChunkIndex];
    return offset - this.compositeBuffer.currentChunkOffset + length <= activeChunk.length;
  }
  /**
   * Gets a DataView of the current chunk, creating it if necessary.
   * @returns DataView for the current chunk.
   */
  getCurrentDataView() {
    if (!this.compositeBuffer.currentDataView) {
      const currentChunk = this.compositeBuffer.chunks[this.compositeBuffer.currentChunkIndex];
      this.compositeBuffer.currentDataView = new DataView(currentChunk.buffer, currentChunk.byteOffset, currentChunk.length);
    }
    return this.compositeBuffer.currentDataView;
  }
  dispose() {
    this.compositeBuffer = new CompositeBuffer();
  }
};

// work/googlevideo-main2/dist/utils/Logger.js
var LogLevel = {
  NONE: 0,
  0: "NONE",
  ERROR: 1,
  1: "ERROR",
  WARN: 2,
  2: "WARN",
  INFO: 3,
  3: "INFO",
  DEBUG: 4,
  4: "DEBUG",
  ALL: 99,
  99: "ALL"
};
var Logger = class _Logger {
  static instance;
  currentLogLevels = /* @__PURE__ */ new Set([LogLevel.INFO, LogLevel.ERROR]);
  static getInstance() {
    if (!_Logger.instance)
      _Logger.instance = new _Logger();
    return _Logger.instance;
  }
  /**
   * Sets the active log levels.
   * Call with {@link LogLevel.NONE} or no arguments to turn off all logging.
   * Otherwise, specify one or more log levels to be active.
   * Use {@link LogLevel.ALL} to enable all log levels.
   */
  setLogLevels(...levels) {
    if (levels.length === 0 || levels.includes(LogLevel.NONE)) {
      this.currentLogLevels = /* @__PURE__ */ new Set();
    } else if (levels.includes(LogLevel.ALL)) {
      this.currentLogLevels = /* @__PURE__ */ new Set([
        LogLevel.ERROR,
        LogLevel.WARN,
        LogLevel.INFO,
        LogLevel.DEBUG
      ]);
    } else
      this.currentLogLevels = new Set(levels.filter((level) => level !== LogLevel.NONE && level !== LogLevel.ALL));
  }
  /**
   * Gets the current set of active log levels.
   * @returns A new Set containing the active LogLevel enums.
   */
  getLogLevels() {
    return new Set(this.currentLogLevels);
  }
  log(level, tag, ...messages) {
    if (level !== LogLevel.NONE && this.currentLogLevels.has(level)) {
      const prefix = `[${LogLevel[level]}] [${tag}]`;
      switch (level) {
        case LogLevel.ERROR:
          console.error(prefix, ...messages);
          break;
        case LogLevel.WARN:
          console.warn(prefix, ...messages);
          break;
        case LogLevel.INFO:
          console.info(prefix, ...messages);
          break;
        case LogLevel.DEBUG:
          console.debug(prefix, ...messages);
          break;
      }
    }
  }
  error(tag, ...messages) {
    this.log(LogLevel.ERROR, tag, ...messages);
  }
  warn(tag, ...messages) {
    this.log(LogLevel.WARN, tag, ...messages);
  }
  info(tag, ...messages) {
    this.log(LogLevel.INFO, tag, ...messages);
  }
  debug(tag, ...messages) {
    this.log(LogLevel.DEBUG, tag, ...messages);
  }
};

// work/googlevideo-main2/dist/utils/formatUtils.js
var EnabledTrackTypes = {
  VIDEO_AND_AUDIO: 0,
  0: "VIDEO_AND_AUDIO",
  AUDIO_ONLY: 1,
  1: "AUDIO_ONLY",
  VIDEO_ONLY: 2,
  2: "VIDEO_ONLY"
};
function describeMissingFormat(type, formatOption, formats) {
  const available = filterFormatsByType(formats, type === "audio").map((f) => `${f.itag}[qualityLabel=${f.qualityLabel || f.audioQuality || ""}, mimeType=${f.mimeType || ""}, isVb=${f.isVb || false}, isDrc=${f.isDrc || false}]`).join(", ") || "none";
  if (typeof formatOption === "number")
    return `no ${type} format with itag ${formatOption} found (available ${type} formats: ${available})`;
  if (typeof formatOption === "function")
    return `no ${type} format matched the provided selector function (available ${type} formats: ${available})`;
  return `no ${type} format matched the given criteria (available ${type} formats: ${available})`;
}
function chooseFormat(formats, formatOption, preferences) {
  if (!formats.length)
    return void 0;
  const typeFormats = filterFormatsByType(formats, preferences.isAudio);
  if (!typeFormats.length)
    return void 0;
  if (typeof formatOption === "number")
    return typeFormats.find((format) => format.itag === formatOption);
  if (formatOption && typeof formatOption !== "function")
    return formatOption;
  if (typeof formatOption === "function")
    return formatOption(typeFormats);
  let filteredFormats = typeFormats;
  const language = preferences.language;
  if (language && preferences.isAudio)
    filteredFormats = filteredFormats.filter((format) => format.language === language);
  const quality = preferences.quality;
  if (quality !== void 0) {
    filteredFormats = filteredFormats.filter((format) => preferences.isAudio ? !!format.audioQuality?.toLowerCase().includes(quality?.toLowerCase() || "") : !!format.qualityLabel?.toLowerCase().includes(quality?.toLowerCase() || ""));
  }
  const container = preferences.container;
  if (container !== void 0)
    filteredFormats = filteredFormats.filter((format) => format.mimeType?.includes(container));
  const voiceBoost = preferences.voiceBoost;
  if (voiceBoost !== void 0)
    filteredFormats = filteredFormats.filter((format) => format.isVb === voiceBoost);
  const dynamicRangeCompression = preferences.dynamicRangeCompression;
  if (dynamicRangeCompression !== void 0)
    filteredFormats = filteredFormats.filter((format) => format.isDrc === dynamicRangeCompression);
  const superResolution = preferences.superResolution;
  if (superResolution !== void 0)
    filteredFormats = filteredFormats.filter((format) => format.isSr === superResolution);
  return filteredFormats.sort((a, b) => {
    const preferredCodec = preferences.isAudio ? preferences.preferredAudioCodec : preferences.preferredVideoCodec;
    const preferenceDifference = Number(matchesCodec(b, preferredCodec)) - Number(matchesCodec(a, preferredCodec));
    if (preferenceDifference)
      return preferenceDifference;
    return preferences.isAudio ? (b.bitrate || 0) - (a.bitrate || 0) : (b.height || 0) - (a.height || 0);
  })[0];
}
function matchesCodec(format, codec) {
  if (!codec)
    return false;
  const codecMimeTypePrefixes = {
    h264: ["avc1", "avc3"],
    vp9: ["vp9", "vp09"],
    av1: ["av01"],
    aac: ["mp4a"],
    opus: ["opus"]
  };
  return codecMimeTypePrefixes[codec].some((prefix) => format.mimeType?.includes(prefix));
}
function filterFormatsByType(formats, isAudio) {
  return formats.filter((format) => {
    if (!format.mimeType)
      return false;
    return isAudio ? format.mimeType.includes("audio") : format.mimeType.includes("video");
  });
}
function createFormatKey(input) {
  if ("formatId" in input && (input.formatId?.itag !== void 0 || input.formatId?.xtags !== void 0))
    return `${input.formatId?.itag || ""}:${input.formatId?.xtags || ""}`;
  if (("itag" in input || "xtags" in input) && (input.itag !== void 0 || input.xtags !== void 0))
    return `${input.itag || ""}:${input.xtags || ""}`;
  throw new Error("Unsupported format type");
}

// work/googlevideo-main2/dist/utils/mediaTimeUtils.js
function ticksToMs(ticks, timescale, round) {
  return round(ticks / timescale * 1e3);
}
function getDurationMs(mediaHeader) {
  const durationMsFromHeader = Number(mediaHeader.durationMs ?? 0);
  if (Number.isFinite(durationMsFromHeader) && durationMsFromHeader > 0)
    return durationMsFromHeader;
  const durationTicks = Number(mediaHeader.timeRange?.durationTicks ?? 0);
  const timescale = Number(mediaHeader.timeRange?.timescale ?? 0);
  if (durationTicks > 0 && timescale > 0)
    return ticksToMs(durationTicks, timescale, Math.ceil);
  return 0;
}
function getStartMs(mediaHeader) {
  const startMsFromHeader = Number(mediaHeader.startMs ?? 0);
  if (Number.isFinite(startMsFromHeader) && startMsFromHeader > 0)
    return startMsFromHeader;
  const startTicks = Number(mediaHeader.timeRange?.startTicks ?? 0);
  const timescale = Number(mediaHeader.timeRange?.timescale ?? 0);
  if (startTicks > 0 && timescale > 0)
    return ticksToMs(startTicks, timescale, Math.floor);
  return 0;
}

// work/googlevideo-main2/dist/utils/EmsgSegmentMetadata.js
var EMSG_BOX_TYPE = 1701671783;
var textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
function makeBoxReader(data, offset) {
  const size = data.getUint32(offset);
  const type = data.getUint32(offset + 4);
  return { data, offset, size, type, cursor: 8 };
}
function readUint32Field(box) {
  const value = box.data.getUint32(box.offset + box.cursor);
  box.cursor += 4;
  return value;
}
function bytesToString(bytes) {
  if (!bytes.length)
    return "";
  if (textDecoder)
    return textDecoder.decode(bytes);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}
function readString(box, terminator) {
  let end;
  if (terminator === void 0) {
    end = box.size;
  } else {
    end = box.cursor;
    while (end < box.size && box.data.getUint8(box.offset + end) !== terminator) {
      end++;
    }
  }
  const bytes = new Uint8Array(box.data.buffer, box.data.byteOffset + box.offset + box.cursor, end - box.cursor);
  box.cursor = Math.min(end + 1, box.size);
  return bytesToString(bytes);
}
function looksLikeBox(data, offset) {
  if (data.byteLength - offset < 8)
    return false;
  const size = data.getUint32(offset);
  if (size < 8 || data.byteLength - offset < size)
    return false;
  for (let i = 4; i < 8; i++) {
    const byte = data.getUint8(offset + i);
    if (byte < 48 || byte > 122)
      return false;
  }
  return true;
}
function findBox(data, offset, targetType) {
  while (looksLikeBox(data, offset)) {
    const box = makeBoxReader(data, offset);
    if (box.type === targetType)
      return box;
    offset += box.size;
  }
  return null;
}
function parseEmsgBody(box) {
  box.cursor += 4;
  return {
    schemeIdUri: readString(box, 0),
    value: readString(box, 0),
    timescale: readUint32Field(box),
    presentationTimeDelta: readUint32Field(box),
    eventDuration: readUint32Field(box),
    id: readUint32Field(box),
    messageData: readString(box)
  };
}
function parseHeaderBlock(text) {
  const lines = text.split("\r\n");
  const headers = {};
  for (const line of lines) {
    if (line.length === 0)
      return headers;
    const match = line.match(/([^:]+):\s+([\S\s]+)/);
    if (match)
      headers[match[1]] = match[2];
  }
  return null;
}
function getNumber(headers, key) {
  return Number(headers[key]) || 0;
}
var EmsgSegmentMetadata = class {
  data;
  uri;
  receivedAtMs = Date.now();
  segmentNumber;
  totalSegmentCount;
  segmentDurationsMs;
  ingestionTimeSec;
  ingestionUncertaintySec;
  safeFirstFrameTimeSec;
  targetDurationSec;
  cryptoPeriodIndex;
  cryptoPeriodSeconds;
  currentAbsoluteLoudnessLkfs;
  constructor(data, uri = "https://youtube.com") {
    this.data = data;
    this.uri = uri;
    this.segmentNumber = getNumber(this.data, "Sequence-Number");
    this.totalSegmentCount = getNumber(this.data, "Segment-Count");
    this.segmentDurationsMs = this.data["Segment-Durations-Ms"] || "";
    this.ingestionTimeSec = getNumber(this.data, "Ingestion-Walltime-Us") / 1e6;
    this.ingestionUncertaintySec = getNumber(this.data, "Ingestion-Uncertainty-Us") / 1e6;
    this.safeFirstFrameTimeSec = (getNumber(this.data, "First-Frame-Time-Us") + getNumber(this.data, "First-Frame-Uncertainty-Us")) / 1e6;
    this.targetDurationSec = getNumber(this.data, "Target-Duration-Us") / 1e6;
    this.cryptoPeriodIndex = getNumber(this.data, "Crypto-Period-Index");
    this.cryptoPeriodSeconds = getNumber(this.data, "Crypto-Period-Seconds");
    this.currentAbsoluteLoudnessLkfs = "Current-Absolute-Loudness-Lkfs" in this.data ? getNumber(this.data, "Current-Absolute-Loudness-Lkfs") : null;
  }
  get latencyMs() {
    const ingestionTimeMs = this.ingestionTimeSec * 1e3;
    const uncertaintyMs = this.ingestionUncertaintySec * 1e3;
    return Math.max(0, this.receivedAtMs - ingestionTimeMs + uncertaintyMs);
  }
  getStitchedCPNs() {
    return this.data["Stitched-Video-Cpn"] ? this.data["Stitched-Video-Cpn"].split(",").slice(0, -1) : [];
  }
  hasStitchedAdBreakMetadata() {
    return !!(this.data["Stitched-Video-Id"] || this.data["Stitched-Video-Cpn"] || this.data["Stitched-Video-Duration-Us"] || this.data["Stitched-Video-Start-Frame-Index"] || this.data["Stitched-Video-Absolute-Loudness-Lkfs"] || this.data["Serialized-State"] || this.data["Is-Ad-Break-Finished"]);
  }
};

// work/googlevideo-main2/dist/utils/mediaSegmentUtils.js
function stripMp4Init(segment) {
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  let offset = 0;
  while (offset < segment.length - 8) {
    let size = view.getUint32(offset, false);
    const type = String.fromCharCode(segment[offset + 4], segment[offset + 5], segment[offset + 6], segment[offset + 7]);
    if (type === "moof" || type === "mdat")
      return segment.subarray(offset);
    if (size === 1) {
      if (offset + 16 > segment.length)
        break;
      size = Number(view.getBigUint64(offset + 8, false));
    } else if (size === 0)
      break;
    offset += size;
  }
  return segment;
}
function stripWebmInit(segment) {
  let offset = 0;
  while (offset < segment.length) {
    let firstByte = segment[offset];
    let idLength = 1;
    let mask = 128;
    while (idLength <= 4 && !(firstByte & mask)) {
      idLength++;
      mask >>= 1;
    }
    if (idLength > 4 || offset + idLength >= segment.length)
      break;
    let id = 0;
    for (let i = 0; i < idLength; i++)
      id = id * 256 + segment[offset + i];
    if (id === 524531317)
      return segment.subarray(offset);
    offset += idLength;
    firstByte = segment[offset];
    let sizeLength = 1;
    mask = 128;
    while (sizeLength <= 8 && !(firstByte & mask)) {
      sizeLength++;
      mask >>= 1;
    }
    if (sizeLength > 8 || offset + sizeLength > segment.length)
      break;
    let size = firstByte & ~mask;
    let isUnknown = firstByte === (mask | mask - 1);
    for (let i = 1; i < sizeLength; i++) {
      const b = segment[offset + i];
      size = size * 256 + b;
      if (b !== 255)
        isUnknown = false;
    }
    offset += sizeLength;
    if (id === 408125543)
      continue;
    if (isUnknown)
      break;
    offset += size;
  }
  return segment;
}
function parseEmsgSegmentMetadata(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const firstBox = findBox(view, 0, EMSG_BOX_TYPE);
  if (!firstBox)
    return;
  const firstBody = parseEmsgBody(firstBox);
  let headers = parseHeaderBlock(firstBody.messageData);
  const secondBox = findBox(view, firstBox.offset + firstBox.size, EMSG_BOX_TYPE);
  if (secondBox) {
    const secondBody = parseEmsgBody(secondBox);
    const secondHeaders = parseHeaderBlock(secondBody.messageData);
    if (headers && secondHeaders)
      headers = { ...headers, ...secondHeaders };
  }
  if (headers)
    return new EmsgSegmentMetadata(headers, firstBody.schemeIdUri);
}

// work/googlevideo-main2/dist/utils/uint8arrayUtils.js
function base64ToU8(base64) {
  const standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = standardBase64.padEnd(standardBase64.length + (4 - standardBase64.length % 4) % 4, "=");
  return new Uint8Array(atob(paddedBase64).split("").map((char) => char.charCodeAt(0)));
}
function concatenateChunks(chunks) {
  const chunkCount = chunks.length;
  let totalLength = 0;
  for (let i = 0; i < chunkCount; i++)
    totalLength += chunks[i].length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunkCount; i++) {
    const chunk = chunks[i];
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
function decodePart(chunks, decoder) {
  if (!chunks.length)
    return void 0;
  try {
    return decoder.decode(concatenateChunks(chunks));
  } catch {
    return void 0;
  }
}

// work/googlevideo-main2/dist/utils/SabrSegmentBuffer.js
var TAG = "SabrSegmentBuffer";
var SabrSegmentBuffer = class {
  trackMetadata;
  isLive;
  stripDuplicateInit;
  logger = Logger.getInstance();
  pendingSegments = /* @__PURE__ */ new Map();
  constructor(trackMetadata, isLive, stripDuplicateInit = true) {
    this.trackMetadata = trackMetadata;
    this.isLive = isLive;
    this.stripDuplicateInit = stripDuplicateInit;
  }
  reset() {
    this.trackMetadata.initializedTracksMap.clear();
    this.pendingSegments.clear();
  }
  queueMediaHeader(mediaHeader) {
    const headerId = mediaHeader.headerId ?? 0;
    const formatKey = createFormatKey(mediaHeader);
    const track = this.trackMetadata.initializedTracksMap.get(formatKey);
    if (!track) {
      this.logger.warn(TAG, `No track found: formatKey=${formatKey}, headerId=${headerId}`);
      return;
    }
    const segmentNumber = mediaHeader.isInitializationSegment ? 0 : mediaHeader.segmentNum;
    if (track.trackedSegments.has(segmentNumber)) {
      this.logger.debug(TAG, `Ignoring recently downloaded segment: formatKey=${formatKey}, segmentNumber=${segmentNumber}`);
      return;
    }
    this.pendingSegments.set(headerId, {
      formatKey,
      segmentNumber,
      mediaHeader,
      startTimeMs: getStartMs(mediaHeader),
      durationMs: getDurationMs(mediaHeader),
      bufferedChunks: [],
      type: track.type
    });
  }
  appendMediaData(headerId, chunks) {
    const pendingSegment = this.pendingSegments.get(headerId);
    if (!pendingSegment) {
      this.logger.debug(TAG, `Received MEDIA for unknown header id ${headerId}`);
      return;
    }
    pendingSegment.bufferedChunks.push(...chunks);
  }
  finalizeSegment(headerId) {
    const pendingSegment = this.pendingSegments.get(headerId);
    if (!pendingSegment) {
      this.logger.debug(TAG, `Received MEDIA_END for unknown header id ${headerId}`);
      return false;
    }
    const track = this.trackMetadata.getInitializedTrack(pendingSegment.formatKey);
    if (!track) {
      this.pendingSegments.delete(headerId);
      return false;
    }
    const bufferedChunks = pendingSegment.bufferedChunks;
    let loadedBytes = 0;
    for (let i = 0; i < bufferedChunks.length; i++)
      loadedBytes += bufferedChunks[i].length;
    const expectedLengthBytes = parseInt(pendingSegment.mediaHeader.segmentLengthBytes || "0");
    if (expectedLengthBytes > 0 && loadedBytes !== expectedLengthBytes) {
      this.logger.warn(TAG, `Ignoring partial segment ${pendingSegment.segmentNumber} for ${pendingSegment.formatKey}.
expected=${expectedLengthBytes}, received=${loadedBytes}`);
      this.pendingSegments.delete(headerId);
      return false;
    }
    let segment = concatenateChunks(bufferedChunks);
    const emsgMetadata = parseEmsgSegmentMetadata(segment);
    if (this.isLive && this.stripDuplicateInit && track.trackedSegments.size !== 0)
      segment = track.mimeType?.includes("webm") ? stripWebmInit(segment) : stripMp4Init(segment);
    if (track.streamLocked || track.streamDesiredSize > 0)
      track.streamController.enqueue(segment);
    track.recordCompletedSegment(pendingSegment, emsgMetadata);
    this.pendingSegments.delete(headerId);
    return !pendingSegment.mediaHeader.isInitializationSegment;
  }
};

// work/googlevideo-main2/dist/utils/EventEmitterLike.js
var EventEmitterLike = class {
  listeners = /* @__PURE__ */ new Map();
  onceWrappers = /* @__PURE__ */ new Map();
  emit(type, ...args) {
    const listeners = this.listeners.get(type);
    if (!listeners || listeners.size === 0)
      return;
    for (const listener of [...listeners])
      listener(...args);
  }
  on(type, listener) {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = /* @__PURE__ */ new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }
  once(type, listener) {
    const wrapper = (...args) => {
      this.off(type, listener);
      listener(...args);
    };
    let wrappersByType = this.onceWrappers.get(listener);
    if (!wrappersByType) {
      wrappersByType = /* @__PURE__ */ new Map();
      this.onceWrappers.set(listener, wrappersByType);
    }
    wrappersByType.set(type, wrapper);
    this.on(type, wrapper);
  }
  off(type, listener) {
    const listeners = this.listeners.get(type);
    if (!listeners)
      return;
    let target = listener;
    const wrappersByType = this.onceWrappers.get(listener);
    if (wrappersByType) {
      const onceWrapper = wrappersByType.get(type);
      if (onceWrapper) {
        target = onceWrapper;
        wrappersByType.delete(type);
        if (wrappersByType.size === 0)
          this.onceWrappers.delete(listener);
      }
    }
    listeners.delete(target);
    if (listeners.size === 0)
      this.listeners.delete(type);
  }
  removeAllListeners(type) {
    if (!type) {
      this.listeners.clear();
      this.onceWrappers.clear();
      return;
    }
    this.listeners.delete(type);
    for (const [listener, wrappersByType] of this.onceWrappers.entries()) {
      wrappersByType.delete(type);
      if (wrappersByType.size === 0)
        this.onceWrappers.delete(listener);
    }
  }
};

// work/googlevideo-main2/dist/utils/misc.js
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function assert(condition, msg) {
  if (!condition)
    throw new Error(msg);
}
function assertIsDefined(val, msg) {
  if (val === void 0 || val === null)
    throw new Error(msg ?? `Expected value to be defined, but got ${val}`);
}
function getMediaType(input) {
  return input.mimeType?.includes("audio") ? "audio" : "video";
}

// work/googlevideo-main2/node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js
function varint64read() {
  let lowBits = 0;
  let highBits = 0;
  for (let shift = 0; shift < 28; shift += 7) {
    let b = this.buf[this.pos++];
    lowBits |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.assertBounds();
      return [lowBits, highBits];
    }
  }
  let middleByte = this.buf[this.pos++];
  lowBits |= (middleByte & 15) << 28;
  highBits = (middleByte & 112) >> 4;
  if ((middleByte & 128) == 0) {
    this.assertBounds();
    return [lowBits, highBits];
  }
  for (let shift = 3; shift <= 31; shift += 7) {
    let b = this.buf[this.pos++];
    highBits |= (b & 127) << shift;
    if ((b & 128) == 0) {
      this.assertBounds();
      return [lowBits, highBits];
    }
  }
  throw new Error("invalid varint");
}
function varint64write(lo, hi, bytes) {
  for (let i = 0; i < 28; i = i + 7) {
    const shift = lo >>> i;
    const hasNext = !(shift >>> 7 == 0 && hi == 0);
    const byte = (hasNext ? shift | 128 : shift) & 255;
    bytes.push(byte);
    if (!hasNext) {
      return;
    }
  }
  const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
  const hasMoreBits = !(hi >> 3 == 0);
  bytes.push((hasMoreBits ? splitBits | 128 : splitBits) & 255);
  if (!hasMoreBits) {
    return;
  }
  for (let i = 3; i < 31; i = i + 7) {
    const shift = hi >>> i;
    const hasNext = !(shift >>> 7 == 0);
    const byte = (hasNext ? shift | 128 : shift) & 255;
    bytes.push(byte);
    if (!hasNext) {
      return;
    }
  }
  bytes.push(hi >>> 31 & 1);
}
var TWO_PWR_32_DBL = 4294967296;
function int64FromString(dec) {
  const minus = dec[0] === "-";
  if (minus) {
    dec = dec.slice(1);
  }
  const base = 1e6;
  let lowBits = 0;
  let highBits = 0;
  function add1e6digit(begin, end) {
    const digit1e6 = Number(dec.slice(begin, end));
    highBits *= base;
    lowBits = lowBits * base + digit1e6;
    if (lowBits >= TWO_PWR_32_DBL) {
      highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
      lowBits = lowBits % TWO_PWR_32_DBL;
    }
  }
  add1e6digit(-24, -18);
  add1e6digit(-18, -12);
  add1e6digit(-12, -6);
  add1e6digit(-6);
  return minus ? negate(lowBits, highBits) : newBits(lowBits, highBits);
}
function int64ToString(lo, hi) {
  let bits = newBits(lo, hi);
  const negative = bits.hi & 2147483648;
  if (negative) {
    bits = negate(bits.lo, bits.hi);
  }
  const result = uInt64ToString(bits.lo, bits.hi);
  return negative ? "-" + result : result;
}
function uInt64ToString(lo, hi) {
  ({ lo, hi } = toUnsigned(lo, hi));
  if (hi <= 2097151) {
    return String(TWO_PWR_32_DBL * hi + lo);
  }
  const low = lo & 16777215;
  const mid = (lo >>> 24 | hi << 8) & 16777215;
  const high = hi >> 16 & 65535;
  let digitA = low + mid * 6777216 + high * 6710656;
  let digitB = mid + high * 8147497;
  let digitC = high * 2;
  const base = 1e7;
  if (digitA >= base) {
    digitB += Math.floor(digitA / base);
    digitA %= base;
  }
  if (digitB >= base) {
    digitC += Math.floor(digitB / base);
    digitB %= base;
  }
  return digitC.toString() + decimalFrom1e7WithLeadingZeros(digitB) + decimalFrom1e7WithLeadingZeros(digitA);
}
function toUnsigned(lo, hi) {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}
function newBits(lo, hi) {
  return { lo: lo | 0, hi: hi | 0 };
}
function negate(lowBits, highBits) {
  highBits = ~highBits;
  if (lowBits) {
    lowBits = ~lowBits + 1;
  } else {
    highBits += 1;
  }
  return newBits(lowBits, highBits);
}
var decimalFrom1e7WithLeadingZeros = (digit1e7) => {
  const partial = String(digit1e7);
  return "0000000".slice(partial.length) + partial;
};
function varint32write(value, bytes) {
  if (value >= 0) {
    while (value > 127) {
      bytes.push(value & 127 | 128);
      value = value >>> 7;
    }
    bytes.push(value);
  } else {
    for (let i = 0; i < 9; i++) {
      bytes.push(value & 127 | 128);
      value = value >> 7;
    }
    bytes.push(1);
  }
}
function varint32read() {
  let b = this.buf[this.pos++];
  let result = b & 127;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 7;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 14;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 127) << 21;
  if ((b & 128) == 0) {
    this.assertBounds();
    return result;
  }
  b = this.buf[this.pos++];
  result |= (b & 15) << 28;
  for (let readBytes = 5; (b & 128) !== 0 && readBytes < 10; readBytes++)
    b = this.buf[this.pos++];
  if ((b & 128) != 0)
    throw new Error("invalid varint");
  this.assertBounds();
  return result >>> 0;
}

// work/googlevideo-main2/node_modules/@bufbuild/protobuf/dist/esm/proto-int64.js
var protoInt64 = /* @__PURE__ */ makeInt64Support();
function makeInt64Support() {
  const dv = new DataView(new ArrayBuffer(8));
  const ok = typeof BigInt === "function" && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function" && (typeof process != "object" || typeof process.env != "object" || process.env.BUF_BIGINT_DISABLE !== "1");
  if (ok) {
    const MIN = BigInt("-9223372036854775808");
    const MAX = BigInt("9223372036854775807");
    const UMIN = BigInt("0");
    const UMAX = BigInt("18446744073709551615");
    return {
      zero: BigInt(0),
      supported: true,
      parse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > MAX || bi < MIN) {
          throw new Error(`invalid int64: ${value}`);
        }
        return bi;
      },
      uParse(value) {
        const bi = typeof value == "bigint" ? value : BigInt(value);
        if (bi > UMAX || bi < UMIN) {
          throw new Error(`invalid uint64: ${value}`);
        }
        return bi;
      },
      enc(value) {
        dv.setBigInt64(0, this.parse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      uEnc(value) {
        dv.setBigInt64(0, this.uParse(value), true);
        return {
          lo: dv.getInt32(0, true),
          hi: dv.getInt32(4, true)
        };
      },
      dec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigInt64(0, true);
      },
      uDec(lo, hi) {
        dv.setInt32(0, lo, true);
        dv.setInt32(4, hi, true);
        return dv.getBigUint64(0, true);
      }
    };
  }
  return {
    zero: "0",
    supported: false,
    parse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return value;
    },
    uParse(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return value;
    },
    enc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertInt64String(value);
      return int64FromString(value);
    },
    uEnc(value) {
      if (typeof value != "string") {
        value = value.toString();
      }
      assertUInt64String(value);
      return int64FromString(value);
    },
    dec(lo, hi) {
      return int64ToString(lo, hi);
    },
    uDec(lo, hi) {
      return uInt64ToString(lo, hi);
    }
  };
}
function assertInt64String(value) {
  if (!/^-?[0-9]+$/.test(value)) {
    throw new Error("invalid int64: " + value);
  }
}
function assertUInt64String(value) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("invalid uint64: " + value);
  }
}

// work/googlevideo-main2/node_modules/@bufbuild/protobuf/dist/esm/wire/text-encoding.js
var symbol = /* @__PURE__ */ Symbol.for("@bufbuild/protobuf/text-encoding");
function getTextEncoding() {
  if (globalThis[symbol] == void 0) {
    const te = new globalThis.TextEncoder();
    const td = new globalThis.TextDecoder();
    globalThis[symbol] = {
      encodeUtf8(text) {
        return te.encode(text);
      },
      decodeUtf8(bytes) {
        return td.decode(bytes);
      },
      checkUtf8(text) {
        try {
          encodeURIComponent(text);
          return true;
        } catch (_) {
          return false;
        }
      }
    };
  }
  return globalThis[symbol];
}

// work/googlevideo-main2/node_modules/@bufbuild/protobuf/dist/esm/wire/binary-encoding.js
var WireType;
(function(WireType2) {
  WireType2[WireType2["Varint"] = 0] = "Varint";
  WireType2[WireType2["Bit64"] = 1] = "Bit64";
  WireType2[WireType2["LengthDelimited"] = 2] = "LengthDelimited";
  WireType2[WireType2["StartGroup"] = 3] = "StartGroup";
  WireType2[WireType2["EndGroup"] = 4] = "EndGroup";
  WireType2[WireType2["Bit32"] = 5] = "Bit32";
})(WireType || (WireType = {}));
var FLOAT32_MAX = 34028234663852886e22;
var FLOAT32_MIN = -34028234663852886e22;
var UINT32_MAX = 4294967295;
var INT32_MAX = 2147483647;
var INT32_MIN = -2147483648;
var BinaryWriter = class {
  constructor(encodeUtf8 = getTextEncoding().encodeUtf8) {
    this.encodeUtf8 = encodeUtf8;
    this.stack = [];
    this.chunks = [];
    this.buf = [];
  }
  /**
   * Return all bytes written and reset this writer.
   */
  finish() {
    if (this.buf.length) {
      this.chunks.push(new Uint8Array(this.buf));
      this.buf = [];
    }
    let len = 0;
    for (let i = 0; i < this.chunks.length; i++)
      len += this.chunks[i].length;
    let bytes = new Uint8Array(len);
    let offset = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      bytes.set(this.chunks[i], offset);
      offset += this.chunks[i].length;
    }
    this.chunks = [];
    return bytes;
  }
  /**
   * Start a new fork for length-delimited data like a message
   * or a packed repeated field.
   *
   * Must be joined later with `join()`.
   */
  fork() {
    this.stack.push({ chunks: this.chunks, buf: this.buf });
    this.chunks = [];
    this.buf = [];
    return this;
  }
  /**
   * Join the last fork. Write its length and bytes, then
   * return to the previous state.
   */
  join() {
    let chunk = this.finish();
    let prev = this.stack.pop();
    if (!prev)
      throw new Error("invalid state, fork stack empty");
    this.chunks = prev.chunks;
    this.buf = prev.buf;
    this.uint32(chunk.byteLength);
    return this.raw(chunk);
  }
  /**
   * Writes a tag (field number and wire type).
   *
   * Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
   *
   * Generated code should compute the tag ahead of time and call `uint32()`.
   */
  tag(fieldNo, type) {
    return this.uint32((fieldNo << 3 | type) >>> 0);
  }
  /**
   * Write a chunk of raw bytes.
   */
  raw(chunk) {
    if (this.buf.length) {
      this.chunks.push(new Uint8Array(this.buf));
      this.buf = [];
    }
    this.chunks.push(chunk);
    return this;
  }
  /**
   * Write a `uint32` value, an unsigned 32 bit varint.
   */
  uint32(value) {
    assertUInt32(value);
    while (value > 127) {
      this.buf.push(value & 127 | 128);
      value = value >>> 7;
    }
    this.buf.push(value);
    return this;
  }
  /**
   * Write a `int32` value, a signed 32 bit varint.
   */
  int32(value) {
    assertInt32(value);
    varint32write(value, this.buf);
    return this;
  }
  /**
   * Write a `bool` value, a variant.
   */
  bool(value) {
    this.buf.push(value ? 1 : 0);
    return this;
  }
  /**
   * Write a `bytes` value, length-delimited arbitrary data.
   */
  bytes(value) {
    this.uint32(value.byteLength);
    return this.raw(value);
  }
  /**
   * Write a `string` value, length-delimited data converted to UTF-8 text.
   */
  string(value) {
    let chunk = this.encodeUtf8(value);
    this.uint32(chunk.byteLength);
    return this.raw(chunk);
  }
  /**
   * Write a `float` value, 32-bit floating point number.
   */
  float(value) {
    assertFloat32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setFloat32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `double` value, a 64-bit floating point number.
   */
  double(value) {
    let chunk = new Uint8Array(8);
    new DataView(chunk.buffer).setFloat64(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
   */
  fixed32(value) {
    assertUInt32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setUint32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
   */
  sfixed32(value) {
    assertInt32(value);
    let chunk = new Uint8Array(4);
    new DataView(chunk.buffer).setInt32(0, value, true);
    return this.raw(chunk);
  }
  /**
   * Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
   */
  sint32(value) {
    assertInt32(value);
    value = (value << 1 ^ value >> 31) >>> 0;
    varint32write(value, this.buf);
    return this;
  }
  /**
   * Write a `fixed64` value, a signed, fixed-length 64-bit integer.
   */
  sfixed64(value) {
    let chunk = new Uint8Array(8), view = new DataView(chunk.buffer), tc = protoInt64.enc(value);
    view.setInt32(0, tc.lo, true);
    view.setInt32(4, tc.hi, true);
    return this.raw(chunk);
  }
  /**
   * Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
   */
  fixed64(value) {
    let chunk = new Uint8Array(8), view = new DataView(chunk.buffer), tc = protoInt64.uEnc(value);
    view.setInt32(0, tc.lo, true);
    view.setInt32(4, tc.hi, true);
    return this.raw(chunk);
  }
  /**
   * Write a `int64` value, a signed 64-bit varint.
   */
  int64(value) {
    let tc = protoInt64.enc(value);
    varint64write(tc.lo, tc.hi, this.buf);
    return this;
  }
  /**
   * Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64(value) {
    const tc = protoInt64.enc(value), sign = tc.hi >> 31, lo = tc.lo << 1 ^ sign, hi = (tc.hi << 1 | tc.lo >>> 31) ^ sign;
    varint64write(lo, hi, this.buf);
    return this;
  }
  /**
   * Write a `uint64` value, an unsigned 64-bit varint.
   */
  uint64(value) {
    const tc = protoInt64.uEnc(value);
    varint64write(tc.lo, tc.hi, this.buf);
    return this;
  }
};
var BinaryReader = class {
  constructor(buf, decodeUtf8 = getTextEncoding().decodeUtf8) {
    this.decodeUtf8 = decodeUtf8;
    this.varint64 = varint64read;
    this.uint32 = varint32read;
    this.buf = buf;
    this.len = buf.length;
    this.pos = 0;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  /**
   * Reads a tag - field number and wire type.
   */
  tag() {
    let tag = this.uint32(), fieldNo = tag >>> 3, wireType = tag & 7;
    if (fieldNo <= 0 || wireType < 0 || wireType > 5)
      throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
    return [fieldNo, wireType];
  }
  /**
   * Skip one element and return the skipped data.
   *
   * When skipping StartGroup, provide the tags field number to check for
   * matching field number in the EndGroup tag.
   */
  skip(wireType, fieldNo) {
    let start = this.pos;
    switch (wireType) {
      case WireType.Varint:
        while (this.buf[this.pos++] & 128) {
        }
        break;
      // @ts-expect-error TS7029: Fallthrough case in switch
      case WireType.Bit64:
        this.pos += 4;
      case WireType.Bit32:
        this.pos += 4;
        break;
      case WireType.LengthDelimited:
        let len = this.uint32();
        this.pos += len;
        break;
      case WireType.StartGroup:
        for (; ; ) {
          const [fn, wt] = this.tag();
          if (wt === WireType.EndGroup) {
            if (fieldNo !== void 0 && fn !== fieldNo) {
              throw new Error("invalid end group tag");
            }
            break;
          }
          this.skip(wt, fn);
        }
        break;
      default:
        throw new Error("cant skip wire type " + wireType);
    }
    this.assertBounds();
    return this.buf.subarray(start, this.pos);
  }
  /**
   * Throws error if position in byte array is out of range.
   */
  assertBounds() {
    if (this.pos > this.len)
      throw new RangeError("premature EOF");
  }
  /**
   * Read a `int32` field, a signed 32 bit varint.
   */
  int32() {
    return this.uint32() | 0;
  }
  /**
   * Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
   */
  sint32() {
    let zze = this.uint32();
    return zze >>> 1 ^ -(zze & 1);
  }
  /**
   * Read a `int64` field, a signed 64-bit varint.
   */
  int64() {
    return protoInt64.dec(...this.varint64());
  }
  /**
   * Read a `uint64` field, an unsigned 64-bit varint.
   */
  uint64() {
    return protoInt64.uDec(...this.varint64());
  }
  /**
   * Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
   */
  sint64() {
    let [lo, hi] = this.varint64();
    let s = -(lo & 1);
    lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
    hi = hi >>> 1 ^ s;
    return protoInt64.dec(lo, hi);
  }
  /**
   * Read a `bool` field, a variant.
   */
  bool() {
    let [lo, hi] = this.varint64();
    return lo !== 0 || hi !== 0;
  }
  /**
   * Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
   */
  fixed32() {
    return this.view.getUint32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
   */
  sfixed32() {
    return this.view.getInt32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
   */
  fixed64() {
    return protoInt64.uDec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `fixed64` field, a signed, fixed-length 64-bit integer.
   */
  sfixed64() {
    return protoInt64.dec(this.sfixed32(), this.sfixed32());
  }
  /**
   * Read a `float` field, 32-bit floating point number.
   */
  float() {
    return this.view.getFloat32((this.pos += 4) - 4, true);
  }
  /**
   * Read a `double` field, a 64-bit floating point number.
   */
  double() {
    return this.view.getFloat64((this.pos += 8) - 8, true);
  }
  /**
   * Read a `bytes` field, length-delimited arbitrary data.
   */
  bytes() {
    let len = this.uint32(), start = this.pos;
    this.pos += len;
    this.assertBounds();
    return this.buf.subarray(start, start + len);
  }
  /**
   * Read a `string` field, length-delimited data converted to UTF-8 text.
   */
  string() {
    return this.decodeUtf8(this.bytes());
  }
};
function assertInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid int32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN)
    throw new Error("invalid int32: " + arg);
}
function assertUInt32(arg) {
  if (typeof arg == "string") {
    arg = Number(arg);
  } else if (typeof arg != "number") {
    throw new Error("invalid uint32: " + typeof arg);
  }
  if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0)
    throw new Error("invalid uint32: " + arg);
}
function assertFloat32(arg) {
  if (typeof arg == "string") {
    const o = arg;
    arg = Number(arg);
    if (Number.isNaN(arg) && o !== "NaN") {
      throw new Error("invalid float32: " + o);
    }
  } else if (typeof arg != "number") {
    throw new Error("invalid float32: " + typeof arg);
  }
  if (Number.isFinite(arg) && (arg > FLOAT32_MAX || arg < FLOAT32_MIN))
    throw new Error("invalid float32: " + arg);
}

// work/googlevideo-main2/protos/generated/misc/common.js
var SeekSource = {
  UNKNOWN: 0,
  0: "UNKNOWN",
  TIMESTAMP_IN_COMMENTS: 1,
  1: "TIMESTAMP_IN_COMMENTS",
  TIMESTAMP_IN_DESCRIPTION: 2,
  2: "TIMESTAMP_IN_DESCRIPTION",
  MACRO_MARKER_LIST_ITEM: 3,
  3: "MACRO_MARKER_LIST_ITEM",
  DOUBLE_TAP_TO_SEEK: 4,
  4: "DOUBLE_TAP_TO_SEEK",
  DOUBLE_TAP_TO_SKIP_CHAPTER: 5,
  5: "DOUBLE_TAP_TO_SKIP_CHAPTER",
  PICK_UP_PLAY_HEAD: 6,
  6: "PICK_UP_PLAY_HEAD",
  SLIDE_ON_SCRUBBER_BAR: 7,
  7: "SLIDE_ON_SCRUBBER_BAR",
  SLIDE_ON_PLAYER: 8,
  8: "SLIDE_ON_PLAYER",
  SABR_PARTIAL_CHUNK: 9,
  9: "SABR_PARTIAL_CHUNK",
  SABR_SEEK_TO_HEAD: 10,
  10: "SABR_SEEK_TO_HEAD",
  SABR_LIVE_DVR_USER_SEEK: 11,
  11: "SABR_LIVE_DVR_USER_SEEK",
  SABR_SEEK_TO_DVR_LOWER_BOUND: 12,
  12: "SABR_SEEK_TO_DVR_LOWER_BOUND",
  SABR_SEEK_TO_DVR_UPPER_BOUND: 13,
  13: "SABR_SEEK_TO_DVR_UPPER_BOUND",
  SSDAI_INTERNAL: 14,
  14: "SSDAI_INTERNAL",
  START_PLAYBACK: 15,
  15: "START_PLAYBACK",
  SABR_ACCURATE_SEEK: 17,
  17: "SABR_ACCURATE_SEEK",
  START_PLAYBACK_SEEK_TO_END: 18,
  18: "START_PLAYBACK_SEEK_TO_END",
  IOS_PLAYER_REMOVED_SEGMENTS: 19,
  19: "IOS_PLAYER_REMOVED_SEGMENTS",
  IOS_PLAYER_SEGMENT_LIST: 20,
  20: "IOS_PLAYER_SEGMENT_LIST",
  IOS_PLAYER_ITEM_SEEK: 21,
  21: "IOS_PLAYER_ITEM_SEEK",
  IOS_PLAYER_ITEM_SEEK_TO_END: 22,
  22: "IOS_PLAYER_ITEM_SEEK_TO_END",
  IOS_PLAYER_SEEK_TO_END_TO_RESYNC: 23,
  23: "IOS_PLAYER_SEEK_TO_END_TO_RESYNC",
  IOS_SEEK_ACCESSIBILITY_BUTTON: 24,
  24: "IOS_SEEK_ACCESSIBILITY_BUTTON",
  FINE_SCRUBBER_SLIDE_ON_FILMSTRIP: 25,
  25: "FINE_SCRUBBER_SLIDE_ON_FILMSTRIP",
  FINE_SCRUBBER_TAP_ON_FILMSTRIP: 26,
  26: "FINE_SCRUBBER_TAP_ON_FILMSTRIP",
  FINE_SCRUBBER_SLIDE_ON_SCRUBBER_BAR: 27,
  27: "FINE_SCRUBBER_SLIDE_ON_SCRUBBER_BAR",
  SEEK_BUTTON_ON_PLAYER_CONTROL: 28,
  28: "SEEK_BUTTON_ON_PLAYER_CONTROL",
  SABR_INGESTION_WALL_TIME_SEEK: 29,
  29: "SABR_INGESTION_WALL_TIME_SEEK",
  PLAYER_VIEW_REPARENT_INTERNAL: 30,
  30: "PLAYER_VIEW_REPARENT_INTERNAL",
  PRESS_REWIND_PLAY_BACK_CONTROL: 31,
  31: "PRESS_REWIND_PLAY_BACK_CONTROL",
  PRESS_FAST_FORWARD_PLAY_BACK_CONTROL: 32,
  32: "PRESS_FAST_FORWARD_PLAY_BACK_CONTROL",
  PRESS_LIVE_SYNC_ICON: 33,
  33: "PRESS_LIVE_SYNC_ICON",
  PEG_TO_LIVE: 34,
  34: "PEG_TO_LIVE",
  ANDROID_MEDIA_SESSION: 35,
  35: "ANDROID_MEDIA_SESSION",
  TAP_ON_REPLAY_ACTION: 36,
  36: "TAP_ON_REPLAY_ACTION",
  AUTOMATIC_REPLAY_ACTION: 37,
  37: "AUTOMATIC_REPLAY_ACTION",
  NON_USER_SEEK_TO_PREVIOUS: 38,
  38: "NON_USER_SEEK_TO_PREVIOUS",
  NON_USER_SEEK_TO_NEXT: 39,
  39: "NON_USER_SEEK_TO_NEXT",
  HIGHLIGHTS_TAP_PREVIOUS_PLAY: 66,
  66: "HIGHLIGHTS_TAP_PREVIOUS_PLAY",
  HIGHLIGHTS_TAP_NEXT_PLAY: 40,
  40: "HIGHLIGHTS_TAP_NEXT_PLAY",
  HIGHLIGHTS_TAP_HIDDEN_NEXT_PLAY: 41,
  41: "HIGHLIGHTS_TAP_HIDDEN_NEXT_PLAY",
  HIGHLIGHTS_TAP_LIST_ITEM: 42,
  42: "HIGHLIGHTS_TAP_LIST_ITEM",
  HIGHLIGHTS_AUTOMATIC_NEXT_PLAY: 43,
  43: "HIGHLIGHTS_AUTOMATIC_NEXT_PLAY",
  HIGHLIGHTS_SEEK_TO_FIRST_PLAY: 44,
  44: "HIGHLIGHTS_SEEK_TO_FIRST_PLAY",
  HIGHLIGHTS_SEEK_TO_END: 45,
  45: "HIGHLIGHTS_SEEK_TO_END",
  SEGMENTS_TAP_LIST_ITEM: 46,
  46: "SEGMENTS_TAP_LIST_ITEM",
  PIP_FAST_FORWARD_BUTTON: 47,
  47: "PIP_FAST_FORWARD_BUTTON",
  PIP_REWIND_BUTTON: 48,
  48: "PIP_REWIND_BUTTON",
  PIP_RESUME_ON_HEAD: 49,
  49: "PIP_RESUME_ON_HEAD",
  MOVING_CLIP_FRAME: 50,
  50: "MOVING_CLIP_FRAME",
  RESUME_CLIP_PREVIOUS_POSITION: 51,
  51: "RESUME_CLIP_PREVIOUS_POSITION",
  SEEK_TO_NEXT_CHAPTER: 52,
  52: "SEEK_TO_NEXT_CHAPTER",
  SEEK_TO_PREVIOUS_CHAPTER: 53,
  53: "SEEK_TO_PREVIOUS_CHAPTER",
  IOS_SHAREPLAY_PAUSE: 54,
  54: "IOS_SHAREPLAY_PAUSE",
  IOS_SHAREPLAY_SEEK: 55,
  55: "IOS_SHAREPLAY_SEEK",
  IOS_SHAREPLAY_SYNC_RESPONSE: 56,
  56: "IOS_SHAREPLAY_SYNC_RESPONSE",
  SEEK_TO_HEAD_IMMERSIVE_LIVE_VIDEO: 57,
  57: "SEEK_TO_HEAD_IMMERSIVE_LIVE_VIDEO",
  SEEK_TO_START_OF_LOOPING_RANGE_OF_SHORTS: 58,
  58: "SEEK_TO_START_OF_LOOPING_RANGE_OF_SHORTS",
  SABR_SEEK_TO_CLOSEST_KEYFRAME: 59,
  59: "SABR_SEEK_TO_CLOSEST_KEYFRAME",
  SEEK_TO_END_OF_LOOPING_RANGE_OF_SHORTS: 60,
  60: "SEEK_TO_END_OF_LOOPING_RANGE_OF_SHORTS",
  CLIP_SLIDE_ON_FLIMSTRIP: 61,
  61: "CLIP_SLIDE_ON_FLIMSTRIP",
  PICK_UP_CLIP_SLIDER: 62,
  62: "PICK_UP_CLIP_SLIDER",
  FINE_SCRUBBER_CANCELLED: 63,
  63: "FINE_SCRUBBER_CANCELLED",
  INLINE_PLAYER_SEEK_CHAPTER: 64,
  64: "INLINE_PLAYER_SEEK_CHAPTER",
  INLINE_PLAYER_SEEK_SECONDS: 65,
  65: "INLINE_PLAYER_SEEK_SECONDS",
  HIGHLIGHTS_PLAYER_EXIT_FULLSCREEN: 67,
  67: "HIGHLIGHTS_PLAYER_EXIT_FULLSCREEN",
  LARGE_CONTROLS_FORWARD_BUTTON: 68,
  68: "LARGE_CONTROLS_FORWARD_BUTTON",
  LARGE_CONTROLS_REWIND_BUTTON: 69,
  69: "LARGE_CONTROLS_REWIND_BUTTON",
  LARGE_CONTROLS_SCRUBBER_BAR: 70,
  70: "LARGE_CONTROLS_SCRUBBER_BAR",
  SEEK_BACKWARD_5S: 71,
  71: "SEEK_BACKWARD_5S",
  SEEK_FORWARD_5S: 72,
  72: "SEEK_FORWARD_5S",
  SEEK_BACKWARD_10S: 73,
  73: "SEEK_BACKWARD_10S",
  SEEK_FORWARD_10S: 74,
  74: "SEEK_FORWARD_10S",
  SEEK_FORWARD_60S: 75,
  75: "SEEK_FORWARD_60S",
  SEEK_BACKWARD_60S: 76,
  76: "SEEK_BACKWARD_60S",
  SEEK_TO_NEXT_FRAME: 77,
  77: "SEEK_TO_NEXT_FRAME",
  SEEK_TO_PREV_FRAME: 78,
  78: "SEEK_TO_PREV_FRAME",
  KEYBOARD_SEEK_TO_BEGINNING: 79,
  79: "KEYBOARD_SEEK_TO_BEGINNING",
  KEYBOARD_SEEK_TO_END: 80,
  80: "KEYBOARD_SEEK_TO_END",
  SEEK_PERCENT_OF_VIDEO: 81,
  81: "SEEK_PERCENT_OF_VIDEO",
  HIDDEN_FAST_FORWARD_BUTTON: 82,
  82: "HIDDEN_FAST_FORWARD_BUTTON",
  HIDDEN_REWIND_BUTTON: 83,
  83: "HIDDEN_REWIND_BUTTON",
  TIMESTAMP: 84,
  84: "TIMESTAMP",
  LR_MEDIA_SESSION_SEEK: 87,
  87: "LR_MEDIA_SESSION_SEEK",
  MIDROLLS_WITH_TIME_RANGE: 88,
  88: "MIDROLLS_WITH_TIME_RANGE",
  SKIP_AD: 89,
  89: "SKIP_AD",
  SEEK_TO_PREVIOUS: 90,
  90: "SEEK_TO_PREVIOUS",
  SEEK_TO_NEXT: 91,
  91: "SEEK_TO_NEXT",
  LR_QUICK_SEEK: 92,
  92: "LR_QUICK_SEEK",
  ONESIE_LIVE: 93,
  93: "ONESIE_LIVE",
  LR_PLAYER_CONTROL_ACTION: 94,
  94: "LR_PLAYER_CONTROL_ACTION",
  UNPLUGGED_LENS_START_CLIP: 95,
  95: "UNPLUGGED_LENS_START_CLIP",
  LR_KEY_PLAYS: 96,
  96: "LR_KEY_PLAYS",
  SSAP_AD_FMT_FATAL: 97,
  97: "SSAP_AD_FMT_FATAL",
  TVHTML5_INPUT_SOURCE_KEY_EVENT: 98,
  98: "TVHTML5_INPUT_SOURCE_KEY_EVENT",
  TVHTML5_INPUT_SOURCE_CONTROLS: 99,
  99: "TVHTML5_INPUT_SOURCE_CONTROLS",
  TVHTML5_INPUT_SOURCE_TOUCH: 100,
  100: "TVHTML5_INPUT_SOURCE_TOUCH",
  TVHTML5_INPUT_SOURCE_TOUCHPAD: 101,
  101: "TVHTML5_INPUT_SOURCE_TOUCHPAD",
  SEEK_TO_HEAD: 102,
  102: "SEEK_TO_HEAD",
  AUTOMATIC_PREVIEW_REPLAY_ACTION: 103,
  103: "AUTOMATIC_PREVIEW_REPLAY_ACTION",
  H5_MEDIA_ELEMENT_EVENT: 104,
  104: "H5_MEDIA_ELEMENT_EVENT",
  H5_WORKAROUND_SEEK: 105,
  105: "H5_WORKAROUND_SEEK",
  MINIPLAYER_REWIND_BUTTON: 106,
  106: "MINIPLAYER_REWIND_BUTTON",
  MINIPLAYER_FAST_FORWARD_BUTTON: 107,
  107: "MINIPLAYER_FAST_FORWARD_BUTTON",
  SABR_RELOAD_PLAYER_RESPONSE_TOKEN_SEEK: 108,
  108: "SABR_RELOAD_PLAYER_RESPONSE_TOKEN_SEEK",
  SLIDE_ON_SCRUBBER_BAR_CHAPTER: 109,
  109: "SLIDE_ON_SCRUBBER_BAR_CHAPTER",
  ANDROID_CLEAR_BUFFER: 110,
  110: "ANDROID_CLEAR_BUFFER",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};
function createBaseFormatId() {
  return { itag: 0, lastModified: "0", xtags: "" };
}
var FormatId = {
  encode(message, writer = new BinaryWriter()) {
    if (message.itag !== void 0 && message.itag !== 0) {
      writer.uint32(8).int32(message.itag);
    }
    if (message.lastModified !== void 0 && message.lastModified !== "0") {
      writer.uint32(16).uint64(message.lastModified);
    }
    if (message.xtags !== void 0 && message.xtags !== "") {
      writer.uint32(26).string(message.xtags);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseFormatId();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.itag = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lastModified = reader.uint64().toString();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.xtags = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseRange() {
  return { legacyStart: 0, legacyEnd: 0, start: 0, end: 0 };
}
var Range = {
  encode(message, writer = new BinaryWriter()) {
    if (message.legacyStart !== void 0 && message.legacyStart !== 0) {
      writer.uint32(8).int32(message.legacyStart);
    }
    if (message.legacyEnd !== void 0 && message.legacyEnd !== 0) {
      writer.uint32(16).int32(message.legacyEnd);
    }
    if (message.start !== void 0 && message.start !== 0) {
      writer.uint32(24).int32(message.start);
    }
    if (message.end !== void 0 && message.end !== 0) {
      writer.uint32(32).int32(message.end);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.legacyStart = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.legacyEnd = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.start = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.end = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseAuthorizedFormat() {
  return { trackType: 0, isHdr: false };
}
var AuthorizedFormat = {
  encode(message, writer = new BinaryWriter()) {
    if (message.trackType !== void 0 && message.trackType !== 0) {
      writer.uint32(8).int32(message.trackType);
    }
    if (message.isHdr !== void 0 && message.isHdr !== false) {
      writer.uint32(16).bool(message.isHdr);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseAuthorizedFormat();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.trackType = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.isHdr = reader.bool();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBasePlaybackAuthorization() {
  return { authorizedFormats: [], sabrLicenseConstraint: new Uint8Array(0) };
}
var PlaybackAuthorization = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.authorizedFormats) {
      AuthorizedFormat.encode(v, writer.uint32(10).fork()).join();
    }
    if (message.sabrLicenseConstraint !== void 0 && message.sabrLicenseConstraint.length !== 0) {
      writer.uint32(18).bytes(message.sabrLicenseConstraint);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBasePlaybackAuthorization();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.authorizedFormats.push(AuthorizedFormat.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.sabrLicenseConstraint = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/format_initialization_metadata.js
function createBaseFormatInitializationMetadata() {
  return {
    videoId: "",
    formatId: void 0,
    endTimeMs: "0",
    endSegmentNum: "0",
    mimeType: "",
    initSegmentRange: void 0,
    indexRange: void 0,
    field8: "0",
    endTimeTicks: "0",
    endTimeTimescale: "0",
    clipId: "",
    formatStream: new Uint8Array(0)
  };
}
var FormatInitializationMetadata = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(10).string(message.videoId);
    }
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(18).fork()).join();
    }
    if (message.endTimeMs !== void 0 && message.endTimeMs !== "0") {
      writer.uint32(24).int64(message.endTimeMs);
    }
    if (message.endSegmentNum !== void 0 && message.endSegmentNum !== "0") {
      writer.uint32(32).int64(message.endSegmentNum);
    }
    if (message.mimeType !== void 0 && message.mimeType !== "") {
      writer.uint32(42).string(message.mimeType);
    }
    if (message.initSegmentRange !== void 0) {
      Range.encode(message.initSegmentRange, writer.uint32(50).fork()).join();
    }
    if (message.indexRange !== void 0) {
      Range.encode(message.indexRange, writer.uint32(58).fork()).join();
    }
    if (message.field8 !== void 0 && message.field8 !== "0") {
      writer.uint32(64).int64(message.field8);
    }
    if (message.endTimeTicks !== void 0 && message.endTimeTicks !== "0") {
      writer.uint32(72).int64(message.endTimeTicks);
    }
    if (message.endTimeTimescale !== void 0 && message.endTimeTimescale !== "0") {
      writer.uint32(80).int64(message.endTimeTimescale);
    }
    if (message.clipId !== void 0 && message.clipId !== "") {
      writer.uint32(90).string(message.clipId);
    }
    if (message.formatStream !== void 0 && message.formatStream.length !== 0) {
      writer.uint32(98).bytes(message.formatStream);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseFormatInitializationMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.endTimeMs = reader.int64().toString();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.endSegmentNum = reader.int64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.mimeType = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.initSegmentRange = Range.decode(reader, reader.uint32());
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.indexRange = Range.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.field8 = reader.int64().toString();
          continue;
        }
        case 9: {
          if (tag !== 72) {
            break;
          }
          message.endTimeTicks = reader.int64().toString();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.endTimeTimescale = reader.int64().toString();
          continue;
        }
        case 11: {
          if (tag !== 90) {
            break;
          }
          message.clipId = reader.string();
          continue;
        }
        case 12: {
          if (tag !== 98) {
            break;
          }
          message.formatStream = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/time_range.js
function createBaseTimeRange() {
  return { startTicks: "0", durationTicks: "0", timescale: 0 };
}
var TimeRange = {
  encode(message, writer = new BinaryWriter()) {
    if (message.startTicks !== void 0 && message.startTicks !== "0") {
      writer.uint32(8).int64(message.startTicks);
    }
    if (message.durationTicks !== void 0 && message.durationTicks !== "0") {
      writer.uint32(16).int64(message.durationTicks);
    }
    if (message.timescale !== void 0 && message.timescale !== 0) {
      writer.uint32(24).int32(message.timescale);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseTimeRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.startTicks = reader.int64().toString();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.durationTicks = reader.int64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.timescale = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/media_header.js
function createBaseMediaHeader() {
  return {
    headerId: 0,
    videoId: "",
    itag: 0,
    lmt: "0",
    xtags: "",
    segmentByteRangeStart: "0",
    compressionType: 0,
    isInitializationSegment: false,
    segmentNum: 0,
    bitrateBps: "0",
    startMs: "0",
    durationMs: "0",
    formatId: void 0,
    segmentLengthBytes: "0",
    timeRange: void 0,
    segmentLmt: "0",
    offsetFromStartOfSegment: "0",
    partialBytesToReturn: "0"
  };
}
var MediaHeader = {
  encode(message, writer = new BinaryWriter()) {
    if (message.headerId !== void 0 && message.headerId !== 0) {
      writer.uint32(8).uint32(message.headerId);
    }
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(18).string(message.videoId);
    }
    if (message.itag !== void 0 && message.itag !== 0) {
      writer.uint32(24).int32(message.itag);
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(32).uint64(message.lmt);
    }
    if (message.xtags !== void 0 && message.xtags !== "") {
      writer.uint32(42).string(message.xtags);
    }
    if (message.segmentByteRangeStart !== void 0 && message.segmentByteRangeStart !== "0") {
      writer.uint32(48).int64(message.segmentByteRangeStart);
    }
    if (message.compressionType !== void 0 && message.compressionType !== 0) {
      writer.uint32(56).int32(message.compressionType);
    }
    if (message.isInitializationSegment !== void 0 && message.isInitializationSegment !== false) {
      writer.uint32(64).bool(message.isInitializationSegment);
    }
    if (message.segmentNum !== void 0 && message.segmentNum !== 0) {
      writer.uint32(72).int32(message.segmentNum);
    }
    if (message.bitrateBps !== void 0 && message.bitrateBps !== "0") {
      writer.uint32(80).int64(message.bitrateBps);
    }
    if (message.startMs !== void 0 && message.startMs !== "0") {
      writer.uint32(88).int64(message.startMs);
    }
    if (message.durationMs !== void 0 && message.durationMs !== "0") {
      writer.uint32(96).int64(message.durationMs);
    }
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(106).fork()).join();
    }
    if (message.segmentLengthBytes !== void 0 && message.segmentLengthBytes !== "0") {
      writer.uint32(112).int64(message.segmentLengthBytes);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(122).fork()).join();
    }
    if (message.segmentLmt !== void 0 && message.segmentLmt !== "0") {
      writer.uint32(128).uint64(message.segmentLmt);
    }
    if (message.offsetFromStartOfSegment !== void 0 && message.offsetFromStartOfSegment !== "0") {
      writer.uint32(136).int64(message.offsetFromStartOfSegment);
    }
    if (message.partialBytesToReturn !== void 0 && message.partialBytesToReturn !== "0") {
      writer.uint32(144).int64(message.partialBytesToReturn);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaHeader();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.headerId = reader.uint32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.itag = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.lmt = reader.uint64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.xtags = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.segmentByteRangeStart = reader.int64().toString();
          continue;
        }
        case 7: {
          if (tag !== 56) {
            break;
          }
          message.compressionType = reader.int32();
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.isInitializationSegment = reader.bool();
          continue;
        }
        case 9: {
          if (tag !== 72) {
            break;
          }
          message.segmentNum = reader.int32();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.bitrateBps = reader.int64().toString();
          continue;
        }
        case 11: {
          if (tag !== 88) {
            break;
          }
          message.startMs = reader.int64().toString();
          continue;
        }
        case 12: {
          if (tag !== 96) {
            break;
          }
          message.durationMs = reader.int64().toString();
          continue;
        }
        case 13: {
          if (tag !== 106) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 14: {
          if (tag !== 112) {
            break;
          }
          message.segmentLengthBytes = reader.int64().toString();
          continue;
        }
        case 15: {
          if (tag !== 122) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.segmentLmt = reader.uint64().toString();
          continue;
        }
        case 17: {
          if (tag !== 136) {
            break;
          }
          message.offsetFromStartOfSegment = reader.int64().toString();
          continue;
        }
        case 18: {
          if (tag !== 144) {
            break;
          }
          message.partialBytesToReturn = reader.int64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/buffered_range.js
function createBaseBufferedRange() {
  return {
    formatId: void 0,
    startTimeMs: "0",
    durationMs: "0",
    startSegmentIndex: 0,
    endSegmentIndex: 0,
    timeRange: void 0,
    field9: void 0,
    field11: void 0,
    field12: void 0
  };
}
var BufferedRange = {
  encode(message, writer = new BinaryWriter()) {
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(10).fork()).join();
    }
    if (message.startTimeMs !== "0") {
      writer.uint32(16).int64(message.startTimeMs);
    }
    if (message.durationMs !== "0") {
      writer.uint32(24).int64(message.durationMs);
    }
    if (message.startSegmentIndex !== 0) {
      writer.uint32(32).int32(message.startSegmentIndex);
    }
    if (message.endSegmentIndex !== 0) {
      writer.uint32(40).int32(message.endSegmentIndex);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(50).fork()).join();
    }
    if (message.field9 !== void 0) {
      BufferedRange_UnknownMessage1.encode(message.field9, writer.uint32(74).fork()).join();
    }
    if (message.field11 !== void 0) {
      BufferedRange_UnknownMessage2.encode(message.field11, writer.uint32(90).fork()).join();
    }
    if (message.field12 !== void 0) {
      BufferedRange_UnknownMessage2.encode(message.field12, writer.uint32(98).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.startTimeMs = reader.int64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.durationMs = reader.int64().toString();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.startSegmentIndex = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.endSegmentIndex = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 9: {
          if (tag !== 74) {
            break;
          }
          message.field9 = BufferedRange_UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
        case 11: {
          if (tag !== 90) {
            break;
          }
          message.field11 = BufferedRange_UnknownMessage2.decode(reader, reader.uint32());
          continue;
        }
        case 12: {
          if (tag !== 98) {
            break;
          }
          message.field12 = BufferedRange_UnknownMessage2.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage1() {
  return { field1: [] };
}
var BufferedRange_UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.field1) {
      BufferedRange_UnknownMessage1_UnknownInnerMessage.encode(v, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.field1.push(BufferedRange_UnknownMessage1_UnknownInnerMessage.decode(reader, reader.uint32()));
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage1_UnknownInnerMessage() {
  return { videoId: "", lmt: "0" };
}
var BufferedRange_UnknownMessage1_UnknownInnerMessage = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(10).string(message.videoId);
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(16).uint64(message.lmt);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage1_UnknownInnerMessage();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lmt = reader.uint64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseBufferedRange_UnknownMessage2() {
  return { field1: 0, field2: 0, field3: 0 };
}
var BufferedRange_UnknownMessage2 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.field1 !== void 0 && message.field1 !== 0) {
      writer.uint32(8).int32(message.field1);
    }
    if (message.field2 !== void 0 && message.field2 !== 0) {
      writer.uint32(16).int32(message.field2);
    }
    if (message.field3 !== void 0 && message.field3 !== 0) {
      writer.uint32(24).int32(message.field3);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseBufferedRange_UnknownMessage2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.field1 = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.field2 = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.field3 = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/cuepoint.js
var Cuepoint_CuepointEvent = {
  UNKNOWN: 0,
  0: "UNKNOWN",
  START: 1,
  1: "START",
  CONTINUE: 2,
  2: "CONTINUE",
  STOP: 3,
  3: "STOP",
  INSERTION: 4,
  4: "INSERTION",
  PREDICT_START: 5,
  5: "PREDICT_START",
  /** PREFETCH - @NOTE: A request to https://www.youtube.com/youtubei/v1/player/ad_break?prettyPrint=false is made to get the ads_config bytes */
  PREFETCH: 6,
  /** PREFETCH - @NOTE: A request to https://www.youtube.com/youtubei/v1/player/ad_break?prettyPrint=false is made to get the ads_config bytes */
  6: "PREFETCH",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};
function createBaseCuepoint() {
  return {
    type: 0,
    event: 0,
    totalDurationSec: 0,
    playheadTimeSec: 0,
    context: "",
    identifier: "",
    playheadTimeAtStartSec: 0,
    mediaTimeSinceStartSec: 0,
    startSequenceNumber: 0
  };
}
var Cuepoint = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.event !== void 0 && message.event !== 0) {
      writer.uint32(16).int32(message.event);
    }
    if (message.totalDurationSec !== void 0 && message.totalDurationSec !== 0) {
      writer.uint32(25).double(message.totalDurationSec);
    }
    if (message.playheadTimeSec !== void 0 && message.playheadTimeSec !== 0) {
      writer.uint32(33).double(message.playheadTimeSec);
    }
    if (message.context !== void 0 && message.context !== "") {
      writer.uint32(42).string(message.context);
    }
    if (message.identifier !== void 0 && message.identifier !== "") {
      writer.uint32(50).string(message.identifier);
    }
    if (message.playheadTimeAtStartSec !== void 0 && message.playheadTimeAtStartSec !== 0) {
      writer.uint32(57).double(message.playheadTimeAtStartSec);
    }
    if (message.mediaTimeSinceStartSec !== void 0 && message.mediaTimeSinceStartSec !== 0) {
      writer.uint32(65).double(message.mediaTimeSinceStartSec);
    }
    if (message.startSequenceNumber !== void 0 && message.startSequenceNumber !== 0) {
      writer.uint32(72).int32(message.startSequenceNumber);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseCuepoint();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.type = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.event = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 25) {
            break;
          }
          message.totalDurationSec = reader.double();
          continue;
        }
        case 4: {
          if (tag !== 33) {
            break;
          }
          message.playheadTimeSec = reader.double();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.context = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.identifier = reader.string();
          continue;
        }
        case 7: {
          if (tag !== 57) {
            break;
          }
          message.playheadTimeAtStartSec = reader.double();
          continue;
        }
        case 8: {
          if (tag !== 65) {
            break;
          }
          message.mediaTimeSinceStartSec = reader.double();
          continue;
        }
        case 9: {
          if (tag !== 72) {
            break;
          }
          message.startSequenceNumber = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/cuepoint_info.js
function createBaseCuepointInfo() {
  return {
    cuepoint: void 0,
    trackType: 1,
    sequenceNumber: 0,
    timeRange: void 0,
    tileContext: "",
    unknownField6: 0,
    unknownField7: 0,
    opportunityId: "",
    serializedPrefetchContext: new Uint8Array(0)
  };
}
var CuepointInfo = {
  encode(message, writer = new BinaryWriter()) {
    if (message.cuepoint !== void 0) {
      Cuepoint.encode(message.cuepoint, writer.uint32(10).fork()).join();
    }
    if (message.trackType !== void 0 && message.trackType !== 1) {
      writer.uint32(16).int32(message.trackType);
    }
    if (message.sequenceNumber !== void 0 && message.sequenceNumber !== 0) {
      writer.uint32(24).int32(message.sequenceNumber);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(34).fork()).join();
    }
    if (message.tileContext !== void 0 && message.tileContext !== "") {
      writer.uint32(42).string(message.tileContext);
    }
    if (message.unknownField6 !== void 0 && message.unknownField6 !== 0) {
      writer.uint32(48).int32(message.unknownField6);
    }
    if (message.unknownField7 !== void 0 && message.unknownField7 !== 0) {
      writer.uint32(56).int32(message.unknownField7);
    }
    if (message.opportunityId !== void 0 && message.opportunityId !== "") {
      writer.uint32(66).string(message.opportunityId);
    }
    if (message.serializedPrefetchContext !== void 0 && message.serializedPrefetchContext.length !== 0) {
      writer.uint32(74).bytes(message.serializedPrefetchContext);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseCuepointInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.cuepoint = Cuepoint.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.trackType = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.sequenceNumber = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.tileContext = reader.string();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.unknownField6 = reader.int32();
          continue;
        }
        case 7: {
          if (tag !== 56) {
            break;
          }
          message.unknownField7 = reader.int32();
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.opportunityId = reader.string();
          continue;
        }
        case 9: {
          if (tag !== 74) {
            break;
          }
          message.serializedPrefetchContext = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/cuepoint_list.js
function createBaseCuepointList() {
  return { ssapInfos: [] };
}
var CuepointList = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.ssapInfos) {
      CuepointInfo.encode(v, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseCuepointList();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.ssapInfos.push(CuepointInfo.decode(reader, reader.uint32()));
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/media_capabilities.js
function createBaseMediaCapabilities() {
  return { videoFormatCapabilities: [], audioFormatCapabilities: [], hdrModeBitmask: 0 };
}
var MediaCapabilities = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.videoFormatCapabilities) {
      MediaCapabilities_VideoFormatCapability.encode(v, writer.uint32(10).fork()).join();
    }
    for (const v of message.audioFormatCapabilities) {
      MediaCapabilities_AudioFormatCapability.encode(v, writer.uint32(18).fork()).join();
    }
    if (message.hdrModeBitmask !== void 0 && message.hdrModeBitmask !== 0) {
      writer.uint32(40).int32(message.hdrModeBitmask);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.videoFormatCapabilities.push(MediaCapabilities_VideoFormatCapability.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.audioFormatCapabilities.push(MediaCapabilities_AudioFormatCapability.decode(reader, reader.uint32()));
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.hdrModeBitmask = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseMediaCapabilities_VideoFormatCapability() {
  return { videoCodec: 0, maxHeight: 0, maxWidth: 0, maxFramerate: 0, maxBitrateBps: 0, is10BitSupported: false };
}
var MediaCapabilities_VideoFormatCapability = {
  encode(message, writer = new BinaryWriter()) {
    if (message.videoCodec !== void 0 && message.videoCodec !== 0) {
      writer.uint32(8).int32(message.videoCodec);
    }
    if (message.maxHeight !== void 0 && message.maxHeight !== 0) {
      writer.uint32(24).int32(message.maxHeight);
    }
    if (message.maxWidth !== void 0 && message.maxWidth !== 0) {
      writer.uint32(32).int32(message.maxWidth);
    }
    if (message.maxFramerate !== void 0 && message.maxFramerate !== 0) {
      writer.uint32(88).int32(message.maxFramerate);
    }
    if (message.maxBitrateBps !== void 0 && message.maxBitrateBps !== 0) {
      writer.uint32(96).int32(message.maxBitrateBps);
    }
    if (message.is10BitSupported !== void 0 && message.is10BitSupported !== false) {
      writer.uint32(120).bool(message.is10BitSupported);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities_VideoFormatCapability();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.videoCodec = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxHeight = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.maxWidth = reader.int32();
          continue;
        }
        case 11: {
          if (tag !== 88) {
            break;
          }
          message.maxFramerate = reader.int32();
          continue;
        }
        case 12: {
          if (tag !== 96) {
            break;
          }
          message.maxBitrateBps = reader.int32();
          continue;
        }
        case 15: {
          if (tag !== 120) {
            break;
          }
          message.is10BitSupported = reader.bool();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseMediaCapabilities_AudioFormatCapability() {
  return { audioCodec: 0, numChannels: 0, maxBitrateBps: 0, spatialCapabilityBitmask: 0 };
}
var MediaCapabilities_AudioFormatCapability = {
  encode(message, writer = new BinaryWriter()) {
    if (message.audioCodec !== void 0 && message.audioCodec !== 0) {
      writer.uint32(8).int32(message.audioCodec);
    }
    if (message.numChannels !== void 0 && message.numChannels !== 0) {
      writer.uint32(16).int32(message.numChannels);
    }
    if (message.maxBitrateBps !== void 0 && message.maxBitrateBps !== 0) {
      writer.uint32(24).int32(message.maxBitrateBps);
    }
    if (message.spatialCapabilityBitmask !== void 0 && message.spatialCapabilityBitmask !== 0) {
      writer.uint32(48).int32(message.spatialCapabilityBitmask);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseMediaCapabilities_AudioFormatCapability();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.audioCodec = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.numChannels = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxBitrateBps = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.spatialCapabilityBitmask = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/playback_cookie.js
function createBasePlaybackCookie() {
  return { resolution: 0, field2: 0, videoFmt: void 0, audioFmt: void 0 };
}
var PlaybackCookie = {
  encode(message, writer = new BinaryWriter()) {
    if (message.resolution !== void 0 && message.resolution !== 0) {
      writer.uint32(8).int32(message.resolution);
    }
    if (message.field2 !== void 0 && message.field2 !== 0) {
      writer.uint32(16).int32(message.field2);
    }
    if (message.videoFmt !== void 0) {
      FormatId.encode(message.videoFmt, writer.uint32(58).fork()).join();
    }
    if (message.audioFmt !== void 0) {
      FormatId.encode(message.audioFmt, writer.uint32(66).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBasePlaybackCookie();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.resolution = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.field2 = reader.int32();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.videoFmt = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.audioFmt = FormatId.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/client_abr_state.js
function createBaseClientAbrState() {
  return {
    timeSinceLastManualFormatSelectionMs: "0",
    lastManualDirection: 0,
    lastManualSelectedResolution: 0,
    detailedNetworkType: 0,
    clientViewportWidth: 0,
    clientViewportHeight: 0,
    clientBitrateCapBytesPerSec: "0",
    stickyResolution: 0,
    clientViewportIsFlexible: false,
    bandwidthEstimate: "0",
    minAudioQuality: 0,
    maxAudioQuality: 0,
    videoQualitySetting: 0,
    audioRoute: 0,
    playerTimeMs: "0",
    timeSinceLastSeek: "0",
    dataSaverMode: false,
    networkMeteredState: 0,
    visibility: 0,
    playbackRate: 0,
    elapsedWallTimeMs: "0",
    mediaCapabilities: void 0,
    timeSinceLastActionMs: "0",
    enabledTrackTypesBitfield: 0,
    maxPacingRate: 0,
    playerState: "0",
    drcEnabled: false,
    field48: 0,
    field50: 0,
    field51: 0,
    sabrReportRequestCancellationInfo: 0,
    disableStreamingXhr: false,
    field57: "0",
    preferVp9: false,
    av1QualityThreshold: 0,
    field60: 0,
    isPrefetch: false,
    sabrSupportQualityConstraints: false,
    sabrLicenseConstraint: new Uint8Array(0),
    allowProximaLiveLatency: 0,
    sabrForceProxima: 0,
    field67: 0,
    sabrForceMaxNetworkInterruptionDurationMs: "0",
    audioTrackId: "",
    enableVoiceBoost: false,
    playbackAuthorization: void 0
  };
}
var ClientAbrState = {
  encode(message, writer = new BinaryWriter()) {
    if (message.timeSinceLastManualFormatSelectionMs !== void 0 && message.timeSinceLastManualFormatSelectionMs !== "0") {
      writer.uint32(104).int64(message.timeSinceLastManualFormatSelectionMs);
    }
    if (message.lastManualDirection !== void 0 && message.lastManualDirection !== 0) {
      writer.uint32(112).sint32(message.lastManualDirection);
    }
    if (message.lastManualSelectedResolution !== void 0 && message.lastManualSelectedResolution !== 0) {
      writer.uint32(128).int32(message.lastManualSelectedResolution);
    }
    if (message.detailedNetworkType !== void 0 && message.detailedNetworkType !== 0) {
      writer.uint32(136).int32(message.detailedNetworkType);
    }
    if (message.clientViewportWidth !== void 0 && message.clientViewportWidth !== 0) {
      writer.uint32(144).int32(message.clientViewportWidth);
    }
    if (message.clientViewportHeight !== void 0 && message.clientViewportHeight !== 0) {
      writer.uint32(152).int32(message.clientViewportHeight);
    }
    if (message.clientBitrateCapBytesPerSec !== void 0 && message.clientBitrateCapBytesPerSec !== "0") {
      writer.uint32(160).int64(message.clientBitrateCapBytesPerSec);
    }
    if (message.stickyResolution !== void 0 && message.stickyResolution !== 0) {
      writer.uint32(168).int32(message.stickyResolution);
    }
    if (message.clientViewportIsFlexible !== void 0 && message.clientViewportIsFlexible !== false) {
      writer.uint32(176).bool(message.clientViewportIsFlexible);
    }
    if (message.bandwidthEstimate !== void 0 && message.bandwidthEstimate !== "0") {
      writer.uint32(184).int64(message.bandwidthEstimate);
    }
    if (message.minAudioQuality !== void 0 && message.minAudioQuality !== 0) {
      writer.uint32(192).int32(message.minAudioQuality);
    }
    if (message.maxAudioQuality !== void 0 && message.maxAudioQuality !== 0) {
      writer.uint32(200).int32(message.maxAudioQuality);
    }
    if (message.videoQualitySetting !== void 0 && message.videoQualitySetting !== 0) {
      writer.uint32(208).int32(message.videoQualitySetting);
    }
    if (message.audioRoute !== void 0 && message.audioRoute !== 0) {
      writer.uint32(216).int32(message.audioRoute);
    }
    if (message.playerTimeMs !== void 0 && message.playerTimeMs !== "0") {
      writer.uint32(224).int64(message.playerTimeMs);
    }
    if (message.timeSinceLastSeek !== void 0 && message.timeSinceLastSeek !== "0") {
      writer.uint32(232).int64(message.timeSinceLastSeek);
    }
    if (message.dataSaverMode !== void 0 && message.dataSaverMode !== false) {
      writer.uint32(240).bool(message.dataSaverMode);
    }
    if (message.networkMeteredState !== void 0 && message.networkMeteredState !== 0) {
      writer.uint32(256).int32(message.networkMeteredState);
    }
    if (message.visibility !== void 0 && message.visibility !== 0) {
      writer.uint32(272).int32(message.visibility);
    }
    if (message.playbackRate !== void 0 && message.playbackRate !== 0) {
      writer.uint32(285).float(message.playbackRate);
    }
    if (message.elapsedWallTimeMs !== void 0 && message.elapsedWallTimeMs !== "0") {
      writer.uint32(288).int64(message.elapsedWallTimeMs);
    }
    if (message.mediaCapabilities !== void 0) {
      MediaCapabilities.encode(message.mediaCapabilities, writer.uint32(306).fork()).join();
    }
    if (message.timeSinceLastActionMs !== void 0 && message.timeSinceLastActionMs !== "0") {
      writer.uint32(312).int64(message.timeSinceLastActionMs);
    }
    if (message.enabledTrackTypesBitfield !== void 0 && message.enabledTrackTypesBitfield !== 0) {
      writer.uint32(320).int32(message.enabledTrackTypesBitfield);
    }
    if (message.maxPacingRate !== void 0 && message.maxPacingRate !== 0) {
      writer.uint32(344).int32(message.maxPacingRate);
    }
    if (message.playerState !== void 0 && message.playerState !== "0") {
      writer.uint32(352).int64(message.playerState);
    }
    if (message.drcEnabled !== void 0 && message.drcEnabled !== false) {
      writer.uint32(368).bool(message.drcEnabled);
    }
    if (message.field48 !== void 0 && message.field48 !== 0) {
      writer.uint32(384).int32(message.field48);
    }
    if (message.field50 !== void 0 && message.field50 !== 0) {
      writer.uint32(400).int32(message.field50);
    }
    if (message.field51 !== void 0 && message.field51 !== 0) {
      writer.uint32(408).int32(message.field51);
    }
    if (message.sabrReportRequestCancellationInfo !== void 0 && message.sabrReportRequestCancellationInfo !== 0) {
      writer.uint32(432).int32(message.sabrReportRequestCancellationInfo);
    }
    if (message.disableStreamingXhr !== void 0 && message.disableStreamingXhr !== false) {
      writer.uint32(448).bool(message.disableStreamingXhr);
    }
    if (message.field57 !== void 0 && message.field57 !== "0") {
      writer.uint32(456).int64(message.field57);
    }
    if (message.preferVp9 !== void 0 && message.preferVp9 !== false) {
      writer.uint32(464).bool(message.preferVp9);
    }
    if (message.av1QualityThreshold !== void 0 && message.av1QualityThreshold !== 0) {
      writer.uint32(472).int32(message.av1QualityThreshold);
    }
    if (message.field60 !== void 0 && message.field60 !== 0) {
      writer.uint32(480).int32(message.field60);
    }
    if (message.isPrefetch !== void 0 && message.isPrefetch !== false) {
      writer.uint32(488).bool(message.isPrefetch);
    }
    if (message.sabrSupportQualityConstraints !== void 0 && message.sabrSupportQualityConstraints !== false) {
      writer.uint32(496).bool(message.sabrSupportQualityConstraints);
    }
    if (message.sabrLicenseConstraint !== void 0 && message.sabrLicenseConstraint.length !== 0) {
      writer.uint32(506).bytes(message.sabrLicenseConstraint);
    }
    if (message.allowProximaLiveLatency !== void 0 && message.allowProximaLiveLatency !== 0) {
      writer.uint32(512).int32(message.allowProximaLiveLatency);
    }
    if (message.sabrForceProxima !== void 0 && message.sabrForceProxima !== 0) {
      writer.uint32(528).int32(message.sabrForceProxima);
    }
    if (message.field67 !== void 0 && message.field67 !== 0) {
      writer.uint32(536).int32(message.field67);
    }
    if (message.sabrForceMaxNetworkInterruptionDurationMs !== void 0 && message.sabrForceMaxNetworkInterruptionDurationMs !== "0") {
      writer.uint32(544).int64(message.sabrForceMaxNetworkInterruptionDurationMs);
    }
    if (message.audioTrackId !== void 0 && message.audioTrackId !== "") {
      writer.uint32(554).string(message.audioTrackId);
    }
    if (message.enableVoiceBoost !== void 0 && message.enableVoiceBoost !== false) {
      writer.uint32(608).bool(message.enableVoiceBoost);
    }
    if (message.playbackAuthorization !== void 0) {
      PlaybackAuthorization.encode(message.playbackAuthorization, writer.uint32(634).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseClientAbrState();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 13: {
          if (tag !== 104) {
            break;
          }
          message.timeSinceLastManualFormatSelectionMs = reader.int64().toString();
          continue;
        }
        case 14: {
          if (tag !== 112) {
            break;
          }
          message.lastManualDirection = reader.sint32();
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.lastManualSelectedResolution = reader.int32();
          continue;
        }
        case 17: {
          if (tag !== 136) {
            break;
          }
          message.detailedNetworkType = reader.int32();
          continue;
        }
        case 18: {
          if (tag !== 144) {
            break;
          }
          message.clientViewportWidth = reader.int32();
          continue;
        }
        case 19: {
          if (tag !== 152) {
            break;
          }
          message.clientViewportHeight = reader.int32();
          continue;
        }
        case 20: {
          if (tag !== 160) {
            break;
          }
          message.clientBitrateCapBytesPerSec = reader.int64().toString();
          continue;
        }
        case 21: {
          if (tag !== 168) {
            break;
          }
          message.stickyResolution = reader.int32();
          continue;
        }
        case 22: {
          if (tag !== 176) {
            break;
          }
          message.clientViewportIsFlexible = reader.bool();
          continue;
        }
        case 23: {
          if (tag !== 184) {
            break;
          }
          message.bandwidthEstimate = reader.int64().toString();
          continue;
        }
        case 24: {
          if (tag !== 192) {
            break;
          }
          message.minAudioQuality = reader.int32();
          continue;
        }
        case 25: {
          if (tag !== 200) {
            break;
          }
          message.maxAudioQuality = reader.int32();
          continue;
        }
        case 26: {
          if (tag !== 208) {
            break;
          }
          message.videoQualitySetting = reader.int32();
          continue;
        }
        case 27: {
          if (tag !== 216) {
            break;
          }
          message.audioRoute = reader.int32();
          continue;
        }
        case 28: {
          if (tag !== 224) {
            break;
          }
          message.playerTimeMs = reader.int64().toString();
          continue;
        }
        case 29: {
          if (tag !== 232) {
            break;
          }
          message.timeSinceLastSeek = reader.int64().toString();
          continue;
        }
        case 30: {
          if (tag !== 240) {
            break;
          }
          message.dataSaverMode = reader.bool();
          continue;
        }
        case 32: {
          if (tag !== 256) {
            break;
          }
          message.networkMeteredState = reader.int32();
          continue;
        }
        case 34: {
          if (tag !== 272) {
            break;
          }
          message.visibility = reader.int32();
          continue;
        }
        case 35: {
          if (tag !== 285) {
            break;
          }
          message.playbackRate = reader.float();
          continue;
        }
        case 36: {
          if (tag !== 288) {
            break;
          }
          message.elapsedWallTimeMs = reader.int64().toString();
          continue;
        }
        case 38: {
          if (tag !== 306) {
            break;
          }
          message.mediaCapabilities = MediaCapabilities.decode(reader, reader.uint32());
          continue;
        }
        case 39: {
          if (tag !== 312) {
            break;
          }
          message.timeSinceLastActionMs = reader.int64().toString();
          continue;
        }
        case 40: {
          if (tag !== 320) {
            break;
          }
          message.enabledTrackTypesBitfield = reader.int32();
          continue;
        }
        case 43: {
          if (tag !== 344) {
            break;
          }
          message.maxPacingRate = reader.int32();
          continue;
        }
        case 44: {
          if (tag !== 352) {
            break;
          }
          message.playerState = reader.int64().toString();
          continue;
        }
        case 46: {
          if (tag !== 368) {
            break;
          }
          message.drcEnabled = reader.bool();
          continue;
        }
        case 48: {
          if (tag !== 384) {
            break;
          }
          message.field48 = reader.int32();
          continue;
        }
        case 50: {
          if (tag !== 400) {
            break;
          }
          message.field50 = reader.int32();
          continue;
        }
        case 51: {
          if (tag !== 408) {
            break;
          }
          message.field51 = reader.int32();
          continue;
        }
        case 54: {
          if (tag !== 432) {
            break;
          }
          message.sabrReportRequestCancellationInfo = reader.int32();
          continue;
        }
        case 56: {
          if (tag !== 448) {
            break;
          }
          message.disableStreamingXhr = reader.bool();
          continue;
        }
        case 57: {
          if (tag !== 456) {
            break;
          }
          message.field57 = reader.int64().toString();
          continue;
        }
        case 58: {
          if (tag !== 464) {
            break;
          }
          message.preferVp9 = reader.bool();
          continue;
        }
        case 59: {
          if (tag !== 472) {
            break;
          }
          message.av1QualityThreshold = reader.int32();
          continue;
        }
        case 60: {
          if (tag !== 480) {
            break;
          }
          message.field60 = reader.int32();
          continue;
        }
        case 61: {
          if (tag !== 488) {
            break;
          }
          message.isPrefetch = reader.bool();
          continue;
        }
        case 62: {
          if (tag !== 496) {
            break;
          }
          message.sabrSupportQualityConstraints = reader.bool();
          continue;
        }
        case 63: {
          if (tag !== 506) {
            break;
          }
          message.sabrLicenseConstraint = reader.bytes();
          continue;
        }
        case 64: {
          if (tag !== 512) {
            break;
          }
          message.allowProximaLiveLatency = reader.int32();
          continue;
        }
        case 66: {
          if (tag !== 528) {
            break;
          }
          message.sabrForceProxima = reader.int32();
          continue;
        }
        case 67: {
          if (tag !== 536) {
            break;
          }
          message.field67 = reader.int32();
          continue;
        }
        case 68: {
          if (tag !== 544) {
            break;
          }
          message.sabrForceMaxNetworkInterruptionDurationMs = reader.int64().toString();
          continue;
        }
        case 69: {
          if (tag !== 554) {
            break;
          }
          message.audioTrackId = reader.string();
          continue;
        }
        case 76: {
          if (tag !== 608) {
            break;
          }
          message.enableVoiceBoost = reader.bool();
          continue;
        }
        case 79: {
          if (tag !== 634) {
            break;
          }
          message.playbackAuthorization = PlaybackAuthorization.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/ssap_playback_info.js
var SsapPlaybackInfo_AdState = {
  UNKNOWN: 0,
  0: "UNKNOWN",
  TIMEOUT: 1,
  1: "TIMEOUT",
  /** RATECONTROL - when /ad_break returns adThrottled=true */
  RATECONTROL: 2,
  /** RATECONTROL - when /ad_break returns adThrottled=true */
  2: "RATECONTROL",
  /** RATECONTROL_CLIENT - when the client itself throttles ad requests? */
  RATECONTROL_CLIENT: 11,
  /** RATECONTROL_CLIENT - when the client itself throttles ad requests? */
  11: "RATECONTROL_CLIENT",
  SERVER_ERROR: 3,
  3: "SERVER_ERROR",
  DELETED: 4,
  4: "DELETED",
  WAITING: 5,
  5: "WAITING",
  READY: 6,
  6: "READY",
  SSDISABLED: 7,
  7: "SSDISABLED",
  SSDISABLED_USTREAMER: 9,
  9: "SSDISABLED_USTREAMER",
  SSDISABLED_NO_CONFIG: 10,
  10: "SSDISABLED_NO_CONFIG",
  NO_DAI_CONFIG_RETURNED_IN_GAB: 12,
  12: "NO_DAI_CONFIG_RETURNED_IN_GAB",
  INACTIVE: 8,
  8: "INACTIVE",
  CACHE_MISS: 13,
  13: "CACHE_MISS",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};
function createBaseSsapPlaybackInfo() {
  return {
    adCpns: [],
    adsConfig: new Uint8Array(0),
    daiState: "",
    skipSequence: 0,
    unknownField5: 0,
    unknownField6: "",
    cuepointId: "",
    state: 0,
    tileContext: "",
    startTimeMs: "0",
    durationMs: "0"
  };
}
var SsapPlaybackInfo = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.adCpns) {
      writer.uint32(10).string(v);
    }
    if (message.adsConfig !== void 0 && message.adsConfig.length !== 0) {
      writer.uint32(18).bytes(message.adsConfig);
    }
    if (message.daiState !== void 0 && message.daiState !== "") {
      writer.uint32(26).string(message.daiState);
    }
    if (message.skipSequence !== void 0 && message.skipSequence !== 0) {
      writer.uint32(32).int32(message.skipSequence);
    }
    if (message.unknownField5 !== void 0 && message.unknownField5 !== 0) {
      writer.uint32(40).int32(message.unknownField5);
    }
    if (message.unknownField6 !== void 0 && message.unknownField6 !== "") {
      writer.uint32(50).string(message.unknownField6);
    }
    if (message.cuepointId !== void 0 && message.cuepointId !== "") {
      writer.uint32(58).string(message.cuepointId);
    }
    if (message.state !== void 0 && message.state !== 0) {
      writer.uint32(64).int32(message.state);
    }
    if (message.tileContext !== void 0 && message.tileContext !== "") {
      writer.uint32(74).string(message.tileContext);
    }
    if (message.startTimeMs !== void 0 && message.startTimeMs !== "0") {
      writer.uint32(80).int64(message.startTimeMs);
    }
    if (message.durationMs !== void 0 && message.durationMs !== "0") {
      writer.uint32(88).int64(message.durationMs);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSsapPlaybackInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.adCpns.push(reader.string());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.adsConfig = reader.bytes();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.daiState = reader.string();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.skipSequence = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.unknownField5 = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.unknownField6 = reader.string();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.cuepointId = reader.string();
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.state = reader.int32();
          continue;
        }
        case 9: {
          if (tag !== 74) {
            break;
          }
          message.tileContext = reader.string();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.startTimeMs = reader.int64().toString();
          continue;
        }
        case 11: {
          if (tag !== 88) {
            break;
          }
          message.durationMs = reader.int64().toString();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/streamer_context.js
function createBaseStreamerContext() {
  return {
    clientInfo: void 0,
    poToken: new Uint8Array(0),
    playbackCookie: new Uint8Array(0),
    field4: new Uint8Array(0),
    sabrContexts: [],
    unsentSabrContexts: [],
    field7: "",
    field8: void 0
  };
}
var StreamerContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.clientInfo !== void 0) {
      StreamerContext_ClientInfo.encode(message.clientInfo, writer.uint32(10).fork()).join();
    }
    if (message.poToken !== void 0 && message.poToken.length !== 0) {
      writer.uint32(18).bytes(message.poToken);
    }
    if (message.playbackCookie !== void 0 && message.playbackCookie.length !== 0) {
      writer.uint32(26).bytes(message.playbackCookie);
    }
    if (message.field4 !== void 0 && message.field4.length !== 0) {
      writer.uint32(34).bytes(message.field4);
    }
    for (const v of message.sabrContexts) {
      StreamerContext_SabrContext.encode(v, writer.uint32(42).fork()).join();
    }
    writer.uint32(50).fork();
    for (const v of message.unsentSabrContexts) {
      writer.int32(v);
    }
    writer.join();
    if (message.field7 !== void 0 && message.field7 !== "") {
      writer.uint32(58).string(message.field7);
    }
    if (message.field8 !== void 0) {
      StreamerContext_UnknownMessage1.encode(message.field8, writer.uint32(66).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.clientInfo = StreamerContext_ClientInfo.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.poToken = reader.bytes();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.playbackCookie = reader.bytes();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }
          message.field4 = reader.bytes();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.sabrContexts.push(StreamerContext_SabrContext.decode(reader, reader.uint32()));
          continue;
        }
        case 6: {
          if (tag === 48) {
            message.unsentSabrContexts.push(reader.int32());
            continue;
          }
          if (tag === 50) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.unsentSabrContexts.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.field7 = reader.string();
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.field8 = StreamerContext_UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_ClientInfo() {
  return { hl: "", deviceMake: "", deviceModel: "", clientName: 0, clientVersion: "", osName: "", osVersion: "" };
}
var StreamerContext_ClientInfo = {
  encode(message, writer = new BinaryWriter()) {
    if (message.hl !== void 0 && message.hl !== "") {
      writer.uint32(10).string(message.hl);
    }
    if (message.deviceMake !== void 0 && message.deviceMake !== "") {
      writer.uint32(98).string(message.deviceMake);
    }
    if (message.deviceModel !== void 0 && message.deviceModel !== "") {
      writer.uint32(106).string(message.deviceModel);
    }
    if (message.clientName !== void 0 && message.clientName !== 0) {
      writer.uint32(128).int32(message.clientName);
    }
    if (message.clientVersion !== void 0 && message.clientVersion !== "") {
      writer.uint32(138).string(message.clientVersion);
    }
    if (message.osName !== void 0 && message.osName !== "") {
      writer.uint32(146).string(message.osName);
    }
    if (message.osVersion !== void 0 && message.osVersion !== "") {
      writer.uint32(154).string(message.osVersion);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_ClientInfo();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.hl = reader.string();
          continue;
        }
        case 12: {
          if (tag !== 98) {
            break;
          }
          message.deviceMake = reader.string();
          continue;
        }
        case 13: {
          if (tag !== 106) {
            break;
          }
          message.deviceModel = reader.string();
          continue;
        }
        case 16: {
          if (tag !== 128) {
            break;
          }
          message.clientName = reader.int32();
          continue;
        }
        case 17: {
          if (tag !== 138) {
            break;
          }
          message.clientVersion = reader.string();
          continue;
        }
        case 18: {
          if (tag !== 146) {
            break;
          }
          message.osName = reader.string();
          continue;
        }
        case 19: {
          if (tag !== 154) {
            break;
          }
          message.osVersion = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_SabrContext() {
  return { type: 0, value: new Uint8Array(0) };
}
var StreamerContext_SabrContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.value !== void 0 && message.value.length !== 0) {
      writer.uint32(18).bytes(message.value);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_SabrContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.type = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.value = reader.bytes();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_UnknownMessage1() {
  return { field1: new Uint8Array(0), field2: void 0 };
}
var StreamerContext_UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.field1 !== void 0 && message.field1.length !== 0) {
      writer.uint32(10).bytes(message.field1);
    }
    if (message.field2 !== void 0) {
      StreamerContext_UnknownMessage1_UnknownInnerMessage1.encode(message.field2, writer.uint32(18).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_UnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.field1 = reader.bytes();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.field2 = StreamerContext_UnknownMessage1_UnknownInnerMessage1.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseStreamerContext_UnknownMessage1_UnknownInnerMessage1() {
  return { code: 0, message: "" };
}
var StreamerContext_UnknownMessage1_UnknownInnerMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.code !== void 0 && message.code !== 0) {
      writer.uint32(8).int32(message.code);
    }
    if (message.message !== void 0 && message.message !== "") {
      writer.uint32(18).string(message.message);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamerContext_UnknownMessage1_UnknownInnerMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.code = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.message = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/video_playback_abr_request.js
function createBaseVideoPlaybackAbrRequest() {
  return {
    clientAbrState: void 0,
    initializationFormatIds: [],
    bufferedRanges: [],
    mediaStartTimeMs: "0",
    videoPlaybackUstreamerConfig: new Uint8Array(0),
    field6: void 0,
    selectedAudioFormatIds: [],
    selectedVideoFormatIds: [],
    selectedCaptionFormatIds: [],
    streamerContext: void 0,
    serverStitchedDaiInfo: void 0,
    lastVideoItag: 0,
    lastAudioItag: 0,
    ssapPlaybackInfos: [],
    unusedBloatSizeBytes: new Uint8Array(0),
    field1000: []
  };
}
var VideoPlaybackAbrRequest = {
  encode(message, writer = new BinaryWriter()) {
    if (message.clientAbrState !== void 0) {
      ClientAbrState.encode(message.clientAbrState, writer.uint32(10).fork()).join();
    }
    for (const v of message.initializationFormatIds) {
      FormatId.encode(v, writer.uint32(18).fork()).join();
    }
    for (const v of message.bufferedRanges) {
      BufferedRange.encode(v, writer.uint32(26).fork()).join();
    }
    if (message.mediaStartTimeMs !== void 0 && message.mediaStartTimeMs !== "0") {
      writer.uint32(32).int64(message.mediaStartTimeMs);
    }
    if (message.videoPlaybackUstreamerConfig !== void 0 && message.videoPlaybackUstreamerConfig.length !== 0) {
      writer.uint32(42).bytes(message.videoPlaybackUstreamerConfig);
    }
    if (message.field6 !== void 0) {
      UnknownMessage1.encode(message.field6, writer.uint32(50).fork()).join();
    }
    for (const v of message.selectedAudioFormatIds) {
      FormatId.encode(v, writer.uint32(130).fork()).join();
    }
    for (const v of message.selectedVideoFormatIds) {
      FormatId.encode(v, writer.uint32(138).fork()).join();
    }
    for (const v of message.selectedCaptionFormatIds) {
      FormatId.encode(v, writer.uint32(146).fork()).join();
    }
    if (message.streamerContext !== void 0) {
      StreamerContext.encode(message.streamerContext, writer.uint32(154).fork()).join();
    }
    if (message.serverStitchedDaiInfo !== void 0) {
      SsapPlaybackInfo.encode(message.serverStitchedDaiInfo, writer.uint32(170).fork()).join();
    }
    if (message.lastVideoItag !== void 0 && message.lastVideoItag !== 0) {
      writer.uint32(176).int32(message.lastVideoItag);
    }
    if (message.lastAudioItag !== void 0 && message.lastAudioItag !== 0) {
      writer.uint32(184).int32(message.lastAudioItag);
    }
    for (const v of message.ssapPlaybackInfos) {
      SsapPlaybackInfo.encode(v, writer.uint32(194).fork()).join();
    }
    if (message.unusedBloatSizeBytes !== void 0 && message.unusedBloatSizeBytes.length !== 0) {
      writer.uint32(202).bytes(message.unusedBloatSizeBytes);
    }
    for (const v of message.field1000) {
      UnknownMessage2.encode(v, writer.uint32(8002).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseVideoPlaybackAbrRequest();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.clientAbrState = ClientAbrState.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.initializationFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.bufferedRanges.push(BufferedRange.decode(reader, reader.uint32()));
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.mediaStartTimeMs = reader.int64().toString();
          continue;
        }
        case 5: {
          if (tag !== 42) {
            break;
          }
          message.videoPlaybackUstreamerConfig = reader.bytes();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.field6 = UnknownMessage1.decode(reader, reader.uint32());
          continue;
        }
        case 16: {
          if (tag !== 130) {
            break;
          }
          message.selectedAudioFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 17: {
          if (tag !== 138) {
            break;
          }
          message.selectedVideoFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 18: {
          if (tag !== 146) {
            break;
          }
          message.selectedCaptionFormatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 19: {
          if (tag !== 154) {
            break;
          }
          message.streamerContext = StreamerContext.decode(reader, reader.uint32());
          continue;
        }
        case 21: {
          if (tag !== 170) {
            break;
          }
          message.serverStitchedDaiInfo = SsapPlaybackInfo.decode(reader, reader.uint32());
          continue;
        }
        case 22: {
          if (tag !== 176) {
            break;
          }
          message.lastVideoItag = reader.int32();
          continue;
        }
        case 23: {
          if (tag !== 184) {
            break;
          }
          message.lastAudioItag = reader.int32();
          continue;
        }
        case 24: {
          if (tag !== 194) {
            break;
          }
          message.ssapPlaybackInfos.push(SsapPlaybackInfo.decode(reader, reader.uint32()));
          continue;
        }
        case 25: {
          if (tag !== 202) {
            break;
          }
          message.unusedBloatSizeBytes = reader.bytes();
          continue;
        }
        case 1e3: {
          if (tag !== 8002) {
            break;
          }
          message.field1000.push(UnknownMessage2.decode(reader, reader.uint32()));
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseUnknownMessage1() {
  return { formatId: void 0, lmt: "0", sequenceNumber: 0, timeRange: void 0, field5: 0 };
}
var UnknownMessage1 = {
  encode(message, writer = new BinaryWriter()) {
    if (message.formatId !== void 0) {
      FormatId.encode(message.formatId, writer.uint32(10).fork()).join();
    }
    if (message.lmt !== void 0 && message.lmt !== "0") {
      writer.uint32(16).sint64(message.lmt);
    }
    if (message.sequenceNumber !== void 0 && message.sequenceNumber !== 0) {
      writer.uint32(24).int32(message.sequenceNumber);
    }
    if (message.timeRange !== void 0) {
      TimeRange.encode(message.timeRange, writer.uint32(34).fork()).join();
    }
    if (message.field5 !== void 0 && message.field5 !== 0) {
      writer.uint32(40).int32(message.field5);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseUnknownMessage1();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatId = FormatId.decode(reader, reader.uint32());
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.lmt = reader.sint64().toString();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.sequenceNumber = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 34) {
            break;
          }
          message.timeRange = TimeRange.decode(reader, reader.uint32());
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.field5 = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseUnknownMessage2() {
  return { formatIds: [], ud: [], clipId: "" };
}
var UnknownMessage2 = {
  encode(message, writer = new BinaryWriter()) {
    for (const v of message.formatIds) {
      FormatId.encode(v, writer.uint32(10).fork()).join();
    }
    for (const v of message.ud) {
      BufferedRange.encode(v, writer.uint32(18).fork()).join();
    }
    if (message.clipId !== void 0 && message.clipId !== "") {
      writer.uint32(26).string(message.clipId);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseUnknownMessage2();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.formatIds.push(FormatId.decode(reader, reader.uint32()));
          continue;
        }
        case 2: {
          if (tag !== 18) {
            break;
          }
          message.ud.push(BufferedRange.decode(reader, reader.uint32()));
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.clipId = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/next_request_policy.js
function createBaseNextRequestPolicy() {
  return {
    targetAudioReadaheadMs: 0,
    targetVideoReadaheadMs: 0,
    maxTimeSinceLastRequestMs: 0,
    backoffTimeMs: 0,
    minAudioReadaheadMs: 0,
    minVideoReadaheadMs: 0,
    playbackCookie: void 0,
    videoId: ""
  };
}
var NextRequestPolicy = {
  encode(message, writer = new BinaryWriter()) {
    if (message.targetAudioReadaheadMs !== void 0 && message.targetAudioReadaheadMs !== 0) {
      writer.uint32(8).int32(message.targetAudioReadaheadMs);
    }
    if (message.targetVideoReadaheadMs !== void 0 && message.targetVideoReadaheadMs !== 0) {
      writer.uint32(16).int32(message.targetVideoReadaheadMs);
    }
    if (message.maxTimeSinceLastRequestMs !== void 0 && message.maxTimeSinceLastRequestMs !== 0) {
      writer.uint32(24).int32(message.maxTimeSinceLastRequestMs);
    }
    if (message.backoffTimeMs !== void 0 && message.backoffTimeMs !== 0) {
      writer.uint32(32).int32(message.backoffTimeMs);
    }
    if (message.minAudioReadaheadMs !== void 0 && message.minAudioReadaheadMs !== 0) {
      writer.uint32(40).int32(message.minAudioReadaheadMs);
    }
    if (message.minVideoReadaheadMs !== void 0 && message.minVideoReadaheadMs !== 0) {
      writer.uint32(48).int32(message.minVideoReadaheadMs);
    }
    if (message.playbackCookie !== void 0) {
      PlaybackCookie.encode(message.playbackCookie, writer.uint32(58).fork()).join();
    }
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(66).string(message.videoId);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseNextRequestPolicy();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.targetAudioReadaheadMs = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.targetVideoReadaheadMs = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.maxTimeSinceLastRequestMs = reader.int32();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.backoffTimeMs = reader.int32();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.minAudioReadaheadMs = reader.int32();
          continue;
        }
        case 6: {
          if (tag !== 48) {
            break;
          }
          message.minVideoReadaheadMs = reader.int32();
          continue;
        }
        case 7: {
          if (tag !== 58) {
            break;
          }
          message.playbackCookie = PlaybackCookie.decode(reader, reader.uint32());
          continue;
        }
        case 8: {
          if (tag !== 66) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_error.js
function createBaseSabrError() {
  return { type: "", code: 0 };
}
var SabrError = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== "") {
      writer.uint32(10).string(message.type);
    }
    if (message.code !== void 0 && message.code !== 0) {
      writer.uint32(16).int32(message.code);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrError();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.type = reader.string();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.code = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_redirect.js
function createBaseSabrRedirect() {
  return { url: "" };
}
var SabrRedirect = {
  encode(message, writer = new BinaryWriter()) {
    if (message.url !== void 0 && message.url !== "") {
      writer.uint32(10).string(message.url);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrRedirect();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.url = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_seek.js
function createBaseSabrSeek() {
  return { seekMediaTime: "0", seekMediaTimescale: 0, seekSource: 0 };
}
var SabrSeek = {
  encode(message, writer = new BinaryWriter()) {
    if (message.seekMediaTime !== void 0 && message.seekMediaTime !== "0") {
      writer.uint32(8).int64(message.seekMediaTime);
    }
    if (message.seekMediaTimescale !== void 0 && message.seekMediaTimescale !== 0) {
      writer.uint32(16).int32(message.seekMediaTimescale);
    }
    if (message.seekSource !== void 0 && message.seekSource !== 0) {
      writer.uint32(24).int32(message.seekSource);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrSeek();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.seekMediaTime = reader.int64().toString();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.seekMediaTimescale = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.seekSource = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/reload_player_response.js
function createBaseReloadPlaybackParams() {
  return { token: "" };
}
var ReloadPlaybackParams = {
  encode(message, writer = new BinaryWriter()) {
    if (message.token !== void 0 && message.token !== "") {
      writer.uint32(10).string(message.token);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseReloadPlaybackParams();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.token = reader.string();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};
function createBaseReloadPlaybackContext() {
  return { reloadPlaybackParams: void 0 };
}
var ReloadPlaybackContext = {
  encode(message, writer = new BinaryWriter()) {
    if (message.reloadPlaybackParams !== void 0) {
      ReloadPlaybackParams.encode(message.reloadPlaybackParams, writer.uint32(10).fork()).join();
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseReloadPlaybackContext();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.reloadPlaybackParams = ReloadPlaybackParams.decode(reader, reader.uint32());
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_context_update.js
var SabrContextUpdate_SabrContextWritePolicy = {
  UNSPECIFIED: 0,
  0: "UNSPECIFIED",
  OVERWRITE: 1,
  1: "OVERWRITE",
  KEEP_EXISTING: 2,
  2: "KEEP_EXISTING",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};
function createBaseSabrContextUpdate() {
  return { type: 0, scope: 0, value: new Uint8Array(0), sendByDefault: false, writePolicy: 0 };
}
var SabrContextUpdate = {
  encode(message, writer = new BinaryWriter()) {
    if (message.type !== void 0 && message.type !== 0) {
      writer.uint32(8).int32(message.type);
    }
    if (message.scope !== void 0 && message.scope !== 0) {
      writer.uint32(16).int32(message.scope);
    }
    if (message.value !== void 0 && message.value.length !== 0) {
      writer.uint32(26).bytes(message.value);
    }
    if (message.sendByDefault !== void 0 && message.sendByDefault !== false) {
      writer.uint32(32).bool(message.sendByDefault);
    }
    if (message.writePolicy !== void 0 && message.writePolicy !== 0) {
      writer.uint32(40).int32(message.writePolicy);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrContextUpdate();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.type = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.scope = reader.int32();
          continue;
        }
        case 3: {
          if (tag !== 26) {
            break;
          }
          message.value = reader.bytes();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.sendByDefault = reader.bool();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.writePolicy = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_context_sending_policy.js
function createBaseSabrContextSendingPolicy() {
  return { startPolicy: [], stopPolicy: [], discardPolicy: [] };
}
var SabrContextSendingPolicy = {
  encode(message, writer = new BinaryWriter()) {
    writer.uint32(10).fork();
    for (const v of message.startPolicy) {
      writer.int32(v);
    }
    writer.join();
    writer.uint32(18).fork();
    for (const v of message.stopPolicy) {
      writer.int32(v);
    }
    writer.join();
    writer.uint32(26).fork();
    for (const v of message.discardPolicy) {
      writer.int32(v);
    }
    writer.join();
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrContextSendingPolicy();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag === 8) {
            message.startPolicy.push(reader.int32());
            continue;
          }
          if (tag === 10) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.startPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 2: {
          if (tag === 16) {
            message.stopPolicy.push(reader.int32());
            continue;
          }
          if (tag === 18) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.stopPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
        case 3: {
          if (tag === 24) {
            message.discardPolicy.push(reader.int32());
            continue;
          }
          if (tag === 26) {
            const end2 = reader.uint32() + reader.pos;
            while (reader.pos < end2) {
              message.discardPolicy.push(reader.int32());
            }
            continue;
          }
          break;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/sabr_live_metadata.js
function createBaseSabrLiveMetadata() {
  return {
    broadcastId: "",
    headSequenceNumber: "0",
    headTimeMs: "0",
    wallTimeMs: "0",
    videoId: "",
    postLiveDvr: false,
    headm: "0",
    minSeekableTimeTicks: "0",
    minSeekableTimescale: 0,
    maxSeekableTimeTicks: "0",
    maxSeekableTimescale: 0
  };
}
var SabrLiveMetadata = {
  encode(message, writer = new BinaryWriter()) {
    if (message.broadcastId !== void 0 && message.broadcastId !== "") {
      writer.uint32(10).string(message.broadcastId);
    }
    if (message.headSequenceNumber !== void 0 && message.headSequenceNumber !== "0") {
      writer.uint32(24).int64(message.headSequenceNumber);
    }
    if (message.headTimeMs !== void 0 && message.headTimeMs !== "0") {
      writer.uint32(32).int64(message.headTimeMs);
    }
    if (message.wallTimeMs !== void 0 && message.wallTimeMs !== "0") {
      writer.uint32(40).int64(message.wallTimeMs);
    }
    if (message.videoId !== void 0 && message.videoId !== "") {
      writer.uint32(50).string(message.videoId);
    }
    if (message.postLiveDvr !== void 0 && message.postLiveDvr !== false) {
      writer.uint32(64).bool(message.postLiveDvr);
    }
    if (message.headm !== void 0 && message.headm !== "0") {
      writer.uint32(80).int64(message.headm);
    }
    if (message.minSeekableTimeTicks !== void 0 && message.minSeekableTimeTicks !== "0") {
      writer.uint32(96).int64(message.minSeekableTimeTicks);
    }
    if (message.minSeekableTimescale !== void 0 && message.minSeekableTimescale !== 0) {
      writer.uint32(104).int32(message.minSeekableTimescale);
    }
    if (message.maxSeekableTimeTicks !== void 0 && message.maxSeekableTimeTicks !== "0") {
      writer.uint32(112).int64(message.maxSeekableTimeTicks);
    }
    if (message.maxSeekableTimescale !== void 0 && message.maxSeekableTimescale !== 0) {
      writer.uint32(120).int32(message.maxSeekableTimescale);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseSabrLiveMetadata();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 10) {
            break;
          }
          message.broadcastId = reader.string();
          continue;
        }
        case 3: {
          if (tag !== 24) {
            break;
          }
          message.headSequenceNumber = reader.int64().toString();
          continue;
        }
        case 4: {
          if (tag !== 32) {
            break;
          }
          message.headTimeMs = reader.int64().toString();
          continue;
        }
        case 5: {
          if (tag !== 40) {
            break;
          }
          message.wallTimeMs = reader.int64().toString();
          continue;
        }
        case 6: {
          if (tag !== 50) {
            break;
          }
          message.videoId = reader.string();
          continue;
        }
        case 8: {
          if (tag !== 64) {
            break;
          }
          message.postLiveDvr = reader.bool();
          continue;
        }
        case 10: {
          if (tag !== 80) {
            break;
          }
          message.headm = reader.int64().toString();
          continue;
        }
        case 12: {
          if (tag !== 96) {
            break;
          }
          message.minSeekableTimeTicks = reader.int64().toString();
          continue;
        }
        case 13: {
          if (tag !== 104) {
            break;
          }
          message.minSeekableTimescale = reader.int32();
          continue;
        }
        case 14: {
          if (tag !== 112) {
            break;
          }
          message.maxSeekableTimeTicks = reader.int64().toString();
          continue;
        }
        case 15: {
          if (tag !== 120) {
            break;
          }
          message.maxSeekableTimescale = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/stream_protection_status.js
function createBaseStreamProtectionStatus() {
  return { status: 0, maxRetries: 0 };
}
var StreamProtectionStatus = {
  encode(message, writer = new BinaryWriter()) {
    if (message.status !== void 0 && message.status !== 0) {
      writer.uint32(8).int32(message.status);
    }
    if (message.maxRetries !== void 0 && message.maxRetries !== 0) {
      writer.uint32(16).int32(message.maxRetries);
    }
    return writer;
  },
  decode(input, length) {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === void 0 ? reader.len : reader.pos + length;
    const message = createBaseStreamProtectionStatus();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1: {
          if (tag !== 8) {
            break;
          }
          message.status = reader.int32();
          continue;
        }
        case 2: {
          if (tag !== 16) {
            break;
          }
          message.maxRetries = reader.int32();
          continue;
        }
      }
      if ((tag & 7) === 4 || tag === 0) {
        break;
      }
      reader.skip(tag & 7);
    }
    return message;
  }
};

// work/googlevideo-main2/protos/generated/video_streaming/ump_part_id.js
var UMPPartId = {
  UNKNOWN: 0,
  0: "UNKNOWN",
  ONESIE_HEADER: 10,
  10: "ONESIE_HEADER",
  ONESIE_DATA: 11,
  11: "ONESIE_DATA",
  ONESIE_ENCRYPTED_MEDIA: 12,
  12: "ONESIE_ENCRYPTED_MEDIA",
  MEDIA_HEADER: 20,
  20: "MEDIA_HEADER",
  MEDIA: 21,
  21: "MEDIA",
  MEDIA_END: 22,
  22: "MEDIA_END",
  CONFIG: 30,
  30: "CONFIG",
  LIVE_METADATA: 31,
  31: "LIVE_METADATA",
  HOSTNAME_CHANGE_HINT_DEPRECATED: 32,
  32: "HOSTNAME_CHANGE_HINT_DEPRECATED",
  LIVE_METADATA_PROMISE: 33,
  33: "LIVE_METADATA_PROMISE",
  LIVE_METADATA_PROMISE_CANCELLATION: 34,
  34: "LIVE_METADATA_PROMISE_CANCELLATION",
  NEXT_REQUEST_POLICY: 35,
  35: "NEXT_REQUEST_POLICY",
  USTREAMER_VIDEO_AND_FORMAT_METADATA: 36,
  36: "USTREAMER_VIDEO_AND_FORMAT_METADATA",
  FORMAT_SELECTION_CONFIG: 37,
  37: "FORMAT_SELECTION_CONFIG",
  USTREAMER_SELECTED_MEDIA_STREAM: 38,
  38: "USTREAMER_SELECTED_MEDIA_STREAM",
  FORMAT_INITIALIZATION_METADATA: 42,
  42: "FORMAT_INITIALIZATION_METADATA",
  SABR_REDIRECT: 43,
  43: "SABR_REDIRECT",
  SABR_ERROR: 44,
  44: "SABR_ERROR",
  SABR_SEEK: 45,
  45: "SABR_SEEK",
  RELOAD_PLAYER_RESPONSE: 46,
  46: "RELOAD_PLAYER_RESPONSE",
  PLAYBACK_START_POLICY: 47,
  47: "PLAYBACK_START_POLICY",
  ALLOWED_CACHED_FORMATS: 48,
  48: "ALLOWED_CACHED_FORMATS",
  START_BW_SAMPLING_HINT: 49,
  49: "START_BW_SAMPLING_HINT",
  PAUSE_BW_SAMPLING_HINT: 50,
  50: "PAUSE_BW_SAMPLING_HINT",
  SELECTABLE_FORMATS: 51,
  51: "SELECTABLE_FORMATS",
  REQUEST_IDENTIFIER: 52,
  52: "REQUEST_IDENTIFIER",
  REQUEST_CANCELLATION_POLICY: 53,
  53: "REQUEST_CANCELLATION_POLICY",
  ONESIE_PREFETCH_REJECTION: 54,
  54: "ONESIE_PREFETCH_REJECTION",
  TIMELINE_CONTEXT: 55,
  55: "TIMELINE_CONTEXT",
  REQUEST_PIPELINING: 56,
  56: "REQUEST_PIPELINING",
  SABR_CONTEXT_UPDATE: 57,
  57: "SABR_CONTEXT_UPDATE",
  STREAM_PROTECTION_STATUS: 58,
  58: "STREAM_PROTECTION_STATUS",
  SABR_CONTEXT_SENDING_POLICY: 59,
  59: "SABR_CONTEXT_SENDING_POLICY",
  LAWNMOWER_POLICY: 60,
  60: "LAWNMOWER_POLICY",
  SABR_ACK: 61,
  61: "SABR_ACK",
  END_OF_TRACK: 62,
  62: "END_OF_TRACK",
  CACHE_LOAD_POLICY: 63,
  63: "CACHE_LOAD_POLICY",
  LAWNMOWER_MESSAGING_POLICY: 64,
  64: "LAWNMOWER_MESSAGING_POLICY",
  PREWARM_CONNECTION: 65,
  65: "PREWARM_CONNECTION",
  PLAYBACK_DEBUG_INFO: 66,
  66: "PLAYBACK_DEBUG_INFO",
  SNACKBAR_MESSAGE: 67,
  67: "SNACKBAR_MESSAGE",
  NETWORK_TIMING: 68,
  68: "NETWORK_TIMING",
  CUEPOINT_LIST: 69,
  69: "CUEPOINT_LIST",
  STITCHED_REGIONS_OF_INTEREST: 70,
  70: "STITCHED_REGIONS_OF_INTEREST",
  STITCHED_SEGMENTS_METADATA_LIST: 71,
  71: "STITCHED_SEGMENTS_METADATA_LIST",
  PROBE_SUCCESS: 72,
  72: "PROBE_SUCCESS",
  UNRECOGNIZED: -1,
  "-1": "UNRECOGNIZED"
};

// work/googlevideo-main2/dist/utils/urlUtils.js
function getBroadcastId(url) {
  const idParam = url.searchParams.get("id");
  if (!idParam)
    return void 0;
  const parts = idParam.split(".");
  return parts.length === 2 ? parts[1] : void 0;
}
function getNextFallbackUrl(input) {
  const urlMod = input instanceof URL ? new URL(input.href) : new URL(input);
  const fvip = urlMod.searchParams.get("fvip");
  const mnRaw = urlMod.searchParams.get("mn");
  const fallbackCount = parseInt(urlMod.searchParams.get("fallback_count") ?? "0", 10);
  if (fvip && mnRaw) {
    const mn = mnRaw.split(",");
    const nextIndex = fallbackCount + 1;
    if (nextIndex < mn.length && mn[nextIndex]) {
      const nextNode = mn[nextIndex];
      const currentHost = urlMod.hostname;
      const suffix = currentHost.replace(/^[^.]*/, "");
      const prefix = currentHost.startsWith("rr") ? "rr" : "r";
      urlMod.hostname = `${prefix}${fvip}---${nextNode}${suffix}`;
      urlMod.searchParams.set("fallback_count", String(fallbackCount + 1));
      return urlMod;
    }
  }
  return void 0;
}

// work/googlevideo-main2/dist/utils/Track.js
var MAX_TRACKED_SEGMENTS = 64;
var Track = class {
  type;
  formatId;
  mimeType;
  endSegmentNum;
  endTimeTicks;
  endTimescale;
  targetDurationSec;
  trackedSegments = /* @__PURE__ */ new Map();
  bufferedRangeSummary;
  emsgSegmentMetadata;
  _output;
  constructor(type) {
    this.type = type;
  }
  set output(value) {
    this._output = value;
  }
  get output() {
    return this._output;
  }
  get streamLocked() {
    return this.output.stream.locked;
  }
  get streamDesiredSize() {
    return this.output.controller.desiredSize ?? 0;
  }
  get streamController() {
    return this.output.controller;
  }
  get streamFull() {
    return this.streamLocked && this.streamDesiredSize <= 0;
  }
  get endTimeMs() {
    if (this.endTimeTicks === void 0 || this.endTimescale === void 0)
      return 0;
    return ticksToMs(this.endTimeTicks, this.endTimescale, Math.ceil);
  }
  get endOfStreamReached() {
    return this.endSegmentNum !== void 0 && this.endSegmentNum > 0 && this.trackedSegments.has(this.endSegmentNum);
  }
  get latencyMs() {
    return this.emsgSegmentMetadata?.latencyMs ?? 0;
  }
  update(state) {
    if ("formatId" in state)
      this.formatId = state.formatId;
    if ("mimeType" in state)
      this.mimeType = state.mimeType;
    if ("endSegmentNum" in state)
      this.endSegmentNum = state.endSegmentNum;
    if ("endTimeTicks" in state)
      this.endTimeTicks = state.endTimeTicks;
    if ("endTimescale" in state)
      this.endTimescale = state.endTimescale;
    if ("targetDurationSec" in state)
      this.targetDurationSec = state.targetDurationSec;
    if ("trackedSegments" in state)
      this.trackedSegments = new Map(state.trackedSegments);
    if ("bufferedRangeSummary" in state)
      this.bufferedRangeSummary = state.bufferedRangeSummary;
  }
  snapshot() {
    return {
      formatId: this.formatId,
      mimeType: this.mimeType,
      endSegmentNum: this.endSegmentNum,
      endTimeTicks: this.endTimeTicks,
      endTimescale: this.endTimescale,
      targetDurationSec: this.targetDurationSec,
      trackedSegments: Array.from(this.trackedSegments.entries() || []),
      bufferedRangeSummary: this.bufferedRangeSummary
    };
  }
  recordCompletedSegment(info, emsgMetadata) {
    let durationMs = info.durationMs;
    if (durationMs <= 0 && !info.mediaHeader.isInitializationSegment)
      durationMs = this.targetDurationSec ? this.targetDurationSec * 1e3 : void 0;
    if (emsgMetadata) {
      this.emsgSegmentMetadata = emsgMetadata;
      if (emsgMetadata.targetDurationSec > 0)
        durationMs = emsgMetadata.targetDurationSec * 1e3;
    }
    assertIsDefined(durationMs, `Track is missing durationMs: formatKey=${info.formatKey}, segmentNumber=${info.segmentNumber}`);
    const segmentNumber = info.segmentNumber;
    const mediaHeader = info.mediaHeader;
    const startTimeMs = info.startTimeMs;
    const endTimeMs = startTimeMs + durationMs;
    this.trackedSegments.set(segmentNumber, {
      segmentNumber,
      startTimeMs,
      endTimeMs,
      durationMs,
      mediaHeader
    });
    this.evictOldestTrackedSegments();
    this.refreshBufferedRanges();
  }
  refreshBufferedRanges() {
    let first;
    let last;
    for (const segment of this.trackedSegments.values()) {
      if (segment.mediaHeader.isInitializationSegment)
        continue;
      if (!first || segment.segmentNumber < first.segmentNumber)
        first = segment;
      if (!last || segment.segmentNumber > last.segmentNumber)
        last = segment;
    }
    if (!first || !last) {
      this.bufferedRangeSummary = void 0;
      return;
    }
    this.bufferedRangeSummary = {
      startTimeMs: first.startTimeMs,
      durationMs: Math.max(0, last.endTimeMs - first.startTimeMs),
      startSegmentIndex: first.segmentNumber,
      endSegmentIndex: last.segmentNumber
    };
  }
  evictOldestTrackedSegments() {
    while (this.trackedSegments.size > MAX_TRACKED_SEGMENTS) {
      const oldestKey = this.trackedSegments.keys().next().value;
      if (oldestKey === void 0)
        break;
      this.trackedSegments.delete(oldestKey);
    }
  }
};

// work/googlevideo-main2/dist/utils/TrackCollection.js
var TrackCollection = class {
  video = new Track("video");
  audio = new Track("audio");
  initializedTracksMap = /* @__PURE__ */ new Map();
  get needsDrain() {
    return this.video.streamFull || this.audio.streamFull;
  }
  get buffered() {
    let bufferedUntil = Infinity;
    for (const track of this.initializedTracks) {
      const summary = track.bufferedRangeSummary;
      if (!summary)
        return 0;
      bufferedUntil = Math.min(bufferedUntil, summary.startTimeMs + summary.durationMs);
    }
    return bufferedUntil;
  }
  get bufferedRanges() {
    const ranges = [];
    for (const track of this.initializedTracks) {
      const summary = track.bufferedRangeSummary;
      if (!summary)
        continue;
      ranges.push({
        formatId: track.formatId,
        startTimeMs: summary.startTimeMs === 0 ? "" : String(summary.startTimeMs),
        durationMs: String(summary.durationMs),
        startSegmentIndex: summary.startSegmentIndex,
        endSegmentIndex: summary.endSegmentIndex,
        timeRange: {
          startTicks: String(summary.startTimeMs),
          durationTicks: String(summary.durationMs),
          timescale: 1e3
        }
      });
    }
    return ranges;
  }
  get initializedTracks() {
    return this.initializedTracksMap.values();
  }
  get initializationFormatIds() {
    const formatIds = [];
    if (this.video.formatId)
      formatIds.push(this.video.formatId);
    if (this.audio.formatId)
      formatIds.push(this.audio.formatId);
    return formatIds;
  }
  get livePlaybackLatencyMs() {
    const videoLatency = this.video.latencyMs;
    const audioLatency = this.audio.latencyMs;
    if (!videoLatency && !audioLatency)
      return;
    return Math.max(videoLatency, audioLatency);
  }
  initialize(type, metadata) {
    this[type].update(metadata);
    if ("formatId" in metadata && metadata.formatId !== void 0)
      this.initializedTracksMap.set(createFormatKey(metadata.formatId), this[type]);
  }
  getInitializedTrack(formatKey) {
    return this.initializedTracksMap.get(formatKey);
  }
  endOfStreamReached(enabledTrackTypes) {
    const videoEndOfStreamReached = this.video.endOfStreamReached;
    const audioEndOfStreamReached = this.audio.endOfStreamReached;
    return videoEndOfStreamReached && audioEndOfStreamReached || enabledTrackTypes === EnabledTrackTypes.VIDEO_ONLY && videoEndOfStreamReached || enabledTrackTypes === EnabledTrackTypes.AUDIO_ONLY && audioEndOfStreamReached;
  }
  snapshot() {
    const trackStates = [];
    for (const initializedTrack of this.initializedTracksMap.values())
      trackStates.push(initializedTrack.snapshot());
    return trackStates;
  }
  error(err) {
    const errorInstance = typeof err === "string" ? new Error(err) : err;
    this.video.streamController.error(errorInstance);
    this.audio.streamController.error(errorInstance);
  }
  close() {
    this.video.streamController.close();
    this.audio.streamController.close();
  }
};

// work/googlevideo-main2/dist/core/SabrStream.js
var TAG2 = "SabrStream";
var MAX_STALLS = 3;
var DEFAULT_MAX_RETRIES = 10;
var DEFAULT_STALL_DETECTION_MS = 3e4;
var REQUEST_TIMEOUT_MS = 3e4;
var INITIAL_RETRY_BACKOFF_MS = 500;
var MAX_RETRY_BACKOFF_MS = 5e3;
var OFFLINE_GRACE_PERIOD_MS = 15e3;
var DEFAULT_HEARTBEAT_INTERVAL_MS = 1e4;
var LIVE_EDGE_SENTINEL_MS = Number.MAX_SAFE_INTEGER;
var DEFAULT_VIDEO_HWM = 1024 * 1024 * 16;
var DEFAULT_AUDIO_HWM = 1024 * 1024 * 3;
var BANDWIDTH_EMA_PREVIOUS_WEIGHT = 0.8;
var BANDWIDTH_EMA_CURRENT_WEIGHT = 0.2;
var MIN_FETCH_DURATION_FOR_BW_ESTIMATE_MS = 50;
var SabrStream = class extends EventEmitterLike {
  logger = Logger.getInstance();
  segmentBuffer;
  formatIds = [];
  fetchFunction;
  abortController;
  requestTimeoutId;
  serverAbrStreamingUrl;
  videoPlaybackUstreamerConfig;
  clientInfo;
  proofOfOriginToken;
  heartbeatParams;
  nextRequestPolicy;
  ssapPlaybackInfos = /* @__PURE__ */ new Map();
  sabrContextUpdates = /* @__PURE__ */ new Map();
  activeSabrContextTypes = /* @__PURE__ */ new Set();
  trackCollection = new TrackCollection();
  videoId;
  broadcastId;
  playerTimeMs = 0;
  requestNumber = 0;
  bandwidthEstimateBps = 0;
  lastHeartbeatTimeMs = 0;
  playbackSessionStartMs;
  poTokenGenerationId = 0;
  spsRejectCount = 0;
  idleResolvers = [];
  drainResolver;
  shouldStop = false;
  isMintingPoToken = false;
  _isLive = false;
  _errored = false;
  _aborted = false;
  _isBusy = false;
  progressTracker = {
    lastProgressTime: Date.now(),
    lastBufferedTimeMs: 0,
    stallCount: 0
  };
  callbacks;
  constructor(config) {
    super();
    this.fetchFunction = config.fetchFunction || fetch;
    this.videoId = config.videoId;
    this.formatIds = config.formats || [];
    this.clientInfo = config.clientInfo;
    this.videoPlaybackUstreamerConfig = config.videoPlaybackUstreamerConfig;
    this.proofOfOriginToken = config.poToken ? base64ToU8(config.poToken) : void 0;
    this.heartbeatParams = config.heartbeatParams || {};
    this.callbacks = config.callbacks || {};
    this.setStreamingURL(config.serverAbrStreamingUrl);
    this._isLive = ["yt_premiere_broadcast", "yt_live_broadcast"].includes(this.streamingURL.searchParams.get("source") || "");
    this.broadcastId = this._isLive ? getBroadcastId(this.streamingURL) : void 0;
    this.trackCollection.video.output = this.createTrackStream(config.videoHighWaterMark ?? DEFAULT_VIDEO_HWM);
    this.trackCollection.audio.output = this.createTrackStream(config.audioHighWaterMark ?? DEFAULT_AUDIO_HWM);
    this.segmentBuffer = new SabrSegmentBuffer(this.trackCollection, this._isLive, config.stripDuplicateInit);
  }
  //#region Public API
  get isBusy() {
    return this._isBusy;
  }
  get isLive() {
    return this._isLive;
  }
  get isAborted() {
    return this._aborted;
  }
  get isErrored() {
    return this._errored;
  }
  get videoEndTimeMs() {
    return this.trackCollection.video.endTimeMs;
  }
  get audioEndTimeMs() {
    return this.trackCollection.audio.endTimeMs;
  }
  get livePlaybackLatencyMs() {
    if (!this._isLive)
      return;
    return this.trackCollection.livePlaybackLatencyMs;
  }
  get streamingURL() {
    assertIsDefined(this.serverAbrStreamingUrl, "Streaming URL is not set");
    return this.serverAbrStreamingUrl;
  }
  setStreamingURL(url) {
    this.serverAbrStreamingUrl = url instanceof URL ? url : new URL(url);
    this.serverAbrStreamingUrl.searchParams.set("alr", "no");
    this.validateStreamingUrl(this.serverAbrStreamingUrl);
  }
  setUstreamerConfig(config) {
    this.videoPlaybackUstreamerConfig = config;
  }
  async waitForIdle() {
    if (this._isBusy)
      await new Promise((resolve) => this.idleResolvers.push(resolve));
  }
  async snapshot() {
    await this.waitForIdle();
    return {
      playerTimeMs: this.playerTimeMs,
      tracks: this.trackCollection.snapshot()
    };
  }
  async abort(options = {}) {
    let snapshotData;
    if (options.snapshot)
      snapshotData = await this.snapshot();
    this.emit("abort");
    this._aborted = true;
    this.abortController?.abort();
    this.trackCollection.error("Stream aborted");
    this.drainResolver?.();
    this.drainResolver = void 0;
    return snapshotData;
  }
  start(options) {
    assert(this.playbackSessionStartMs === void 0, "This stream instance has already been started and cannot be reused");
    const { videoFormat, audioFormat } = this.selectFormats(options);
    this.setupStreaming(options, audioFormat, videoFormat).catch(() => {
    });
    return {
      videoStream: this.trackCollection.video.output.stream,
      audioStream: this.trackCollection.audio.output.stream,
      selectedFormats: { videoFormat, audioFormat }
    };
  }
  //#endregion
  //#region Internal
  createTrackStream(highWaterMark) {
    let controller;
    const stream = new ReadableStream({
      start: (c) => controller = c,
      pull: () => this.notifyDrain(),
      cancel: (reason) => {
        this.logger.debug(TAG2, `Stream cancelled by consumer. Reason: ${reason || "N/A"}`);
        this.abort().catch(() => {
        });
      }
    }, new ByteLengthQueuingStrategy({ highWaterMark }));
    return { stream, controller };
  }
  notifyDrain() {
    if (!this.trackCollection.needsDrain && this.drainResolver) {
      this.drainResolver();
      this.drainResolver = void 0;
    }
  }
  waitForDrain() {
    if (!this.trackCollection.needsDrain)
      return Promise.resolve();
    this.logger.debug(TAG2, "Waiting for drain");
    return new Promise((resolve) => this.drainResolver = resolve);
  }
  validateStreamingUrl(url) {
    const broadcastId = getBroadcastId(url);
    if (broadcastId)
      this.validateBroadcastId(broadcastId);
  }
  validateBroadcastId(bid) {
    if (this._isLive && (!!this.broadcastId && this.broadcastId !== bid)) {
      this.logger.warn(TAG2, `Broadcast ID changed from ${this.broadcastId} to ${bid}. Stopping.`);
      this.shouldStop = true;
    }
  }
  selectFormats(options) {
    const audioOnly = options.enabledTrackTypes === EnabledTrackTypes.AUDIO_ONLY;
    const needsVideo = !audioOnly;
    const hasAudioSpecs = !!(options.audioFormat || options.audioPreferences);
    const hasVideoSpecs = !!(options.videoFormat || options.videoPreferences);
    if (audioOnly)
      assert(hasAudioSpecs, "Expected audio format or preferences to be provided");
    else
      assert(hasAudioSpecs && hasVideoSpecs, "Expected video and/or audio format or preferences to be provided");
    const audioFormat = chooseFormat(this.formatIds, options.audioFormat, {
      isAudio: true,
      ...options.audioPreferences
    });
    const videoFormat = needsVideo ? chooseFormat(this.formatIds, options.videoFormat, {
      isAudio: false,
      ...options.videoPreferences
    }) : void 0;
    const missing = [];
    if (needsVideo && !videoFormat)
      missing.push(describeMissingFormat("video", options.videoFormat, this.formatIds));
    if (!audioFormat)
      missing.push(describeMissingFormat("audio", options.audioFormat, this.formatIds));
    if (missing.length > 0)
      throw new Error(`Could not select formats: ${missing.join("; ")}`);
    assertIsDefined(audioFormat, "Expected selected audio format");
    return { videoFormat, audioFormat };
  }
  async setupStreaming(options, audioFormat, videoFormat) {
    try {
      this.logger.debug(TAG2, `Starting SABR stream: videoFormat=${videoFormat?.itag ?? "n/a"}, audioFormat=${audioFormat.itag}, isLive=${this._isLive}, isPostLiveDvr=${options.isPostLiveDvr}`);
      this.tryMintPoToken();
      const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
      const enabledTrackTypesBitfield = options.enabledTrackTypes ?? EnabledTrackTypes.VIDEO_AND_AUDIO;
      if (options.snapshot && options.snapshot.tracks.length > 0) {
        const snapshot = options.snapshot;
        if (videoFormat)
          assert(snapshot.tracks.some((track) => createFormatKey(track) === createFormatKey(videoFormat)), "The selected video format does not match any format in the provided snapshot");
        assertIsDefined(snapshot.tracks.some((track) => createFormatKey(track) === createFormatKey(audioFormat)), "The selected audio format does not match any format in the provided snapshot");
        for (const state of snapshot.tracks)
          this.trackCollection.initialize(getMediaType(state), state);
        this.seekTo(snapshot.playerTimeMs, "client");
      } else
        this.seekTo(options.startTimeMs ?? (this._isLive && !options.isPostLiveDvr ? LIVE_EDGE_SENTINEL_MS : 0), "client");
      const abrState = {
        playerTimeMs: this.playerTimeMs.toString(),
        audioTrackId: audioFormat?.audioTrackId,
        clientViewportIsFlexible: false,
        drcEnabled: audioFormat?.isVb ? false : audioFormat?.isDrc ?? false,
        enableVoiceBoost: audioFormat?.isVb,
        stickyResolution: videoFormat?.height,
        elapsedWallTimeMs: "0",
        timeSinceLastActionMs: "0",
        timeSinceLastSeek: "0",
        playbackRate: 1,
        visibility: 1,
        enabledTrackTypesBitfield
      };
      this.playbackSessionStartMs = Date.now();
      while (!this.shouldStop) {
        if (this._aborted) {
          this.logger.debug(TAG2, "Stream aborted");
          break;
        }
        const elapsedTimeMs = this.getElapsedWallTimeMs().toString();
        abrState.timeSinceLastSeek = elapsedTimeMs;
        abrState.timeSinceLastActionMs = elapsedTimeMs;
        abrState.elapsedWallTimeMs = elapsedTimeMs;
        if (this.bandwidthEstimateBps > 0)
          abrState.bandwidthEstimate = Math.round(this.bandwidthEstimateBps).toString();
        this.logger.debug(TAG2, `Starting new segment fetch, playerTimeMs=${abrState.playerTimeMs}, bandwidthEstimate=${abrState.bandwidthEstimate ?? "n/a"}, elapsedWallTimeMs=${abrState.elapsedWallTimeMs}`);
        this.checkForStall(options.stallDetectionMs);
        const success = await this.executeWithRetry(() => this.fetchAndProcess(abrState, audioFormat, videoFormat), maxRetries);
        abrState.playerTimeMs = this.playerTimeMs.toString();
        if (this.trackCollection.endOfStreamReached(enabledTrackTypesBitfield))
          this.shouldStop = true;
        if (this._isLive)
          this.heartbeat().then();
        if (!success)
          break;
      }
    } catch (error) {
      if (!this._aborted)
        this.errorHandler(error);
    } finally {
      if (!this._aborted && !this._errored) {
        this.trackCollection.close();
        this.emit("finish");
      }
      this.reset();
    }
  }
  async heartbeat() {
    const heartbeatParams = this.heartbeatParams;
    const heartbeatCallback = this.callbacks.onCheckHeartbeat;
    if (!heartbeatCallback || !this.videoId)
      return;
    const intervalMs = heartbeatParams.intervalMilliseconds !== void 0 ? parseInt(heartbeatParams.intervalMilliseconds, 10) : DEFAULT_HEARTBEAT_INTERVAL_MS;
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatTimeMs;
    if (timeSinceLastHeartbeat < intervalMs)
      return;
    try {
      this.lastHeartbeatTimeMs = Date.now();
      const heartbeatBody = {
        heartbeatRequestParams: {
          heartbeatChecks: ["HEARTBEAT_CHECK_TYPE_LIVE_STREAM_STATUS"]
        },
        videoId: this.videoId
      };
      if ("heartbeatToken" in heartbeatParams)
        heartbeatBody.heartbeatToken = heartbeatParams.heartbeatToken;
      if ("heartbeatServerData" in heartbeatParams)
        heartbeatBody.heartbeatServerData = heartbeatParams.heartbeatServerData;
      const response = await heartbeatCallback(heartbeatBody);
      if (this.shouldStop)
        return;
      if ("heartbeatServerData" in response)
        this.heartbeatParams.heartbeatServerData = response.heartbeatServerData;
      if ("broadcastId" in response && response.broadcastId !== void 0)
        this.validateBroadcastId(response.broadcastId);
      if (response.status === "OK") {
        this.logger.debug(TAG2, "Live stream is online");
        return;
      }
      if (response.status === "LIVE_STREAM_OFFLINE") {
        if (response.offlineSlatePresent && !response.displayEndscreen) {
          this.logger.debug(TAG2, "Live stream is offline but not displaying end screen. Continuing.");
        } else if (response.displayEndscreen || response.offlineSlateButtonsPresent) {
          const elapsedTimeSinceLastProgress = Date.now() - this.progressTracker.lastProgressTime;
          if (elapsedTimeSinceLastProgress > OFFLINE_GRACE_PERIOD_MS) {
            this.logger.debug(TAG2, `Heartbeat check indicates live stream is offline and no activity for ${elapsedTimeSinceLastProgress}ms. Stopping stream.`);
            this.shouldStop = true;
          } else {
            this.logger.debug(TAG2, `Heartbeat check indicates live stream is offline, but progress was made ${elapsedTimeSinceLastProgress}ms ago. Continuing.`);
          }
        }
      }
    } catch (error) {
      this.logger.error(TAG2, "Heartbeat check failed:", error.message);
    }
  }
  reset() {
    this.sabrContextUpdates.clear();
    this.ssapPlaybackInfos.clear();
    this.activeSabrContextTypes.clear();
    this.segmentBuffer.reset();
    this.abortController = void 0;
    this.nextRequestPolicy = void 0;
    this.spsRejectCount = 0;
    this.playerTimeMs = 0;
    this.requestNumber = 0;
    this.bandwidthEstimateBps = 0;
    this.isMintingPoToken = false;
    this.resetProgressTracker(0);
    this.clearRequestTimeout();
    this.setBusyState(false);
  }
  getElapsedWallTimeMs() {
    if (this.playbackSessionStartMs === void 0)
      return 0;
    return Date.now() - this.playbackSessionStartMs;
  }
  checkForStall(stallDetectionMs) {
    if (this._isLive && this.playerTimeMs === LIVE_EDGE_SENTINEL_MS)
      return;
    const currentTime = Date.now();
    const stallThreshold = stallDetectionMs ?? DEFAULT_STALL_DETECTION_MS;
    if (currentTime - this.progressTracker.lastProgressTime > stallThreshold) {
      this.progressTracker.stallCount++;
      this.logger.warn(TAG2, `Stream stalled for ${stallThreshold}ms (stall #${this.progressTracker.stallCount})`);
      if (this.progressTracker.stallCount >= MAX_STALLS) {
        if (this._isLive) {
          this.logger.warn(TAG2, "Live stream stalled. Assuming end of stream and stopping download");
          this.shouldStop = true;
        } else
          throw new Error(`Stream stalled ${MAX_STALLS} times. Aborting`);
      }
      this.progressTracker.lastProgressTime = currentTime;
    }
  }
  async executeWithRetry(fetchFn, maxRetries) {
    const backoffTimeMs = this.nextRequestPolicy?.backoffTimeMs || 0;
    if (backoffTimeMs > 0) {
      this.logger.debug(TAG2, `Backing off for ${backoffTimeMs}ms before next request`);
      await wait(backoffTimeMs);
    }
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (this._aborted) {
        this.logger.debug(TAG2, "Abort requested, preventing new requests");
        return false;
      }
      try {
        this.setBusyState(true);
        await fetchFn();
        this.setBusyState(false);
        return true;
      } catch (e) {
        this.setBusyState(false);
        const error = e;
        if (this._aborted) {
          this.logger.debug(TAG2, "Abort requested, not retrying fetch");
          return false;
        }
        if (attempt > maxRetries) {
          this.logger.error(TAG2, `Retries exhausted while fetching segment: ${error.message}`);
          this.errorHandler(error);
          break;
        }
        const retryBackoffMs = Math.min(INITIAL_RETRY_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_RETRY_BACKOFF_MS);
        this.logger.warn(TAG2, `Segment fetch attempt ${attempt}/${maxRetries} failed - retrying in ${retryBackoffMs}ms`, error);
        await wait(retryBackoffMs);
      }
    }
    return false;
  }
  setBusyState(isBusy) {
    this._isBusy = isBusy;
    if (!isBusy) {
      this.idleResolvers.forEach((resolve) => resolve());
      this.idleResolvers = [];
    }
  }
  errorHandler(err) {
    this._errored = true;
    this.trackCollection.error(err);
    this.emit("error", err);
  }
  async fetchAndProcess(abrState, selectedAudioFormat, selectedVideoFormat) {
    const requestPoTokenGeneration = this.poTokenGenerationId;
    const requestBody = this.buildRequestBody(abrState, selectedAudioFormat, selectedVideoFormat);
    const response = await this.makeStreamingRequest(requestBody);
    const contentType = response.headers.get("content-type");
    if (response.status === 403 && this.hasExpired())
      await this.tryReloadStreamingData();
    assert(response.ok, `Server returned ${response.status} ${response.statusText}`);
    assert(contentType === "application/vnd.yt-ump", `Unexpected content type from server: ${contentType}`);
    assertIsDefined(response.body, "Response body is null");
    const startTime = performance.now();
    const reader = response.body.getReader();
    let serverSeek = false;
    let bytesDownloaded = 0;
    const umpReader = new UmpReader({
      onPart: async (type, data) => {
        switch (type) {
          case UMPPartId.SABR_ERROR: {
            const sabrError = decodePart(data.chunks, SabrError);
            if (!sabrError)
              break;
            throw new Error(`SABR Error: ${sabrError.type} - ${sabrError.code}`);
          }
          case UMPPartId.FORMAT_INITIALIZATION_METADATA: {
            const formatInitializationMetadata = decodePart(data.chunks, FormatInitializationMetadata);
            if (!formatInitializationMetadata)
              break;
            if (this.videoId !== formatInitializationMetadata.videoId) {
              this.logger.warn(TAG2, `Video ID mismatch: expected ${this.videoId}, got ${formatInitializationMetadata.videoId}. Ignoring format initialization metadata.`);
              return;
            }
            if (!this.trackCollection.initializedTracksMap.has(createFormatKey(formatInitializationMetadata))) {
              const formatType = getMediaType(formatInitializationMetadata);
              const selectedFormat = formatType === "video" ? selectedVideoFormat : selectedAudioFormat;
              this.trackCollection.initialize(formatType, {
                formatId: formatInitializationMetadata.formatId,
                mimeType: formatInitializationMetadata.mimeType,
                endTimeTicks: parseInt(formatInitializationMetadata.endTimeTicks || "0"),
                endTimescale: parseInt(formatInitializationMetadata.endTimeTimescale || "1000"),
                endSegmentNum: parseInt(formatInitializationMetadata.endSegmentNum || "0"),
                targetDurationSec: selectedFormat?.targetDurationSec
                // @NOTE: Not a requirement. We always get it from the EMSG box anyway.
              });
              this.logger.debug(TAG2, `Initialized format: itag=${formatInitializationMetadata.formatId?.itag}, mimeType=${formatInitializationMetadata.mimeType}`);
              this.emit("formatInitialization", this.trackCollection[formatType]);
            }
            break;
          }
          case UMPPartId.MEDIA_HEADER: {
            const mediaHeader = decodePart(data.chunks, MediaHeader);
            if (!mediaHeader)
              break;
            if (this.videoId !== mediaHeader.videoId) {
              this.logger.warn(TAG2, `Video ID mismatch: expected ${this.videoId}, got ${mediaHeader.videoId}. Ignoring media header.`);
              break;
            }
            this.logger.debug(TAG2, `Received media header: headerId=${mediaHeader.headerId}, itag=${mediaHeader.itag}, segmentNum=${mediaHeader.segmentNum}, startMs=${mediaHeader.startMs}, durationMs=${mediaHeader.durationMs}, segmentLengthBytes=${mediaHeader.segmentLengthBytes}`);
            this.segmentBuffer.queueMediaHeader(mediaHeader);
            break;
          }
          case UMPPartId.MEDIA: {
            const headerId = data.getUint8(0);
            const dataBuffer = data.split(1).remainingBuffer;
            this.segmentBuffer.appendMediaData(headerId, dataBuffer.chunks);
            break;
          }
          case UMPPartId.MEDIA_END: {
            const headerId = data.getUint8(0);
            if (this.segmentBuffer.finalizeSegment(headerId)) {
              this.recordProgress(this.trackCollection.buffered);
              this.logger.debug(TAG2, `Finalized segment: headerId=${headerId}`);
              this.emit("trackStateUpdate", this.trackCollection);
            }
            break;
          }
          case UMPPartId.LIVE_METADATA: {
            const sabrLiveMetadata = decodePart(data.chunks, SabrLiveMetadata);
            if (!sabrLiveMetadata)
              break;
            const broadcastId = sabrLiveMetadata.broadcastId;
            if (broadcastId)
              this.validateBroadcastId(broadcastId);
            this.emit("liveMetadataUpdate", sabrLiveMetadata);
            break;
          }
          case UMPPartId.SABR_SEEK: {
            const sabrSeek = decodePart(data.chunks, SabrSeek);
            if (!sabrSeek)
              break;
            if (sabrSeek.seekSource === SeekSource.SABR_SEEK_TO_HEAD) {
              const seekTimeMs = ticksToMs(parseInt(sabrSeek.seekMediaTime || "0"), sabrSeek.seekMediaTimescale || 1e3, Math.floor);
              this.seekTo(seekTimeMs, "server");
              this.resetProgressTracker(seekTimeMs);
              this.ssapPlaybackInfos.clear();
              serverSeek = true;
            }
            break;
          }
          case UMPPartId.CUEPOINT_LIST: {
            const cuepointList = decodePart(data.chunks, CuepointList);
            if (!(cuepointList && "ssapInfos" in cuepointList))
              break;
            for (const info of cuepointList.ssapInfos) {
              const cuepoint = info.cuepoint;
              const cuepointId = cuepoint?.identifier || "";
              const timeRange = info.timeRange;
              if (!cuepoint || !timeRange)
                continue;
              if (cuepoint.event === Cuepoint_CuepointEvent.STOP) {
                this.ssapPlaybackInfos.delete(cuepointId);
                this.logger.debug(TAG2, `Removed cuepoint: identifier=${cuepointId}`);
              } else {
                if (this.ssapPlaybackInfos.has(cuepointId))
                  continue;
                const timescale = timeRange.timescale || 1e3;
                const startTicks = parseInt(timeRange.startTicks || "0");
                const startTimeMs = String(Math.floor(ticksToMs(startTicks, timescale, Math.floor) - (cuepoint.playheadTimeSec ?? 0) * 1e3));
                const durationMs = String((cuepoint.totalDurationSec ?? 0) * 1e3);
                this.ssapPlaybackInfos.set(cuepointId, {
                  adCpns: [],
                  cuepointId,
                  startTimeMs,
                  durationMs,
                  state: SsapPlaybackInfo_AdState.RATECONTROL_CLIENT
                });
                this.logger.debug(TAG2, `Added new cuepoint: cuepointId=${cuepointId}, startTimeMs=${startTimeMs}, durationMs=${durationMs}`);
              }
            }
            break;
          }
          case UMPPartId.SABR_CONTEXT_UPDATE: {
            const contextUpdate = decodePart(data.chunks, SabrContextUpdate);
            if (!contextUpdate || contextUpdate.type === void 0 || !contextUpdate.value?.length)
              break;
            if (contextUpdate.writePolicy === SabrContextUpdate_SabrContextWritePolicy.KEEP_EXISTING && this.sabrContextUpdates.has(contextUpdate.type))
              break;
            this.sabrContextUpdates.set(contextUpdate.type, contextUpdate);
            if (contextUpdate.sendByDefault)
              this.activeSabrContextTypes.add(contextUpdate.type);
            break;
          }
          case UMPPartId.SABR_CONTEXT_SENDING_POLICY: {
            const contextSendingPolicy = decodePart(data.chunks, SabrContextSendingPolicy);
            if (!contextSendingPolicy)
              break;
            for (const startPolicy of contextSendingPolicy.startPolicy) {
              if (!this.activeSabrContextTypes.has(startPolicy)) {
                this.activeSabrContextTypes.add(startPolicy);
                this.logger.debug(TAG2, `Activated SABR context: type=${startPolicy}`);
              }
            }
            for (const stopPolicy of contextSendingPolicy.stopPolicy) {
              if (this.activeSabrContextTypes.has(stopPolicy)) {
                this.activeSabrContextTypes.delete(stopPolicy);
                this.logger.debug(TAG2, `Deactivated SABR context: type=${stopPolicy}`);
              }
            }
            for (const discardPolicy of contextSendingPolicy.discardPolicy) {
              if (this.sabrContextUpdates.has(discardPolicy)) {
                this.sabrContextUpdates.delete(discardPolicy);
                this.logger.debug(TAG2, `Discarded SABR context: type=${discardPolicy}`);
              }
            }
            break;
          }
          case UMPPartId.NEXT_REQUEST_POLICY: {
            this.nextRequestPolicy = decodePart(data.chunks, NextRequestPolicy);
            break;
          }
          case UMPPartId.STREAM_PROTECTION_STATUS: {
            const streamProtectionStatus = decodePart(data.chunks, StreamProtectionStatus);
            if (!streamProtectionStatus || !streamProtectionStatus.status)
              break;
            this.emit("streamProtectionStatusUpdate", streamProtectionStatus);
            if (requestPoTokenGeneration !== this.poTokenGenerationId)
              break;
            const status = streamProtectionStatus.status;
            const reject = status === 3;
            const pending = status === 2;
            const maxRetries = streamProtectionStatus.maxRetries || 5;
            assert(this.spsRejectCount < maxRetries, `Stream protection attestation rejected after ${this.spsRejectCount} attempts`);
            if ((reject || pending) && !this.isMintingPoToken) {
              this.logger.warn(TAG2, reject ? `Stream protection attestation rejected: attempt ${this.spsRejectCount} of ${maxRetries}` : "Stream protection attestation pending");
              if (reject)
                this.spsRejectCount += 1;
              this.tryMintPoToken();
            }
            break;
          }
          case UMPPartId.SABR_REDIRECT: {
            const sabrRedirect = decodePart(data.chunks, SabrRedirect);
            if (!sabrRedirect || !sabrRedirect.url)
              break;
            this.setStreamingURL(sabrRedirect.url);
            this.logger.debug(TAG2, `Received SABR redirect: newUrl=${sabrRedirect.url}`);
            break;
          }
          case UMPPartId.RELOAD_PLAYER_RESPONSE: {
            const reloadPlaybackContext = decodePart(data.chunks, ReloadPlaybackContext);
            if (!reloadPlaybackContext)
              break;
            this.logger.debug(TAG2, `Reload requested: reloadPlaybackParams=${reloadPlaybackContext.reloadPlaybackParams}`);
            await this.tryReloadStreamingData(reloadPlaybackContext);
            break;
          }
        }
      }
    });
    const abortController = this.abortController;
    try {
      while (true) {
        await this.waitForDrain();
        if (abortController?.signal.aborted && !this._aborted)
          throw new Error("Request timed out");
        if (this._aborted)
          break;
        const { done, value } = await reader.read();
        if (done)
          break;
        if (value.length > 0) {
          bytesDownloaded += value.length;
          this.resetRequestTimeout();
          await umpReader.feed(value);
        }
      }
    } finally {
      this.clearRequestTimeout();
      reader.cancel().catch(() => {
      });
      reader.releaseLock();
      umpReader.dispose();
    }
    const fetchDurationMs = performance.now() - startTime;
    if (fetchDurationMs > MIN_FETCH_DURATION_FOR_BW_ESTIMATE_MS && bytesDownloaded > 0) {
      const currentBps = bytesDownloaded * 8 / (fetchDurationMs / 1e3);
      this.bandwidthEstimateBps = this.bandwidthEstimateBps === 0 ? currentBps : BANDWIDTH_EMA_PREVIOUS_WEIGHT * this.bandwidthEstimateBps + BANDWIDTH_EMA_CURRENT_WEIGHT * currentBps;
    }
    if (!serverSeek) {
      const buffered = this.trackCollection.buffered;
      if (buffered !== Infinity) {
        this.seekTo(buffered, "client");
      }
    }
  }
  hasExpired() {
    const expireRawValue = this.streamingURL.searchParams.get("expire");
    if (!expireRawValue)
      return false;
    const expireTimestampMs = parseInt(expireRawValue, 10) * 1e3;
    const msRemaining = expireTimestampMs - Date.now();
    return msRemaining <= 0;
  }
  tryMintPoToken() {
    const onMintPoToken = this.callbacks.onMintPoToken;
    if (onMintPoToken) {
      this.isMintingPoToken = true;
      (async () => {
        try {
          this.proofOfOriginToken = await onMintPoToken();
          this.poTokenGenerationId += 1;
        } catch (err) {
          this.logger.error(TAG2, `An error occurred while minting proof of origin token: ${err?.message}`);
        } finally {
          this.isMintingPoToken = false;
        }
      })();
    }
  }
  async tryReloadStreamingData(reloadPlaybackContext) {
    const onReloadPlayerResponseCb = this.callbacks.onReloadPlayerResponse;
    if (onReloadPlayerResponseCb) {
      try {
        const response = await onReloadPlayerResponseCb(reloadPlaybackContext);
        this.setStreamingURL(response.serverAbrStreamingUrl);
        this.setUstreamerConfig(response.videoPlaybackUstreamerConfig);
        this.sabrContextUpdates.clear();
        this.activeSabrContextTypes.clear();
        this.ssapPlaybackInfos.clear();
      } catch (err) {
        throw new Error(`An error occurred while reloading streaming data: ${err?.message}`);
      }
    } else
      throw new Error("Streaming data reload requested but no handler was found");
  }
  buildRequestBody(abrState, selectedAudioFormat, selectedVideoFormat) {
    const ssapPlaybackInfos = Array.from(this.ssapPlaybackInfos.values());
    const videoPlaybackUstreamerConfig = base64ToU8(this.videoPlaybackUstreamerConfig);
    const bufferedRanges = this.trackCollection.bufferedRanges;
    const playbackCookie = this.nextRequestPolicy?.playbackCookie ? PlaybackCookie.encode(this.nextRequestPolicy.playbackCookie).finish() : void 0;
    const clientInfo = this.clientInfo;
    const poToken = this.proofOfOriginToken;
    const initializationFormatIds = !this._isLive ? this.trackCollection.initializationFormatIds : [];
    const selectedAudioFormatIds = selectedAudioFormat ? [selectedAudioFormat] : [];
    const selectedVideoFormatIds = selectedVideoFormat ? [selectedVideoFormat] : [];
    const { sabrContexts, unsentSabrContexts } = this.prepareSabrContexts();
    return VideoPlaybackAbrRequest.encode({
      clientAbrState: abrState,
      bufferedRanges,
      ssapPlaybackInfos,
      initializationFormatIds,
      selectedAudioFormatIds,
      selectedVideoFormatIds,
      selectedCaptionFormatIds: [],
      videoPlaybackUstreamerConfig,
      streamerContext: {
        clientInfo,
        playbackCookie,
        unsentSabrContexts,
        sabrContexts,
        poToken
      },
      field1000: []
    }).finish();
  }
  prepareSabrContexts() {
    const sabrContexts = [];
    const unsentSabrContexts = [];
    for (const [type, ctxUpdate] of this.sabrContextUpdates.entries()) {
      if (this.activeSabrContextTypes.has(type))
        sabrContexts.push(ctxUpdate);
      else
        unsentSabrContexts.push(type);
    }
    return { sabrContexts, unsentSabrContexts };
  }
  async makeStreamingRequest(body) {
    this.streamingURL.searchParams.set("rn", this.requestNumber.toString());
    this.abortController = new AbortController();
    this.resetRequestTimeout();
    try {
      return this.fetchFunction(this.streamingURL, {
        body,
        method: "POST",
        headers: {
          "content-type": "application/x-protobuf",
          "accept-encoding": "identity",
          "accept": "application/vnd.yt-ump"
        },
        redirect: "follow",
        signal: this.abortController.signal
      });
    } catch (error) {
      this.clearRequestTimeout();
      const nextFallbackUrl = getNextFallbackUrl(this.streamingURL);
      if (nextFallbackUrl) {
        this.logger.warn(TAG2, `Switching to fallback URL: ${nextFallbackUrl.hostname}`);
        this.setStreamingURL(nextFallbackUrl);
      }
      throw error;
    } finally {
      this.requestNumber += 1;
    }
  }
  resetRequestTimeout() {
    this.clearRequestTimeout();
    const abortController = this.abortController;
    this.requestTimeoutId = setTimeout(() => abortController?.abort(), REQUEST_TIMEOUT_MS);
  }
  clearRequestTimeout() {
    if (this.requestTimeoutId !== void 0) {
      clearTimeout(this.requestTimeoutId);
      this.requestTimeoutId = void 0;
    }
  }
  recordProgress(progressMs) {
    if (!Number.isFinite(progressMs) || progressMs <= this.progressTracker.lastBufferedTimeMs)
      return;
    this.progressTracker.lastProgressTime = Date.now();
    this.progressTracker.lastBufferedTimeMs = progressMs;
    this.progressTracker.stallCount = 0;
  }
  seekTo(timeMs, source) {
    this.logger.debug(TAG2, `Seeking: timeMs=${timeMs}, source=${source}`);
    this.playerTimeMs = Math.round(timeMs);
  }
  resetProgressTracker(progressMs) {
    this.progressTracker = {
      lastProgressTime: Date.now(),
      lastBufferedTimeMs: progressMs,
      stallCount: 0
    };
  }
};
export {
  SabrStream,
  VideoPlaybackAbrRequest
};
