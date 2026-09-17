import {
  findMediaSection,
  MediaSection,
  primaryCodecs,
  simulcastSendRids,
} from './voice.sdp';

const sdp = (...lines: string[]) => [...lines, ''].join('\r\n');

const session = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS stream',
];

const transport = [
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:Yx3b',
  'a=ice-pwd:9Hq1dM4vUQ0bX1w0lqEw7zQd',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 6B:8B:5D:EA:59:04:20:23:29:C8:87:1C:CD:0B:86:0E:4D:31:F4:4D',
  'a=setup:actpass',
];

/**
 * Chrome's publish offer for a mic and a simulcast camera, as it looks with no
 * `setCodecPreferences` — every codec the browser has, auxiliaries included.
 */
const chromeUnrestricted = sdp(
  ...session,
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126',
  ...transport,
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=sendonly',
  'a=msid:stream 5c7e1c3f-mic',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:13 CN/8000',
  'a=rtpmap:110 telephone-event/48000',
  'a=rtpmap:126 telephone-event/8000',
  'a=ssrc:1466105217 cname:Kx2bV0lq',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 102 103 35 36 114 115 116',
  ...transport,
  'a=mid:1',
  'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
  'a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id',
  'a=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id',
  'a=sendonly',
  'a=msid:stream 9a1f0e2d-camera',
  'a=rtcp-mux',
  'a=rtcp-rsize',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:96 goog-remb',
  'a=rtcp-fb:96 transport-cc',
  'a=rtcp-fb:96 nack pli',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=fmtp:98 profile-id=0',
  'a=rtpmap:99 rtx/90000',
  'a=fmtp:99 apt=98',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  'a=rtpmap:35 AV1/90000',
  'a=rtpmap:36 rtx/90000',
  'a=fmtp:36 apt=35',
  'a=rtpmap:114 red/90000',
  'a=rtpmap:115 rtx/90000',
  'a=fmtp:115 apt=114',
  'a=rtpmap:116 ulpfec/90000',
  'a=rid:f send',
  'a=rid:h send',
  'a=rid:q send',
  'a=simulcast:send f;h;q',
);

/** The same offer after `setCodecPreferences` narrowed it to Opus and VP8. */
const chromeRestricted = sdp(
  ...session,
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  ...transport,
  'a=mid:0',
  'a=sendonly',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  ...transport,
  'a=mid:1',
  'a=sendonly',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:96 nack pli',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rid:f send',
  'a=rid:h send',
  'a=rid:q send',
  'a=simulcast:send f;h;q',
);

/** Firefox's shape: other payload types, same RFC 8853 simulcast syntax. */
const firefox = sdp(
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 7512164357211286736 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 3A:5C:1E:9B:0D:77:42:AA:18:FE:61:C4:2B:90:5D:0F',
  'a=group:BUNDLE 0 1',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=audio 9 UDP/TLS/RTP/SAVPF 109 9 0 8 101',
  'c=IN IP4 0.0.0.0',
  'a=sendonly',
  'a=mid:0',
  'a=rtpmap:109 opus/48000/2',
  'a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1',
  'a=rtpmap:9 G722/8000/1',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:101 telephone-event/8000',
  'm=video 9 UDP/TLS/RTP/SAVPF 120 124 121 125 126 127 97 98 123 122 119',
  'c=IN IP4 0.0.0.0',
  'a=sendonly',
  'a=mid:1',
  'a=rtpmap:120 VP8/90000',
  'a=rtpmap:124 rtx/90000',
  'a=fmtp:124 apt=120',
  'a=rtpmap:121 VP9/90000',
  'a=rtpmap:125 rtx/90000',
  'a=rtpmap:126 H264/90000',
  'a=rtpmap:127 rtx/90000',
  'a=rtpmap:97 H264/90000',
  'a=rtpmap:98 rtx/90000',
  'a=rtpmap:123 ulpfec/90000',
  'a=rtpmap:122 red/90000',
  'a=rtpmap:119 rtx/90000',
  'a=rid:f send',
  'a=rid:h send',
  'a=simulcast:send f;h',
);

const section = (offer: string, mid: string): MediaSection => {
  const found = findMediaSection(offer, mid);
  if (!found) throw new Error(`fixture has no mid ${mid}`);
  return found;
};

describe('voice.sdp', () => {
  describe('findMediaSection', () => {
    it('finds each section by its mid, with its media kind', () => {
      expect(section(chromeUnrestricted, '0').kind).toBe('audio');
      expect(section(chromeUnrestricted, '1').kind).toBe('video');
      expect(section(firefox, '1').kind).toBe('video');
    });

    it('keeps a section to its own lines', () => {
      const audio = section(chromeUnrestricted, '0');

      expect(audio.lines[0]).toMatch(/^m=audio/);
      expect(audio.lines.some((line) => line.startsWith('m=video'))).toBe(
        false,
      );
    });

    it('returns null for a mid the offer does not have', () => {
      expect(findMediaSection(chromeUnrestricted, '7')).toBeNull();
    });

    it('matches the mid exactly, not by prefix', () => {
      const offer = sdp(...session, 'm=audio 9 RTP/AVP 0', 'a=mid:10');

      expect(findMediaSection(offer, '1')).toBeNull();
      expect(findMediaSection(offer, '10')).not.toBeNull();
    });

    it('reads LF-only descriptions too', () => {
      expect(
        findMediaSection(chromeRestricted.replace(/\r\n/g, '\n'), '1')?.kind,
      ).toBe('video');
    });
  });

  describe('primaryCodecs', () => {
    it('lists every primary codec of an unrestricted offer', () => {
      expect(primaryCodecs(section(chromeUnrestricted, '0'))).toEqual([
        'opus',
        'g722',
        'pcmu',
        'pcma',
      ]);
      expect(primaryCodecs(section(chromeUnrestricted, '1'))).toEqual([
        'vp8',
        'vp9',
        'h264',
        'av1',
      ]);
    });

    it('ignores rtx, red, ulpfec, comfort noise and DTMF', () => {
      expect(primaryCodecs(section(chromeRestricted, '0'))).toEqual(['opus']);
      expect(primaryCodecs(section(chromeRestricted, '1'))).toEqual(['vp8']);
    });

    it('deduplicates a codec offered under several payload types', () => {
      expect(primaryCodecs(section(firefox, '1'))).toEqual([
        'vp8',
        'vp9',
        'h264',
      ]);
    });
  });

  describe('simulcastSendRids', () => {
    it('reads the send rids', () => {
      expect(simulcastSendRids(section(chromeUnrestricted, '1'))).toEqual([
        'f',
        'h',
        'q',
      ]);
      expect(simulcastSendRids(section(firefox, '1'))).toEqual(['f', 'h']);
    });

    it('is empty for a section without simulcast', () => {
      expect(simulcastSendRids(section(chromeUnrestricted, '0'))).toEqual([]);
    });

    it('counts a paused stream, and flattens alternatives', () => {
      const offer = sdp(
        ...session,
        'm=video 9 UDP/TLS/RTP/SAVPF 96',
        'a=mid:1',
        'a=simulcast:send f,h;~q recv x',
      );

      expect(simulcastSendRids(section(offer, '1'))).toEqual(['f', 'h', 'q']);
    });

    it('ignores a receive-only simulcast declaration', () => {
      const offer = sdp(
        ...session,
        'm=video 9 UDP/TLS/RTP/SAVPF 96',
        'a=mid:1',
        'a=simulcast:recv f;h;q',
      );

      expect(simulcastSendRids(section(offer, '1'))).toEqual([]);
    });
  });
});
