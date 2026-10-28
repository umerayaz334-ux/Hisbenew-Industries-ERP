import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'dashboard_data.dart';
import 'offline_store.dart';
import 'product_image_cache.dart';

const erpApiBase = 'https://api.hisbenew.com';

class ErpException implements Exception {
  const ErpException(this.code, {this.detail = '', this.statusCode});

  final String code;
  final String detail;
  final int? statusCode;
}

class ErpSession {
  const ErpSession({
    required this.baseUrl,
    required this.token,
    required this.name,
    required this.username,
    required this.role,
    required this.workerId,
    required this.tenantSlug,
    required this.tenantName,
    required this.companyCode,
  });

  final String baseUrl;
  final String token;
  final String name;
  final String username;
  final String role;
  final int workerId;
  final String tenantSlug;
  final String tenantName;
  final String companyCode;

  Map<String, String> toStorage() {
    return {
      'baseUrl': baseUrl,
      'token': token,
      'name': name,
      'username': username,
      'role': role,
      'workerId': '$workerId',
      'tenantSlug': tenantSlug,
      'tenantName': tenantName,
      'companyCode': companyCode,
    };
  }

  factory ErpSession.fromStorage(Map<String, String> values) {
    return ErpSession(
      baseUrl: values['baseUrl'] ?? '',
      token: values['token'] ?? '',
      name: values['name'] ?? '',
      username: values['username'] ?? '',
      role: values['role'] ?? '',
      workerId: int.tryParse(values['workerId'] ?? '') ?? 0,
      tenantSlug: values['tenantSlug'] ?? '',
      tenantName: values['tenantName'] ?? '',
      companyCode: values['companyCode'] ?? '',
    );
  }
}

class ErpApi {
  ErpApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  final offline = OfflineStore();
  Future<List<String>> pageAccess(ErpSession session) async {
    final result = await _send(method: 'GET', url: '${session.baseUrl}/mobile-access', token: session.token);
    return (result['allowed_pages'] as List).cast<String>();
  }
  Future<void>? _syncing;
  Future<List<Map<String, dynamic>>> pendingSync(ErpSession session) async => [
    for (final row in await offline.expenses(_account(session))) {...row, 'kind': 'Spending'},
    for (final row in await offline.messages(_account(session))) {...row, 'kind': 'Message'},
  ];
  String _syncError(ErpException error) => switch (error.code) {
    'invalidLogin' => 'Sign in again to sync your saved items.',
    'unreachable' => 'Cannot reach the server. Will retry automatically.',
    'denied' => error.detail.isEmpty ? 'Your account does not have access. Ask your admin to restore it.' : error.detail,
    _ => error.statusCode == 404 ? 'Server update required for offline sync. Your entries remain saved.' : error.detail.isEmpty ? 'The server could not save this entry. Will retry.' : error.detail,
  };
  String _account(ErpSession session) => '${session.baseUrl}|${session.tenantSlug}|${session.username}|${session.workerId}';

  final _listRequests = <String, Future<List<Map<String, dynamic>>>>{};
  final _memoryLists = <String, List<Map<String, dynamic>>>{};
  String _listKey(ErpSession session, String path) => '${_account(session)}|$path';
  List<Map<String, dynamic>>? peekList(ErpSession session, String path) => _memoryLists[_listKey(session, path)];
  Future<List<Map<String, dynamic>>?> rememberedList(ErpSession session, String path) async {
    final hot = peekList(session, path);
    if (hot != null) return hot;
    final saved = await savedList(session, path);
    if (saved != null) _memoryLists[_listKey(session, path)] = saved;
    return saved;
  }
  void warmLists(ErpSession session) {
    for (final path in const [
      '/products',
      '/orders',
      '/shipping/pending',
      '/shipping',
      '/manufacturing/dispatch-needs',
      '/customers',
      '/internal-message-users',
    ]) {
      if (_memoryLists.containsKey(_listKey(session, path))) continue;
      unawaited(_cachedList(session, path).then<void>((_) {}, onError: (Object _) {}));
    }
  }
  Future<List<Map<String, dynamic>>> _cachedList(ErpSession session, String path) {
    final key = '${session.token}|${_account(session)}|$path';
    return _listRequests.putIfAbsent(key, () => _loadList(session, path).whenComplete(() { _listRequests.remove(key); }));
  }
  Future<List<Map<String, dynamic>>> _loadList(ErpSession session, String path) async {
    final key = _listKey(session, path);
    try {
      final rows = await _sendList(url: '${session.baseUrl}$path', token: session.token).timeout(const Duration(seconds: 8));
      _memoryLists[key] = rows;
      unawaited(() async {
        try {
          await offline.saveCache(_account(session), path, rows);
        } catch (_) {}
      }());
      unawaited(ProductImageCache.instance.prefetch(rows, limit: 6));
      return rows;
    } on TimeoutException {
      offline.markOffline();
      return _memoryLists[key] ?? await offline.cache(_account(session), path) ?? [];
    } on ErpException catch (error) {
      if (error.code == 'invalidLogin' || error.code == 'denied') rethrow;
      if (error.code != 'denied') offline.markOffline();
      return _memoryLists[key] ?? await offline.cache(_account(session), path) ?? [];
    }
  }

