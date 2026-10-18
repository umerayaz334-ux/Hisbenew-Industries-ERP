import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:hisbenew_erp/src/app_model.dart';
import 'package:hisbenew_erp/src/erp_api.dart';
import 'package:hisbenew_erp/src/dashboard_data.dart';
import 'package:hisbenew_erp/src/worker_portal.dart';

class DashboardApi extends ErpApi {
  @override
  Future<List<Map<String, dynamic>>> pendingShipping(ErpSession session) async => [for (var i = 1; i <= 8; i++) {'order_id': i, 'order_no': '100$i', 'customer_name': 'Customer $i', 'items': [], 'order_date': '2026-10-18'}];
  @override
  Future<List<ShipmentRecord>> shipments(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> workerTasks(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> workerOrderTasks(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> workerPayments(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> workerExpenses(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> products(ErpSession session) async => [];
  @override
  Future<List<Map<String, dynamic>>> messageUsers(ErpSession session) async => [];
  @override
  Future<Map<String, dynamic>?> activeCall(ErpSession session) async => null;
  @override
  Future<List<Map<String, dynamic>>> callIceServers(ErpSession session) async => [];
  @override
  Future<void> syncExpenses(ErpSession session) async {}
  @override
  Future<void> syncMessages(ErpSession session) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('dashboard fits small phone, lists every dispatch and opens sidebar', (tester) async {
    SharedPreferences.setMockInitialValues({'erp.micAsked': true});
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final channel in ['hisbenew/phone', 'flutter_callkit_incoming', 'flutter_callkit_incoming_events']) {
      messenger.setMockMethodCallHandler(MethodChannel(channel), (_) async => null);
    }
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final model = AppModel(api: DashboardApi())..session = const ErpSession(baseUrl: 'https://example.test', token: 'test', name: 'Faheem', username: 'worker', role: 'worker', workerId: 1, tenantSlug: 'test', tenantName: 'Factory', companyCode: '');
    await tester.pumpWidget(MaterialApp(home: WorkerPortal(model: model)));
    await tester.pumpAndSettle();
    expect(find.text('Your day, Faheem'), findsOneWidget);
    expect(find.text('#1001'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('#1008'), 400);
    expect(find.text('#1008'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Menu'));
    await tester.pumpAndSettle();
    expect(find.text('Manufacturing'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);
    expect(find.text('Settings'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
  });
}
