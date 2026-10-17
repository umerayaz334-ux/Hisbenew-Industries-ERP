import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/call_event.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'incoming_call.dart';
import 'page_kit.dart';
import 'phone_permissions.dart';
import 'theme.dart';

class CallDesk extends ChangeNotifier with WidgetsBindingObserver {
  CallDesk(this.model);

  final AppModel model;
  String phase = 'idle';
  String otherName = '';
  String notice = '';

  Timer? _watch;
  StreamSubscription<CallEvent?>? _callEvents;
  Timer? _signals;
  Timer? _dismiss;
  RTCPeerConnection? _pc;
  MediaStream? _local;
  int? _callId;
  var _afterSignal = 0;
  var _remoteReady = false;
  var _pulling = false;
  var _peeking = false;
  var _accepting = false;
  var _disposed = false;
  var _generation = 0;
  bool muted = false;
  bool speaker = false;
  DateTime? _connectedAt;
  Timer? _clock;
  Timer? _connectionTimeout;
  Future<void> _mediaQueue = Future.value();
  String get duration {
    final seconds = _connectedAt == null
        ? 0
        : DateTime.now().difference(_connectedAt!).inSeconds;
    return '${(seconds ~/ 60).toString().padLeft(2, '0')}:${(seconds % 60).toString().padLeft(2, '0')}';
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) answerIfWaiting();
  }

  final List<RTCIceCandidate> _queuedIce = [];
  List<Map<String, dynamic>> _ice = relayIceServers();

  void startWatch() {
    WidgetsBinding.instance.addObserver(this);
    _watch?.cancel();
    _callEvents ??= FlutterCallkitIncoming.onEvent.listen(_onCallEvent);
    _watch = Timer.periodic(const Duration(seconds: 4), (_) => _peek());
    _loadIce();
    _peek();
  }

  Future<void> _onCallEvent(CallEvent? event) async {
    if (event is CallEventActionCallAccept) {
      await accept(
        callId: callIdFromScreen(event.callKitParams),
        name: event.callKitParams.nameCaller ?? '',
      );
    } else if (event is CallEventActionCallDecline) {
      final id = callIdFromScreen(event.callKitParams);
      if (id > 0) await decline(callId: id);
    } else if (event is CallEventActionCallEnded) {
      if (callIdFromScreen(event.callKitParams) == _callId &&
          phase != 'ended' &&
          phase != 'idle')
        await hangUp();
    } else if (event is CallEventActionCallTimeout) {
      if (_callId != null &&
          event.id == callScreenId(_callId!) &&
          phase == 'incoming')
        await hangUp();
    }
  }

  Future<void> answerIfWaiting() async {
    await _takePendingAccept();
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      for (final call in calls) {
        if (!call.isAccepted) continue;
        await accept(
          callId: callIdFromScreen(call),
          name: call.nameCaller ?? '',
        );
        return;
      }
    } catch (_) {}
  }

  Future<void> _takePendingAccept() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final pending = prefs.getInt('erp.pendingAcceptCall') ?? 0;
    if (pending <= 0) return;
    final name = prefs.getString('erp.pendingAcceptName') ?? '';
    await prefs.remove('erp.pendingAcceptCall');
    await accept(callId: pending, name: name);
  }

  Future<void> _loadIce() async {
    final session = model.session;
    if (session == null) return;
    try {
      final servers = await model.api.callIceServers(session);
      _ice = withRelay(servers);
    } on ErpException {
      return;
    }
  }

  Future<void> _peek() async {
    if (_disposed || _peeking) return;
    _peeking = true;
    try {
      await _takePendingAccept();
      if (_accepting || (phase != 'idle' && phase != 'incoming')) return;
      final session = model.session;
      if (session == null) return;
      final generation = _generation;
      try {
        final call = await model.api.activeCall(session);
        if (_disposed || generation != _generation || _accepting) return;
        if (phase != 'idle' && phase != 'incoming') return;
        final status = asText(call?['status']).toLowerCase();
        final incoming = call?['is_incoming'] == true && status == 'ringing';
        if (incoming && call != null) {
          _callId = asInt(call['id']);
          otherName = asText(call['other_user_name']);
          phase = 'incoming';
          notice = '';
          notifyListeners();
          return;
        }
        if (phase == 'incoming') {
          _reset();
        }
      } on ErpException {
        return;
      }
    } finally {
      _peeking = false;
    }
  }

  Future<void> startOutgoing(int userId, String name) async {
    if (phase != 'idle') return;
    final session = model.session;
    if (session == null) return;
    otherName = name;
    notice = '';
    phase = 'outgoing';
    final generation = ++_generation;
    notifyListeners();
    if (!await PhonePermissions.request()) {
      _fail(
        phraseFromLocale(
          'Turn on the microphone in phone settings to place a call.',
          'کال کے لیے فون سیٹنگز میں مائیکروفون کھولیں۔',
        ),
      );
      return;
    }
    if (_disposed || generation != _generation) return;
    try {
      await _openMedia();
      if (_disposed || generation != _generation) return;
      final call = await model.api.startCall(session: session, userId: userId);
      if (_disposed || generation != _generation) {
        await model.api.endCall(session: session, callId: asInt(call['id']));
        return;
      }
      _callId = asInt(call['id']);
      if (_callId == 0) {
        _fail('The call could not start.');
        return;
      }
      final offer = await _pc!.createOffer({'offerToReceiveAudio': 1});
      await _pc!.setLocalDescription(offer);
      if (_disposed || generation != _generation) return;
      await model.api.sendCallSignal(
        session: session,
        callId: _callId!,
        type: 'offer',
        payload: {'type': offer.type, 'sdp': offer.sdp},
      );
      _armSignals();
      _connectionTimeout?.cancel();
      _connectionTimeout = Timer(const Duration(seconds: 65), () {
        if (phase != 'connected') hangUp();
      });
    } on ErpException {
      if (!_disposed && generation == _generation)
        _fail('The call could not start. Check your connection.');
    } catch (_) {
      if (!_disposed && generation == _generation)
        _fail(
          'Audio could not start. Check microphone access in phone settings.',
        );
    }
  }

  Future<void> accept({int? callId, String? name}) async {
    // Native Answer can arrive before Android has resumed the Activity. Audio
    // must start from the visible Activity so microphone access is available.
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    if (lifecycle != null && lifecycle != AppLifecycleState.resumed) {
      final id = callId ?? _callId;
      if (id != null && id > 0) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setInt('erp.pendingAcceptCall', id);
        await prefs.setString('erp.pendingAcceptName', name ?? otherName);
      }
      return;
    }
    if (_disposed ||
        _accepting ||
        phase == 'connected' ||
        phase == 'connecting' ||
        phase == 'outgoing')
      return;
    _accepting = true;
    final generation = _generation;
    try {
      if (callId != null && callId > 0) _callId = callId;
      if (name != null && name.trim().isNotEmpty) otherName = name.trim();
      final session = model.session;
      final id = _callId;
      if (session == null || id == null || id <= 0) return;
      if (phase == 'connected' || phase == 'outgoing') return;
      phase = 'incoming';
      notifyListeners();
      if (!await PhonePermissions.granted()) {
        await PhonePermissions.request();
      }
      if (!await PhonePermissions.granted()) {
        notice = phraseFromLocale(
          'Turn on the microphone in phone settings to answer.',
          'جواب کے لیے فون سیٹنگز میں مائیکروفون کھولیں۔',
        );
        notifyListeners();
        return;
      }
      if (_disposed || generation != _generation) return;
      try {
        await model.api.respondCall(
          session: session,
          callId: id,
          action: 'accept',
        );
      } on ErpException {
        final live = await model.api.activeCall(session);
        final status = asText(live?['status']).toLowerCase();
        if (asInt(live?['id']) != id || status != 'accepted') {
          _fail('The call is no longer ringing.');
          return;
        }
      }
      if (_disposed || generation != _generation) {
        await model.api.endCall(session: session, callId: id);
        return;
      }
      phase = 'connecting';
      notice = '';
      notifyListeners();
      if (_pc == null) await _openMedia();
      if (_disposed || generation != _generation) return;
      _armSignals();
      try {
        await FlutterCallkitIncoming.hideCallkitIncoming(
          incomingCallParams(callId: id, name: otherName),
        );
      } catch (_) {}
      _connectionTimeout?.cancel();
      _connectionTimeout = Timer(const Duration(seconds: 30), () {
        if (phase != 'connected') hangUp();
      });
    } catch (error) {
      debugPrint('Call answer failed: ${error.runtimeType}');
      await hangUp();
    } finally {
      _accepting = false;
    }
  }

  Future<void> decline({int? callId}) async {
    final session = model.session;
    callId ??= _callId;
    if (session != null && callId != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('erp.skipMissedCall', callId);
      try {
        await model.api.respondCall(
          session: session,
          callId: callId,
          action: 'decline',
        );
      } on ErpException {
        await prefs.setInt('erp.pendingDeclineCall', callId);
      }
    }
    if (_callId == callId || _callId == null) _fail('Call declined');
  }

  Future<void> hangUp() async {
    final session = model.session;
    final callId = _callId;
    _fail(phraseFromLocale('Call ended', 'کال ختم'));
    if (session != null && callId != null) {
      try {
        await model.api.endCall(session: session, callId: callId);
      } on ErpException {
        // The other side may already have ended it.
      }
    }
  }

  Future<void> _openMedia() {
    final generation = _generation;
    final work = _mediaQueue.then((_) async {
      if (_disposed || generation != _generation) return;
      await _createMedia();
    });
    _mediaQueue = work.catchError((Object error) {
      debugPrint('Call media failed: ${error.runtimeType}');
    });
    return work;
  }

  Future<void> _createMedia() async {
    await PhonePermissions.startVoiceService();
    await WebRTC.initialize(
      options: {'androidUseHardwareAudioProcessing': false},
    );
    _local = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': false,
    });
    await Helper.setSpeakerphoneOn(false);
    speaker = false;
    muted = false;
    _pc = await createPeerConnection({
      'iceServers': _ice,
      'sdpSemantics': 'unified-plan',
    });
    // Keep a stable peer identity so callbacks from an old call cannot revive it.
    final peer = _pc!;
    for (final track in _local!.getAudioTracks()) {
      await _pc!.addTrack(track, _local!);
    }
    _pc!.onIceCandidate = (candidate) {
      final callId = _callId;
      final session = model.session;
      if (callId == null ||
          session == null ||
          candidate.candidate == null ||
          candidate.candidate!.isEmpty)
        return;
      model.api
          .sendCallSignal(
            session: session,
            callId: callId,
            type: 'ice',
            payload: {
              'candidate': candidate.candidate,
              'sdpMid': candidate.sdpMid,
              'sdpMLineIndex': candidate.sdpMLineIndex,
            },
          )
          .catchError((Object error) {
            debugPrint('Call ICE send failed: ${error.runtimeType}');
          });
    };
    _pc!.onConnectionState = (state) {
      if (_disposed || _pc != peer || phase == 'ended' || phase == 'idle')
        return;
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _connectionTimeout?.cancel();
        _connectedAt ??= DateTime.now();
        _clock ??= Timer.periodic(
          const Duration(seconds: 1),
          (_) => notifyListeners(),
        );
        phase = 'connected';
        notice = '';
        notifyListeners();
        final id = _callId;
        if (id != null)
          FlutterCallkitIncoming.setCallConnected(callScreenId(id))
              .catchError((Object _) {});
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        hangUp();
      }
    };
  }

  void _armSignals() {
    _signals?.cancel();
    _signals = Timer.periodic(
      const Duration(milliseconds: 800),
      (_) => _pullSignals(),
    );
  }

  Future<void> _pullSignals() async {
    if (_pulling || _disposed || phase == 'idle' || phase == 'ended') return;
    _pulling = true;
    final work = _mediaQueue.then((_) => _readSignals());
    _mediaQueue = work.catchError((Object error) {
      debugPrint('Call signal queue failed: ${error.runtimeType}');
    });
    try { await work; } finally { _pulling = false; }
  }

  Future<void> _readSignals() async {
    if (_disposed || phase == 'idle' || phase == 'ended') return;
    final session = model.session;
    final callId = _callId;
    final peer = _pc;
    if (session == null || callId == null || peer == null) return;
    final generation = _generation;
    try {
      final live = await model.api.callDetails(session, callId);
      if (_pc != peer || _callId != callId || generation != _generation) return;
      final status = asText(live['status']).toLowerCase();
      if (status != 'ringing' && status != 'accepted') {
        _fail(
          status == 'declined'
              ? 'Call declined'
              : status == 'missed'
              ? 'No answer'
              : 'Call ended',
        );
        return;
      }
      final rows = await model.api.callSignals(
        session: session,
        callId: callId,
        afterId: _afterSignal,
      );
      if (_pc != peer || _callId != callId || generation != _generation) return;
      for (final row in rows) {
        if (generation != _generation) return;
        _afterSignal = asInt(row['id']) > _afterSignal
            ? asInt(row['id'])
            : _afterSignal;
        final type = asText(row['signal_type']);
        final payload = row['payload'] is Map
            ? Map<String, dynamic>.from(row['payload'] as Map)
            : const <String, dynamic>{};
        if (type == 'offer' && !_remoteReady) {
          await peer.setRemoteDescription(
            RTCSessionDescription(
              asText(payload['sdp']),
              asText(payload['type']),
            ),
          );
          _remoteReady = true;
          await _flushIce(peer);
          final answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await model.api.sendCallSignal(
            session: session,
            callId: callId,
            type: 'answer',
            payload: {'type': answer.type, 'sdp': answer.sdp},
          );
        } else if (type == 'answer' &&
            peer.signalingState ==
                RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
          await peer.setRemoteDescription(
            RTCSessionDescription(
              asText(payload['sdp']),
              asText(payload['type']),
            ),
          );
          _remoteReady = true;
          await _flushIce(peer);
        } else if (type == 'ice') {
          final ice = RTCIceCandidate(
            asText(payload['candidate']),
            asText(payload['sdpMid']),
            asInt(payload['sdpMLineIndex']),
          );
          if (_remoteReady) {
            await peer.addCandidate(ice);
          } else {
            _queuedIce.add(ice);
          }
        }
      }
    } on ErpException {
      return;
    } catch (error) {
      debugPrint('Call signaling failed: ${error.runtimeType}');
    }
  }

  Future<void> _flushIce(RTCPeerConnection peer) async {
    final queued = List<RTCIceCandidate>.from(_queuedIce);
    _queuedIce.clear();
    for (final ice in queued) {
      try {
        await peer.addCandidate(ice);
      } catch (_) {}
    }
  }

  void _fail(String message) {
    if (_disposed) return;
    ++_generation;
    notice = message;
    phase = 'ended';
    final id = _callId;
    if (id != null)
      FlutterCallkitIncoming.endCall(callScreenId(id))
          .catchError((Object _) {});
    _releaseMedia();
    notifyListeners();
    _dismiss?.cancel();
    _dismiss = Timer(const Duration(seconds: 2), _reset);
  }

  void _releaseMedia() {
    // Silence capture immediately; dispose only after in-flight native work.
    for (final track in _local?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      track.enabled = false;
    }
    _clock?.cancel();
    _clock = null;
    _connectionTimeout?.cancel();
    _connectedAt = null;
    _signals?.cancel();
    _signals = null;
    _mediaQueue = _mediaQueue
        .then((_) async {
          final peer = _pc;
          final local = _local;
          _pc = null;
          _local = null;
          if (peer != null) {
            await peer.close();
            await peer.dispose();
          }
          for (final track
              in local?.getTracks() ?? const <MediaStreamTrack>[]) {
            await track.stop();
          }
          await local?.dispose();
          await PhonePermissions.stopVoiceService();
        })
        .catchError((Object error) {
          debugPrint('Call cleanup failed: ${error.runtimeType}');
        });
    _remoteReady = false;
    _queuedIce.clear();
    _afterSignal = 0;
  }

  void _reset() {
    ++_generation;
    _releaseMedia();
    _callId = null;
    otherName = '';
    notice = '';
    phase = 'idle';
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    ++_generation;
    WidgetsBinding.instance.removeObserver(this);
    _watch?.cancel();
    _callEvents?.cancel();
    _dismiss?.cancel();
    _releaseMedia();
    super.dispose();
  }

  void toggleMute() {
    muted = !muted;
    for (final track in _local?.getAudioTracks() ?? <MediaStreamTrack>[]) {
      track.enabled = !muted;
    }
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    try {
      await Helper.setSpeakerphoneOn(!speaker);
      speaker = !speaker;
      notifyListeners();
    } catch (_) {
      notice = 'Audio output could not be changed';
      notifyListeners();
    }
  }
}

