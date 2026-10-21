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
import 'notification_navigation.dart';

const _watchChannelId = 'hisbenew_watch';
const _alertChannelId = 'hisbenew_orders_lock_v2';

final _notifications = FlutterLocalNotificationsPlugin();

Future<void> startOrderWatch() async {
  if (!Platform.isAndroid) return;
  await _prepareNotifications();
  final service = FlutterBackgroundService();
  await service.configure(
    androidConfiguration: AndroidConfiguration(
      onStart: orderWatchStart,
      autoStart: false,
      autoStartOnBoot: false,
      isForegroundMode: true,
      notificationChannelId: _watchChannelId,
      initialNotificationTitle: 'Hisbenew',
      initialNotificationContent: 'Message alerts are on',
      foregroundServiceNotificationId: 701,
      foregroundServiceTypes: const [AndroidForegroundType.dataSync],
    ),
    iosConfiguration: IosConfiguration(
      autoStart: false,
      onForeground: orderWatchStart,
    ),
  );
  await FlutterCallkitIncoming.onBackgroundMessage(onIncomingCallBackground);
  if (!await FlutterCallkitIncoming.canUseFullScreenIntent()) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    if (prefs.getBool('erp.fullScreenAsked') != true) {
      await prefs.setBool('erp.fullScreenAsked', true);
      await FlutterCallkitIncoming.requestFullIntentPermission();
    }
  }
  // Restarting on every open posts the same chat notices again.
  if (await service.isRunning()) return;
  await service.startService();
}

Future<void> stopOrderWatch() async {
  if (!Platform.isAndroid) return;
  final service = FlutterBackgroundService();
  if (await service.isRunning()) {
    service.invoke('stop');
  }
  await _notifications.cancelAll();
}

Future<void> refreshMessageNotifications({int? eventId}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload();
  final token = prefs.getString('erp.token') ?? '';
  if (token.isEmpty) return;
  await _notifications.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@drawable/ic_stat_hisbenew'),
    ),
    onDidReceiveNotificationResponse: (response) =>
        openNotificationPayload(response.payload),
  );
  await _watchMessages(prefs, token, _notifications, eventId: eventId);
}

Future<void> refreshOrderNotifications({int? eventId}) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.reload();
  final token = prefs.getString('erp.token') ?? '';
  if (token.isEmpty || prefs.getString('erp.role')?.toLowerCase() != 'worker')
    return;
  await _notifications.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@drawable/ic_stat_hisbenew'),
    ),
  );
  await _watchOrders(prefs, token, _notifications, eventId: eventId);
}

Future<void> _prepareNotifications() async {
  const android = AndroidInitializationSettings('@drawable/ic_stat_hisbenew');
  await _notifications.initialize(
    settings: const InitializationSettings(android: android),
    onDidReceiveNotificationResponse: (response) =>
        openNotificationPayload(response.payload),
  );
  final launch = await _notifications.getNotificationAppLaunchDetails();
  if (launch?.didNotificationLaunchApp == true) {
    openNotificationPayload(launch?.notificationResponse?.payload);
  }
  final plugin = _notifications
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();
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
      playSound: true,
      enableVibration: true,
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
  var watchingCalls = false;
  Future<void> tickCalls() async {
    if (watchingCalls) return;
    watchingCalls = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final token = prefs.getString('erp.token') ?? '';
      if (token.isNotEmpty) {
        await retryPendingDecline(token);
        await watchIncomingCall(token);
      }
    } finally {
      watchingCalls = false;
    }
  }

  final callWatch = Timer.periodic(
    const Duration(seconds: 2),
    (_) => tickCalls(),
  );
  service.on('checkIncoming').listen((_) => tickCalls());
  tickCalls();
  if (service is AndroidServiceInstance) {
    service.on('stop').listen((_) {
      callWatch.cancel();
      service.stopSelf();
    });
  }

  final notes = FlutterLocalNotificationsPlugin();
  await notes.initialize(
    settings: const InitializationSettings(
      android: AndroidInitializationSettings('@drawable/ic_stat_hisbenew'),
    ),
  );
  await notes
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >()
      ?.createNotificationChannel(
        const AndroidNotificationChannel(
          messageChannel,
          'Messages',
          description: 'When someone sends a chat message',
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
        ),
      );
  while (true) {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    final token = prefs.getString('erp.token') ?? '';
    final role = (prefs.getString('erp.role') ?? '').toLowerCase();
    if (token.isEmpty) {
      callWatch.cancel();
      await service.stopSelf();
      return;
    }

    if (role == 'worker') {
      await _watchOrders(prefs, token, notes);
    }
    await _watchMessages(prefs, token, notes);
    await Future<void>.delayed(const Duration(seconds: 4));
  }
}