  Future<void> syncExpenses(ErpSession session) => _syncing ??= _syncExpenses(session).whenComplete(() => _syncing = null);
  Future<void> _syncExpenses(ErpSession session) async {
    final account = _account(session);
    await offline.refresh(account);
    final rows = await offline.expenses(account);
    if (rows.isEmpty) return;
    try {
      final capabilities = await _send(method: 'GET', url: '${session.baseUrl}/worker-expenses/sync-capabilities', token: session.token).timeout(const Duration(seconds: 8));
      if (capabilities['idempotent_expenses'] != true) {
        offline.notice('Saved on this phone. Server update required before syncing.');
        return;
      }
      var failed = 0;
      for (final row in rows) {
        try {
        final saved = await _send(method: 'POST', url: '${session.baseUrl}/worker-expenses', token: session.token, body: row).timeout(const Duration(seconds: 12));
        if (saved['client_request_id'] != row['client_request_id']) {
          offline.notice('Saved locally. Server sync confirmation is missing.');
          return;
        }
        // Cache the confirmed row before removing it from the outbox.
        final path = '/worker-expenses?worker_id=${session.workerId}';
        final cached = await offline.cache(account, path) ?? [];
        cached.removeWhere((item) => item['id'] == saved['id'] || item['client_request_id'] == row['client_request_id']);
        cached.add(saved);
        await offline.saveCache(account, path, cached);
        await offline.acknowledge(account, '${row['client_request_id']}');
        } on ErpException catch (error) {
          failed++;
          await offline.recordFailure(account, 'outbox', '${row['client_request_id']}', _syncError(error));
          if (error.code == 'unreachable' || error.code == 'invalidLogin') rethrow;
        } on TimeoutException {
          await offline.recordFailure(account, 'outbox', '${row['client_request_id']}', 'Server did not respond. Retrying with the same entry ID.');
          rethrow;
        }
      }
      offline.notice(failed == 0 ? '' : '$failed spending entries need attention. Tap to view the reason.');
    } on TimeoutException {
      offline.markOffline();
      offline.notice('Saved on this phone. Sync will retry automatically.');
    } on ErpException catch (error) {
      if (error.code == 'unreachable') offline.markOffline();
      offline.notice(_syncError(error));
    } on StateError {
      offline.notice('Phone storage is unavailable. Your pending spending has not been removed.');
    }
  }

  Future<ErpSession> login({
    required String username,
    required String pin,
  }) async {
    final body = await _send(
      method: 'POST',
      url: '$erpApiBase/login',
      body: {
        'username': username.trim(),
        'pin': pin.trim(),
      },
    );
    final token = asText(body['access_token']);
    if (token.isEmpty) throw const ErpException('server');
    return ErpSession(
      baseUrl: erpApiBase,
      token: token,
      name: asText(body['name']),
      username: asText(body['username']).isEmpty ? username.trim() : asText(body['username']),
      role: asText(body['role']),
      workerId: asInt(body['worker_id']),
      tenantSlug: asText(body['tenant_slug']),
      tenantName: asText(body['tenant_name']),
      companyCode: '',
    );
  }

  Future<List<Map<String, dynamic>>?> savedList(ErpSession session, String path) {
    return offline.cache(_account(session), path);
  }

  Future<List<ShipmentRecord>> shipments(ErpSession session) async {
    final recordsFuture = _cachedList(session, '/shipping');
    final ordersFuture = _optionalList(session, '/orders');
    return _shipmentRows(await recordsFuture, await ordersFuture);
  }

