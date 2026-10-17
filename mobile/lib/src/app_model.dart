import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'dashboard_data.dart';
import 'erp_api.dart';
import 'order_watch.dart';

class AppModel extends ChangeNotifier {
  AppModel({ErpApi? api}) : _api = api ?? ErpApi();

  final ErpApi _api;

  ErpApi get api => _api;

  Locale locale = const Locale('en');
  ErpSession? session;
  bool booting = true;
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
    booting = false;
    notifyListeners();
    if (session != null) {
      await startOrderWatch(orders: isWorker);
      if (!isWorker) await refreshDashboard();
    }
  }

  bool get isWorker => (session?.role ?? '').trim().toLowerCase() == 'worker';

  Future<void> setLocale(Locale next) async {
    locale = next;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
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
      signingIn = false;
      notifyListeners();
      final worker = next.role.trim().toLowerCase() == 'worker';
      await startOrderWatch(orders: worker);
      if (!worker) await refreshDashboard();
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

  Future<void> signOut() async {
    await stopOrderWatch();
    session = null;
    dashboard = null;
    dashboardError = null;
    loadingDashboard = false;
    loginError = null;
    signingIn = false;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
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