Future<void> _watchOrders(
  SharedPreferences prefs,
  String token,
  FlutterLocalNotificationsPlugin notes, {
  int? eventId,
}) async {
  final known = prefs.containsKey('erp.orderAlertAfter');
  final storedAfterId = prefs.getInt('erp.orderAlertAfter') ?? 0;
  final afterId = !known && eventId != null && eventId > 0
      ? eventId - 1
      : storedAfterId;
  try {
    final uri = Uri.parse(
      known
          ? '$erpApiBase/worker-order-alerts?after_id=$afterId'
          : !known && (eventId == null || eventId <= 0)
          ? '$erpApiBase/worker-order-alerts?seed=true'
          : '$erpApiBase/worker-order-alerts?after_id=$afterId',
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
      await prefs.reload();
      if (prefs.getString('erp.token') != token) return;
      final body = jsonDecode(response.body);
      if (body is Map) {
        final latest = int.tryParse('${body['latest_id']}') ?? afterId;
        final rawOrders = body['orders'];
        final orders = rawOrders is List
            ? [
                for (final row in rawOrders)
                  if (row is Map) row,
              ]
            : const <Map>[];
        if (!known && (eventId == null || eventId <= 0)) {
          await prefs.setInt('erp.orderAlertAfter', latest);
        } else if (orders.isNotEmpty) {
          await _notify(notes, orders);
          await prefs.setInt('erp.orderAlertAfter', latest);
        }
      }
    }
  } catch (_) {}
}

Future<void> _watchMessages(
  SharedPreferences prefs,
  String token,
  FlutterLocalNotificationsPlugin notes, {
  int? eventId,
}) async {
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
    await prefs.reload();
    if (prefs.getString('erp.token') != token) return;
    final body = jsonDecode(response.body);
    if (body is! List) return;
    var unread = 0;
    final account =
        '${prefs.getString('erp.tenantSlug')}|${prefs.getString('erp.username')}';
    final seededKey = 'erp.messageAlertSeeded.$account';
    final seeded = prefs.getBool(seededKey) == true;
    for (final row in body) {
      if (row is! Map) continue;
      final count = int.tryParse('${row['unread_count']}') ?? 0;
      unread += count;
      final senderId = int.tryParse('${row['id']}') ?? 0;
      if (senderId <= 0) continue;
      final notificationId = 100000 + senderId;
      if (count == 0) {
        await notes.cancel(id: notificationId);
        continue;
      }
      final messageId = int.tryParse('${row['unread_message_id']}') ?? 0;
      // Per-conversation message cursors also detect arrivals when another
      // conversation is read and the total unread count stays unchanged.
      final cursor = 'erp.messageAlert.$account.$senderId';
      final marker = messageId > 0 ? '$messageId' : '${row['last_message_at']}';
      await prefs.reload();
      if (prefs.getString(cursor) == marker) continue;
      if (!seeded &&
          (eventId == null || eventId <= 0 || messageId != eventId)) {
        await prefs.setString(cursor, marker);
        continue;
      }
      final name = '${row['name'] ?? ''}'.trim();
      final who = name.isEmpty ? 'New message' : name;
      final preview = '${row['unread_message_preview'] ?? ''}'.trim();
      final text = preview.isEmpty ? 'Sent you a message' : preview;
      final timestamp =
          DateTime.tryParse('${row['unread_message_at']}') ?? DateTime.now();
      final recent = row['unread_messages'] is List
          ? row['unread_messages'] as List
          : const [];
      await notes.show(
        id: notificationId,
        title: who,
        body: text,
        payload: 'chat:$senderId',
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            messageChannel,
            'Messages',
            channelDescription: 'Chat messages on the lock screen',
            importance: Importance.max,
            priority: Priority.max,
            category: AndroidNotificationCategory.message,
            visibility: NotificationVisibility.public,
            audioAttributesUsage: AudioAttributesUsage.notification,
            autoCancel: true,
            playSound: true,
            enableVibration: true,
            color: const Color(0xFF215C4A),
            number: count,
            icon: '@drawable/ic_stat_hisbenew',
            styleInformation: MessagingStyleInformation(
              const Person(name: 'You'),
              groupConversation: false,
              messages: recent.isEmpty
                  ? [
                      Message(
                        text,
                        timestamp,
                        Person(name: who, key: '$senderId'),
                      ),
                    ]
                  : [
                      for (final entry in recent.whereType<Map>())
                        Message(
                          '${entry['body'] ?? ''}',
                          DateTime.tryParse('${entry['created_at']}') ??
                              timestamp,
                          Person(name: who, key: '$senderId'),
                        ),
                    ],
            ),
          ),
        ),
      );
      await prefs.reload();
      if (prefs.getString(cursor) == marker) continue;
      await prefs.setString(cursor, marker);
    }
    await prefs.reload();
    if (!seeded) await prefs.setBool(seededKey, true);
    await prefs.setInt('erp.chatUnread', unread);
  } catch (_) {}
}

Future<void> _notify(
  FlutterLocalNotificationsPlugin notes,
  List<Map> orders,
) async {
  final last = orders.last;
  final count = orders.length;
  final orderNo = '${last['order_no'] ?? ''}'.trim();
  final source = '${last['source'] ?? 'Office'}'.trim();
  final units = int.tryParse('${last['units']}') ?? 0;
  final unitText = units == 1 ? '1 unit' : '$units units';
  final title = count == 1
      ? 'New order ${orderNo.isEmpty ? '' : '#$orderNo'}'.trim()
      : '$count new orders';
  final body = count == 1
      ? '$source · $unitText'
      : '$source · latest ${orderNo.isEmpty ? '' : '#$orderNo'}'.trim();
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
        priority: Priority.max,
        visibility: NotificationVisibility.public,
        playSound: true,
        enableVibration: true,
        autoCancel: true,
        category: AndroidNotificationCategory.status,
        icon: '@drawable/ic_stat_hisbenew',
        styleInformation: BigTextStyleInformation(body),
      ),
    ),
  );
}