  Future<List<Map<String, dynamic>>> _optionalList(ErpSession session, String path) async {
    try {
      return await _cachedList(session, path);
    } on ErpException catch (error) {
      if (error.code == 'invalidLogin') rethrow;
      return const [];
    }
  }

  List<ShipmentRecord> shipmentRecords(List<Map<String, dynamic>> records, List<Map<String, dynamic>> orders) {
    return _shipmentRows(records, orders);
  }

  List<ShipmentRecord> _shipmentRows(List<Map<String, dynamic>> records, List<Map<String, dynamic>> orders) {
    final unitsByOrder = <int, int>{};
    final itemsByOrder = <int, List<ItemShot>>{};
    for (final order in orders) {
      final shots = itemShotsOf(order['items']);
      var units = 0;
      for (final shot in shots) {
        units += shot.qty;
      }
      final id = asInt(order['id']);
      unitsByOrder[id] = units;
      itemsByOrder[id] = shots;
    }
    return [
      for (final record in records)
        ShipmentRecord.fromJson(
          record,
          unitsByOrder[asInt(record['order_id'])] ?? 0,
          itemsByOrder[asInt(record['order_id'])] ?? const [],
        ),
    ];
  }

  Future<List<AmazonOrderBrief>> openAmazonOrders(ErpSession session) async {
    final raw = await _request(
      method: 'GET',
      url: '${session.baseUrl}/amazon/orders?limit=100',
      token: session.token,
    );
    if (raw is! Map) return const [];
    final items = raw['items'];
    if (items is! List) return const [];
    return [
      for (final item in items)
        if (item is Map) AmazonOrderBrief.fromJson(Map<String, dynamic>.from(item)),
    ].where((order) => order.isOpen).toList();
  }

  Future<List<Map<String, dynamic>>> products(ErpSession session) async {
    return _cachedList(session, '/products');
  }
  Future<List<Map<String, dynamic>>> manufacturingNeeds(ErpSession session) => _cachedList(session, '/manufacturing/dispatch-needs');

  Future<List<String>> labelPrinters(ErpSession session) async {
    final raw = await _request(method: 'GET', url: '${session.baseUrl}/label-printers', token: session.token);
    if (raw is! Map) return const [];
    final printers = raw['printers'];
    if (printers is! List) return const [];
    return [
      for (final printer in printers)
        if (printer is Map && asText(printer['name']).isNotEmpty) asText(printer['name']),
    ];
  }

  Future<void> printLabel({
    required ErpSession session,
    required String printerName,
    required String title,
    required String sku,
    required int copies,
  }) async {
    await _send(
      method: 'POST',
      url: '${session.baseUrl}/label-printers/print',
      token: session.token,
      body: {
        'printer_name': printerName,
        'size': {'width': '50', 'height': '25', 'gap': '2'},
        'labels': [
          {
            'title': title,
            'sku': sku,
            'barcode': sku,
            'articleNo': sku,
            'productName': title,
            'quantity': '$copies',
            'brand': 'HISBENEW INDUSTRIES',
            'showBarcode': 'true',
            'showBrand': 'false',
            'showPrice': 'false',
          },
        ],
      },
    );
  }

  Future<List<Map<String, dynamic>>> customers(ErpSession session) async {
    return _cachedList(session, '/customers');
  }

  Future<void> saveCustomer(ErpSession session, Map<String, String> body, {int? id}) async {
    await _send(
      method: id == null ? 'POST' : 'PUT',
      url: id == null ? '${session.baseUrl}/customers' : '${session.baseUrl}/customers/$id',
      token: session.token,
      body: body,
    );
  }

  Future<void> deleteCustomer(ErpSession session, int id) async {
    await _request(method: 'DELETE', url: '${session.baseUrl}/customers/$id', token: session.token);
  }

  Future<List<Map<String, dynamic>>> orders(ErpSession session) async {
    return _cachedList(session, '/orders');
  }

  Future<List<Map<String, dynamic>>> pendingShipping(ErpSession session) async {
    return _cachedList(session, '/shipping/pending');
  }

  Future<void> markShipped({
    required ErpSession session,
    required int orderId,
    required String courier,
    required String tracking,
    required String note,
    required double weightKg,
  }) async {
    await _send(
      method: 'POST',
      url: '${session.baseUrl}/shipping/mark-shipped',
      token: session.token,
      body: {
        'order_id': orderId,
        'courier_name': courier,
        'tracking_number': tracking,
        'shipping_note': note,
        'shipping_service': 'duty_paid',
        if (weightKg > 0) 'package_weight_kg': weightKg,
      },
    );
  }

