import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';

import 'phone_permissions.dart';

/// Sends microphone frames to the office and plays the frames that come back.
class VoiceLink {
  VoiceLink._(this._socket, this._frames, this._incoming);

  final WebSocket _socket;
  final StreamSubscription<dynamic> _frames;
  final StreamSubscription<dynamic> _incoming;
  var _stopped = false;
  var _muted = false;
  Timer? _ping;

  static Future<VoiceLink> start({
    required String baseUrl,
    required String token,
    required int callId,
    required void Function() onReady,
    required void Function() onEnded,
    required void Function(String message) onError,
  }) async {
    final started = await PhonePermissions.startVoiceRelay();
    if (!started) {
      throw StateError('microphone');
    }
    final WebSocket socket;
    try {
      socket = await WebSocket.connect(_voiceUrl(baseUrl))
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      await PhonePermissions.stopVoiceRelay();
      rethrow;
    }
    VoiceLink? link;
    var endedBeforeReady = false;
    var readyBeforeReady = false;
    final frames = PhonePermissions.voiceFrames().listen((frame) {
      if ((link?._muted ?? false) || socket.readyState != WebSocket.open)
        return;
      socket.add(frame);
    });
    final incoming = socket.listen(
      (event) {
        if (link == null) {
          if (event is String) {
            final decoded = jsonDecode(event);
            if (decoded is Map && decoded['type'] == 'peer-ready')
              readyBeforeReady = true;
            if (decoded is Map && decoded['type'] == 'peer-left')
              endedBeforeReady = true;
          } else if (event is List<int>) {
            readyBeforeReady = true;
            unawaited(PhonePermissions.playVoice(Uint8List.fromList(event)));
          }
          return;
        }
        if (link._stopped) return;
        if (event is String) {
          final decoded = jsonDecode(event);
          if (decoded is! Map) return;
          final type = '${decoded['type'] ?? ''}';
          if (type == 'peer-ready') onReady();
          if (type == 'peer-left') onEnded();
          return;
        }
        if (event is List<int>) {
          onReady();
          PhonePermissions.playVoice(Uint8List.fromList(event));
        }
      },
      onError: (_) {
        if (link == null) {
          endedBeforeReady = true;
        } else if (!link._stopped) {
          onError('The voice line could not connect.');
        }
      },
      onDone: () {
        if (link == null) {
          endedBeforeReady = true;
        } else if (!link._stopped) {
          onEnded();
        }
      },
    );
    link = VoiceLink._(socket, frames, incoming);
    if (readyBeforeReady) onReady();
    if (endedBeforeReady) onEnded();
    socket.add(jsonEncode({'type': 'join', 'token': token, 'call_id': callId}));
    final established = link;
    established._ping = Timer.periodic(const Duration(seconds: 15), (_) {
      if (socket.readyState == WebSocket.open) {
        socket.add(jsonEncode({'type': 'ping', 'call_id': callId}));
      }
    });
    return established;
  }

  void setMuted(bool muted) {
    _muted = muted;
  }

  Future<void> setSpeaker(bool speaker) =>
      PhonePermissions.setVoiceSpeaker(speaker);

  Future<void> stop() async {
    if (_stopped) return;
    _stopped = true;
    _ping?.cancel();
    await _frames.cancel();
    await _incoming.cancel();
    try {
      await _socket.close();
    } catch (_) {}
    await PhonePermissions.stopVoiceRelay();
  }
}

String _voiceUrl(String baseUrl) {
  final uri = Uri.parse(baseUrl);
  final secure = uri.scheme == 'https';
  return uri
      .replace(scheme: secure ? 'wss' : 'ws', path: '/ws/call-voice')
      .toString();
}
