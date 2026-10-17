import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PhonePermissions {
  static const _channel = MethodChannel('hisbenew/phone');
  static const _askedKey = 'erp.micAsked';
  static Future<bool>? _request;

  static Future<bool> request() =>
      _request ??= _requestMicrophone().whenComplete(() => _request = null);

  static Future<bool> _requestMicrophone() async {
    if (await granted()) return true;
    try {
      return await _channel.invokeMethod<bool>('microphone') == true;
    } on PlatformException {
      return false;
    }
  }

  static Future<void> openSettings() async =>
      _channel.invokeMethod('openSettings');
  static Future<void> soundSettings() async =>
      _channel.invokeMethod('soundSettings');
  static Future<void> notificationSettings() async =>
      _channel.invokeMethod('notificationSettings');
  static Future<void> startVoiceService() async =>
      _channel.invokeMethod('startVoiceService');
  static Future<void> stopVoiceService() async =>
      _channel.invokeMethod('stopVoiceService');

  static Future<bool> granted() async {
    try {
      final allowed = await _channel.invokeMethod<bool>('microphoneStatus');
      return allowed == true;
    } on PlatformException {
      return false;
    }
  }

  /// Shows the system microphone prompt once. Later calls reuse that choice.
  static Future<void> askOnce() async {
    if (await granted()) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_askedKey) == true) return;
    await prefs.setBool(_askedKey, true);
    try {
      await request();
    } on PlatformException {
      return;
    }
  }
}

class CallPermissionTile extends StatefulWidget {
  const CallPermissionTile({super.key});
  @override
  State<CallPermissionTile> createState() => _CallPermissionTileState();
}

class _CallPermissionTileState extends State<CallPermissionTile>
    with WidgetsBindingObserver {
  bool _allowed = false;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  Future<void> _refresh() async {
    final allowed = await PhonePermissions.granted();
    if (mounted) setState(() => _allowed = allowed);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(_allowed ? Icons.mic : Icons.mic_off),
        title: const Text('Microphone for calls'),
        subtitle: Text(
          _allowed ? 'Enabled' : 'Allow microphone access to speak on calls',
        ),
        trailing: TextButton(
          onPressed: () async {
            if (_allowed || !await PhonePermissions.request()) {
              await PhonePermissions.openSettings();
            }
            await _refresh();
          },
          child: Text(_allowed ? 'Settings' : 'Enable'),
        ),
      ),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.notifications_active_outlined),
        title: const Text('Call and message alerts'),
        subtitle: const Text('Manage notification permissions'),
        trailing: const Icon(Icons.chevron_right),
        onTap: PhonePermissions.notificationSettings,
      ),
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.volume_up_outlined),
        title: const Text('Incoming ringtone'),
        subtitle: const Text('Hisbenew double chime · phone ring volume'),
        trailing: const Icon(Icons.chevron_right),
        onTap: PhonePermissions.soundSettings,
      ),
    ],
  );
}
