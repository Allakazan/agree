/**
 * Just enough SDP reading to validate a publish offer before it reaches the
 * SFU. Read-only by design: nothing here rewrites a description — munging SDP
 * is fragile, and the mesh path never looks inside one at all. Only the offers
 * of `voice:sfu:publish`, which pass through this server anyway on their way to
 * Cloudflare, are inspected.
 */

/** One `m=` section: its media kind and its lines, the `m=` line included. */
export type MediaSection = {
  kind: string;
  lines: string[];
};

/**
 * Codecs that ride alongside a primary codec rather than being one:
 * retransmission, redundancy, FEC, comfort noise and DTMF. An offer's codec
 * allowlist check ignores these.
 */
const AUXILIARY_CODECS = new Set([
  'rtx',
  'red',
  'ulpfec',
  'flexfec-03',
  'cn',
  'telephone-event',
]);

const mediaSections = (sdp: string): MediaSection[] => {
  const sections: MediaSection[] = [];

  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      sections.push({ kind: line.slice(2).split(' ')[0], lines: [line] });
    } else if (sections.length) {
      sections[sections.length - 1].lines.push(line);
    }
  }

  return sections;
};

/** The `m=` section whose `a=mid` is `mid`, or `null` if the offer has none. */
export const findMediaSection = (
  sdp: string,
  mid: string,
): MediaSection | null =>
  mediaSections(sdp).find((section) =>
    section.lines.some((line) => line === `a=mid:${mid}`),
  ) ?? null;

/**
 * The section's primary codecs, lowercased and deduplicated, from its
 * `a=rtpmap:<pt> <name>/<clock>` lines — auxiliaries excluded.
 */
export const primaryCodecs = (section: MediaSection): string[] => {
  const codecs = new Set<string>();

  for (const line of section.lines) {
    const match = /^a=rtpmap:\d+ ([^/\s]+)\//.exec(line);
    if (!match) continue;

    const codec = match[1].toLowerCase();
    if (!AUXILIARY_CODECS.has(codec)) codecs.add(codec);
  }

  return [...codecs];
};

/**
 * A one-line summary of a description, for logs — never the SDP itself:
 * `bundle=[0 1] 0:audio:sendonly[1=audio-level 4=mid] 1:video:inactive:rejected[…]`.
 * `rejected` is a zero port: a stopped transceiver's m-section. The BUNDLE
 * group is listed because its first mid anchors the one shared transport; the
 * brackets hold each section's `a=extmap` ids (uri shortened to its last
 * segment), which Chrome requires consistent across the bundle and stable
 * per mid.
 */
export const describeSdp = (sdp: string): string => {
  const bundle =
    sdp
      .split(/\r?\n/)
      .find((line) => line.startsWith('a=group:BUNDLE'))
      ?.slice('a=group:BUNDLE'.length)
      .trim() ?? '';

  const sections = mediaSections(sdp).map(({ kind, lines }) => {
    const port = lines[0].split(' ')[1];
    const mid =
      lines.find((line) => line.startsWith('a=mid:'))?.slice(6) ?? '?';
    const direction =
      lines
        .find((line) => /^a=(sendrecv|sendonly|recvonly|inactive)$/.test(line))
        ?.slice(2) ?? '?';
    const extmap = lines.flatMap((line) => {
      const ext = /^a=extmap:(\d+)(?:\/\w+)? (\S+)/.exec(line);
      return ext ? [`${ext[1]}=${ext[2].split(/[:/]/).pop()}`] : [];
    });
    return `${mid}:${kind}:${direction}${port === '0' ? ':rejected' : ''}[${extmap.join(' ')}]`;
  });

  return `bundle=[${bundle}] ${sections.join(' ')}`;
};

/**
 * The rids the section offers to send, from `a=simulcast:send <list>` (RFC
 * 8853). The list separates streams with `;` and alternatives with `,`, and a
 * `~` marks a stream as paused — it is still a stream, so it still counts.
 * Empty when the section declares no simulcast.
 */
export const simulcastSendRids = (section: MediaSection): string[] => {
  for (const line of section.lines) {
    if (!line.startsWith('a=simulcast:')) continue;

    const tokens = line.slice('a=simulcast:'.length).trim().split(/\s+/);
    const sendAt = tokens.indexOf('send');
    if (sendAt === -1 || !tokens[sendAt + 1]) return [];

    return tokens[sendAt + 1]
      .split(/[;,]/)
      .map((rid) => rid.replace(/^~/, ''))
      .filter(Boolean);
  }

  return [];
};
