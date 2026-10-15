import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'dashboard_data.dart';

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
    required String baseUrl,
    required String username,
    required String pin,
    required String companyCode,
  }) async {
    final company = companyCode.trim().toLowerCase();
    final payload = <String, String>{
      'username': username.trim(),
      'pin': pin.trim(),
      if (company.isNotEmpty) 'tenant_slug': company,
    };
    final body = await _send(
      method: 'POST',
      url: '$baseUrl/login',
      body: payload,
    );
    final token = asText(body['access_token']);
    if (token.isEmpty) throw const ErpException('server');
    return ErpSession(
      baseUrl: baseUrl,
      token: token,
      name: asText(body['name']),
      username: asText(body['username']).isEmpty ? username.trim() : asText(body['username']),
      role: asText(body['role']),
      tenantSlug: asText(body['tenant_slug']),
      tenantName: asText(body['tenant_name']),
      companyCode: company,
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

  Future<Map<String, dynamic>> _send({
    required String method,
    required String url,
    String? token,
    Map<String, String>? body,
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

    Map<String, dynamic> decoded = const {};
    if (response.body.isNotEmpty) {
      try {
        final raw = jsonDecode(response.body);
        if (raw is Map) decoded = Map<String, dynamic>.from(raw);
      } catch (_) {
        decoded = const {};
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