  Future<void> updateShipment({
    required ErpSession session,
    required int shippingId,
    required String courier,
    required String tracking,
    required String note,
    required double weightKg,
  }) async {
    await _send(
      method: 'PATCH',
      url: '${session.baseUrl}/shipping/$shippingId',
      token: session.token,
      body: {
        'courier_name': courier,
        'tracking_number': tracking,
        'shipping_note': note,
        if (weightKg > 0) 'package_weight_kg': weightKg,
      },
    );
  }

  Future<void> updateShipmentStatus({
    required ErpSession session,
    required int shippingId,
    required String stage,
  }) async {
    await _send(
      method: 'POST',
      url: '${session.baseUrl}/shipping/$shippingId/status',
      token: session.token,
      body: {'status_stage': stage},
    );
  }

  Future<void> updateProductStock({
    required ErpSession session,
    required int productId,
    required int factoryStock,
    required int usaStock,
  }) async {
    final response = await _client
        .patch(
          Uri.parse('${session.baseUrl}/products/$productId/update-stock'),
          headers: {
            'Accept': 'application/json',
            if (session.token.isNotEmpty) 'Authorization': 'Bearer ${session.token}',
          },
          body: {
            'factory_stock': '$factoryStock',
            'usa_stock': '$usaStock',
          },
        )
        .timeout(const Duration(seconds: 90));
    if (response.statusCode == 401 || response.statusCode == 403) {
      throw const ErpException('invalidLogin');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const ErpException('server');
    }
  }

  Future<List<Map<String, dynamic>>> workerTasks(ErpSession session) async {
    if (session.workerId <= 0) return const [];
    return _cachedList(session, '/production/tasks?worker_id=${session.workerId}');
  }

  Future<List<Map<String, dynamic>>> workerOrderTasks(ErpSession session) async {
    if (session.workerId <= 0) return const [];
    return _cachedList(session, '/order-workflow/tasks?worker_id=${session.workerId}');
  }

  Future<void> actOnOrderTask(ErpSession session, int taskId, String action, {Map<String, dynamic>? body}) async {
    await _send(method: 'PATCH', url: '${session.baseUrl}/order-workflow/tasks/$taskId/$action', token: session.token, body: body);
  }

  Future<List<Map<String, dynamic>>> workerPayments(ErpSession session) async {
    if (session.workerId <= 0) return const [];
    return _cachedList(session, '/worker-payments?worker_id=${session.workerId}');
  }

  Future<List<Map<String, dynamic>>> workerExpenses(ErpSession session) async {
    if (session.workerId <= 0) return const [];
    final rows = await _cachedList(session, '/worker-expenses?worker_id=${session.workerId}');
    final pending = await offline.expenses(_account(session));
    final confirmed = rows.map((row) => row['client_request_id']).whereType<String>().toSet();
    return [...rows, for (final row in pending) if (!confirmed.contains(row['client_request_id'])) {...row, 'pending_sync': true}];
  }

  Future<void>? _syncingMessages;
  Future<void> syncMessages(ErpSession session) => _syncingMessages ??= _syncMessages(session).whenComplete(() => _syncingMessages = null);
  Future<void> _syncMessages(ErpSession session) async {
    final account = _account(session);
    await offline.refresh(account);
    final rows = await offline.messages(account);
    if (rows.isEmpty) return;
    try {
      final capabilities = await _send(method: 'GET', url: '${session.baseUrl}/worker-expenses/sync-capabilities', token: session.token).timeout(const Duration(seconds: 8));
      if (capabilities['idempotent_messages'] != true) {
        offline.notice('Messages saved on this phone. Server update required before syncing.');
        return;
      }
      var failed = 0;
      for (final row in List<Map<String, dynamic>>.from(rows)) {
        try {
        final saved = await _send(
          method: 'POST',
          url: '${session.baseUrl}/internal-messages',
          token: session.token,
          body: row,
        ).timeout(const Duration(seconds: 12));
        final savedId = saved['client_request_id'];
        final confirmed = savedId == row['client_request_id'];
        if (!confirmed) {
          offline.notice('Message saved on this phone. Waiting for the server to confirm it.');
          return;
        }
        final path = '/internal-messages?user_id=${row['recipient_user_id']}';
        final cached = await offline.cache(account, path) ?? [];
        cached.removeWhere((item) => item['id'] == saved['id'] || item['client_request_id'] == row['client_request_id']);
        cached.add(saved);
        await offline.saveCache(account, path, cached);
        await offline.acknowledgeMessage(account, '${row['client_request_id']}');
        } on ErpException catch (error) {
          failed++;
          await offline.recordFailure(account, 'messages', '${row['client_request_id']}', _syncError(error));
          if (error.code == 'unreachable' || error.code == 'invalidLogin') rethrow;
        } on TimeoutException {
          await offline.recordFailure(account, 'messages', '${row['client_request_id']}', 'Server did not respond. Message retained for retry.');
          rethrow;
        }
      }
      offline.notice(failed > 0 ? '$failed messages need attention. Tap to view the reason.' : '');
    } on TimeoutException {
      offline.markOffline();
      offline.notice('Messages saved on this phone. They will send when the connection returns.');
    } on ErpException catch (error) {
      if (error.code == 'unreachable') offline.markOffline();
      offline.notice(_syncError(error));
    } on StateError {
      offline.notice('Phone storage is unavailable. Pending messages have not been removed.');
    }
  }

