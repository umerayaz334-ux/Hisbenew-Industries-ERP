import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:hisbenew_erp/src/app_model.dart';
import 'package:hisbenew_erp/src/call_desk.dart';
import 'package:hisbenew_erp/src/erp_api.dart';
import 'package:hisbenew_erp/src/phone_permissions.dart';
import 'package:hisbenew_erp/src/incoming_call.dart';

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

  testWidgets(
    'call controls fit small phones and large text without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final desk = CallDesk(AppModel())
        ..phase = 'connecting'
        ..otherName = 'Factory administrator';
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.3)),
            child: Scaffold(body: CallCover(desk: desk)),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Mute'), findsOneWidget);
      expect(find.text('Speaker on'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      desk.dispose();
      await tester.pump();
    },
  );

  testWidgets('connected call shows duration and compact audio controls', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final desk = CallDesk(AppModel())
      ..phase = 'connected'
      ..otherName = 'Warehouse Admin';
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: CallCover(desk: desk)),
      ),
    );
    expect(find.text('Warehouse Admin'), findsOneWidget);
    expect(find.text('CALL IN PROGRESS'), findsOneWidget);
    expect(find.text('Mute'), findsOneWidget);
    expect(find.text('Speaker on'), findsOneWidget);
    expect(find.text('End'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    desk.dispose();
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

  test('configured authenticated relays survive filtering', () {
    final servers = withRelay([
      {
        'urls': 'turn:company.metered.ca:443',
        'username': 'company',
        'credential': 'temporary',
      },
      {
        'urls': 'turn:retired.invalid:80',
        'username': 'openrelayproject',
        'credential': 'old',
      },
    ]);
    expect(hasCallRelay(servers), true);
    expect(servers.any((server) => server['username'] == 'company'), true);
    expect(
      servers.any((server) => server['username'] == 'openrelayproject'),
      false,
    );
    expect(hasCallRelay(relayIceServers()), false);
  });

  test('incoming call uses native lock screen notification once with one ringtone owner', () async {
    final methods = <String>[];
    messenger.setMockMethodCallHandler(
      const MethodChannel('flutter_callkit_incoming'),
      (call) async {
        methods.add(call.method);
        if (call.method == 'activeCalls') return <dynamic>[];
        return null;
      },
    );
    messenger.setMockMethodCallHandler(phone, (call) async {
      methods.add(call.method);
      return null;
    });
    final params = incomingCallParams(callId: 991, name: 'Admin');
    expect(params.android?.isFullScreen, false);
    expect(params.android?.isShowFullLockedScreen, true);
    await showIncomingIfNeeded(991, 'Admin');
    await showIncomingIfNeeded(991, 'Admin');
    expect(
      methods.where((method) => method == 'showCallkitIncoming').length,
      1,
    );
    expect(methods, isNot(contains('startIncomingRing')));
    forgetIncomingScreen(991);
  });

  test(
    'duplicate answer event cannot change audio of an active outgoing call',
    () async {
      final methods = <String>[];
      messenger.setMockMethodCallHandler(phone, (call) async {
        methods.add(call.method);
        return null;
      });
      final desk = CallDesk(model(CallApi()))..phase = 'outgoing';
      await desk.accept(callId: 42);
      expect(desk.phase, 'outgoing');
      expect(methods, isEmpty);
      desk.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );

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
