import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_callkit_incoming/entities/android_params.dart';
import 'package:flutter_callkit_incoming/entities/call_event.dart';
import 'package:flutter_callkit_incoming/entities/call_kit_params.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'erp_api.dart';

String callScreenId(int callId) {
  final tail = callId.toRadixString(16).padLeft(12, '0');
  return '00000000-0000-4000-8000-$tail';
}

int callIdFromScreen(CallKitParams params) {
  return int.tryParse('${params.extra?['callId']}') ?? 0;
}

CallKitParams incomingCallParams({required int callId, required String name}) {
  return CallKitParams(
    id: callScreenId(callId),
    nameCaller: name.isEmpty ? 'Hisbenew' : name,
    appName: 'Hisbenew',
    handle: 'Voice call',
    type: 0,
    duration: 55000,
    extra: {'callId': callId},
    android: const AndroidParams(
      isCustomNotification: true,
      isShowFullLockedScreen: true,
      isFullScreen: true,
      isImportant: true,
      ringtonePath: 'system_ringtone_default',
      backgroundColor: '#141210',
      actionColor: '#1F4D3A',
      textColor: '#F3E6C8',
      incomingCallNotificationChannelName: 'Incoming calls',
      textAccept: 'Answer',
      textDecline: 'Decline',
    ),
  );
}

var _shownIncomingId = 0;

Future<void> watchIncomingCall(String token) async {
  try {
    final response = await http
        .get(
          Uri.parse('$erpApiBase/internal-calls/active'),
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          },
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode == 401) return;
    final body = response.body.trim();
    if (response.statusCode != 200 || body.isEmpty || body == 'null') {
      await _hideShownCall();
      return;
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map) {
      await _hideShownCall();
      return;
    }
    final callId = int.tryParse('${decoded['id']}') ?? 0;
    final incoming = decoded['is_incoming'] == true;
    final status = '${decoded['status'] ?? ''}'.toLowerCase();
    if (incoming && status == 'accepted') return;
    if (!incoming || status != 'ringing' || callId <= 0) {
      await _hideShownCall();
      return;
    }
    if (_shownIncomingId == callId) return;
    _shownIncomingId = callId;
    final name = '${decoded['other_user_name'] ?? ''}'.trim();
    await FlutterCallkitIncoming.showCallkitIncoming(incomingCallParams(callId: callId, name: name));
  } catch (_) {}
}

Future<void> _hideShownCall() async {
  if (_shownIncomingId <= 0) return;
  final id = callScreenId(_shownIncomingId);
  _shownIncomingId = 0;
  try {
    await FlutterCallkitIncoming.endCall(id);
  } catch (_) {}
}

@pragma('vm:entry-point')
Future<void> onIncomingCallBackground(CallEvent event) async {
  WidgetsFlutterBinding.ensureInitialized();
  final CallKitParams params;
  final String action;
  if (event is CallEventActionCallAccept) {
    params = event.callKitParams;
    action = 'accept';
  } else if (event is CallEventActionCallDecline) {
    params = event.callKitParams;
    action = 'decline';
  } else {
    return;
  }
  final callId = callIdFromScreen(params);
  if (callId <= 0) return;
  final prefs = await SharedPreferences.getInstance();
  if (action == 'accept') {
    await prefs.setInt('erp.pendingAcceptCall', callId);
    await prefs.setString('erp.pendingAcceptName', params.nameCaller ?? '');
  }
  final token = prefs.getString('erp.token') ?? '';
  if (token.isEmpty) return;
  try {
    await http
        .post(
          Uri.parse('$erpApiBase/internal-calls/$callId/respond'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'action': action == 'accept' ? 'accept' : 'decline'}),
        )
        .timeout(const Duration(seconds: 12));
  } catch (_) {}
}