  Future<List<Map<String, dynamic>>> messageUsers(ErpSession session) async {
    final people = await _cachedList(session, '/internal-message-users');
    final pending = await offline.messages(_account(session));
    final byId = <int, Map<String, dynamic>>{};
    for (final person in people) {
      final id = int.tryParse('${person['id']}') ?? 0;
      if (id > 0) byId[id] = person;
    }
    for (final row in pending) {
      final person = byId[int.tryParse('${row['recipient_user_id']}') ?? 0];
      if (person == null) continue;
      person['last_message_at'] = row['created_at'];
    }
    return people;
  }

  Future<List<Map<String, dynamic>>> messages(ErpSession session, int userId) async {
    final rows = await _cachedList(session, '/internal-messages?user_id=$userId');
    final pending = await offline.messages(_account(session));
    final confirmed = rows.map((row) => row['client_request_id']).whereType<String>().toSet();
    return [
      ...rows,
      for (final row in pending)
        if ((int.tryParse('${row['recipient_user_id']}') ?? 0) == userId && !confirmed.contains(row['client_request_id']))
          {
            'id': 0,
            'client_request_id': row['client_request_id'],
            'recipient_user_id': userId,
            'body': row['body'],
            'is_mine': true,
            'pending_sync': true,
            'created_at': row['created_at'],
          },
    ];
  }

  Future<void> sendMessage({required ErpSession session, required int userId, required String body}) async {
    final text = body.trim();
    if (userId <= 0 || text.isEmpty) throw const ErpException('server');
    await offline.enqueueMessage(_account(session), {
      'client_request_id': OfflineStore.newId(),
      'recipient_user_id': userId,
      'body': text,
      'created_at': DateTime.now().toUtc().toIso8601String(),
    });
    unawaited(syncMessages(session));
  }

  Future<Map<String, dynamic>?> activeCall(ErpSession session) async {
    final raw = await _request(method: 'GET', url: '${session.baseUrl}/internal-calls/active', token: session.token);
    if (raw is Map && raw['id'] != null) return Map<String, dynamic>.from(raw);
    return null;
  }

  Future<Map<String, dynamic>> callDetails(ErpSession session, int callId) =>
      _send(method: 'GET', url: '${session.baseUrl}/internal-calls/$callId', token: session.token);

  Future<List<Map<String, dynamic>>> callIceServers(ErpSession session) async {
    final body = await _send(method: 'GET', url: '${session.baseUrl}/internal-calls/config', token: session.token);
    final raw = body['ice_servers'];
    if (raw is! List) return const [];
    return [for (final item in raw) if (item is Map) Map<String, dynamic>.from(item)];
  }

  Future<Map<String, dynamic>> startCall({required ErpSession session, required int userId}) async {
    return _send(
      method: 'POST',
      url: '${session.baseUrl}/internal-calls',
      token: session.token,
      body: {'recipient_user_id': userId, 'call_type': 'audio'},
    );
  }

  Future<Map<String, dynamic>> respondCall({required ErpSession session, required int callId, required String action}) async {
    return _send(
      method: 'POST',
      url: '${session.baseUrl}/internal-calls/$callId/respond',
      token: session.token,
      body: {'action': action},
    );
  }

