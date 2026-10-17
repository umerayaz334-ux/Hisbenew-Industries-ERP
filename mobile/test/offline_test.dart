import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:hisbenew_erp/src/erp_api.dart';
import 'package:hisbenew_erp/src/offline_store.dart';

const session = ErpSession(baseUrl: 'https://example.test', token: 'test', name: 'Worker',
    username: 'worker', role: 'worker', workerId: 1, tenantSlug: 'company', tenantName: '', companyCode: '');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('cached products survive offline restart', () async {
    final api = ErpApi(client: MockClient((_) async => http.Response('[{"id":1,"name":"Chair"}]', 200)));
    await api.products(session);
    final restarted = ErpApi(client: MockClient((_) async => throw http.ClientException('offline')));
    expect((await restarted.products(session)).single['name'], 'Chair');
    expect(restarted.offline.offline, isTrue);
  });

  test('outbox is durable and isolated between accounts', () async {
    final store = OfflineStore();
    await store.enqueue('first', {'client_request_id': 'a', 'amount': 50});
    expect(await OfflineStore().expenses('second'), isEmpty);
    expect((await OfflineStore().expenses('first')).single['amount'], 50);
  });

  test('expense retries preserve id and only clear confirmed entries', () async {
    var online = false;
    final ids = <String>[];
    final api = ErpApi(client: MockClient((request) async {
      if (!online) throw http.ClientException('offline');
      if (request.url.path.endsWith('sync-capabilities')) {
        return http.Response('{"idempotent_expenses":true}', 200);
      }
      final row = jsonDecode(request.body) as Map<String, dynamic>;
      ids.add(row['client_request_id'] as String);
      if (ids.length == 1) throw http.ClientException('server saved but response lost');
      return http.Response(jsonEncode({...row, 'id': 12}), 200);
    }));
    await api.sendWorkerExpense(session: session, amount: 100, note: 'Fuel', spentAt: DateTime.utc(2026));
    await api.syncExpenses(session);
    expect(api.offline.pending, 1);
    online = true;
    await api.syncExpenses(session);
    expect(api.offline.pending, 1);
    await api.syncExpenses(session);
    expect(ids.length, 2);
    expect(ids.first, ids.last);
    expect(api.offline.pending, 0);
  });

  test('old server cannot consume a queued expense without idempotency support', () async {
    var posts = 0;
    final api = ErpApi(client: MockClient((request) async {
      if (request.method == 'POST') posts++;
      return http.Response('{}', 200);
    }));
    await api.sendWorkerExpense(session: session, amount: 80, note: 'Travel', spentAt: DateTime.utc(2026));
    await api.syncExpenses(session);
    expect(posts, 0);
    expect(api.offline.pending, 1);
  });

  test('a message stays on the phone until the server confirms it', () async {
    var online = false;
    final bodies = <String>[];
    final api = ErpApi(client: MockClient((request) async {
      if (!online) throw http.ClientException('offline');
      final row = jsonDecode(request.body) as Map<String, dynamic>;
      bodies.add(row['body'] as String);
      return http.Response(jsonEncode({...row, 'id': 7, 'is_mine': true}), 200);
    }));
    await api.sendMessage(session: session, userId: 2, body: 'On my way');
    await api.syncMessages(session);
    expect(api.offline.pendingMessages, 1);
    online = true;
    await api.syncMessages(session);
    expect(bodies, ['On my way']);
    expect(api.offline.pendingMessages, 0);
    final thread = await api.messages(session, 2);
    expect(thread.single['body'], 'On my way');
  });
}
