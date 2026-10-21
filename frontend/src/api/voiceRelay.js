import { API_BASE_URL } from "./api";
import { getAccessToken } from "./auth";

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320;

const voiceSocketUrl = () => {
  const base = new URL(API_BASE_URL || window.location.origin, window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = `${prefix}/ws/call-voice`.replace(/\/+/g, "/");
  base.search = "";
  base.hash = "";
  return base.toString();
};

const floatToInt16 = (samples) => {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return pcm;
};

const resample = (samples, fromRate, toRate) => {
  if (!samples.length || fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const mix = position - left;
    output[index] = samples[left] * (1 - mix) + samples[right] * mix;
  }
  return output;
};

/**
 * Voice line through the office server. The microphone is sent as small PCM
 * frames and the other person's frames are played back here.
 */
export function openVoiceRelay({ callId, stream, onPeer, onEnded, onError }) {
  let stopped = false;
  let muted = false;
  let socket = null;
  let pingTimer = null;
  let playAt = 0;
  let pending = new Float32Array(0);
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(2048, 1, 1);
  const silent = audioContext.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(audioContext.destination);
  audioContext.resume().catch(() => {});

  const playFrame = (pcm) => {
    if (!pcm.length || audioContext.state === "closed") return;
    const floats = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index += 1) {
      floats[index] = pcm[index] / 32768;
    }
    const buffer = audioContext.createBuffer(1, floats.length, SAMPLE_RATE);
    buffer.copyToChannel(floats, 0);
    const player = audioContext.createBufferSource();
    player.buffer = buffer;
    player.connect(audioContext.destination);
    const start = Math.max(audioContext.currentTime + 0.08, playAt);
    player.start(start);
    playAt = start + buffer.duration;
  };

  const pushSamples = (samples) => {
    if (muted || !socket || socket.readyState !== WebSocket.OPEN) return;
    const converted = resample(samples, audioContext.sampleRate, SAMPLE_RATE);
    if (!converted.length) return;
    const merged = new Float32Array(pending.length + converted.length);
    merged.set(pending, 0);
    merged.set(converted, pending.length);
    let offset = 0;
    while (merged.length - offset >= FRAME_SAMPLES) {
      const frame = floatToInt16(merged.subarray(offset, offset + FRAME_SAMPLES));
      socket.send(frame.buffer);
      offset += FRAME_SAMPLES;
    }
    pending = merged.slice(offset);
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    pushSamples(event.inputBuffer.getChannelData(0));
  };

  const url = voiceSocketUrl();
  const token = getAccessToken();
  if (!url || !token) {
    onError?.("Voice could not reach the office.");
  } else {
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify({ type: "join", token, call_id: callId }));
      pingTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", call_id: callId }));
        }
      }, 15000);
    });
    socket.addEventListener("message", (message) => {
      if (stopped) return;
      if (typeof message.data === "string") {
        let event = null;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        if (event?.type === "peer-ready") onPeer?.();
        if (event?.type === "peer-left") onEnded?.();
        return;
      }
      const bytes = message.data instanceof ArrayBuffer ? new Int16Array(message.data) : null;
      if (bytes?.length) {
        onPeer?.();
        playFrame(bytes);
      }
    });
    socket.addEventListener("close", () => {
      if (!stopped) onError?.("The voice line closed.");
    });
    socket.addEventListener("error", () => {
      if (!stopped) onError?.("The voice line could not connect.");
    });
  }

  return {
    setMuted(next) {
      muted = Boolean(next);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    resume() {
      return audioContext.resume();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = null;
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      silent.disconnect();
      audioContext.close().catch(() => {});
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
      socket = null;
    },
  };
}
