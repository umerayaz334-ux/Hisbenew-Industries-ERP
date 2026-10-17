import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/widgets.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'erp_api.dart';
import 'incoming_call.dart';

const _watchChannelId = 'hisbenew_watch';
const _alertChannelId = 'hisbenew_orders';

final _notifications = FlutterLocalNotificationsPlugin();

Future<void> startOrderWatch({bool orders = false}) async {
  if (!Platform.isAndroid) return;
  await _prepareNotifications();
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: orderWatchStart,
      autoStart: false,
      autoStartOnBoot: true,
      isForegroundMode: true,
      notificationChannelId: _watchChannelId,
      initialNotificationTitle: 'Hisbenew',
      initialNotificationContent: orders ? 'New orders will alert this phone' : 'Messages and calls stay available',
      foregroundServiceNotificationId: 701,
      foregroundServiceTypes: const [AndroidForegroundType.dataSync],
    ),
    iosConfiguration: IosConfiguration(autoStart: false, onForeground: orderWatchStart),
  );
  await FlutterCallkitIncoming.onBackgroundMessage(onIncomingCallBackground);
  if (!await FlutterCallkitIncoming.canUseFullScreenIntent()) {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool('erp.fullScreenAsked') != true) {
      await prefs.setBool('erp.fullScreenAsked', true);
      await FlutterCallkitIncoming.requestFullIntentPermission();
    }
  }
  if (!await service.isRunning()) {
    await service.startService();
  }
}

Future<void> stopOrderWatch() async {
  if (!Platform.isAndroid) return;
  final service = FlutterBackgroundService();
  if (await service.isRunning()) {
    service.invoke('stop');
  }
}

Future<void> _prepareNotifications() async {
  const android = AndroidInitializationSettings('@mipmap/ic_launcher');
  await _notifications.initialize(settings: const InitializationSettings(android: android));
  final plugin = _notifications.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
  await plugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      _watchChannelId,
      'Order watch',
      description: 'Keeps new-order alerts available when the app is closed',
      importance: Importance.low,
      playSound: false,
      enableVibration: false,
    ),
  );
  await plugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      _alertChannelId,
      'New orders',
      description: 'When the office or Muse adds an order',
      importance: Importance.max,
    ),
  );
  await plugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      messageChannel,
      'Messages',
      description: 'When someone sends a chat message',
      importance: Importance.max,
    ),
  );
  await plugin?.createNotificationChannel(
    const AndroidNotificationChannel(
      missedCallChannel,
      'Missed calls',
      description: 'When a call is not answered',
      importance: Importance.high,
    ),
  );
  await plugin?.requestNotificationsPermission();
}

@pragma('vm:entry-point')
Future<void> orderWatchStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();
  WidgetsFlutterBinding.ensureInitialized();
  if (service is AndroidServiceInstance) {
    service.on('stop').listen((_) {
      service.stopSelf();
    });
  }

  final notes = FlutterLocalNotificationsPlugin();
  await notes.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));

  while (true) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final token = prefs.getString('erp.token') ?? '';
    final role = (prefs.getString('erp.role') ?? '').toLowerCase();
    if (token.isEmpty) {
      await service.stopSelf();
      return;
    }

    if (role == 'worker') {
      await _watchOrders(prefs, token, notes);
    }
    await _watchMessages(prefs, token, notes);
    await watchIncomingCall(token);
    await Future<void>.delayed(const Duration(seconds: 4));
  }
}

Future<void> _watchOrders(SharedPreferences prefs, String token, FlutterLocalNotificationsPlugin notes) async {
  final known = prefs.containsKey('erp.orderAlertAfter');
  final afterId = prefs.getInt('erp.orderAlertAfter') ?? 0;
  try {
    final uri = Uri.parse(
      known ? '$erpApiBase/worker-order-alerts?after_id=$afterId' : '$erpApiBase/worker-order-alerts?seed=true',
    );
    final response = await http
        .get(
          uri,
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode == 401 || response.statusCode == 403) return;
    if (response.statusCode == 200 && response.body.isNotEmpty) {
      final body = jsonDecode(response.body);
      if (body is Map) {
        final latest = int.tryParse('${body['latest_id']}') ?? afterId;
        final rawOrders = body['orders'];
        final orders = rawOrders is List ? [for (final row in rawOrders) if (row is Map) row] : const <Map>[];
        if (!known) {
          await prefs.setInt('erp.orderAlertAfter', latest);
        } else if (orders.isNotEmpty) {
          await _notify(notes, orders);
          await prefs.setInt('erp.orderAlertAfter', latest);
        }
      }
    }
  } catch (_) {}
}

Future<void> _watchMessages(SharedPreferences prefs, String token, FlutterLocalNotificationsPlugin notes) async {
  try {
    final response = await http
        .get(
          Uri.parse('$erpApiBase/internal-message-users'),
          headers: {
            'Accept': 'application/json',
            'Authorization': 'Bearer $token',
          },
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200 || response.body.isEmpty) return;
    final body = jsonDecode(response.body);
    if (body is! List) return;
    var unread = 0;
    var latest = '';
    var name = '';
    for (final row in body) {
      if (row is! Map) continue;
      final count = int.tryParse('${row['unread_count']}') ?? 0;
      unread += count;
      final at = '${row['last_message_at'] ?? ''}';
      if (count > 0 && at.compareTo(latest) > 0) {
        latest = at;
        name = '${row['name'] ?? ''}'.trim();
      }
    }
    await prefs.setInt('erp.chatUnread', unread);
    final seen = prefs.getInt('erp.chatUnreadSeen');
    await prefs.setInt('erp.chatUnreadSeen', unread);
    if (seen == null || unread <= seen) return;
    final who = name.isEmpty ? 'Someone' : name;
    await notes.show(
      id: 92001,
      title: 'New message',
      body: who,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          messageChannel,
          'Messages',
          channelDescription: 'When someone sends a chat message',
          importance: Importance.max,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
        ),
      ),
    );
  } catch (_) {}
}

Future<void> _notify(FlutterLocalNotificationsPlugin notes, List<Map> orders) async {
  final last = orders.last;
  final count = orders.length;
  final orderNo = '${last['order_no'] ?? ''}'.trim();
  final source = '${last['source'] ?? 'Office'}'.trim();
  final units = int.tryParse('${last['units']}') ?? 0;
  final unitText = units == 1 ? '1 unit' : '$units units';
  final title = count == 1 ? 'New order ${orderNo.isEmpty ? '' : '#$orderNo'}'.trim() : '$count new orders';
  final body = count == 1 ? '$source · $unitText' : '$source · latest ${orderNo.isEmpty ? '' : '#$orderNo'}'.trim();
  final id = int.tryParse('${last['id']}') ?? 88001;
  await notes.show(
    id: id,
    title: title,
    body: body,
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        _alertChannelId,
        'New orders',
        channelDescription: 'When the office or Muse adds an order',
        importance: Importance.max,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
        styleInformation: BigTextStyleInformation(body),
      ),
    ),
  );
}
