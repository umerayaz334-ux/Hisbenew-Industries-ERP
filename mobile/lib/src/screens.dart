import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'dashboard_data.dart';
import 'theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({required this.model, super.key});

  final AppModel model;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _server;
  late final TextEditingController _company;
  late final TextEditingController _username;
  final TextEditingController _pin = TextEditingController();
  bool _showPin = false;

  @override
  void initState() {
    super.initState();
    _server = TextEditingController(text: widget.model.rememberedServer);
    _company = TextEditingController(text: widget.model.rememberedCompany);
    _username = TextEditingController();
  }

  @override
  void dispose() {
    _server.dispose();
    _company.dispose();
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
                  const SizedBox(height: 18),
                  Text(
                    copy.signInTitle,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: hisbenewInk,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.4,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(copy.signInHelp, style: const TextStyle(color: hisbenewMuted, height: 1.4)),
                  const SizedBox(height: 22),
                  Text(copy.language, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: [
                      ButtonSegment(value: 'en', label: Text(copy.english)),
                      ButtonSegment(value: 'ur', label: Text(copy.urdu)),
                    ],
                    selected: {model.locale.languageCode},
                    onSelectionChanged: (value) {
                      model.setLocale(Locale(value.first));
                    },
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    controller: _server,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: InputDecoration(labelText: copy.server, hintText: copy.serverHint),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _company,
                    textCapitalization: TextCapitalization.none,
                    autocorrect: false,
                    decoration: InputDecoration(
                      labelText: copy.companyCode,
                      hintText: copy.companyCodeHint,
                    ),
                  ),
                  const SizedBox(height: 12),
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
                              server: _server.text,
                              companyCode: _company.text,
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

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final pages = [
      DashboardPage(model: widget.model),
      OrdersPage(model: widget.model),
      ShippingPage(model: widget.model),
      AccountPage(model: widget.model),
    ];

    return Scaffold(
      body: SafeArea(child: pages[_index]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: copy.home),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: const Icon(Icons.receipt_long), label: copy.orders),
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: copy.shipping),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: copy.account),
        ],
      ),
    );
  }
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final data = model.dashboard;
    final locale = Localizations.localeOf(context).toString();
    final numbers = NumberFormat.decimalPattern(locale);
    final money = NumberFormat.simpleCurrency(name: 'USD', locale: locale);
    final session = model.session;
    final title = data?.companyName.isNotEmpty == true
        ? data!.companyName
        : (session?.tenantName.isNotEmpty == true ? session!.tenantName : copy.appTitle);

    return RefreshIndicator(
      onRefresh: model.refreshDashboard,
        child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        children: [
          Text(copy.brandLine, style: const TextStyle(color: Color(0xFF6366F1), fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.4)),
          const SizedBox(height: 6),
          Text(
            title,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800, letterSpacing: -0.4),
          ),
          const SizedBox(height: 4),
          Text(
            session?.name.isNotEmpty == true ? session!.name : copy.home,
            style: const TextStyle(color: hisbenewMuted),
          ),
          const SizedBox(height: 18),
          if (model.loadingDashboard && data == null)
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator()))
          else if (model.dashboardError != null && data == null)
            _StatusCard(
              message: copy.couldNotLoad,
              action: copy.retry,
              onPressed: model.refreshDashboard,
            )
          else if (data != null) ...[
            _MetricGrid(
              items: [
                _Metric(copy.newOrders, numbers.format(data.newOrdersToday)),
                _Metric(copy.shipQueue, numbers.format(data.pendingShippingOrders)),
                _Metric(copy.lowStock, numbers.format(data.lowStockCount)),
                _Metric(copy.factoryStock, numbers.format(data.factoryStock)),
                _Metric(copy.weekSales, money.format(data.weekSales)),
                _Metric(copy.workers, numbers.format(data.activeWorkers)),
              ],
            ),
          ],
        ],
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
        _InfoRow(copy.serverLabel, session?.baseUrl ?? ''),
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
          child: const Text('HI', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
        ),
        const SizedBox(width: 12),
        const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Hisbenew', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text('Industries', style: TextStyle(color: hisbenewMuted, fontSize: 13)),
          ],
        ),
      ],
    );
  }
}

class _Metric {
  const _Metric(this.label, this.value);

  final String label;
  final String value;
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.items});

  final List<_Metric> items;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.45,
      children: [
        for (final item in items)
          DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: hisbenewLine),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.label, style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700, fontSize: 12)),
                  const Spacer(),
                  Text(item.value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                ],
              ),
            ),
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
