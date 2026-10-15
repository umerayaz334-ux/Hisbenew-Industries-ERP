import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'customers_page.dart';
import 'dashboard_view.dart';
import 'labels_page.dart';
import 'orders_page.dart';
import 'page_kit.dart';
import 'products_page.dart';
import 'shipping_page.dart';
import 'theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({required this.model, super.key});

  final AppModel model;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _username;
  final TextEditingController _pin = TextEditingController();
  bool _showPin = false;

  @override
  void initState() {
    super.initState();
    _username = TextEditingController();
  }

  @override
  void dispose() {
    _username.dispose();
    _pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final model = widget.model;
    final error = _loginMessage(copy, model.loginError);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _BrandMark(),
                  const SizedBox(height: 28),
                  Align(
                    alignment: Alignment.centerRight,
                    child: SegmentedButton<String>(
                      style: SegmentedButton.styleFrom(
                        backgroundColor: hisbenewCard,
                        selectedBackgroundColor: hisbenewForest,
                        selectedForegroundColor: Colors.white,
                        side: const BorderSide(color: hisbenewLine),
                      ),
                      segments: [
                        ButtonSegment(value: 'en', label: Text(copy.english)),
                        ButtonSegment(value: 'ur', label: Text(copy.urdu)),
                      ],
                      selected: {model.locale.languageCode},
                      onSelectionChanged: (value) {
                        model.setLocale(Locale(value.first));
                      },
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    controller: _username,
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    decoration: InputDecoration(labelText: copy.username),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _pin,
                    keyboardType: TextInputType.number,
                    maxLength: 4,
                    obscureText: !_showPin,
                    decoration: InputDecoration(
                      labelText: copy.pin,
                      counterText: '',
                      suffixIcon: IconButton(
                        onPressed: () => setState(() => _showPin = !_showPin),
                        icon: Icon(_showPin ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                      ),
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(error, style: const TextStyle(color: Color(0xFFA43A2D), fontWeight: FontWeight.w600)),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: model.signingIn
                        ? null
                        : () {
                            model.signIn(
                              username: _username.text,
                              pin: _pin.text,
                            );
                          },
                    child: Text(model.signingIn ? copy.signingIn : copy.signIn),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class WorkspaceScreen extends StatefulWidget {
  const WorkspaceScreen({required this.model, super.key});

  final AppModel model;

  @override
  State<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends State<WorkspaceScreen> {
  int _index = 0;
  final _scaffold = GlobalKey<ScaffoldState>();

  static const _bottom = [0, 1, 2, 4, 3];

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardView(model: widget.model),
      OrdersPage(model: widget.model),
      ShippingPage(model: widget.model),
      CustomersPage(model: widget.model),
      ProductsPage(model: widget.model),
      AmazonPage(model: widget.model),
      LabelsPage(model: widget.model),
      AccountPage(model: widget.model),
    ];
    final labels = [
      phrase(context, 'Home', 'ہوم'),
      phrase(context, 'Orders', 'آرڈرز'),
      phrase(context, 'Shipping', 'شپنگ'),
      phrase(context, 'Customers', 'گاہک'),
      phrase(context, 'Products', 'پروڈکٹس'),
      phrase(context, 'Amazon', 'ایمیزون'),
      phrase(context, 'Labels', 'لیبل'),
      phrase(context, 'Account', 'اکاؤنٹ'),
    ];
    final icons = [
      Icons.home_rounded,
      Icons.receipt_long_rounded,
      Icons.local_shipping_rounded,
      Icons.groups_rounded,
      Icons.inventory_2_rounded,
      Icons.storefront_rounded,
      Icons.sell_rounded,
      Icons.person_rounded,
    ];

    return Scaffold(
      key: _scaffold,
      drawer: _index == 0
          ? _SideMenu(
              labels: labels,
              icons: icons,
              index: _index,
              onSelect: (value) {
                setState(() => _index = value);
                Navigator.pop(context);
              },
            )
          : null,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
              child: Row(
                children: [
                  if (_index == 0)
                    IconButton(
                      onPressed: () => _scaffold.currentState?.openDrawer(),
                      icon: const Icon(Icons.menu_rounded, color: hisbenewInk),
                    )
                  else
                    const SizedBox(width: 12),
                  Text(labels[_index], style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                ],
              ),
            ),
            Expanded(child: pages[_index]),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _bottom.contains(_index) ? _bottom.indexOf(_index) : 0,
        indicatorColor: const Color(0xFFE0E7FF),
        onDestinationSelected: (value) => setState(() => _index = _bottom[value]),
        destinations: [
          for (final slot in _bottom)
            NavigationDestination(icon: Icon(icons[slot]), label: labels[slot]),
        ],
      ),
    );
  }
}

class _SideMenu extends StatelessWidget {
  const _SideMenu({required this.labels, required this.icons, required this.index, required this.onSelect});

  final List<String> labels;
  final List<IconData> icons;
  final int index;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: const Color(0xFF161513),
      shape: const RoundedRectangleBorder(),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 28, 22, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Hisbenew',
                style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.6),
              ),
              const SizedBox(height: 6),
              Container(width: 28, height: 1.5, color: hisbenewBrass),
              const SizedBox(height: 28),
              for (var i = 0; i < labels.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: InkWell(
                    onTap: () => onSelect(i),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        children: [
                          Icon(icons[i], size: 18, color: i == index ? hisbenewBrass : const Color(0xFFB7AFA4)),
                          const SizedBox(width: 12),
                          Text(
                            labels[i],
                            style: TextStyle(
                              color: i == index ? Colors.white : const Color(0xFFB7AFA4),
                              fontSize: 16,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class AccountPage extends StatelessWidget {
  const AccountPage({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final session = model.session;
    final company = session == null
        ? ''
        : (session.tenantName.isNotEmpty ? session.tenantName : session.tenantSlug);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        Text(copy.account, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 16),
        _InfoRow(copy.signedIn, session?.name ?? ''),
        _InfoRow(copy.username, session?.username ?? ''),
        _InfoRow(copy.role, session?.role ?? ''),
        _InfoRow(copy.company, company),
        const SizedBox(height: 18),
        Text(copy.switchLanguage, style: const TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: [
            ButtonSegment(value: 'en', label: Text(copy.english)),
            ButtonSegment(value: 'ur', label: Text(copy.urdu)),
          ],
          selected: {model.locale.languageCode},
          onSelectionChanged: (value) => model.setLocale(Locale(value.first)),
        ),
        const SizedBox(height: 22),
        OutlinedButton(
          onPressed: model.signOut,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: hisbenewInk,
            side: const BorderSide(color: hisbenewLine),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          child: Text(copy.signOut),
        ),
      ],
    );
  }
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: hisbenewInk, borderRadius: BorderRadius.circular(12)),
          child: const Text('HI', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w500, letterSpacing: 0.6)),
        ),
        const SizedBox(width: 12),
        const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Hisbenew', style: TextStyle(fontWeight: FontWeight.w500, fontSize: 22, letterSpacing: -0.4)),
            Text('Industries', style: TextStyle(color: hisbenewMuted, fontSize: 13)),
          ],
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 96, child: Text(label, style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700))),
          Expanded(child: Text(value.isEmpty ? '—' : value, style: const TextStyle(fontWeight: FontWeight.w700))),
        ],
      ),
    );
  }
}

String? _loginMessage(AppLocalizations copy, String? code) {
  return switch (code) {
    'missingServer' => copy.serverRule,
    'username' => copy.usernameRule,
    'pin' => copy.pinRule,
    'invalidLogin' => copy.invalidLogin,
    'unreachable' => copy.couldNotLoad,
    'serverRejected' || 'server' => copy.serverRejected,
    null || '' => null,
    _ => copy.serverRejected,
  };
}
