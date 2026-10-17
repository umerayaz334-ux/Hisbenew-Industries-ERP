import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:hisbenew_erp/src/app_model.dart';
import 'package:hisbenew_erp/src/call_desk.dart';
import 'package:hisbenew_erp/src/erp_api.dart';
import 'package:hisbenew_erp/src/phone_permissions.dart';

class CallApi extends ErpApi {
  final actions = <String>[];
  int starts = 0;
  @override
  Future<Map<String, dynamic>> respondCall({
    required ErpSession session,
    required int callId,
    required String action,
  }) async {
    actions.add('$callId:$action');
    return {'id': callId, 'status': 'declined'};
  }

  @override
  Future<Map<String, dynamic>> startCall({
    required ErpSession session,
    required int userId,
  }) async {
    starts++;
    return {'id': 9};
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const phone = MethodChannel('hisbenew/phone');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(() {
    SharedPreferences.setMockInitialValues({'erp.micAsked': true});
    messenger.setMockMethodCallHandler(
      const MethodChannel('flutter_callkit_incoming'),
      (_) async => null,
    );
  });
  tearDown(() {
    messenger.setMockMethodCallHandler(phone, null);
  });

  testWidgets('call controls fit small phones and large text without overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final desk = CallDesk(AppModel())..phase = 'connecting'..otherName = 'Factory administrator';
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
      child: Scaffold(body: CallCover(desk: desk)),
    )));
    expect(tester.takeException(), isNull);
    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Speaker'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    desk.dispose();
    await tester.pump();
  });

  AppModel model(CallApi api) => AppModel(api: api)
    ..session = const ErpSession(
      baseUrl: 'https://test.invalid',
      token: 'test',
      name: 'Worker',
      username: 'worker',
      role: 'worker',
      workerId: 1,
      tenantSlug: 'test',
      tenantName: 'Test',
      companyCode: 'test',
    );

  test(
    'explicit microphone request still works after the first prompt was denied',
    () async {
      var requests = 0;
      messenger.setMockMethodCallHandler(phone, (call) async {
        if (call.method == 'microphoneStatus') return false;
        if (call.method == 'microphone') {
          requests++;
          return true;
        }
        return null;
      });
      expect(await PhonePermissions.request(), true);
      expect(requests, 1);
    },
  );

  test('concurrent microphone requests share one native prompt', () async {
    final reply = Completer<bool>();
    var requests = 0;
    messenger.setMockMethodCallHandler(phone, (call) async {
      if (call.method == 'microphoneStatus') return false;
      if (call.method == 'microphone') {
        requests++;
        return reply.future;
      }
      return null;
    });
    final first = PhonePermissions.request();
    final second = PhonePermissions.request();
    await Future<void>.delayed(Duration.zero);
    reply.complete(true);
    expect(await Future.wait([first, second]), [true, true]);
    expect(requests, 1);
  });

  test(
    'native decline updates the server even before the app discovers the call',
    () async {
      messenger.setMockMethodCallHandler(phone, (_) async => null);
      final api = CallApi();
      final desk = CallDesk(model(api));
      await desk.decline(callId: 42);
      expect(api.actions, ['42:decline']);
      expect(desk.phase, 'ended');
      desk.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );

  test(
    'cancelling during permission prompt cannot create a late outgoing call',
    () async {
      final reply = Completer<bool>();
      messenger.setMockMethodCallHandler(phone, (call) async {
        if (call.method == 'microphoneStatus') return false;
        if (call.method == 'microphone') return reply.future;
        return null;
      });
      final api = CallApi();
      final desk = CallDesk(model(api));
      final starting = desk.startOutgoing(2, 'Admin');
      await Future<void>.delayed(Duration.zero);
      await desk.hangUp();
      reply.complete(true);
      await starting;
      expect(api.starts, 0);
      expect(desk.phase, 'ended');
      desk.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );
}
