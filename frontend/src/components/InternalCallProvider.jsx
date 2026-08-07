import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import api from "../api/api";
import {
  isRealtimeConnected,
  sendRealtime,
  subscribeRealtime,
} from "../api/realtime";
import { InternalCallContext } from "./InternalCallContext";
import "./InternalCallProvider.css";

const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

const TERMINAL_STATUSES = new Set([
  "declined",
  "cancelled",
  "ended",
  "missed",
  "failed",
]);

const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    // Some mobile noise gates clip the beginning and end of spoken words.
    noiseSuppression: { ideal: false },
    autoGainControl: true,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48000 },
    sampleSize: { ideal: 16 },
    latency: { ideal: 0.02, max: 0.12 },
  },
  video: false,
};

const CAMERA_CONSTRAINTS = {
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
  facingMode: { ideal: "user" },
  resizeMode: { ideal: "crop-and-scale" },
};

const SCREEN_CONSTRAINTS = {
  width: { ideal: 1920, max: 2560 },
  height: { ideal: 1080, max: 1440 },
  frameRate: { ideal: 30, max: 30 },
};

const AUDIO_BITRATE = 128_000;
const CAMERA_BITRATE = 2_800_000;
const SCREEN_BITRATE = 4_500_000;

const enhanceOpusDescription = (description) => {
  const sdp = String(description?.sdp || "");
  const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!opusMatch) return description;
  const payloadType = opusMatch[1];
  const fmtpPattern = new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`, "i");
  const qualityOptions = [
    "minptime=10",
    "useinbandfec=1",
    "usedtx=0",
    "stereo=0",
    "sprop-stereo=0",
    "maxaveragebitrate=128000",
    "maxplaybackrate=48000",
  ];
  let enhancedSdp = sdp;
  if (fmtpPattern.test(enhancedSdp)) {
    enhancedSdp = enhancedSdp.replace(fmtpPattern, (line, existing) => {
      const additions = qualityOptions.filter(
        (option) => !new RegExp(`(?:^|;)${option.split("=")[0]}=`, "i").test(existing)
      );
      return `${line}${additions.length ? `;${additions.join(";")}` : ""}`;
    });
  } else {
    enhancedSdp = enhancedSdp.replace(
      opusMatch[0],
      `${opusMatch[0]}\r\na=fmtp:${payloadType} ${qualityOptions.join(";")}`
    );
  }
  if (/a=ptime:\d+/i.test(enhancedSdp)) {
    enhancedSdp = enhancedSdp.replace(/a=ptime:\d+/i, "a=ptime:20");
  } else {
    const enhancedFmtpPattern = new RegExp(`a=fmtp:${payloadType}[^\\r\\n]*`, "i");
    enhancedSdp = enhancedSdp.replace(
      enhancedFmtpPattern,
      (line) => `${line}\r\na=ptime:20`
    );
  }
  return { type: description.type, sdp: enhancedSdp };
};

const videoSenderFor = (peer) =>
  peer
    ?.getTransceivers()
    .find((transceiver) => transceiver.receiver?.track?.kind === "video")
    ?.sender || null;

const applyAudioSenderQuality = async (sender) => {
  if (!sender) return;
  const apply = async (includePriority) => {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = AUDIO_BITRATE;
    if (includePriority) {
      parameters.encodings[0].priority = "high";
      parameters.encodings[0].networkPriority = "high";
    }
    await sender.setParameters(parameters);
  };
  try {
    await apply(true);
  } catch {
    try {
      await apply(false);
    } catch {
      // Older mobile browsers may ignore WebRTC sender quality hints.
    }
  }
};

const applyVideoSenderQuality = async (sender, mode = "camera") => {
  if (!sender) return;
  const isScreen = mode === "screen";
  const apply = async (includePriority) => {
    const parameters = sender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = isScreen ? SCREEN_BITRATE : CAMERA_BITRATE;
    parameters.encodings[0].maxFramerate = 30;
    parameters.encodings[0].scaleResolutionDownBy = 1;
    parameters.degradationPreference = isScreen ? "maintain-resolution" : "balanced";
    if (includePriority) {
      parameters.encodings[0].priority = "high";
      parameters.encodings[0].networkPriority = "high";
    }
    await sender.setParameters(parameters);
  };
  try {
    await apply(true);
  } catch {
    try {
      await apply(false);
    } catch {
      // The negotiated browser defaults remain the fallback.
    }
  }
};

function CallIcon({ name, size = 22 }) {
  const paths = {
    phone: (
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.6a2 2 0 0 1-.5 2.1L9 10.7a16 16 0 0 0 4.3 4.3l1.3-1.3a2 2 0 0 1 2.1-.5c.8.4 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z" />
    ),
    phoneOff: (
      <>
        <path d="m3 3 18 18" />
        <path d="M8.6 8.6 9 8.2a2 2 0 0 0 .5-2.1 14 14 0 0 1-.4-1.8A2 2 0 0 0 7.1 3h-3a2 2 0 0 0-2 2.2 19.8 19.8 0 0 0 16.7 16.7 2 2 0 0 0 2.2-2v-3a2 2 0 0 0-1.7-2 14 14 0 0 1-1.8-.4 2 2 0 0 0-2.1.5l-.4.4" />
      </>
    ),
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
      </>
    ),
    micOff: (
      <>
        <path d="m3 3 18 18M9 9v2a3 3 0 0 0 4.7 2.5M15 9V5a3 3 0 0 0-5.1-2.1M5 10a7 7 0 0 0 11.9 5M19 10a7 7 0 0 1-.4 2.3M12 17v5M8 22h8" />
      </>
    ),
    camera: (
      <>
        <path d="M15 10l4.5-2.5v9L15 14" />
        <rect x="3" y="6" width="12" height="12" rx="2" />
      </>
    ),
    cameraOff: (
      <>
        <path d="m3 3 18 18M10.5 6H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5M17 9.5l2.5-2v9L17 15" />
      </>
    ),
    screen: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6" />
      </>
    ),
    screenOff: (
      <>
        <path d="m3 3 18 18M10 17H4a2 2 0 0 1-2-2V5.5M7 3h13a2 2 0 0 1 2 2v10a2 2 0 0 1-1 1.7M8 21h8M12 17v4" />
      </>
    ),
    fullscreen: (
      <>
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
      </>
    ),
    fullscreenExit: (
      <>
        <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
        {paths[name]}
      </g>
    </svg>
  );
}

const initialsFor = (name) =>
  String(name || "ERP")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const formatDuration = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};

const callFinishedMessage = (call, currentUserId) => {
  if (call.status === "declined") return "Call declined";
  if (call.status === "missed") return "No answer";
  if (call.status === "cancelled") {
    return call.ended_by_user_id === currentUserId ? "Call cancelled" : "Caller hung up";
  }
  if (call.status === "failed") return "Call could not connect";
  return "Call ended";
};

const mediaErrorMessage = (error, callType = "audio") => {
  const isVideo = callType === "video";
  if (!window.isSecureContext) {
    return `${isVideo ? "Camera and microphone" : "Microphone"} calling needs an HTTPS ERP link (localhost also works).`;
  }
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return `${isVideo ? "Camera or microphone" : "Microphone"} access was blocked. Allow access and try again.`;
  }
  if (error?.name === "NotFoundError") {
    return `No ${isVideo ? "camera or microphone" : "microphone"} was found on this device.`;
  }
  if (error?.name === "NotSupportedError") {
    return `${isVideo ? "Video" : "Voice"} calling is unavailable in this browser.`;
  }
  return `The ${isVideo ? "camera or microphone" : "microphone"} could not be started. Check the device settings and try again.`;
};

export function InternalCallProvider({ children, user }) {
  const [activeCall, setActiveCall] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [notice, setNotice] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isVideoCallingEnabled, setIsVideoCallingEnabled] = useState(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState("good");
  const [durationSeconds, setDurationSeconds] = useState(0);

  const callRef = useRef(null);
  const phaseRef = useRef("idle");
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteVideoStreamRef = useRef(null);
  const remoteVideoActiveRef = useRef(false);
  const remoteMediaStateKnownRef = useRef(false);
  const localVideoRef = useRef(null);
  const videoStageRef = useRef(null);
  const lastSignalIdRef = useRef(0);
  const queuedIceRef = useRef([]);
  const processingSignalsRef = useRef(false);
  const realtimeConnectedRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const connectionFailureRef = useRef(null);
  const iceServersRef = useRef(FALLBACK_ICE_SERVERS);
  const callOperationRef = useRef(0);
  const ringtoneContextRef = useRef(null);
  const ringtoneNodesRef = useRef([]);
  const iceRestartTimerRef = useRef(null);
  const iceRestartAttemptsRef = useRef(0);

  const updateCall = useCallback((nextCall) => {
    callRef.current = nextCall;
    setActiveCall(nextCall);
  }, []);

  const updatePhase = useCallback((nextPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const cleanupMedia = useCallback(() => {
    const peer = peerRef.current;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.close();
      peerRef.current = null;
    }
    if (iceRestartTimerRef.current) window.clearTimeout(iceRestartTimerRef.current);
    iceRestartTimerRef.current = null;
    iceRestartAttemptsRef.current = 0;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.pause();
      remoteVideoRef.current.srcObject = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    remoteVideoStreamRef.current = null;
    remoteVideoActiveRef.current = false;
    remoteMediaStateKnownRef.current = false;
    queuedIceRef.current = [];
    lastSignalIdRef.current = 0;
    processingSignalsRef.current = false;
    setIsMuted(false);
    setIsCameraEnabled(false);
    setIsScreenSharing(false);
    setHasRemoteVideo(false);
    setIsRemoteScreenSharing(false);
    setIsFullscreen(false);
    setNeedsAudioTap(false);
    setConnectionQuality("good");
    setDurationSeconds(0);
  }, []);

  const hideRemoteVideo = useCallback(() => {
    const video = remoteVideoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.load();
    }
    setHasRemoteVideo(false);
  }, []);

  const revealRemoteVideo = useCallback(() => {
    if (remoteMediaStateKnownRef.current && !remoteVideoActiveRef.current) return;
    const stream = remoteVideoStreamRef.current;
    const track = stream?.getVideoTracks()[0];
    if (!stream || !track || track.readyState !== "live" || track.muted) return;
    const video = remoteVideoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
    video?.play().catch(() => {});
    setHasRemoteVideo(true);
  }, []);

  const ensureRingtoneAudio = useCallback(() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!ringtoneContextRef.current) ringtoneContextRef.current = new AudioContextClass();
    const context = ringtoneContextRef.current;
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }, []);

  const stopRingtone = useCallback(() => {
    ringtoneNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // The scheduled tone may already have stopped.
      }
    });
    ringtoneNodesRef.current = [];
    navigator.vibrate?.(0);
  }, []);

  const playRingtonePulse = useCallback(() => {
    const context = ensureRingtoneAudio();
    if (!context || context.state !== "running") return;
    const startedAt = context.currentTime + 0.02;
    const gain = context.createGain();
    const lowTone = context.createOscillator();
    const highTone = context.createOscillator();
    lowTone.type = "sine";
    highTone.type = "sine";
    lowTone.frequency.setValueAtTime(440, startedAt);
    highTone.frequency.setValueAtTime(520, startedAt);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(0.075, startedAt + 0.03);
    gain.gain.setValueAtTime(0.075, startedAt + 0.32);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.39);
    gain.gain.setValueAtTime(0.0001, startedAt + 0.48);
    gain.gain.exponentialRampToValueAtTime(0.075, startedAt + 0.51);
    gain.gain.setValueAtTime(0.075, startedAt + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.88);
    lowTone.connect(gain);
    highTone.connect(gain);
    gain.connect(context.destination);
    lowTone.start(startedAt);
    highTone.start(startedAt);
    lowTone.stop(startedAt + 0.9);
    highTone.stop(startedAt + 0.9);
    ringtoneNodesRef.current.push(lowTone, highTone);
    highTone.onended = () => {
      ringtoneNodesRef.current = ringtoneNodesRef.current.filter(
        (node) => node !== lowTone && node !== highTone
      );
      gain.disconnect();
    };
    navigator.vibrate?.([350, 140, 350]);
  }, [ensureRingtoneAudio]);

  const resumeRemoteAudio = useCallback(async () => {
    ensureRingtoneAudio();
    const audio = remoteAudioRef.current;
    if (!audio?.srcObject) return;
    audio.muted = false;
    audio.volume = 1;
    try {
      await audio.play();
      setNeedsAudioTap(false);
      setNotice("");
    } catch {
      setNeedsAudioTap(true);
      setNotice("Tap Enable sound so this device can play the call audio.");
    }
  }, [ensureRingtoneAudio]);

  const clearCall = useCallback(() => {
    callOperationRef.current += 1;
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
    cleanupMedia();
    updateCall(null);
    updatePhase("idle");
    setNotice("");
  }, [cleanupMedia, updateCall, updatePhase]);

  const finishLocally = useCallback(
    (message) => {
      callOperationRef.current += 1;
      cleanupMedia();
      updatePhase("ended");
      setNotice(message || "Call ended");
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = window.setTimeout(() => {
        updateCall(null);
        updatePhase("idle");
        setNotice("");
      }, 3200);
    },
    [cleanupMedia, updateCall, updatePhase]
  );

  const requireMedia = useCallback(async (callType = "audio") => {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      const error = new Error("Calling is unavailable in this browser.");
      error.name = window.isSecureContext ? "NotSupportedError" : "SecurityError";
      throw error;
    }
    return navigator.mediaDevices.getUserMedia({
      ...AUDIO_CONSTRAINTS,
      video: callType === "video" ? CAMERA_CONSTRAINTS : false,
    });
  }, []);

  const sendSignal = useCallback(async (callId, signalType, payload, required = false) => {
    try {
      await api.post(`/internal-calls/${callId}/signals`, {
        signal_type: signalType,
        payload,
      });
    } catch (error) {
      if (required) throw error;
      if (![404, 409].includes(error.response?.status)) {
        console.warn("Call signal could not be sent.", error);
      }
    }
  }, []);

  const sendMediaState = useCallback(
    (callId, cameraEnabled, screenSharing) =>
      sendSignal(callId, "media-state", {
        camera_enabled: Boolean(cameraEnabled),
        screen_sharing: Boolean(screenSharing),
      }),
    [sendSignal]
  );

  const createPeer = useCallback(
    (callId, stream) => {
      const peer = new RTCPeerConnection({ iceServers: iceServersRef.current });
      peerRef.current = peer;
      stream.getAudioTracks().forEach((track) => {
        if ("contentHint" in track) track.contentHint = "speech";
      });
      stream.getVideoTracks().forEach((track) => {
        if ("contentHint" in track) track.contentHint = "motion";
      });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      if (!stream.getVideoTracks().length) {
        peer.addTransceiver("video", { direction: "sendrecv" });
      }

      const audioTransceiver = peer
        .getTransceivers()
        .find((transceiver) => transceiver.sender?.track?.kind === "audio");
      const audioCodecs = window.RTCRtpReceiver?.getCapabilities?.("audio")?.codecs || [];
      if (audioTransceiver?.setCodecPreferences && audioCodecs.length) {
        const opusCodecs = audioCodecs.filter(
          (codec) => codec.mimeType?.toLowerCase() === "audio/opus"
        );
        const otherCodecs = audioCodecs.filter(
          (codec) => codec.mimeType?.toLowerCase() !== "audio/opus"
        );
        if (opusCodecs.length) audioTransceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
      }

      const audioSender = peer
        .getSenders()
        .find((sender) => sender.track?.kind === "audio");
      void applyAudioSenderQuality(audioSender);
      void applyVideoSenderQuality(videoSenderFor(peer), "camera");

      const attemptIceRestart = async () => {
        if (["connected", "completed"].includes(peer.iceConnectionState)) return;
        const call = callRef.current;
        if (!call || call.id !== callId) return;
        if (call.is_incoming) {
          connectionFailureRef.current?.();
          return;
        }
        if (iceRestartAttemptsRef.current >= 2) {
          connectionFailureRef.current?.();
          return;
        }
        if (peer.signalingState !== "stable") {
          iceRestartTimerRef.current = window.setTimeout(attemptIceRestart, 1000);
          return;
        }
        iceRestartAttemptsRef.current += 1;
        try {
          peer.restartIce?.();
          const offer = await peer.createOffer({ iceRestart: true });
          await peer.setLocalDescription(enhanceOpusDescription(offer));
          await sendSignal(callId, "offer", peer.localDescription.toJSON(), true);
          setNotice("Restoring the audio connection...");
        } catch (error) {
          console.warn("Call audio recovery could not start.", error);
          iceRestartTimerRef.current = window.setTimeout(attemptIceRestart, 1800);
        }
      };

      const scheduleIceRecovery = (delay) => {
        if (iceRestartTimerRef.current) window.clearTimeout(iceRestartTimerRef.current);
        const call = callRef.current;
        const recoveryDelay = call?.is_incoming ? Math.max(delay, 12000) : delay;
        iceRestartTimerRef.current = window.setTimeout(attemptIceRestart, recoveryDelay);
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(callId, "ice", event.candidate.toJSON());
        }
      };
      peer.ontrack = (event) => {
        if (event.track.kind === "video") {
          const videoStream = new MediaStream([event.track]);
          remoteVideoStreamRef.current = videoStream;
          const showRemoteVideo = () => {
            revealRemoteVideo();
          };
          event.track.onunmute = showRemoteVideo;
          event.track.onmute = hideRemoteVideo;
          event.track.onended = () => {
            hideRemoteVideo();
            remoteVideoStreamRef.current = null;
            remoteVideoActiveRef.current = false;
            setIsRemoteScreenSharing(false);
          };
          if (!event.track.muted) showRemoteVideo();
          return;
        }
        const [remoteStream] = event.streams;
        if (!remoteAudioRef.current || !remoteStream) return;
        try {
          if ("playoutDelayHint" in event.receiver) event.receiver.playoutDelayHint = 0.25;
          if ("jitterBufferTarget" in event.receiver) event.receiver.jitterBufferTarget = 200;
        } catch {
          // Receiver buffer tuning is not available in every mobile browser.
        }
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.muted = false;
        remoteAudioRef.current.volume = 1;
        remoteAudioRef.current.play().then(() => {
          setNeedsAudioTap(false);
        }).catch(() => {
          setNeedsAudioTap(true);
          setNotice("Tap the call window if remote audio does not start.");
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          if (phaseRef.current !== "connected") setDurationSeconds(0);
          updatePhase("connected");
          setConnectionQuality("good");
          setNotice("");
          const connectedAudioSender = peer
            .getSenders()
            .find((sender) => sender.track?.kind === "audio");
          void applyAudioSenderQuality(connectedAudioSender);
          void applyVideoSenderQuality(
            videoSenderFor(peer),
            screenStreamRef.current ? "screen" : "camera"
          );
        } else if (peer.connectionState === "failed") {
          setConnectionQuality("unstable");
          setNotice("Connection interrupted - restoring audio...");
          scheduleIceRecovery(500);
        }
      };
      peer.oniceconnectionstatechange = () => {
        if (["connected", "completed"].includes(peer.iceConnectionState)) {
          if (iceRestartTimerRef.current) window.clearTimeout(iceRestartTimerRef.current);
          iceRestartTimerRef.current = null;
          iceRestartAttemptsRef.current = 0;
          setConnectionQuality("good");
          setNotice("");
        } else if (peer.iceConnectionState === "disconnected") {
          setConnectionQuality("unstable");
          setNotice("Network is unstable - protecting the audio...");
          scheduleIceRecovery(2500);
        } else if (peer.iceConnectionState === "failed") {
          setConnectionQuality("unstable");
          setNotice("Connection interrupted - restoring audio...");
          scheduleIceRecovery(500);
        }
      };
      return peer;
    },
    [hideRemoteVideo, revealRemoteVideo, sendSignal, updatePhase]
  );

  const flushQueuedIce = useCallback(async (peer) => {
    const queued = queuedIceRef.current;
    queuedIceRef.current = [];
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(candidate);
      } catch (error) {
        console.warn("A queued call connection candidate was ignored.", error);
      }
    }
  }, []);

  const processSignals = useCallback(
    async (callId) => {
      const peer = peerRef.current;
      if (!peer) return;
      if (processingSignalsRef.current) return;
      processingSignalsRef.current = true;
      try {
        const response = await api.get(`/internal-calls/${callId}/signals`, {
          params: { after_id: lastSignalIdRef.current },
        });
        const signals = Array.isArray(response.data) ? response.data : [];
        for (const signal of signals) {
          try {
            if (signal.signal_type === "media-state") {
              const cameraEnabled = Boolean(signal.payload?.camera_enabled);
              const screenSharing = Boolean(signal.payload?.screen_sharing);
              const videoActive = cameraEnabled || screenSharing;
              remoteMediaStateKnownRef.current = true;
              remoteVideoActiveRef.current = videoActive;
              setIsRemoteScreenSharing(screenSharing);
              if (videoActive) revealRemoteVideo();
              else hideRemoteVideo();
            } else if (signal.signal_type === "offer") {
              if (peer.signalingState === "have-local-offer") {
                await peer.setLocalDescription({ type: "rollback" });
              }
              await peer.setRemoteDescription(signal.payload);
              await flushQueuedIce(peer);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(enhanceOpusDescription(answer));
              await sendSignal(callId, "answer", peer.localDescription.toJSON(), true);
            } else if (
              signal.signal_type === "answer" &&
              peer.signalingState === "have-local-offer"
            ) {
              await peer.setRemoteDescription(signal.payload);
              await flushQueuedIce(peer);
            } else if (signal.signal_type === "ice") {
              if (peer.remoteDescription) {
                await peer.addIceCandidate(signal.payload);
              } else {
                queuedIceRef.current.push(signal.payload);
              }
            }
          } catch (error) {
            console.warn("A call connection update was ignored.", error);
            if (signal.signal_type !== "ice") {
              connectionFailureRef.current?.();
            }
          } finally {
            lastSignalIdRef.current = Math.max(lastSignalIdRef.current, signal.id);
          }
        }
      } catch (error) {
        if (![404, 409].includes(error.response?.status)) {
          console.warn("Call connection updates could not be loaded.", error);
        }
      } finally {
        processingSignalsRef.current = false;
      }
    },
    [flushQueuedIce, hideRemoteVideo, revealRemoteVideo, sendSignal]
  );

  const endCall = useCallback(async () => {
    stopRingtone();
    const call = callRef.current;
    if (call?.id) {
      try {
        await api.post(`/internal-calls/${call.id}/end`);
      } catch (error) {
        if (error.response?.status !== 404) console.warn("Call could not be ended cleanly.", error);
      }
    }
    finishLocally("Call ended");
  }, [finishLocally, stopRingtone]);

  useEffect(() => {
    connectionFailureRef.current = async () => {
      const call = callRef.current;
      if (call?.id) {
        try {
          await api.post(`/internal-calls/${call.id}/end`);
        } catch {
          // The connection has already failed locally; the status poll will also reconcile it.
        }
      }
      finishLocally("Call could not connect");
    };
  }, [finishLocally]);

  useEffect(() => {
    const unlockCallAudio = () => {
      ensureRingtoneAudio();
    };
    window.addEventListener("pointerdown", unlockCallAudio, true);
    window.addEventListener("keydown", unlockCallAudio, true);
    return () => {
      window.removeEventListener("pointerdown", unlockCallAudio, true);
      window.removeEventListener("keydown", unlockCallAudio, true);
    };
  }, [ensureRingtoneAudio]);

  useEffect(() => {
    if (phase !== "incoming") {
      stopRingtone();
      return undefined;
    }
    playRingtonePulse();
    const intervalId = window.setInterval(playRingtonePulse, 1800);
    return () => {
      window.clearInterval(intervalId);
      stopRingtone();
    };
  }, [phase, playRingtonePulse, stopRingtone]);

  useEffect(() => {
    if (!user?.id) {
      iceServersRef.current = FALLBACK_ICE_SERVERS;
      return undefined;
    }
    let disposed = false;
    const loadCallConfig = () => {
      api.get("/internal-calls/config").then((response) => {
        const servers = response.data?.ice_servers;
        if (!disposed && Array.isArray(servers) && servers.length) {
          iceServersRef.current = servers;
        }
        if (!disposed) {
          setIsVideoCallingEnabled(response.data?.video_calls_enabled !== false);
        }
      }).catch((error) => {
        if (![401, 403].includes(error.response?.status)) {
          console.warn("Voice call network settings could not be loaded.", error);
        }
      });
    };
    const handleCallSettingsUpdate = (event) => {
      setIsVideoCallingEnabled(event.detail?.video_calls_enabled !== false);
    };
    loadCallConfig();
    const intervalId = window.setInterval(loadCallConfig, 60000);
    window.addEventListener("erp.call-settings-updated", handleCallSettingsUpdate);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("erp.call-settings-updated", handleCallSettingsUpdate);
    };
  }, [user?.id]);

  const startCall = useCallback(
    async (person, callType = "audio") => {
      if (!person?.id || callRef.current) return;
      const normalizedCallType = callType === "video" ? "video" : "audio";
      if (normalizedCallType === "video" && !isVideoCallingEnabled) return;
      const operationId = callOperationRef.current + 1;
      callOperationRef.current = operationId;
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
      setNotice("");
      updateCall({
        id: null,
        other_user_id: person.id,
        other_user_name: person.name || person.username || "ERP user",
        other_user_role: person.role || "User",
        is_incoming: false,
        call_type: normalizedCallType,
        status: "preparing",
      });
      updatePhase("preparing");

      let stream;
      let createdCallId = null;
      try {
        stream = await requireMedia(normalizedCallType);
        if (callOperationRef.current !== operationId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setIsCameraEnabled(stream.getVideoTracks().length > 0);
        const response = await api.post("/internal-calls", {
          recipient_user_id: person.id,
          call_type: normalizedCallType,
        });
        const call = response.data;
        createdCallId = call.id;
        if (callOperationRef.current !== operationId) {
          await api.post(`/internal-calls/${call.id}/end`).catch(() => {});
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        updateCall(call);
        updatePhase("outgoing");
        const peer = createPeer(call.id, stream);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(enhanceOpusDescription(offer));
        if (callOperationRef.current !== operationId) return;
        await sendSignal(call.id, "offer", peer.localDescription.toJSON(), true);
        await sendMediaState(call.id, stream.getVideoTracks().length > 0, false);
      } catch (error) {
        if (createdCallId) {
          try {
            await api.post(`/internal-calls/${createdCallId}/end`);
          } catch {
            // The call may already have been closed by the other user.
          }
        }
        if (stream && !localStreamRef.current) {
          stream.getTracks().forEach((track) => track.stop());
        }
        cleanupMedia();
        const message =
          error.response?.data?.detail ||
          (stream
            ? "The call could not be started. Check the ERP connection and try again."
            : mediaErrorMessage(error, normalizedCallType));
        updatePhase("ended");
        setNotice(message);
        dismissTimerRef.current = window.setTimeout(clearCall, 4200);
      }
    },
    [clearCall, cleanupMedia, createPeer, isVideoCallingEnabled, requireMedia, sendMediaState, sendSignal, updateCall, updatePhase]
  );

  const startVideoCall = useCallback(
    (person) => {
      if (!isVideoCallingEnabled) return;
      startCall(person, "video");
    },
    [isVideoCallingEnabled, startCall]
  );

  const acceptCall = useCallback(async () => {
    const call = callRef.current;
    if (!call?.id || !call.is_incoming || call.status !== "ringing") return;
    stopRingtone();
    ensureRingtoneAudio();
    const operationId = callOperationRef.current + 1;
    callOperationRef.current = operationId;
    setNotice("");
    updatePhase("preparing");
    let stream;
    try {
      const callType = call.call_type === "video" ? "video" : "audio";
      stream = await requireMedia(callType);
      if (callOperationRef.current !== operationId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      setIsCameraEnabled(stream.getVideoTracks().length > 0);
      createPeer(call.id, stream);
      const response = await api.post(`/internal-calls/${call.id}/respond`, {
        action: "accept",
      });
      if (callOperationRef.current !== operationId) return;
      updateCall(response.data);
      updatePhase("connecting");
      await processSignals(call.id);
      await sendMediaState(call.id, stream.getVideoTracks().length > 0, false);
    } catch (error) {
      try {
        await api.post(`/internal-calls/${call.id}/respond`, { action: "decline" });
      } catch {
        // The caller may already have cancelled while microphone access was requested.
      }
      cleanupMedia();
      updatePhase("ended");
      setNotice(
          error.response?.data?.detail ||
          (stream
            ? "The call could not be answered. Check the ERP connection and try again."
            : mediaErrorMessage(error, call.call_type))
      );
      dismissTimerRef.current = window.setTimeout(clearCall, 4200);
    }
  }, [clearCall, cleanupMedia, createPeer, ensureRingtoneAudio, processSignals, requireMedia, sendMediaState, stopRingtone, updateCall, updatePhase]);

  const declineCall = useCallback(async () => {
    stopRingtone();
    const call = callRef.current;
    if (call?.id && call.is_incoming && call.status === "ringing") {
      try {
        await api.post(`/internal-calls/${call.id}/respond`, { action: "decline" });
      } catch (error) {
        if (error.response?.status !== 409) console.warn("Call response could not be sent.", error);
      }
    }
    finishLocally("Call declined");
  }, [finishLocally, stopRingtone]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, [isMuted]);

  const stopScreenShare = useCallback(async () => {
    const screenStream = screenStreamRef.current;
    const screenTrack = screenStream?.getVideoTracks()[0] || null;
    if (screenTrack) screenTrack.onended = null;
    screenStreamRef.current = null;

    const peer = peerRef.current;
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    const hasLiveCamera = cameraTrack?.readyState === "live";
    try {
      const sender = videoSenderFor(peer);
      await sender?.replaceTrack(hasLiveCamera ? cameraTrack : null);
      await applyVideoSenderQuality(sender, "camera");
    } catch (error) {
      console.warn("Camera could not be restored after screen sharing.", error);
    }
    screenStream?.getTracks().forEach((track) => track.stop());
    setIsScreenSharing(false);
    setNotice("");
    if (callRef.current?.id) {
      await sendMediaState(callRef.current.id, hasLiveCamera, false);
    }
  }, [sendMediaState]);

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !peerRef.current) {
      setNotice("Screen sharing is unavailable in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: SCREEN_CONSTRAINTS,
        audio: false,
      });
      const screenTrack = stream.getVideoTracks()[0];
      const sender = videoSenderFor(peerRef.current);
      if (!screenTrack || !sender) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("No video sender is available.");
      }
      if ("contentHint" in screenTrack) screenTrack.contentHint = "detail";
      await sender.replaceTrack(screenTrack);
      await applyVideoSenderQuality(sender, "screen");
      screenStreamRef.current = stream;
      screenTrack.onended = () => {
        void stopScreenShare();
      };
      setIsScreenSharing(true);
      setNotice("You are sharing your screen");
      if (callRef.current?.id) {
        await sendMediaState(callRef.current.id, isCameraEnabled, true);
      }
    } catch (error) {
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") {
        console.warn("Screen sharing could not start.", error);
        setNotice("Screen sharing could not start on this device.");
      }
    }
  }, [isCameraEnabled, sendMediaState, stopScreenShare]);

  const toggleCamera = useCallback(async () => {
    if (!isVideoCallingEnabled) {
      setNotice("Camera video is disabled by the ERP administrator.");
      return;
    }
    const peer = peerRef.current;
    if (!peer) return;
    const sender = videoSenderFor(peer);
    if (!sender) {
      setNotice("Camera video is unavailable for this call.");
      return;
    }

    if (isCameraEnabled) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      if (!isScreenSharing) await sender.replaceTrack(null).catch(() => {});
      if (cameraTrack) {
        localStreamRef.current?.removeTrack(cameraTrack);
        cameraTrack.stop();
      }
      setIsCameraEnabled(false);
      if (callRef.current?.id) {
        await sendMediaState(callRef.current.id, false, isScreenSharing);
      }
      return;
    }

    let cameraTrack = null;
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: CAMERA_CONSTRAINTS,
      });
      cameraTrack = cameraStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error("No camera track is available.");
      if ("contentHint" in cameraTrack) cameraTrack.contentHint = "motion";
      const localStream = localStreamRef.current;
      if (!localStream) throw new Error("The local call stream is unavailable.");
      localStream.addTrack(cameraTrack);
      if (!isScreenSharing) {
        await sender.replaceTrack(cameraTrack);
        await applyVideoSenderQuality(sender, "camera");
      }
      setIsCameraEnabled(true);
      setNotice("");
      if (callRef.current?.id) {
        await sendMediaState(callRef.current.id, true, isScreenSharing);
      }
    } catch (error) {
      if (cameraTrack) {
        localStreamRef.current?.removeTrack(cameraTrack);
        cameraTrack.stop();
      }
      setNotice(mediaErrorMessage(error, "video"));
    }
  }, [isCameraEnabled, isScreenSharing, isVideoCallingEnabled, sendMediaState]);

  useEffect(() => {
    if (isVideoCallingEnabled !== false || !isCameraEnabled) return;
    const disableCamera = async () => {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      const sender = videoSenderFor(peerRef.current);
      if (!isScreenSharing) await sender?.replaceTrack(null).catch(() => {});
      if (cameraTrack) {
        localStreamRef.current?.removeTrack(cameraTrack);
        cameraTrack.stop();
      }
      setIsCameraEnabled(false);
      if (callRef.current?.id) {
        await sendMediaState(callRef.current.id, false, isScreenSharing);
        setNotice("Camera video was disabled by the ERP administrator.");
      }
    };
    void disableCamera();
  }, [isCameraEnabled, isScreenSharing, isVideoCallingEnabled, sendMediaState]);

  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    const previewTrack = isScreenSharing
      ? screenStreamRef.current?.getVideoTracks()[0]
      : localStreamRef.current?.getVideoTracks()[0];
    video.srcObject = previewTrack ? new MediaStream([previewTrack]) : null;
    if (previewTrack) video.play().catch(() => {});
  }, [activeCall?.id, isCameraEnabled, isScreenSharing]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    video.srcObject = hasRemoteVideo ? remoteVideoStreamRef.current : null;
    if (hasRemoteVideo) video.play().catch(() => {});
  }, [activeCall?.id, hasRemoteVideo, isRemoteScreenSharing, isScreenSharing]);

  const toggleFullscreen = useCallback(async () => {
    const stage = videoStageRef.current;
    if (!stage) return;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (fullscreenElement) {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        await exitFullscreen?.call(document);
        return;
      }
      const requestFullscreen = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (requestFullscreen) {
        await requestFullscreen.call(stage);
        return;
      }
      if (remoteVideoRef.current?.webkitEnterFullscreen) {
        remoteVideoRef.current.webkitEnterFullscreen();
        return;
      }
      setNotice("Full screen is unavailable in this browser.");
    } catch {
      setNotice("Full screen could not be opened on this device.");
    }
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    const remoteVideo = remoteVideoRef.current;
    const startNativeFullscreen = () => setIsFullscreen(true);
    const endNativeFullscreen = () => setIsFullscreen(false);
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    remoteVideo?.addEventListener("webkitbeginfullscreen", startNativeFullscreen);
    remoteVideo?.addEventListener("webkitendfullscreen", endNativeFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
      remoteVideo?.removeEventListener("webkitbeginfullscreen", startNativeFullscreen);
      remoteVideo?.removeEventListener("webkitendfullscreen", endNativeFullscreen);
    };
  }, [activeCall?.id, hasRemoteVideo, isRemoteScreenSharing, isScreenSharing]);

  useEffect(() => {
    if (!user?.id) {
      realtimeConnectedRef.current = false;
      return undefined;
    }
    return subscribeRealtime((event) => {
      if (event?.type === "realtime.status") {
        realtimeConnectedRef.current = Boolean(event.connected);
        return;
      }
      if (event?.type === "call.signal") {
        if (callRef.current?.id === event.call_id) processSignals(event.call_id);
        return;
      }
      if (event?.type === "call.missing") {
        if (callRef.current?.id === event.call_id) finishLocally("Call ended");
        return;
      }
      if (event?.type !== "call.updated" || !event.call) return;

      const call = event.call;
      const currentCall = callRef.current;
      if (!currentCall) {
        if (TERMINAL_STATUSES.has(call.status)) return;
        updateCall(call);
        if (call.status === "ringing" && call.is_incoming) {
          updatePhase("incoming");
        } else {
          updatePhase("interrupted");
          setNotice("This call was interrupted. End it and call again.");
        }
        return;
      }
      if (currentCall.id && currentCall.id !== call.id) return;
      updateCall(call);
      if (TERMINAL_STATUSES.has(call.status)) {
        finishLocally(callFinishedMessage(call, user.id));
      } else if (call.status === "accepted" && phaseRef.current === "outgoing") {
        updatePhase("connecting");
      }
    });
  }, [finishLocally, processSignals, updateCall, updatePhase, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      if (callRef.current) clearCall();
      return undefined;
    }
    let disposed = false;
    const checkForIncomingCall = async () => {
      if (callRef.current) return;
      try {
        const response = await api.get("/internal-calls/active");
        const call = response.data;
        if (disposed || !call || callRef.current) return;
        updateCall(call);
        if (call.status === "ringing") {
          updatePhase(call.is_incoming ? "incoming" : "interrupted");
          if (!call.is_incoming) setNotice("This call was interrupted. End it and call again.");
        } else {
          updatePhase("interrupted");
          setNotice("This call was interrupted. End it and call again.");
        }
      } catch (error) {
        if (![401, 403].includes(error.response?.status)) {
          console.warn("Incoming calls could not be checked.", error);
        }
      }
    };
    checkForIncomingCall();
    const intervalId = window.setInterval(checkForIncomingCall, 30000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [clearCall, updateCall, updatePhase, user?.id]);

  useEffect(() => {
    if (!activeCall?.id || phase === "incoming" || phase === "interrupted" || phase === "ended") {
      return undefined;
    }
    processSignals(activeCall.id);
    const intervalId = window.setInterval(() => processSignals(activeCall.id), 5000);
    return () => window.clearInterval(intervalId);
  }, [activeCall?.id, phase, processSignals]);

  useEffect(() => {
    if (!activeCall?.id || phase === "ended") return undefined;
    let disposed = false;
    const refreshCall = async () => {
      try {
        const response = await api.get(`/internal-calls/${activeCall.id}`);
        const call = response.data;
        if (disposed || callRef.current?.id !== call.id) return;
        updateCall(call);
        if (TERMINAL_STATUSES.has(call.status)) {
          finishLocally(callFinishedMessage(call, user?.id));
        } else if (call.status === "accepted" && phaseRef.current === "outgoing") {
          updatePhase("connecting");
        }
      } catch (error) {
        if (error.response?.status === 404) finishLocally("Call ended");
      }
    };
    const intervalId = window.setInterval(refreshCall, 20000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [activeCall?.id, finishLocally, phase, updateCall, updatePhase, user?.id]);

  useEffect(() => {
    if (!activeCall?.id || phase === "ended" || phase === "incoming") return undefined;
    const sendHeartbeat = () => {
      if (isRealtimeConnected()) {
        sendRealtime({ type: "call.heartbeat", call_id: activeCall.id });
      }
    };
    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 12000);
    return () => window.clearInterval(intervalId);
  }, [activeCall?.id, phase]);

  useEffect(() => {
    if (phase !== "connected") return undefined;
    const intervalId = window.setInterval(
      () => setDurationSeconds((current) => current + 1),
      1000
    );
    return () => window.clearInterval(intervalId);
  }, [phase]);

  useEffect(
    () => () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
      stopRingtone();
      cleanupMedia();
      if (ringtoneContextRef.current) {
        ringtoneContextRef.current.close().catch(() => {});
      }
      ringtoneContextRef.current = null;
    },
    [cleanupMedia, stopRingtone]
  );

  const contextValue = useMemo(
    () => ({
      activeCall,
      callPhase: phase,
      isCallBusy: Boolean(activeCall),
      isVideoCallingEnabled,
      startCall,
      startVideoCall,
    }),
    [activeCall, isVideoCallingEnabled, phase, startCall, startVideoCall]
  );

  const otherName = activeCall?.other_user_name || "ERP user";
  const isVideoCall = activeCall?.call_type === "video";
  const isIncoming = phase === "incoming";
  const canControlAudio = ["outgoing", "connecting", "connected"].includes(phase);
  const showVideoStage =
    isVideoCall || hasRemoteVideo || isCameraEnabled || isScreenSharing || isRemoteScreenSharing;
  const canShareScreen = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const canFullscreen = Boolean(
    document.fullscreenEnabled ||
      document.documentElement?.webkitRequestFullscreen ||
      window.HTMLVideoElement?.prototype?.webkitEnterFullscreen
  );
  const showFullscreenControl =
    canFullscreen && (isRemoteScreenSharing || isScreenSharing);
  const statusText =
    phase === "preparing"
      ? isVideoCall
        ? "Starting camera and microphone..."
        : "Starting microphone..."
      : phase === "incoming"
        ? `Incoming ${isVideoCall ? "video" : "voice"} call`
        : phase === "outgoing"
          ? "Calling..."
          : phase === "connecting"
            ? "Connecting securely..."
            : phase === "connected"
              ? formatDuration(durationSeconds)
              : notice || `${isVideoCall ? "Video" : "Voice"} call`;

  return (
    <InternalCallContext.Provider value={contextValue}>
      {children}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="erp-call-remote-audio"
        onPlaying={() => setNeedsAudioTap(false)}
      />
      {activeCall && (
        <div className={`erp-call-overlay is-${phase}`} role="presentation">
          <section
            aria-label={`${isIncoming ? "Incoming call from" : `${isVideoCall ? "Video" : "Voice"} call with`} ${otherName}`}
            aria-live="assertive"
            className={`erp-call-card ${showVideoStage ? "has-video" : ""}`.trim()}
            role="dialog"
          >
            {showVideoStage ? (
              <div
                className={`erp-call-video-stage ${
                  hasRemoteVideo ? "" : "is-local-only"
                } ${isScreenSharing && !isRemoteScreenSharing ? "is-local-share-focus" : ""}`.trim()}
                ref={videoStageRef}
              >
                <video
                  aria-label={`${otherName} video`}
                  autoPlay
                  className="erp-call-remote-video"
                  onLoadedData={revealRemoteVideo}
                  playsInline
                  ref={remoteVideoRef}
                />
                {!hasRemoteVideo && (
                  <div className="erp-call-video-placeholder">
                    <span>{initialsFor(otherName)}</span>
                    <small>
                      {isRemoteScreenSharing ? "Waiting for shared screen..." : "Camera is off"}
                    </small>
                  </div>
                )}
                {(isCameraEnabled || isScreenSharing) && (
                  <video
                    aria-label={isScreenSharing ? "Your shared screen" : "Your camera"}
                    autoPlay
                    className="erp-call-local-video"
                    muted
                    playsInline
                    ref={localVideoRef}
                  />
                )}
                {(isScreenSharing || isRemoteScreenSharing) && (
                  <span className="erp-call-sharing-badge">
                    {isRemoteScreenSharing ? `${otherName} is sharing` : "You are sharing"}
                  </span>
                )}
                {showFullscreenControl && (
                  <button
                    aria-label={isFullscreen ? "Exit full screen" : "View shared screen full screen"}
                    className="erp-call-fullscreen"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? "Exit full screen" : "Full screen"}
                    type="button"
                  >
                    <CallIcon name={isFullscreen ? "fullscreenExit" : "fullscreen"} size={18} />
                    <span>{isFullscreen ? "Exit" : "Full screen"}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="erp-call-pulse" aria-hidden="true">
                <span>{initialsFor(otherName)}</span>
              </div>
            )}
            <p className="erp-call-eyebrow">Hisbenew ERP {isVideoCall ? "video" : "voice"}</p>
            <h2>{otherName}</h2>
            <p className="erp-call-role">{activeCall.other_user_role || "ERP user"}</p>
            <strong className={`erp-call-status is-${connectionQuality}`}>{statusText}</strong>
            {notice && phase !== "ended" && <p className="erp-call-notice">{notice}</p>}

            {needsAudioTap && !isIncoming && (
              <button className="erp-call-enable-sound" onClick={resumeRemoteAudio} type="button">
                Enable sound
              </button>
            )}

            {isIncoming ? (
              <div className="erp-call-actions is-incoming">
                <button className="erp-call-action is-decline" onClick={declineCall} type="button">
                  <CallIcon name="phoneOff" />
                  <span>Decline</span>
                </button>
                <button className="erp-call-action is-answer" onClick={acceptCall} type="button">
                  <CallIcon name="phone" />
                  <span>Answer</span>
                </button>
              </div>
            ) : phase === "ended" ? (
              <button className="erp-call-close" onClick={clearCall} type="button">
                Close
              </button>
            ) : (
              <div className="erp-call-actions">
                {canControlAudio && (
                  <button
                    className={`erp-call-action is-mute ${isMuted ? "is-active" : ""}`}
                    onClick={toggleMute}
                    type="button"
                  >
                    <CallIcon name={isMuted ? "micOff" : "mic"} />
                    <span>{isMuted ? "Unmute" : "Mute"}</span>
                  </button>
                )}
                {canControlAudio && isVideoCallingEnabled && (
                  <button
                    className={`erp-call-action is-camera ${isCameraEnabled ? "is-active" : ""}`}
                    onClick={toggleCamera}
                    type="button"
                  >
                    <CallIcon name={isCameraEnabled ? "camera" : "cameraOff"} />
                    <span>{isCameraEnabled ? "Camera off" : "Camera on"}</span>
                  </button>
                )}
                {canControlAudio && canShareScreen && (
                  <button
                    className={`erp-call-action is-screen ${isScreenSharing ? "is-active" : ""}`}
                    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                    type="button"
                  >
                    <CallIcon name={isScreenSharing ? "screenOff" : "screen"} />
                    <span>{isScreenSharing ? "Stop share" : "Share screen"}</span>
                  </button>
                )}
                <button className="erp-call-action is-decline" onClick={endCall} type="button">
                  <CallIcon name="phoneOff" />
                  <span>Hang up</span>
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </InternalCallContext.Provider>
  );
}
