import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'dashboard_data.dart';

const erpApiBase = 'https://api.hisbenew.com';

class ErpException implements Exception {
  const ErpException(this.code);

  final String code;
}

class ErpSession {
  const ErpSession({
    required this.baseUrl,
    required this.token,
    required this.name,
    required this.username,
    required this.role,
    required this.tenantSlug,
    required this.tenantName,
    required this.companyCode,
  });

  final String baseUrl;
  final String token;
  final String name;
  final String username;
  final String role;
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
      tenantSlug: values['tenantSlug'] ?? '',
      tenantName: values['tenantName'] ?? '',
      companyCode: values['companyCode'] ?? '',
    );
  }
}

class ErpApi {
  ErpApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

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
      tenantSlug: asText(body['tenant_slug']),
      tenantName: asText(body['tenant_name']),
      companyCode: '',
    );
  }

  Future<List<ShipmentRecord>> shipments(ErpSession session) async {
    final records = await _sendList(url: '${session.baseUrl}/shipping', token: session.token);
    final orders = await _sendList(url: '${session.baseUrl}/orders', token: session.token);
    final unitsByOrder = <int, int>{};
    for (final order in orders) {
      final items = order['items'];
      var units = 0;
      if (items is List) {
        for (final item in items) {
          if (item is Map) units += asInt(item['quantity']);
        }
      }
      unitsByOrder[asInt(order['id'])] = units;
    }
    return [
      for (final record in records) ShipmentRecord.fromJson(record, unitsByOrder[asInt(record['order_id'])] ?? 0),
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
    return _sendList(url: '${session.baseUrl}/products', token: session.token);
  }

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
      final request = method == 'POST'
          ? _client.post(uri, headers: headers, body: jsonEncode(body))
          : _client.get(uri, headers: headers);
      response = await request.timeout(const Duration(seconds: 25));
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

    if (response.statusCode == 401 || response.statusCode == 403) {
      throw const ErpException('invalidLogin');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw const ErpException('server');
    }
    return decoded;
  }
}
