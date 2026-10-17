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

class CallDesk extends ChangeNotifier {
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
  final List<RTCIceCandidate> _queuedIce = [];
  List<Map<String, dynamic>> _ice = relayIceServers();

  void startWatch() {
    _watch?.cancel();
    _callEvents ??= FlutterCallkitIncoming.onEvent.listen(_onCallEvent);
    _watch = Timer.periodic(const Duration(seconds: 4), (_) => _peek());
    _loadIce();
    _peek();
  }

  Future<void> _onCallEvent(CallEvent? event) async {
    if (event is CallEventActionCallAccept) {
      await accept(callId: callIdFromScreen(event.callKitParams), name: event.callKitParams.nameCaller ?? '');
    } else if (event is CallEventActionCallDecline || event is CallEventActionCallEnded || event is CallEventActionCallTimeout) {
      if (phase == 'incoming') _reset();
    }
  }

  Future<void> answerIfWaiting() async {
    await _takePendingAccept();
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      for (final call in calls) {
        if (!call.isAccepted) continue;
        await accept(callId: callIdFromScreen(call), name: call.nameCaller ?? '');
        return;
      }
    } catch (_) {}
  }

  Future<void> _takePendingAccept() async {
    final prefs = await SharedPreferences.getInstance();
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
    await _takePendingAccept();
    if (phase != 'idle' && phase != 'incoming') return;
    final session = model.session;
    if (session == null) return;
    try {
      final call = await model.api.activeCall(session);
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
  }

  Future<void> startOutgoing(int userId, String name) async {
    if (phase != 'idle') return;
    final session = model.session;
    if (session == null) return;
    otherName = name;
    notice = '';
    phase = 'outgoing';
    notifyListeners();
    if (!await PhonePermissions.granted()) {
      _fail(phraseFromLocale('Turn on the microphone in phone settings to place a call.', 'کال کے لیے فون سیٹنگز میں مائیکروفون کھولیں۔'));
      return;
    }
    try {
      await _openMedia();
      final call = await model.api.startCall(session: session, userId: userId);
      _callId = asInt(call['id']);
      if (_callId == 0) {
        _fail('The call could not start.');
        return;
      }
      final offer = await _pc!.createOffer({'offerToReceiveAudio': 1});
      await _pc!.setLocalDescription(offer);
      await model.api.sendCallSignal(
        session: session,
        callId: _callId!,
        type: 'offer',
        payload: {'type': offer.type, 'sdp': offer.sdp},
      );
      _armSignals();
    } on ErpException {
      _fail('The call could not start.');
    } catch (_) {
      _fail(phraseFromLocale('Allow the microphone to place a call.', 'کال کے لیے مائیکروفون کی اجازت دیں۔'));
    }
  }

  Future<void> accept({int? callId, String? name}) async {
    if (callId != null && callId > 0) _callId = callId;
    if (name != null && name.trim().isNotEmpty) otherName = name.trim();
    final session = model.session;
    final id = _callId;
    if (session == null || id == null || id <= 0) return;
    if (phase == 'connected' || phase == 'outgoing') return;
    phase = 'incoming';
    notifyListeners();
    if (!await PhonePermissions.granted()) {
      await PhonePermissions.askOnce();
    }
    if (!await PhonePermissions.granted()) {
      notice = phraseFromLocale('Turn on the microphone in phone settings to answer.', 'جواب کے لیے فون سیٹنگز میں مائیکروفون کھولیں۔');
      notifyListeners();
      return;
    }
    try {
      await model.api.respondCall(session: session, callId: id, action: 'accept');
    } on ErpException {
      final live = await model.api.activeCall(session);
      final status = asText(live?['status']).toLowerCase();
      if (asInt(live?['id']) != id || status != 'accepted') {
        _fail('The call is no longer ringing.');
        return;
      }
    }
    phase = 'connected';
    notice = '';
    notifyListeners();
    if (_pc == null) await _openMedia();
    _armSignals();
    try {
      await FlutterCallkitIncoming.setCallConnected(callScreenId(id));
    } catch (_) {}
  }

  Future<void> decline() async {
    final session = model.session;
    final callId = _callId;
    if (session != null && callId != null && phase == 'incoming') {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('erp.skipMissedCall', callId);
      try {
        await model.api.respondCall(session: session, callId: callId, action: 'decline');
      } on ErpException {
        // Already gone.
      }
    }
    _reset();
  }

  Future<void> hangUp() async {
    final session = model.session;
    final callId = _callId;
    if (session != null && callId != null) {
      try {
        await model.api.endCall(session: session, callId: callId);
      } on ErpException {
        // The other side may already have ended it.
      }
    }
    _fail(phraseFromLocale('Call ended', 'کال ختم'));
  }

  Future<void> _openMedia() async {
    _local = await navigator.mediaDevices.getUserMedia({'audio': true, 'video': false});
    await Helper.setSpeakerphoneOn(true);
    _pc = await createPeerConnection({'iceServers': _ice});
    for (final track in _local!.getAudioTracks()) {
      await _pc!.addTrack(track, _local!);
    }
    _pc!.onIceCandidate = (candidate) {
      final callId = _callId;
      final session = model.session;
      if (callId == null || session == null || candidate.candidate == null || candidate.candidate!.isEmpty) return;
      model.api.sendCallSignal(
        session: session,
        callId: callId,
        type: 'ice',
        payload: {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
        },
      );
    };
    _pc!.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        phase = 'connected';
        notice = '';
        notifyListeners();
      }
    };
  }

  void _armSignals() {
    _signals?.cancel();
    _signals = Timer.periodic(const Duration(milliseconds: 800), (_) => _pullSignals());
  }

  Future<void> _pullSignals() async {
    if (_pulling) return;
    final session = model.session;
    final callId = _callId;
    final peer = _pc;
    if (session == null || callId == null || peer == null) return;
    _pulling = true;
    try {
      final rows = await model.api.callSignals(session: session, callId: callId, afterId: _afterSignal);
      for (final row in rows) {
        _afterSignal = asInt(row['id']) > _afterSignal ? asInt(row['id']) : _afterSignal;
        final type = asText(row['signal_type']);
        final payload = row['payload'] is Map ? Map<String, dynamic>.from(row['payload'] as Map) : const <String, dynamic>{};
        if (type == 'offer' && !_remoteReady) {
          await peer.setRemoteDescription(RTCSessionDescription(asText(payload['sdp']), asText(payload['type'])));
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
        } else if (type == 'answer' && peer.signalingState == RTCSignalingState.RTCSignalingStateHaveLocalOffer) {
          await peer.setRemoteDescription(RTCSessionDescription(asText(payload['sdp']), asText(payload['type'])));
          _remoteReady = true;
          await _flushIce(peer);
        } else if (type == 'ice') {
          final ice = RTCIceCandidate(asText(payload['candidate']), asText(payload['sdpMid']), asInt(payload['sdpMLineIndex']));
          if (_remoteReady) {
            await peer.addCandidate(ice);
          } else {
            _queuedIce.add(ice);
          }
        }
      }
      final live = await model.api.activeCall(session);
      final status = asText(live?['status']).toLowerCase();
      if (live == null || (status != 'ringing' && status != 'accepted')) {
        _fail(phraseFromLocale('Call ended', 'کال ختم'));
      }
    } on ErpException {
      return;
    } finally {
      _pulling = false;
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
    notice = message;
    phase = 'ended';
    _releaseMedia();
    notifyListeners();
    _dismiss?.cancel();
    _dismiss = Timer(const Duration(seconds: 2), _reset);
  }

  void _releaseMedia() {
    _signals?.cancel();
    _signals = null;
    _pc?.close();
    _pc = null;
    for (final track in _local?.getTracks() ?? const <MediaStreamTrack>[]) {
      track.stop();
    }
    _local = null;
    _remoteReady = false;
    _queuedIce.clear();
    _afterSignal = 0;
  }

  void _reset() {
    _releaseMedia();
    _callId = null;
    otherName = '';
    notice = '';
    phase = 'idle';
    notifyListeners();
  }

  @override
  void dispose() {
    _watch?.cancel();
    _callEvents?.cancel();
    _dismiss?.cancel();
    _releaseMedia();
    super.dispose();
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
      'incoming' => phrase(context, 'Incoming call', 'آنے والی کال'),
      'outgoing' => phrase(context, 'Calling', 'کال ہو رہی ہے'),
      'connected' => phrase(context, 'Connected', 'جڑ گئی'),
      _ => phrase(context, 'Call', 'کال'),
    };
    return Material(
      color: const Color(0xF0141210),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 36, 24, 28),
          child: Column(
            children: [
              const Spacer(),
              Container(
                width: 92,
                height: 92,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: hisbenewForest, shape: BoxShape.circle),
                child: Text(
                  desk.otherName.isEmpty ? 'H' : desk.otherName.characters.first.toUpperCase(),
                  style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 36, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                desk.otherName.isEmpty ? phrase(context, 'Hisbenew', 'ہزبینیو') : desk.otherName,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.4),
              ),
              const SizedBox(height: 8),
              Text(title, style: const TextStyle(color: Color(0xFFF3E6C8), fontWeight: FontWeight.w700)),
              if (desk.notice.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(desk.notice, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFD6CBBA))),
              ],
              const Spacer(),
              if (!ended && incoming)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    _AnswerButton(icon: Icons.call_end_rounded, color: const Color(0xFFE11D48), label: phrase(context, 'Decline', 'رد'), onTap: desk.decline),
                    _AnswerButton(icon: Icons.call_rounded, color: const Color(0xFF1F8A4C), label: phrase(context, 'Answer', 'جواب'), onTap: () => desk.accept()),
                  ],
                )
              else if (!ended)
                _AnswerButton(icon: Icons.call_end_rounded, color: const Color(0xFFE11D48), label: phrase(context, 'End', 'ختم'), onTap: desk.hangUp),
            ],
          ),
        ),
      ),
    );
  }
}

class _AnswerButton extends StatelessWidget {
  const _AnswerButton({required this.icon, required this.color, required this.label, required this.onTap});

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
            child: SizedBox(width: 76, height: 76, child: Icon(icon, color: Colors.white, size: 34)),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ],
    );
  }
}
