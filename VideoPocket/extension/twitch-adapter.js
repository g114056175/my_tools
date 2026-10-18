const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const QUERY = `query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature } videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature } }`;

export function twitchVodId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)twitch\.tv$/i.test(url.hostname)) return '';
    return url.pathname.match(/^\/videos\/(\d+)/i)?.[1] || '';
  } catch { return ''; }
}

export async function twitchVodManifest(rawUrl, fetchImpl = globalThis.fetch) {
  const id = twitchVodId(rawUrl);
  if (!id || typeof fetchImpl !== 'function') return null;
  const body = JSON.stringify({ operationName: 'PlaybackAccessToken_Template', query: QUERY, variables: { isLive: false, login: '', isVod: true, vodID: id, playerType: 'site', platform: 'web' } });
  const response = await fetchImpl('https://gql.twitch.tv/gql', { method: 'POST', credentials: 'include', headers: { Accept: '*/*', 'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain; charset=UTF-8' }, body });
  if (!response?.ok) return { id, status: response?.status || 0 };
  const json = await response.json();
  const token = json?.data?.videoPlaybackAccessToken;
  if (!token?.value || !token?.signature) return { id, status: response.status, unavailable: true };
  const manifest = new URL(`https://usher.ttvnw.net/vod/${id}.m3u8`);
  manifest.search = new URLSearchParams({ allow_source: 'true', allow_audio_only: 'true', allow_spectre: 'true', p: String(Math.floor(1000000 + Math.random() * 9000000)), platform: 'web', player: 'twitchweb', supported_codecs: 'av1,h265,h264', playlist_include_framerate: 'true', sig: token.signature, token: token.value }).toString();
  return { id, url: manifest.href };
}