String phraseFromLocale(String en, String ur) => en;

class CallCover extends StatelessWidget {
  const CallCover({required this.desk, super.key});

  final CallDesk desk;

  @override
  Widget build(BuildContext context) {
    final incoming = desk.phase == 'incoming';
    final ended = desk.phase == 'ended';
    final title = switch (desk.phase) {
      'connecting' => phrase(context, 'Connecting…', 'رابطہ ہو رہا ہے'),
      'incoming' => phrase(context, 'Incoming call', 'آنے والی کال'),
      'outgoing' => phrase(context, 'Calling', 'کال ہو رہی ہے'),
      'connected' => desk.duration,
      _ => phrase(context, 'Call', 'کال'),
    };
    return Material(
      color: const Color(0xFF102C26),
      child: SafeArea(
        child: LayoutBuilder(builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: IntrinsicHeight(child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 36, 24, 28),
          child: Column(
            children: [
              const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.graphic_eq, color: Color(0xFF8BD6B8), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'HISBENEW VOICE',
                    style: TextStyle(
                      color: Color(0xFF8BD6B8),
                      letterSpacing: 2,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Container(
                width: 92,
                height: 92,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: hisbenewForest,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  desk.otherName.isEmpty
                      ? 'H'
                      : desk.otherName.characters.first.toUpperCase(),
                  style: const TextStyle(
                    color: Color(0xFFF3E6C8),
                    fontSize: 36,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                desk.otherName.isEmpty
                    ? phrase(context, 'Hisbenew', 'ہزبینیو')
                    : desk.otherName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                title,
                style: const TextStyle(
                  color: Color(0xFFF3E6C8),
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (desk.notice.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  desk.notice,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFFD6CBBA)),
                ),
                if (desk.notice.toLowerCase().contains('microphone'))
                  TextButton(
                    onPressed: PhonePermissions.openSettings,
                    child: const Text('Open phone settings'),
                  ),
              ],
              const Spacer(),
              if (!ended && !incoming) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _AnswerButton(
                      icon: desk.muted ? Icons.mic_off : Icons.mic,
                      color: desk.muted
                          ? const Color(0xFF647D72)
                          : const Color(0xFF284A3F),
                      label: desk.muted ? 'Unmute' : 'Mute',
                      onTap: desk.toggleMute,
                    ),
                    _AnswerButton(
                      icon: desk.speaker ? Icons.volume_up : Icons.hearing,
                      color: desk.speaker
                          ? const Color(0xFF647D72)
                          : const Color(0xFF284A3F),
                      label: 'Speaker',
                      onTap: desk.toggleSpeaker,
                    ),
                  ],
                ),
                const SizedBox(height: 32),
              ],
              if (!ended && incoming)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _AnswerButton(
                      icon: Icons.call_end_rounded,
                      color: const Color(0xFFE11D48),
                      label: phrase(context, 'Decline', 'رد'),
                      onTap: desk.decline,
                    ),
                    _AnswerButton(
                      icon: Icons.call_rounded,
                      color: const Color(0xFF1F8A4C),
                      label: phrase(context, 'Answer', 'جواب'),
                      onTap: () => desk.accept(),
                    ),
                  ],
                )
              else if (!ended)
                _AnswerButton(
                  icon: Icons.call_end_rounded,
                  color: const Color(0xFFE11D48),
                  label: phrase(context, 'End', 'ختم'),
                  onTap: desk.hangUp,
                ),
            ],
          ),
        ),
      )))),
      ),
    );
  }
}

class _AnswerButton extends StatelessWidget {
  const _AnswerButton({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          elevation: 6,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 76,
              height: 76,
              child: Icon(icon, color: Colors.white, size: 34),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
