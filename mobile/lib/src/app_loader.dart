import 'package:flutter/material.dart';

class AppLoader extends StatelessWidget {
  const AppLoader({super.key, this.fullScreen = false});
  final bool fullScreen;

  @override
  Widget build(BuildContext context) {
    const indicator = Center(child: CircularProgressIndicator());
    return fullScreen
        ? const Scaffold(body: indicator)
        : const Padding(padding: EdgeInsets.all(24), child: indicator);
  }
}
