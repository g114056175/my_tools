// Retain fixed categories only, never raw FFmpeg output, media URLs or paths.
(function(root){
 root.VideoPocketFFmpegDiagnostics=()=>{
  let reason;
  const rules=[
   ['memory',/out of memory|Cannot enlarge memory|memory access out of bounds|allocation failed/i],
   ['storage',/No space left on device|QuotaExceededError/i],
   ['missing-track',/matches no streams|does not contain any stream|Stream map .+ matches no/i],
   ['unsupported-format',/Unknown (?:input|output) format|Requested output format .+ not (?:a suitable|known)|Unable to find a suitable output format|Could not find tag for codec|codec .+ not (?:currently )?supported in container|muxer does not support/i],
   ['invalid-input',/Invalid data found when processing input|moov atom not found|could not find corresponding trex|trun track id unknown|error reading header|Invalid NAL unit size|partial file|Packet corrupt/i],
   ['timestamps',/non monotonically increasing dts|non-monotonous DTS|Timestamps are unset|pts .+ < dts/i],
   ['file-io',/Input\/output error|Error opening (?:input|output)|Error writing trailer|Unable to re-open|Bad file descriptor|Permission denied/i],
  ];
  return {
   observe(message){const text=String(message || '').slice(0,4096);for(const [name,pattern] of rules)if(pattern.test(text)){if(!reason||name==='memory'||name==='storage')reason=name;break;}},
   failure(exitCode){return {processingReason:reason || 'unknown',...(Number.isInteger(exitCode)?{ffmpegExitCode:exitCode}:{})};},
  };
 };
})(globalThis);