  Future<void> endCall({required ErpSession session, required int callId}) async {
    await _send(method: 'POST', url: '${session.baseUrl}/internal-calls/$callId/end', token: session.token);
  }

  Future<List<Map<String, dynamic>>> callSignals({required ErpSession session, required int callId, required int afterId}) async {
    return _sendList(url: '${session.baseUrl}/internal-calls/$callId/signals?after_id=$afterId', token: session.token);
  }

  Future<void> sendCallSignal({
    required ErpSession session,
    required int callId,
    required String type,
    required Map<String, dynamic> payload,
  }) async {
    await _send(
      method: 'POST',
      url: '${session.baseUrl}/internal-calls/$callId/signals',
      token: session.token,
      body: {'signal_type': type, 'payload': payload},
    );
  }

  Future<void> sendWorkerExpense({
    required ErpSession session,
    required double amount,
    required String note,
    required DateTime spentAt,
  }) async {
    if (!amount.isFinite || amount <= 0 || note.trim().isEmpty || session.workerId <= 0) throw const ErpException('invalidExpense');
    await offline.enqueue(_account(session), {
        'client_request_id': OfflineStore.newId(),
        'amount': amount,
        'note': note.trim(),
        'spent_at': spentAt.toUtc().toIso8601String(),
    });
    unawaited(syncExpenses(session));
  }

  Future<Map<String, dynamic>> fulfillmentDesk(ErpSession session) {
    return _send(method: 'GET', url: '${session.baseUrl}/fulfillment/dashboard', token: session.token);
  }

  Future<void> receiveFulfillmentShipment(ErpSession session, int shipmentId) async {
    await _send(
      method: 'POST',
      url: '${session.baseUrl}/fulfillment/shipments/$shipmentId/receive',
      token: session.token,
      body: {'party': 'fulfillment'},
    );
  }

  Future<void> shipFulfillmentOrder(ErpSession session, int orderId) async {
    await _send(method: 'PATCH', url: '${session.baseUrl}/fulfillment/orders/$orderId/ship', token: session.token);
  }

  Future<DashboardData> dashboard(ErpSession session) async {
    final body = await _send(
      method: 'GET',
      url: '${session.baseUrl}/dashboard-stats?refresh=${DateTime.now().millisecondsSinceEpoch}',
      token: session.token,
    );
    return DashboardData.fromJson(body);
  }

  Future<List<Map<String, dynamic>>> _sendList({
    required String url,
    String? token,
  }) async {
    final raw = await _request(method: 'GET', url: url, token: token);
    if (raw is! List) return const [];
    return [
      for (final item in raw)
        if (item is Map) Map<String, dynamic>.from(item),
    ];
  }

  Future<Map<String, dynamic>> _send({
    required String method,
    required String url,
    String? token,
    Object? body,
  }) async {
    final raw = await _request(method: method, url: url, token: token, body: body);
    if (raw is Map<String, dynamic>) return raw;
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return const {};
  }

  Future<Object?> _request({
    required String method,
    required String url,
    String? token,
    Object? body,
  }) async {
    final headers = <String, String>{
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      if (body != null) 'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };

    late http.Response response;
    try {
      final uri = Uri.parse(url);
      final encoded = body == null ? null : jsonEncode(body);
      final Future<http.Response> request = switch (method) {
        'POST' => _client.post(uri, headers: headers, body: encoded),
        'PUT' => _client.put(uri, headers: headers, body: encoded),
        'PATCH' => _client.patch(uri, headers: headers, body: encoded),
        'DELETE' => _client.delete(uri, headers: headers),
        _ => _client.get(uri, headers: headers),
      };
      response = await request.timeout(const Duration(seconds: 90));
    } on TimeoutException {
      throw const ErpException('unreachable');
    } on ErpException {
      rethrow;
    } catch (_) {
      throw const ErpException('unreachable');
    }

    Object? decoded;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode == 401) {
      throw const ErpException('invalidLogin');
    }
    if (response.statusCode == 403) {
      final detail = decoded is Map && decoded['detail'] is String ? decoded['detail'] as String : 'Access denied by the server.';
      throw ErpException('denied', detail: detail, statusCode: 403);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final detail = decoded is Map && decoded['detail'] is String ? decoded['detail'] as String : 'Server returned HTTP ${response.statusCode}.';
      throw ErpException('server', detail: detail, statusCode: response.statusCode);
    }
    return decoded;
  }
}
