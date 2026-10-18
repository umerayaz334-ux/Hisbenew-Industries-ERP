import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Account-scoped snapshots and a durable expense outbox. Only the app isolate
/// writes this outbox; background call polling does not mutate it.
class OfflineStore extends ChangeNotifier {
  bool offline = false;
  int pendingExpenses = 0;
  int pendingMessages = 0;
  int get pending => pendingExpenses + pendingMessages;
  String syncNotice = '';
  DateTime? savedAt;
  Future<void> _writes = Future.value();

  String _key(String account, String kind) => 'erp.offline.v1.${base64Url.encode(utf8.encode(account))}.$kind';
  Future<List<Map<String, dynamic>>?> cache(String account, String path) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key(account, path));
    if (raw == null) return null;
    final data = jsonDecode(raw) as Map;
    savedAt = DateTime.tryParse('${data['at']}');
    return (data['rows'] as List).map((row) => Map<String, dynamic>.from(row as Map)).toList();
  }
  Future<void> saveCache(String account, String path, List<Map<String, dynamic>> rows) async {
    final prefs = await SharedPreferences.getInstance();
    final at = DateTime.now();
    if (!await prefs.setString(_key(account, path), jsonEncode({'at': at.toIso8601String(), 'rows': rows}))) {
      throw StateError('Offline storage is unavailable');
    }
    savedAt = at;
    offline = false;
    notifyListeners();
  }
  void markOffline() { offline = true; notifyListeners(); }
  Future<List<Map<String, dynamic>>> _read(String account, String kind) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key(account, kind)) ?? '[]';
    return (jsonDecode(raw) as List).map((row) => Map<String, dynamic>.from(row as Map)).toList();
  }
  Future<List<Map<String, dynamic>>> expenses(String account) => _read(account, 'outbox');
  Future<List<Map<String, dynamic>>> messages(String account) => _read(account, 'messages');
  Future<void> _edit(String account, String kind, void Function(List<Map<String, dynamic>>) change) {
    final work = _writes.then((_) async {
      final rows = await _read(account, kind);
      change(rows);
      final prefs = await SharedPreferences.getInstance();
      if (!await prefs.setString(_key(account, kind), jsonEncode(rows))) throw StateError('Could not save this on the phone');
      if (kind == 'outbox') pendingExpenses = rows.length;
      if (kind == 'messages') pendingMessages = rows.length;
      notifyListeners();
    });
    _writes = work.catchError((Object _) {});
    return work;
  }
  Future<void> enqueue(String account, Map<String, dynamic> row) => _edit(account, 'outbox', (rows) => rows.add(row));
  Future<void> acknowledge(String account, String id) => _edit(account, 'outbox', (rows) => rows.removeWhere((row) => row['client_request_id'] == id));
  Future<void> enqueueMessage(String account, Map<String, dynamic> row) => _edit(account, 'messages', (rows) => rows.add(row));
  Future<void> acknowledgeMessage(String account, String id) => _edit(account, 'messages', (rows) => rows.removeWhere((row) => row['client_request_id'] == id));
  Future<void> recordFailure(String account, String kind, String id, String error) => _edit(account, kind, (rows) {
    for (final row in rows) {
      if (row['client_request_id'] == id) {
        row['sync_error'] = error;
        row['last_attempt_at'] = DateTime.now().toUtc().toIso8601String();
      }
    }
  });
  Future<void> refresh(String account) async {
    pendingExpenses = (await expenses(account)).length;
    pendingMessages = (await messages(account)).length;
    notifyListeners();
  }
  void notice(String value) { syncNotice = value; notifyListeners(); }
  static String newId() {
    final random = Random.secure();
    return List.generate(24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
