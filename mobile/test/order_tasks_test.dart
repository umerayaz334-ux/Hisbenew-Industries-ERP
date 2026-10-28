import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hisbenew_erp/src/app_model.dart';
import 'package:hisbenew_erp/src/erp_api.dart';
import 'package:hisbenew_erp/src/order_tasks_page.dart';

class TaskApi extends ErpApi {
  String status = 'New';
  final calls = <String>[];
  @override
  Future<List<Map<String, dynamic>>> workerOrderTasks(ErpSession session) async => [{
    'id': 12, 'order_no': 'C6Q6WP38M8', 'source_company_name': 'Cuterex',
    'task_type': 'Preparation', 'status': status, 'notes': 'Pack carefully', 'items': [],
  }];
  @override
  Future<void> actOnOrderTask(ErpSession session, int taskId, String action, {Map<String, dynamic>? body}) async {
    calls.add('$taskId/$action');
    expect(session.tenantSlug, 'hisbenew');
    if (action == 'complete') expect(body?['verify'], false);
    status = action == 'start' ? 'In Progress' : 'Pending Verification';
  }
}

void main() {
  testWidgets('forwarded order can be accepted and submitted with the existing company login', (tester) async {
    final api = TaskApi();
    final model = AppModel(api: api)..session = const ErpSession(baseUrl: 'https://example.test', token: 'test',
      name: 'Worker', username: 'worker', role: 'worker', workerId: 1, tenantSlug: 'hisbenew', tenantName: 'Hisbenew', companyCode: '');
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: OrderTasksPage(model: model))));
    await tester.pumpAndSettle();
    expect(find.text('From Cuterex'), findsOneWidget);
    expect(find.text('#C6Q6WP38M8'), findsOneWidget);
    await tester.tap(find.text('Accept task'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit completed work'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();
    expect(api.calls, ['12/start', '12/complete']);
    expect(find.text('Waiting for the sending company to verify.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
