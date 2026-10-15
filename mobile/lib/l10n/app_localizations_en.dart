// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Hisbenew ERP';

  @override
  String get brandLine => 'Factory workspace';

  @override
  String get signInTitle => 'Sign in to your company';

  @override
  String get signInHelp =>
      'Use the same company code, username, and 4-digit PIN as the web ERP.';

  @override
  String get companyCode => 'Company code';

  @override
  String get companyCodeHint => 'Leave blank for the main company';

  @override
  String get username => 'Username';

  @override
  String get pin => 'PIN';

  @override
  String get server => 'Server';

  @override
  String get serverHint => 'http://192.168.1.10:8000';

  @override
  String get language => 'Language';

  @override
  String get english => 'English';

  @override
  String get urdu => 'Urdu';

  @override
  String get signIn => 'Sign in';

  @override
  String get signingIn => 'Signing in...';

  @override
  String get home => 'Home';

  @override
  String get orders => 'Orders';

  @override
  String get shipping => 'Shipping';

  @override
  String get account => 'Account';

  @override
  String get signOut => 'Sign out';

  @override
  String get newOrders => 'New today';

  @override
  String get shipQueue => 'To ship';

  @override
  String get lowStock => 'Low stock';

  @override
  String get factoryStock => 'Factory stock';

  @override
  String get weekSales => '7-day sales';

  @override
  String get workers => 'Active workers';

  @override
  String get recentOrders => 'Orders this week';

  @override
  String get waitingShip => 'Waiting to ship';

  @override
  String get emptyOrders => 'No orders this week.';

  @override
  String get emptyShipping => 'Nothing is waiting to ship.';

  @override
  String get retry => 'Try again';

  @override
  String get couldNotLoad => 'The factory server did not respond.';

  @override
  String get pinRule => 'PIN must be 4 digits.';

  @override
  String get serverRule => 'Enter the factory server address.';

  @override
  String get usernameRule => 'Enter your username.';

  @override
  String get invalidLogin => 'Username, PIN, or company code was not accepted.';

  @override
  String get serverRejected =>
      'The factory server could not open this workspace.';

  @override
  String get signedIn => 'Signed in';

  @override
  String get role => 'Role';

  @override
  String get company => 'Company';

  @override
  String get serverLabel => 'Server';

  @override
  String get switchLanguage => 'App language';
}
