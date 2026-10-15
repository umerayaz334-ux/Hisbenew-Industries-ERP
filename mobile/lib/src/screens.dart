import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'dashboard_data.dart';
import 'dashboard_view.dart';
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

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final pages = [
      DashboardView(model: widget.model),
      OrdersPage(model: widget.model),
      ShippingPage(model: widget.model),
      AccountPage(model: widget.model),
    ];
    final labels = [copy.home, copy.orders, copy.shipping, copy.account];

    return Scaffold(
      key: _scaffold,
      drawer: _SideMenu(
        labels: labels,
        index: _index,
        onSelect: (value) {
          setState(() => _index = value);
          Navigator.pop(context);
        },
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 12, 0),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => _scaffold.currentState?.openDrawer(),
                    icon: const Icon(Icons.menu_rounded, color: hisbenewInk),
                  ),
                  const Spacer(),
                  Text(
                    labels[_index],
                    style: const TextStyle(color: hisbenewMuted, fontSize: 12, letterSpacing: 1.2, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
            Expanded(child: pages[_index]),
          ],
        ),
      ),
    );
  }
}

class _SideMenu extends StatelessWidget {
  const _SideMenu({required this.labels, required this.index, required this.onSelect});

  final List<String> labels;
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
                style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w500, letterSpacing: -0.6),
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
                          Container(
                            width: 2,
                            height: 16,
                            color: i == index ? hisbenewBrass : Colors.transparent,
                          ),
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

class OrdersPage extends StatelessWidget {
  const OrdersPage({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final orders = model.dashboard?.orders ?? const <OrderBrief>[];
    return _RecordPage(
      title: copy.recentOrders,
      loading: model.loadingDashboard && model.dashboard == null,
      empty: orders.isEmpty,
      emptyText: copy.emptyOrders,
      error: model.dashboardError != null && model.dashboard == null,
      onRefresh: model.refreshDashboard,
      children: [
        for (final order in orders) _RecordTile(title: order.orderNo, subtitle: _orderSubtitle(order), trailing: order.status),
      ],
    );
  }
}

class ShippingPage extends StatelessWidget {
  const ShippingPage({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final shipments = model.dashboard?.shipments ?? const <ShipBrief>[];
    return _RecordPage(
      title: copy.waitingShip,
      loading: model.loadingDashboard && model.dashboard == null,
      empty: shipments.isEmpty,
      emptyText: copy.emptyShipping,
      error: model.dashboardError != null && model.dashboard == null,
      onRefresh: model.refreshDashboard,
      children: [
        for (final shipment in shipments)
          _RecordTile(
            title: shipment.orderNo,
            subtitle: [shipment.customer, shipment.platform].where((part) => part.isNotEmpty).join(' · '),
            trailing: shipment.status,
          ),
      ],
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

class _RecordPage extends StatelessWidget {
  const _RecordPage({
    required this.title,
    required this.loading,
    required this.empty,
    required this.emptyText,
    required this.error,
    required this.onRefresh,
    required this.children,
  });

  final String title;
  final bool loading;
  final bool empty;
  final String emptyText;
  final bool error;
  final Future<void> Function() onRefresh;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          if (loading)
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator()))
          else if (error)
            _StatusCard(message: copy.couldNotLoad, action: copy.retry, onPressed: onRefresh)
          else if (empty)
            _StatusCard(message: emptyText)
          else
            ...children,
        ],
      ),
    );
  }
}

class _RecordTile extends StatelessWidget {
  const _RecordTile({required this.title, required this.subtitle, required this.trailing});

  final String title;
  final String subtitle;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: hisbenewLine),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title.isEmpty ? '—' : title, style: const TextStyle(fontWeight: FontWeight.w800)),
                if (subtitle.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(subtitle, style: const TextStyle(color: hisbenewMuted, fontSize: 13)),
                ],
              ],
            ),
          ),
          if (trailing.isNotEmpty)
            Text(trailing, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
        ],
      ),
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

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.message, this.action, this.onPressed});

  final String message;
  final String? action;
  final Future<void> Function()? onPressed;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: hisbenewLine),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: const TextStyle(height: 1.4)),
          if (action != null && onPressed != null) ...[
            const SizedBox(height: 12),
            TextButton(onPressed: onPressed, child: Text(action!)),
          ],
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

String _orderSubtitle(OrderBrief order) {
  final parts = <String>[
    if (order.customer.isNotEmpty) order.customer,
    if (order.platform.isNotEmpty) order.platform,
    if (order.amountUsd > 0) NumberFormat.simpleCurrency(name: 'USD').format(order.amountUsd),
  ];
  return parts.join(' · ');
}
