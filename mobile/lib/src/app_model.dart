import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'dashboard_data.dart';
import 'erp_api.dart';
import 'order_watch.dart';
import 'push_notifications.dart';
import 'notification_navigation.dart';

class AppModel extends ChangeNotifier {
  AppModel({ErpApi? api}) : _api = api ?? ErpApi();

  final ErpApi _api;

  ErpApi get api => _api;

  Locale locale = const Locale('en');
  ErpSession? session;
  bool booting = true;
  Set<String> allowedPages = {};
  bool accessReady = false;
  bool canAccess(String page) => page == 'Shipping' || !isWorker || !accessReady || allowedPages.contains(page);
  String get _accessKey => 'erp.pageAccess.${session?.tenantSlug}.${session?.username}';

  Future<bool> refreshAccess() async {
    final current = session;
    if (current == null) return false;
    final prefs = await SharedPreferences.getInstance();
    try {
      final pages = await api.pageAccess(current).timeout(const Duration(seconds: 8));
      if (session != current) return false;
      final becameReady = !accessReady;
      final changed = becameReady || pages.length != allowedPages.length || !allowedPages.containsAll(pages);
      allowedPages = pages.toSet();
      accessReady = true;
      await prefs.reload();
      await prefs.setStringList(_accessKey, pages);
      if (changed) notifyListeners();
      return changed;
    } catch (_) {
      if (session == current && !accessReady) {
        final cached = prefs.getStringList(_accessKey);
        if (cached != null) {
          allowedPages = cached.toSet();
          accessReady = true;
          notifyListeners();
        }
      }
      return false;
    }
  }
  bool signingIn = false;
  bool loadingDashboard = false;
  String? loginError;
  String? dashboardError;
  DashboardData? dashboard;

  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final language = prefs.getString('erp.locale') ?? 'en';
    locale = Locale(language == 'ur' ? 'ur' : 'en');
    final token = prefs.getString('erp.token') ?? '';
    if (token.isNotEmpty) {
      session = ErpSession(
        baseUrl: erpApiBase,
        token: token,
        name: prefs.getString('erp.name') ?? '',
        username: prefs.getString('erp.username') ?? '',
        role: prefs.getString('erp.role') ?? '',
        workerId: int.tryParse(prefs.getString('erp.workerId') ?? '') ?? 0,
        tenantSlug: prefs.getString('erp.tenantSlug') ?? '',
        tenantName: prefs.getString('erp.tenantName') ?? '',
        companyCode: '',
      );
    }
    if (session != null) {
      final cached = prefs.getStringList(_accessKey);
      if (cached != null) {
        allowedPages = cached.toSet();
        accessReady = true;
      }
      unawaited(refreshAccess());
    }
    booting = false;
    notifyListeners();
    if (session != null) {
      unawaited(_startPhoneServices());
      api.warmLists(session!);
      if (!isWorker && !isWarehouse) unawaited(refreshDashboard());
    }
  }

  bool get isWorker => (session?.role ?? '').trim().toLowerCase() == 'worker';
  bool get isWarehouse => (session?.role ?? '').trim().toLowerCase() == 'warehouse';

  Future<void> setLocale(Locale next) async {
    locale = next;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    await prefs.setString('erp.locale', next.languageCode);
  }

  Future<bool> signIn({
    required String username,
    required String pin,
  }) async {
    if (username.trim().isEmpty) {
      loginError = 'username';
      notifyListeners();
      return false;
    }
    if (!RegExp(r'^\d{4}$').hasMatch(pin.trim())) {
      loginError = 'pin';
      notifyListeners();
      return false;
    }

    signingIn = true;
    loginError = null;
    notifyListeners();
    try {
      final next = await _api.login(username: username, pin: pin);
      session = next;
      dashboard = null;
      dashboardError = null;
      await _storeSession(next);
      allowedPages = {};
      accessReady = false;
      unawaited(refreshAccess());
      signingIn = false;
      notifyListeners();
      final worker = next.role.trim().toLowerCase() == 'worker';
      unawaited(_startPhoneServices());
      api.warmLists(next);
      if (!worker && next.role.trim().toLowerCase() != 'warehouse') unawaited(refreshDashboard());
      return true;
    } on ErpException catch (error) {
      loginError = error.code;
      signingIn = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> refreshDashboard() async {
    final current = session;
    if (current == null) return;
    loadingDashboard = true;
    dashboardError = null;
    notifyListeners();
    try {
      dashboard = await _api.dashboard(current);
      loadingDashboard = false;
      notifyListeners();
    } on ErpException catch (error) {
      if (error.code == 'invalidLogin') {
        await signOut();
        return;
      }
      loadingDashboard = false;
      dashboardError = error.code;
      notifyListeners();
    }
  }

  Future<void> _startPhoneServices() async {
    try {
      await startOrderWatch();
      if (session != null) await MobilePush.start();
    } catch (error) {
      debugPrint('Phone services unavailable: ${error.runtimeType}');
    }
  }

  Future<void> signOut() async {
    notificationChat.value = null;
    await MobilePush.stop();
    await stopOrderWatch();
    session = null;
    allowedPages = {};
    accessReady = false;
    dashboard = null;
    dashboardError = null;
    loadingDashboard = false;
    loginError = null;
    signingIn = false;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    await prefs.remove('erp.orderAlertAfter');
    await prefs.remove('erp.token');
    await prefs.remove('erp.baseUrl');
    await prefs.remove('erp.name');
    await prefs.remove('erp.username');
    await prefs.remove('erp.role');
    await prefs.remove('erp.workerId');
    await prefs.remove('erp.tenantSlug');
    await prefs.remove('erp.tenantName');
  }

  Future<void> _storeSession(ErpSession next) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    await prefs.setString('erp.server', next.baseUrl);
    await prefs.setString('erp.company', next.companyCode);
    await prefs.setString('erp.baseUrl', next.baseUrl);
    await prefs.setString('erp.token', next.token);
    await prefs.setString('erp.name', next.name);
    await prefs.setString('erp.username', next.username);
    await prefs.setString('erp.role', next.role);
    await prefs.setString('erp.workerId', '${next.workerId}');
    await prefs.setString('erp.tenantSlug', next.tenantSlug);
    await prefs.setString('erp.tenantName', next.tenantName);
  }
}
