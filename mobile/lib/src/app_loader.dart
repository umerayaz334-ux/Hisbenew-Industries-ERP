import 'package:flutter/material.dart';

import 'theme.dart';

/// A quiet, shared loading state without branding or artificial progress.
class AppLoader extends StatelessWidget {
  const AppLoader({super.key, this.fullScreen = false});

  final bool fullScreen;

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final content = Semantics(
      label: 'Loading your workspace',
      liveRegion: true,
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: hisbenewForest.withValues(alpha: 0.07),
                borderRadius: BorderRadius.circular(26),
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 48,
                    height: 48,
                    child: CircularProgressIndicator(
                      value: reducedMotion ? 0.75 : null,
                      strokeWidth: 2.5,
                      strokeCap: StrokeCap.round,
                      color: hisbenewForest,
                      backgroundColor: hisbenewForest.withValues(alpha: 0.10),
                    ),
                  ),
                  const Icon(Icons.space_dashboard_rounded,
                      size: 22, color: hisbenewForest),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const Text('Getting things ready',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600,
                    color: hisbenewInk, letterSpacing: -0.3)),
            const SizedBox(height: 8),
            const Text('Your workspace will be with you shortly',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: hisbenewMuted)),
          ],
        ),
      ),
    );
    if (!fullScreen) {
      return Padding(padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 16),
          child: Center(child: content));
    }
    return Scaffold(
      backgroundColor: hisbenewCanvas,
      body: SafeArea(child: Center(child: SingleChildScrollView(
        padding: const EdgeInsets.all(32), child: content))),
    );
  }
}
