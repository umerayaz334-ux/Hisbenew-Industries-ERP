import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'erp_api.dart';
import 'incoming_call.dart';
import 'offline_store.dart';
import 'order_watch.dart';

@pragma('vm:entry-point')
Future<void> receiveMobilePush(RemoteMessage message) async {
  await Firebase.initializeApp();
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload();
  // Ignore queued pushes from a previous account on a shared phone.
  if (message.data['binding'] != prefs.getString('erp.pushBinding')) return;
  final token = prefs.getString('erp.token') ?? '';
  if (token.isEmpty) return;
  if (message.data['kind'] == 'call') {
    await watchIncomingCall(token);
  } else if (message.data['kind'] == 'message') {
    await refreshMessageNotifications();
  }
}

class MobilePush {
  static StreamSubscription<String>? _tokens;
  static StreamSubscription<RemoteMessage>? _messages;

  static Future<void> start() async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(receiveMobilePush);
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString('erp.pushBinding') == null) {
        await prefs.setString('erp.pushBinding', OfflineStore.newId());
      }
      await FirebaseMessaging.instance.requestPermission();
      // Python Admin SDK sends to FCM registration tokens, not installation IDs.
      // ignore: deprecated_member_use
      _tokens ??= FirebaseMessaging.instance.onTokenRefresh.listen((token) => _register(token));
      _messages ??= FirebaseMessaging.onMessage.listen(receiveMobilePush);
      // ignore: deprecated_member_use
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _register(token);
    } catch (_) {
      // No Firebase project in development builds: keep the polling fallback.
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('erp.pushReady', false);
    }
  }

  static Future<void> _register(String deviceToken) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('erp.token') ?? '';
    final binding = prefs.getString('erp.pushBinding');
    if (token.isEmpty || binding == null) return;
    try {
      final response = await http.post(Uri.parse('$erpApiBase/mobile-push/device'),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
        body: jsonEncode({'token': deviceToken, 'binding': binding}),
      ).timeout(const Duration(seconds: 10));
      await prefs.setString('erp.pushToken', deviceToken);
      await prefs.setBool('erp.pushReady', response.statusCode == 200 && jsonDecode(response.body)['enabled'] == true);
    } catch (_) {
      await prefs.setBool('erp.pushReady', false);
    }
  }

  static Future<void> stop() async {
    final prefs = await SharedPreferences.getInstance();
    final binding = prefs.getString('erp.pushBinding');
    final deviceToken = prefs.getString('erp.pushToken');
    final token = prefs.getString('erp.token');
    // Invalidate locally before any network request, including when offline.
    await prefs.remove('erp.pushBinding');
    await prefs.remove('erp.pushToken');
    await prefs.setBool('erp.pushReady', false);
    await _tokens?.cancel();
    await _messages?.cancel();
    _tokens = null;
    _messages = null;
    if (binding == null || deviceToken == null || token == null) return;
    try {
      await http.delete(Uri.parse('$erpApiBase/mobile-push/device'),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
        body: jsonEncode({'token': deviceToken, 'binding': binding}),
      ).timeout(const Duration(seconds: 5));
    } catch (_) { /* The old binding is rejected on this phone. */ }
  }
}
