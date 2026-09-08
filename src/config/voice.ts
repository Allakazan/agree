import { envInt, envList } from '../common/env';

export type VoiceConfig = {
  meshMax: number;
  videoMeshMax: number;
  maxAudioBitrate: number;
  uplinkBudget: number;
  turn: {
    static: {
      urls: string[];
      username?: string;
      credential?: string;
    };
    keyId?: string;
    apiToken?: string;
    ttl: number;
  };
  stunUrls: string[];
};

/**
 * Voice tuning knobs. Every value has a working default so a dev `.env` needs
 * none of them — only the TURN settings change behaviour when absent, and
 * `voice.ice.service.ts` falls back to STUN-only without them.
 */
export default (): { voice: VoiceConfig } => {
  const meshMax = envInt(process.env.VOICE_MESH_MAX, 5);
  const maxAudioBitrate = envInt(process.env.VOICE_MAX_AUDIO_BITRATE, 40_000);
  const stunUrls = envList(process.env.STUN_URL);

  return {
    voice: {
      // > this many participants ⇒ the room needs the SFU (Phase 2).
      meshMax,
      // > this many, once anyone publishes video ⇒ SFU. Unused until Phase 2.
      videoMeshMax: envInt(process.env.VIDEO_MESH_MAX, 2),
      maxAudioBitrate,
      // What one client is assumed able to push in total. In a mesh a sender
      // encodes once per peer, so the per-peer ceiling divides this budget.
      // Defaulting to `maxAudioBitrate * meshMax` means a full mesh at the
      // default limits never has to drop below the nominal Opus bitrate.
      uplinkBudget: envInt(
        process.env.VOICE_UPLINK_BUDGET,
        maxAudioBitrate * meshMax,
      ),
      turn: {
        /**
         * A plain, long-lived TURN server (coturn, Metered, a colleague's box).
         * Takes precedence over Cloudflare when `TURN_URL` is set: it exists so
         * the relay path can be tested without provisioning a Cloudflare key,
         * and an explicitly configured server should win over a minted one.
         * `TURN_URL` accepts a comma-separated list — udp, tcp and tls of the
         * same host, typically.
         */
        static: {
          urls: envList(process.env.TURN_URL),
          username: process.env.TURN_USER,
          credential: process.env.TURN_PASS,
        },
        /** Cloudflare Realtime TURN — short-lived credentials, minted per TTL. */
        keyId: process.env.CF_TURN_KEY_ID,
        apiToken: process.env.CF_TURN_KEY_API_TOKEN,
        // Cloudflare caps this at 24h; an hour keeps a leaked credential short-lived.
        ttl: envInt(process.env.CF_TURN_TTL, 3600),
      },
      /** Last resort when no TURN is configured: host/srflx candidates only. */
      stunUrls: stunUrls.length ? stunUrls : ['stun:stun.cloudflare.com:3478'],
    },
  };
};
