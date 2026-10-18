import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_callkit_incoming/entities/android_params.dart';
import 'package:flutter_callkit_incoming/entities/call_event.dart';
import 'package:flutter_callkit_incoming/entities/call_kit_params.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'erp_api.dart';
import 'phone_permissions.dart';

const missedCallChannel = 'hisbenew_calls';
const messageChannel = 'hisbenew_messages_lock';

List<Map<String, dynamic>> relayIceServers() => const [
  {'urls': 'stun:stun.l.google.com:19302'},
  {'urls': 'stun:stun1.l.google.com:19302'},
  {'urls': 'stun:stun.cloudflare.com:3478'},
];

List<Map<String, dynamic>> withRelay(List<Map<String, dynamic>> servers) {
  final seen = <String>{};
  final merged = <Map<String, dynamic>>[];
  for (final server in [...servers, ...relayIceServers()]) {
    final urls = '${server['urls']}';
    if (urls.isEmpty || !seen.add(urls)) continue;
    // Retired public relays answer slowly and never carry the call.
    if ('${server['username']}' == 'openrelayproject' || urls.contains('metered.ca')) continue;
    merged.add(server);
  }
  return merged;
}

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
      ringtonePath: 'hisbenew_ring',
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
final Set<int> _answeredCallIds = {};
final Set<int> _presentedIncoming = {};

void forgetIncomingScreen(int callId) {
  if (callId > 0) _presentedIncoming.remove(callId);
}

Future<void> showIncomingIfNeeded(int callId, String name) async {
  if (callId <= 0 || !_presentedIncoming.add(callId)) return;
  try {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    if (prefs.getInt('erp.skipMissedCall') == callId ||
        prefs.getInt('erp.pendingAcceptCall') == callId) {
      return;
    }
    await prefs.setString('erp.ringingName', name);
    await FlutterCallkitIncoming.showCallkitIncoming(incomingCallParams(callId: callId, name: name));
    await PhonePermissions.startIncomingRing();
  } catch (error) {
    _presentedIncoming.remove(callId);
    rethrow;
  }
}

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
    // A network/server error is not a remote hang-up.
    if (response.statusCode != 200) return;
    final body = response.body.trim();
    if (body == 'null') {
      await _hideShownCall();
      return;
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map) return;
    final callId = int.tryParse('${decoded['id']}') ?? 0;
    final incoming = decoded['is_incoming'] == true;
    final status = '${decoded['status'] ?? ''}'.toLowerCase();
    if (incoming && status == 'accepted') {
      await PhonePermissions.releaseCallTone();
      _answeredCallIds.add(callId);
      await FlutterCallkitIncoming.hideCallkitIncoming(
        incomingCallParams(callId: callId, name: ''),
      );
      return;
    }
    if (!incoming || status != 'ringing' || callId <= 0) {
      await _hideShownCall();
      return;
    }
    if (_shownIncomingId == callId) return;
    final name = '${decoded['other_user_name'] ?? ''}'.trim();
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    if (prefs.getInt('erp.skipMissedCall') == callId || prefs.getInt('erp.pendingAcceptCall') == callId) return;
    await showIncomingIfNeeded(callId, name);
    _shownIncomingId = callId;
  } catch (_) {}
}

Future<void> _hideShownCall() async {
  if (_shownIncomingId <= 0) return;
  final callId = _shownIncomingId;
  final screenId = callScreenId(callId);
  _shownIncomingId = 0;
  forgetIncomingScreen(callId);
  await PhonePermissions.stopIncomingRing();
  try {
    await FlutterCallkitIncoming.endCall(screenId);
  } catch (_) {}
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload();
  final skipped = prefs.getInt('erp.skipMissedCall') ?? 0;
  final accepted = prefs.getInt('erp.pendingAcceptCall') ?? 0;
  if (_answeredCallIds.contains(callId) ||
      skipped == callId ||
      accepted == callId) {
    return;
  }
  final name = prefs.getString('erp.ringingName') ?? '';
  await noteMissedCall(name);
}

Future<void> noteMissedCall(String name) async {
  final who = name.trim().isEmpty ? 'Hisbenew' : name.trim();
  final notes = FlutterLocalNotificationsPlugin();
  const android = AndroidInitializationSettings('@drawable/ic_stat_hisbenew');
  await notes.initialize(
    settings: const InitializationSettings(android: android),
  );
  final plugin = notes
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();
  await plugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      missedCallChannel,
      'Missed calls',
      description: 'When a call is not answered',
      importance: Importance.high,
    ),
  );
  await notes.show(
    id: 91001,
    title: 'Missed call',
    body: who,
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails(
        missedCallChannel,
        'Missed calls',
        channelDescription: 'When a call is not answered',
        importance: Importance.high,
        priority: Priority.high,
        icon: '@drawable/ic_stat_hisbenew',
      ),
    ),
  );
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
  await prefs.reload();
  if (action == 'accept') {
    await prefs.setInt('erp.pendingAcceptCall', callId);
    await prefs.setString('erp.pendingAcceptName', params.nameCaller ?? '');
    // The visible app owns permission, audio and the server acceptance together.
    return;
  } else {
    await prefs.setInt('erp.skipMissedCall', callId);
    await prefs.setInt('erp.pendingDeclineCall', callId);
  }
  final token = prefs.getString('erp.token') ?? '';
  if (token.isEmpty) return;
  try {
    final response = await http
        .post(
          Uri.parse('$erpApiBase/internal-calls/$callId/respond'),
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
          body: jsonEncode({
            'action': action == 'accept' ? 'accept' : 'decline',
          }),
        )
        .timeout(const Duration(seconds: 12));
    if (response.statusCode == 200 ||
        response.statusCode == 409 ||
        response.statusCode == 404) {
      await prefs.remove('erp.pendingDeclineCall');
    }
  } catch (_) {}
}

Future<void> retryPendingDecline(String token) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload();
  final id = prefs.getInt('erp.pendingDeclineCall') ?? 0;
  if (id <= 0) return;
  try {
    final response = await http
        .post(
          Uri.parse('$erpApiBase/internal-calls/$id/respond'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'action': 'decline'}),
        )
        .timeout(const Duration(seconds: 8));
    if ([200, 404, 409].contains(response.statusCode)) {
      await prefs.remove('erp.pendingDeclineCall');
    }
  } catch (_) {}
}
