const enabledChoices = choices => Object.values(choices || {}).some(choice => choice?.enabled);

export function mediaAvailability(info) {
  return {
    video: enabledChoices(info?.choices?.video),
    audio: enabledChoices(info?.choices?.audio),
  };
}

export function popupAvailability(info, tracks = []) {
  const media = mediaAvailability(info);
  return {...media, subtitle: tracks.length > 0, any: media.video || media.audio || tracks.length > 0};
}

export function restoredKind(kind, available) {
  if (available[kind]) return kind;
  if (available.video) return 'video';
  if (available.audio) return 'audio';
  if (available.subtitle) return 'subtitle';
  return 'video';
}

export function sourceVisibility({info, tracks = [], kind}) {
  const available = popupAvailability(info, tracks);
  return {
    available,
    showDownloadSection: available.any,
    showSubtitleSection: available.subtitle && kind === 'subtitle',
    showVideoSettings: available.video && kind === 'video',
    showAudioSettings: available.audio && kind === 'audio',
  };
}
