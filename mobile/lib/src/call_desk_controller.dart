import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_callkit_incoming/entities/call_event.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'incoming_call.dart';
import 'phone_permissions.dart';
import 'voice_link.dart';

/// Controls internal calls over an authenticated WSS audio relay.
///
/// Sending voice through the existing API WebSocket avoids NAT-dependent ICE
/// setup and the native libjingle crash path on affected Android devices.
class CallDesk extends ChangeNotifier with WidgetsBindingObserver {
  CallDesk(this.model);

  final AppModel model;
  String phase = 'idle';
  String otherName = '';
  String notice = '';
  bool muted = false;
  bool speaker = true;

  Timer? _watch;
  Timer? _signals;
  Timer? _dismiss;
  Timer? _clock;
  Timer? _connectionTimeout;
  StreamSubscription<CallEvent?>? _callEvents;
  VoiceLink? _voiceLink;
  int? _callId;
  int _generation = 0;
  DateTime? _connectedAt;
  var _disposed = false;
  var _accepting = false;
  var _peeking = false;
  var _pulling = false;
  var _voiceRelayStarting = false;
  var _voiceRelayRetries = 0;

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

  void startWatch() {
    WidgetsBinding.instance.addObserver(this);
    _callEvents ??= FlutterCallkitIncoming.onEvent.listen(_onCallEvent);
    _watch?.cancel();
    _watch = Timer.periodic(const Duration(seconds: 2), (_) => _peek());
    unawaited(_peek());
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
          phase != 'idle') {
        await hangUp();
      }
    } else if (event is CallEventActionCallTimeout && phase == 'incoming') {
      await hangUp();
    }
  }

  Future<void> answerIfWaiting() async {
    await _takePendingAccept();
    try {
      for (final call in await FlutterCallkitIncoming.activeCalls()) {
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
        } else if (phase == 'incoming') {
          forgetIncomingScreen(_callId ?? 0);
          _reset();
        }
      } on ErpException {
        // Brief network loss should not dismiss an active incoming screen.
      }
    } finally {
      _peeking = false;
    }
  }

  Future<void> startOutgoing(int userId, String name) async {
    if (phase != 'idle') return;
    final session = model.session;
    if (session == null) return;
    final generation = ++_generation;
    otherName = name;
    notice = '';
    muted = false;
    speaker = true;
    phase = 'outgoing';
    _voiceRelayRetries = 0;
    notifyListeners();
    await PhonePermissions.startOutgoingRing();
    if (!await PhonePermissions.request()) {
      _fail('Turn on the microphone in phone settings to place a call.');
      return;
    }
    if (_disposed || generation != _generation) return;
    try {
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
      _armSignals();
      _armConnectionTimeout();
    } on ErpException catch (error) {
      if (!_disposed && generation == _generation) {
        _fail(error.detail);
      }
    } catch (_) {
      if (!_disposed && generation == _generation) {
        _fail('The call could not start. Check your connection.');
      }
    }
  }

  Future<void> accept({int? callId, String? name}) async {
    if (_disposed ||
        _accepting ||
        phase == 'connected' ||
        phase == 'connecting' ||
        phase == 'outgoing')
      return;
    await PhonePermissions.releaseCallTone();
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
      phase = 'incoming';
      notifyListeners();
      if (!await PhonePermissions.granted() &&
          !await PhonePermissions.request()) {
        notice = 'Turn on the microphone in phone settings to answer.';
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
      } catch (_) {
        Map<String, dynamic>? live;
        for (var attempt = 0; attempt < 3; attempt++) {
          try {
            live = await model.api.activeCall(session);
            break;
          } on ErpException {
            if (attempt == 2) rethrow;
            await Future<void>.delayed(
              Duration(milliseconds: 350 * (attempt + 1)),
            );
          }
        }
        if (asInt(live?['id']) != id ||
            asText(live?['status']).toLowerCase() != 'accepted') {
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
      await FlutterCallkitIncoming.hideCallkitIncoming(
        incomingCallParams(callId: id, name: otherName),
      );
      _armSignals();
      _armConnectionTimeout();
      await _connectVoiceRelay(id, generation);
    } on ErpException catch (error) {
      if (!_disposed && generation == _generation) _fail(error.detail);
    } catch (error) {
      if (!_disposed && generation == _generation) {
        _fail(
          error is PlatformException
              ? (error.message ?? 'Android could not enable the microphone.')
              : 'Could not connect call audio. Please try again.',
        );
      }
    } finally {
      _accepting = false;
    }
  }

  Future<void> decline({int? callId}) async {
    await PhonePermissions.stopIncomingRing();
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
      } catch (_) {
        await prefs.setInt('erp.pendingDeclineCall', callId);
      }
    }
    if (_callId == callId || _callId == null) _fail('Call declined');
  }

  Future<void> hangUp() async {
    final session = model.session;
    final callId = _callId;
    _fail('Call ended');
    if (session != null && callId != null) {
      try {
        await model.api.endCall(session: session, callId: callId);
      } on ErpException {
        // The other side may already have ended the call.
      }
    }
  }

  void _armSignals() {
    _signals?.cancel();
    _signals = Timer.periodic(
      const Duration(seconds: 1),
      (_) => _pullCallState(),
    );
    unawaited(_pullCallState());
  }

  Future<void> _pullCallState() async {
    if (_pulling || _disposed || phase == 'idle' || phase == 'ended') return;
    final session = model.session;
    final id = _callId;
    if (session == null || id == null) return;
    _pulling = true;
    final generation = _generation;
    try {
      final live = await model.api.callDetails(session, id);
      if (_disposed || generation != _generation || id != _callId) return;
      final status = asText(live['status']).toLowerCase();
      if (status == 'accepted' && phase == 'outgoing') {
        await PhonePermissions.releaseCallTone();
        phase = 'connecting';
        notice = '';
        notifyListeners();
        _armConnectionTimeout();
        unawaited(_connectVoiceRelay(id, generation));
      } else if (!{'ringing', 'accepted'}.contains(status)) {
        _fail(
          status == 'declined'
              ? 'Call declined'
              : status == 'missed'
              ? 'No answer'
              : 'Call ended',
        );
      }
    } on ErpException {
      // Preserve the call while the phone briefly changes networks.
    } finally {
      _pulling = false;
    }
  }

  Future<void> _connectVoiceRelay(int callId, int generation) async {
    if (_voiceRelayStarting || _voiceLink != null || _disposed) return;
    final session = model.session;
    if (session == null || _callId != callId || generation != _generation)
      return;
    _voiceRelayStarting = true;
    notice = _voiceRelayRetries == 0 ? '' : 'Reconnecting audio...';
    notifyListeners();
    try {
      await PhonePermissions.startVoiceService();
      if (_disposed || _callId != callId || generation != _generation) return;
      late final VoiceLink link;
      link = await VoiceLink.start(
        baseUrl: session.baseUrl,
        token: session.token,
        callId: callId,
        onReady: () => _markVoiceConnected(callId, generation),
        onEnded: () => _handleVoiceRelayEnded(callId, generation, link),
        onError: (message) {
          if (_callId != callId || generation != _generation || _disposed)
            return;
          notice = message;
          notifyListeners();
        },
      );
      if (_disposed || _callId != callId || generation != _generation) {
        await link.stop();
        return;
      }
      _voiceLink = link;
    } catch (error) {
      if (_callId == callId && generation == _generation && !_disposed) {
        notice = error is PlatformException && error.code.contains('microphone')
            ? 'Allow microphone access in phone settings to use calls.'
            : 'Could not start call audio. Check your connection and microphone permission.';
        notifyListeners();
        if (_voiceRelayRetries < 2) {
          _voiceRelayRetries++;
          Timer(
            const Duration(seconds: 1),
            () => _connectVoiceRelay(callId, generation),
          );
        }
      }
    } finally {
      _voiceRelayStarting = false;
    }
  }

  void _markVoiceConnected(int callId, int generation) {
    if (_disposed ||
        _callId != callId ||
        generation != _generation ||
        phase == 'ended' ||
        phase == 'idle')
      return;
    _connectionTimeout?.cancel();
    unawaited(PhonePermissions.releaseCallTone());
    _connectedAt ??= DateTime.now();
    _clock ??= Timer.periodic(
      const Duration(seconds: 1),
      (_) => notifyListeners(),
    );
    phase = 'connected';
    notice = '';
    notifyListeners();
    FlutterCallkitIncoming.setCallConnected(callScreenId(callId))
        .catchError((Object _) {});
  }

  void _handleVoiceRelayEnded(int callId, int generation, VoiceLink link) {
    if (_disposed ||
        _callId != callId ||
        generation != _generation ||
        _voiceLink != link ||
        phase == 'ended')
      return;
    _voiceLink = null;
    _clock?.cancel();
    _clock = null;
    _connectedAt = null;
    phase = 'connecting';
    _voiceRelayRetries++;
    notice = _voiceRelayRetries <= 2
        ? 'Reconnecting audio...'
        : 'The voice connection was lost.';
    notifyListeners();
    unawaited(link.stop());
    if (_voiceRelayRetries <= 2) {
      Timer(
        const Duration(seconds: 1),
        () => _connectVoiceRelay(callId, generation),
      );
    }
  }

  void _armConnectionTimeout() {
    _connectionTimeout?.cancel();
    final waitingForAnswer = phase == 'outgoing';
    _connectionTimeout = Timer(
      Duration(seconds: waitingForAnswer ? 65 : 30),
      () async {
        if (phase == 'connected' || _disposed) return;
        final session = model.session;
        final id = _callId;
        _fail(
          waitingForAnswer ? 'No answer' : 'Could not connect the voice line. Check the internet connection and try again.',
        );
        if (session != null && id != null) {
          try {
            await model.api.endCall(session: session, callId: id);
          } on ErpException {
            // The other side may already have ended the call.
          }
        }
      },
    );
  }

  void _fail(String message) {
    if (_disposed) return;
    ++_generation;
    notice = message;
    phase = 'ended';
    final id = _callId;
    if (id != null) {
      forgetIncomingScreen(id);
      FlutterCallkitIncoming.endCall(callScreenId(id))
          .catchError((Object _) {});
    }
    _releaseMedia();
    notifyListeners();
    _dismiss?.cancel();
    _dismiss = Timer(const Duration(seconds: 2), _reset);
  }

  void _releaseMedia() {
    _clock?.cancel();
    _clock = null;
    _connectionTimeout?.cancel();
    _connectedAt = null;
    _signals?.cancel();
    _signals = null;
    final link = _voiceLink;
    _voiceLink = null;
    if (link != null) unawaited(link.stop());
    unawaited(PhonePermissions.stopVoiceRelay());
    unawaited(PhonePermissions.stopVoiceService());
    _voiceRelayStarting = false;
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
    _voiceLink?.setMuted(muted);
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    try {
      speaker = !speaker;
      await PhonePermissions.setVoiceSpeaker(speaker);
      notifyListeners();
    } catch (_) {
      notice = 'Audio output could not be changed';
      notifyListeners();
    }
  }
}
