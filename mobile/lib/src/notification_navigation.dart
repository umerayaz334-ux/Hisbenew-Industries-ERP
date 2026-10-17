import 'package:flutter/foundation.dart';

final notificationChat = ValueNotifier<int?>(null);

void openNotificationPayload(String? payload) {
  if (payload == null || !payload.startsWith('chat:')) return;
  final id = int.tryParse(payload.substring(5));
  if (id != null && id > 0) notificationChat.value = id;
}
