import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'l10n/app_localizations.dart';
import 'src/app_model.dart';
import 'src/screens.dart';
import 'src/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final model = AppModel();
  runApp(HisbenewApp(model: model));
  await model.restore();
}

class HisbenewApp extends StatelessWidget {
  const HisbenewApp({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: model,
      builder: (context, _) {
        return MaterialApp(
          title: 'Hisbenew ERP',
          debugShowCheckedModeBanner: false,
          theme: hisbenewTheme(),
          locale: model.locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: model.booting
              ? const Scaffold(body: Center(child: CircularProgressIndicator()))
              : model.session == null
                  ? LoginScreen(model: model)
                  : WorkspaceScreen(model: model),
        );
      },
    );
  }
}
