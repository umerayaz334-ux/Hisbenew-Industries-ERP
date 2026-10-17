import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

class PhonePermissions {
  static const _channel = MethodChannel('hisbenew/phone');
  static const _askedKey = 'erp.micAsked';

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
      await _channel.invokeMethod<bool>('microphone');
    } on PlatformException {
      return;
    }
  }
}
