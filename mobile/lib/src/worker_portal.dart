import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'app_loader.dart';
import 'call_desk.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'phone_permissions.dart';
import 'shipping_page.dart';
import 'theme.dart';
import 'worker_chat.dart';
import 'notification_inbox.dart';
import 'notification_navigation.dart';
import 'orders_page.dart';
import 'products_page.dart';

class WorkerPortal extends StatefulWidget {
  const WorkerPortal({required this.model, super.key});

  final AppModel model;

  @override
  State<WorkerPortal> createState() => _WorkerPortalState();
}

class _WorkerPortalState extends State<WorkerPortal> with WidgetsBindingObserver {
  late final CallDesk _calls = CallDesk(widget.model);
  var _index = 0;
  var _notifications = false;
  var _loading = true;
  var _error = false;
  List<PendingShip> _pending = const [];
  List<ShipmentRecord> _moving = const [];
  List<Map<String, dynamic>> _tasks = const [];
  List<Map<String, dynamic>> _payments = const [];
  List<Map<String, dynamic>> _expenses = const [];
  var _unread = 0;
  Timer? _unreadTimer;
  Timer? _syncTimer;

  @override
  void initState() {
    super.initState();
    widget.model.addListener(_onAccess);
    notificationChat.addListener(_openNotificationChat);
    if (notificationChat.value != null) _index = 2;
    WidgetsBinding.instance.addObserver(this);
    _load();
    _refreshUnread();
    _unreadTimer = Timer.periodic(const Duration(seconds: 8), (_) => _refreshUnread());
    _calls.startWatch();
    PhonePermissions.askOnce();
    _syncTimer = Timer.periodic(const Duration(seconds: 20), (_) => _syncOffline());
    _syncOffline();
    final session = widget.model.session;
    if (session != null && widget.model.canAccess('Products')) {
      widget.model.api.products(session).catchError((_) => <Map<String, dynamic>>[]);
    }
  }

  @override
  void dispose() {
    widget.model.removeListener(_onAccess);
    notificationChat.removeListener(_openNotificationChat);
    _unreadTimer?.cancel();
    _syncTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _calls.dispose();
    super.dispose();
  }

  Future<void> _refreshUnread() async {
    final session = widget.model.session;
    if (session == null || !_allow('Messages')) return;
    try {
      final people = await widget.model.api.messageUsers(session);
      if (!mounted) return;
      final count = people.fold<int>(0, (sum, row) => sum + asInt(row['unread_count']));
      setState(() => _unread = count);
    } on ErpException {
      return;
    }
  }

  void _openNotificationChat() {
    if (mounted && notificationChat.value != null) _open(2);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _calls.answerIfWaiting();
      widget.model.refreshAccess();
      _syncOffline();
    }
  }

  Future<void> _syncOffline() async {
    final session = widget.model.session;
    if (session == null) return;
    final before = widget.model.api.offline.pending;
    await widget.model.api.syncExpenses(session);
    await widget.model.api.syncMessages(session);
    if (mounted && before > 0 && widget.model.api.offline.pending == 0) _load();
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final pendingFuture = _allow('Shipping') ? widget.model.api.pendingShipping(session) : Future.value(const <Map<String, dynamic>>[]);
      final tasksFuture = _allow('My Tasks') ? widget.model.api.workerTasks(session) : Future.value(const <Map<String, dynamic>>[]);
      final orderTasksFuture = _allow('My Tasks') ? widget.model.api.workerOrderTasks(session) : Future.value(const <Map<String, dynamic>>[]);
      final paymentsFuture = _allow('Worker Payouts') ? widget.model.api.workerPayments(session) : Future.value(const <Map<String, dynamic>>[]);
      final expensesFuture = _allow('Worker Payouts') ? widget.model.api.workerExpenses(session) : Future.value(const <Map<String, dynamic>>[]);
      final shippedFuture = _allow('Shipping') ? widget.model.api.shipments(session) : Future.value(const <ShipmentRecord>[]);
      final pending = await pendingFuture;
      final tasks = await tasksFuture;
      final orderTasks = await orderTasksFuture;
      final payments = await paymentsFuture;
      final expenses = await expensesFuture;
      final shipped = await shippedFuture;
      if (!mounted) return;
      setState(() {
        _pending = [for (final row in pending) PendingShip.fromJson(row)];
        _moving = [
          for (final row in shipped)
            if (_stillMoving(row.status)) row,
        ];
        _tasks = [...tasks, ...orderTasks];
        _payments = payments;
        _expenses = expenses;
        _loading = false;
      });
    } on ErpException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = true;
      });
    }
  }

  void _onAccess() {
    if (!mounted) return;
    var index = _index;
    if (index == 1 && !_allow('Shipping')) index = 0;
    if (index == 2 && !_allow('Messages')) index = 0;
    if (index == 3 && !_allow('Worker Payouts')) index = 0;
    if (index == 5 && !_allow('Orders')) index = 0;
    if (index == 6 && !_allow('Products')) index = 0;
    if (index != _index) setState(() => _index = index);
  }

  bool _allow(String page) => widget.model.canAccess(page);

  void _open(int index) {
    if (index == 1 && !_allow('Shipping')) index = 0;
    if (index == 2 && !_allow('Messages')) index = 0;
    if (index == 3 && !_allow('Worker Payouts')) index = 0;
    if (index == 5 && !_allow('Orders')) index = 0;
    if (index == 6 && !_allow('Products')) index = 0;
    setState(() { _index = index; _notifications = false; });
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      _WorkerHome(
        model: widget.model,
        loading: _loading,
        error: _error,
        pending: _pending,
        moving: _moving,
        tasks: _tasks,
        payments: _payments,
        expenses: _expenses,
        onRetry: _load,
        onOpenPayouts: () => _open(3),
        onOpenShipping: () => _open(1),
        onOpenChat: () => _open(2),
        onOpenOrders: () => _open(5),
        onOpenProducts: () => _open(6),
        unread: _unread,
      ),
      ShippingPage(model: widget.model),
      WorkerChat(model: widget.model, calls: _calls),
      _PayoutPage(
        model: widget.model,
        loading: _loading,
        error: _error,
        tasks: _tasks,
        payments: _payments,
        expenses: _expenses,
        onRetry: _load,
        onChanged: _load,
      ),
      _WorkerSettings(model: widget.model, onProducts: () => _open(6), onOrders: () => _open(5)),
      OrdersPage(model: widget.model),
      ProductsPage(model: widget.model),
    ];

    return ListenableBuilder(
      listenable: _calls,
      builder: (context, _) {
        return Scaffold(
      backgroundColor: hisbenewCanvas,
      body: Stack(
        children: [
          SafeArea(child: Column(children: [
            if (_index == 0 && !_notifications) Padding(padding: const EdgeInsets.fromLTRB(20, 4, 12, 0), child: Row(children: [
              const Spacer(),
              NotificationBell(count: _unread, onTap: () => setState(() => _notifications = !_notifications)),
            ])),
            if (_index > 4 && !_notifications) Row(children: [IconButton(onPressed: () => _open(0), icon: const Icon(Icons.arrow_back)), Text(_index == 5 ? 'Orders' : 'Products', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700))]),
            ListenableBuilder(listenable: widget.model.api.offline, builder: (context, _) {
              final store = widget.model.api.offline;
              if (!store.offline && store.pending == 0) return const SizedBox.shrink();
              return Material(color: const Color(0xFFFFF3D5), child: ListTile(dense: true,
                leading: Icon(store.offline ? Icons.cloud_off : Icons.cloud_upload_outlined, size: 20),
                title: Text(store.offline
                    ? 'Offline · showing saved data'
                    : '${store.pending} saved item${store.pending == 1 ? '' : 's'} waiting to sync'),
                subtitle: Text(store.pending > 0
                    ? (store.syncNotice.isNotEmpty
                        ? store.syncNotice
                        : 'Orders, products, spendings, and messages stay on this phone until the connection returns.')
                    : 'Only previously downloaded information is available.'),
                trailing: IconButton(tooltip: 'Sync now', icon: const Icon(Icons.sync), onPressed: () async { await _syncOffline(); await _load(); }),
              ));
            }),
            Expanded(child: _notifications ? NotificationInbox(model: widget.model,
              onClose: () => setState(() => _notifications = false), onChat: () => _open(2), onShipping: () => _open(1)) : pages[_index]),
          ])),
          if (_calls.phase != 'idle') CallCover(desk: _calls),
        ],
      ),
      bottomNavigationBar: _calls.phase != 'idle' ? null : Builder(builder: (context) {
        final nav = <int>[
          0,
          if (_allow('Shipping')) 1,
          if (_allow('Messages')) 2,
          if (_allow('Worker Payouts')) 3,
          4,
        ];
        final selected = nav.indexOf(_index > 4 ? 0 : _index);
        return NavigationBar(
        selectedIndex: selected < 0 ? 0 : selected,
        height: 68,
        backgroundColor: Colors.white,
        indicatorColor: const Color(0xFFF3E6C8),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        onDestinationSelected: (slot) => _open(nav[slot]),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.space_dashboard_outlined),
            selectedIcon: const Icon(Icons.space_dashboard_rounded),
            label: phrase(context, 'Today', 'آج'),
          ),
          if (_allow('Shipping')) NavigationDestination(
            icon: const Icon(Icons.local_shipping_outlined),
            selectedIcon: const Icon(Icons.local_shipping_rounded),
            label: phrase(context, 'Queue', 'قطار'),
          ),
          if (_allow('Messages')) NavigationDestination(
            icon: _ChatIcon(unread: _unread, selected: false),
            selectedIcon: _ChatIcon(unread: _unread, selected: true),
            label: phrase(context, 'Chat', 'چیٹ'),
          ),
          if (_allow('Worker Payouts')) NavigationDestination(
            icon: const Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: const Icon(Icons.account_balance_wallet_rounded),
            label: phrase(context, 'Pay', 'رقم'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.menu_rounded),
            selectedIcon: const Icon(Icons.menu_rounded),
            label: phrase(context, 'Menu', 'مینو'),
          ),
        ],
      );
      }),
        );
      },
    );
  }
}

bool _stillMoving(String status) {
  final value = status.trim().toLowerCase();
  return value != 'delivered' && value != 'completed';
}

class _Money {
  const _Money({required this.earned, required this.paid, required this.spent});

  final double earned;
  final double paid;
  final double spent;

  double get balance => earned + spent - paid;
}

_Money _moneyOf(List<Map<String, dynamic>> tasks, List<Map<String, dynamic>> payments, List<Map<String, dynamic>> expenses) {
  final earned = tasks.fold<double>(0, (sum, task) => sum + _taskPay(task));
  final paid = payments.fold<double>(0, (sum, row) => sum + asDouble(row['amount']));
  final spent = expenses.fold<double>(0, (sum, row) => sum + asDouble(row['amount']));
  return _Money(earned: earned, paid: paid, spent: spent);
}

String _pkr(double value) => 'PKR ${NumberFormat('#,##0', 'en').format(value.round())}';

class _WorkerHome extends StatelessWidget {
  const _WorkerHome({
    required this.model,
    required this.loading,
    required this.error,
    required this.pending,
    required this.moving,
    required this.tasks,
    required this.payments,
    required this.expenses,
    required this.onRetry,
    required this.onOpenPayouts,
    required this.onOpenShipping,
    required this.onOpenChat,
    required this.onOpenOrders,
    required this.onOpenProducts,
    required this.unread,
  });

  final AppModel model;
  final bool loading;
  final bool error;
  final List<PendingShip> pending;
  final List<ShipmentRecord> moving;
  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;
  final Future<void> Function() onRetry;
  final VoidCallback onOpenPayouts;
  final VoidCallback onOpenShipping;
  final VoidCallback onOpenChat;
  final VoidCallback onOpenOrders;
  final VoidCallback onOpenProducts;
  final int unread;

  @override
  Widget build(BuildContext context) {
    final rawName = model.session?.name.trim() ?? '';
    final name = rawName.isEmpty ? '' : rawName.split(RegExp(r'\s+')).first;
    final money = _moneyOf(tasks, payments, expenses);
    final waiting = pending.take(4).toList();
    final road = moving.take(4).toList();
    return RefreshIndicator(
      color: hisbenewForest,
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          Text(_greeting(context, name), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.7, height: 1.05, color: hisbenewInk)),
          const SizedBox(height: 6),
          Text(DateFormat.yMMMEd().format(DateTime.now()), style: const TextStyle(color: hisbenewMuted, fontSize: 13)),
          const SizedBox(height: 18),
          if (loading)
            const AppLoader()
          else if (error)
            FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else ...[
            _TodaySummary(waiting: pending.length, moving: moving.length,
              tasks: tasks.where((row) => !['completed', 'verified'].contains(asText(row['status']).toLowerCase())).length,
              onTap: onOpenShipping),
            const SizedBox(height: 20),
            const Text('YOUR WORKSPACE', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.6, color: hisbenewMuted)),
            const SizedBox(height: 12),
            Row(children: [
              if (model.canAccess('Orders')) ...[
                Expanded(child: _HomeAction(icon: Icons.receipt_long_outlined, title: 'Orders', subtitle: 'View orders', onTap: onOpenOrders)),
                const SizedBox(width: 10),
              ],
              if (model.canAccess('Products')) ...[
                Expanded(child: _HomeAction(icon: Icons.inventory_2_outlined, title: 'Products', subtitle: 'Browse stock', onTap: onOpenProducts)),
                const SizedBox(width: 10),
              ],
              if (model.canAccess('Worker Payouts'))
                Expanded(child: _HomeAction(icon: Icons.add_card_outlined, title: 'Spending', subtitle: 'Record costs', onTap: onOpenPayouts)),
            ]),
            if (model.canAccess('Worker Payouts')) ...[
            const SizedBox(height: 16),
            Material(color: Colors.white, borderRadius: BorderRadius.circular(20), child: InkWell(
              borderRadius: BorderRadius.circular(20), onTap: onOpenPayouts,
              child: Padding(padding: const EdgeInsets.all(18), child: Row(children: [
                const CircleAvatar(backgroundColor: Color(0xFFEDF5EF), child: Icon(Icons.account_balance_wallet_outlined, color: hisbenewForest)),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Your balance', style: TextStyle(color: hisbenewMuted, fontSize: 12)),
                  const SizedBox(height: 4), Text(_pkr(money.balance), style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800, letterSpacing: -.6)),
                ])),
                const Icon(Icons.arrow_forward_rounded, color: hisbenewForest),
              ])),
            )),
            ],
            if (model.canAccess('Messages')) ...[
            const SizedBox(height: 12),
            _ChatCallBar(onTap: onOpenChat, unread: unread),
            ],
            if (model.canAccess('Shipping')) ...[
            const SizedBox(height: 24),
            _QueueBlock(
              title: phrase(context, 'Still in the factory', 'فیکٹری میں'),
              count: pending.length,
              onOpen: onOpenShipping,
              empty: phrase(context, 'Nothing waiting to go out.', 'بھیجنے کو کچھ نہیں۔'),
              children: [
                for (final row in waiting)
                  _QueueLine(
                    when: row.when,
                    title: row.customer.isEmpty ? row.orderNo : row.customer,
                    units: row.units,
                    onTap: () => openPendingShip(context, model: model, row: row, onChanged: onRetry),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            _QueueBlock(
              title: phrase(context, 'Already sent', 'بھیج دیا'),
              count: moving.length,
              onOpen: onOpenShipping,
              empty: phrase(context, 'Nothing is out right now.', 'ابھی راستے میں کچھ نہیں۔'),
              children: [
                for (final row in road)
                  _QueueLine(
                    when: row.when,
                    title: row.customer.isEmpty ? row.orderNo : row.customer,
                    units: row.units,
                    trail: _roadLabel(context, row.status),
                    onTap: () => openShippedShip(context, model: model, row: row, onChanged: onRetry),
                  ),
              ],
            ),
            ],
          ],
        ],
      ),
    );
  }
}

String _greeting(BuildContext context, String name) {
  final hour = DateTime.now().hour;
  final who = name.isEmpty ? '' : ', $name';
  if (hour < 12) return phrase(context, 'Good morning$who', 'صبح بخیر$who');
  if (hour < 17) return phrase(context, 'Good afternoon$who', 'دوپہر بخیر$who');
  return phrase(context, 'Good evening$who', 'شام بخیر$who');
}

String _roadLabel(BuildContext context, String status) {
  final value = status.trim().toLowerCase();
  if (value.contains('transit')) return phrase(context, 'In transit', 'راستے میں');
  if (value.contains('exception') || value.contains('issue')) return phrase(context, 'Issue', 'مسئلہ');
  if (value.contains('wait')) return phrase(context, 'Waiting', 'انتظار');
  if (value.isEmpty) return phrase(context, 'Sent', 'بھیجا');
  return status;
}

class _PayoutPage extends StatelessWidget {
  const _PayoutPage({
    required this.model,
    required this.loading,
    required this.error,
    required this.tasks,
    required this.payments,
    required this.expenses,
    required this.onRetry,
    required this.onChanged,
  });

  final AppModel model;
  final bool loading;
  final bool error;
  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;
  final Future<void> Function() onRetry;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final money = _moneyOf(tasks, payments, expenses);
    final linked = (model.session?.workerId ?? 0) > 0;
    return RefreshIndicator(
      color: hisbenewInk,
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          if (loading)
            const AppLoader()
          else if (error)
            FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else if (!linked)
            Text(phrase(context, 'This login is not linked to a worker record yet.', 'یہ لاگ اِن ورکر سے منسلک نہیں۔'))
          else ...[
            _BalanceCard(money: money),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => _sendSpend(context),
              icon: const Icon(Icons.add_rounded),
              label: Text(phrase(context, 'Send factory spending', 'فیکٹری خرچ بھیجیں')),
            ),
            const SizedBox(height: 18),
            _Statement(tasks: tasks, payments: payments, expenses: expenses),
          ],
        ],
      ),
    );
  }

  Future<void> _sendSpend(BuildContext context) async {
    final amount = TextEditingController();
    final note = TextEditingController();
    var spent = DateTime.now();
    var saving = false;
    String? saveError;
    await showWorkSheet(
      context: context,
      title: phrase(context, 'Factory spending', 'فیکٹری خرچ'),
      child: StatefulBuilder(
        builder: (context, setSheet) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: phrase(context, 'Amount PKR', 'رقم')),
              ),
              const SizedBox(height: 10),
              OutlinedButton(
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: spent,
                    firstDate: DateTime(2020),
                    lastDate: DateTime.now().add(const Duration(days: 1)),
                  );
                  if (picked != null) setSheet(() => spent = picked);
                },
                child: Text(DateFormat.yMMMd().format(spent)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: note,
                minLines: 2,
                maxLines: 4,
                decoration: InputDecoration(labelText: phrase(context, 'Note', 'نوٹ')),
              ),
              const SizedBox(height: 14),
              if (saveError != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(saveError!, style: const TextStyle(color: Colors.red))),
              FilledButton(
                onPressed: saving ? null : () async {
                  final value = double.tryParse(amount.text.trim()) ?? 0;
                  if (!value.isFinite || value <= 0 || note.text.trim().isEmpty) { setSheet(() => saveError = 'Enter a positive amount and a note.'); return; }
                  final session = model.session;
                  if (session == null) return;
                  setSheet(() { saving = true; saveError = null; });
                  try {
                    await model.api.sendWorkerExpense(
                      session: session,
                      amount: value,
                      note: note.text,
                      spentAt: DateTime(spent.year, spent.month, spent.day, 12),
                    );
                  } catch (_) {
                    if (context.mounted) setSheet(() { saving = false; saveError = 'Could not save on this phone. Please try again.'; });
                    return;
                  }
                  if (context.mounted) Navigator.pop(context);
                  await onChanged();
                },
                child: Text(saving ? 'Saving…' : 'Save spending'),
              ),
            ],
          );
        },
      ),
    );
    amount.dispose();
    note.dispose();
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.money});

  final _Money money;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: hisbenewForest,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(phrase(context, 'Still owed', 'باقی'), style: const TextStyle(color: Color(0xFFD7E4DB), fontWeight: FontWeight.w700, fontSize: 13)),
              const SizedBox(height: 4),
              Text(_pkr(money.balance), style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.8)),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: _Mini(label: phrase(context, 'Earned', 'کمائی'), value: _pkr(money.earned))),
                  const SizedBox(width: 8),
                  Expanded(child: _Mini(label: phrase(context, 'Paid', 'ملا'), value: _pkr(money.paid))),
                  const SizedBox(width: 8),
                  Expanded(child: _Mini(label: phrase(context, 'Spent', 'خرچ'), value: _pkr(money.spent))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0x1AFFFFFF),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xFFD7E4DB), fontSize: 11, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}


class _QueueBlock extends StatelessWidget {
  const _QueueBlock({
    required this.title,
    required this.count,
    required this.onOpen,
    required this.empty,
    required this.children,
  });

  final String title;
  final int count;
  final VoidCallback onOpen;
  final String empty;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: hisbenewInk))),
            if (count > 0)
              TextButton(
                onPressed: onOpen,
                child: Text(phrase(context, 'All $count', 'سب $count')),
              ),
          ],
        ),
        if (children.isEmpty)
          Text(empty, style: const TextStyle(color: hisbenewMuted))
        else
          Container(
            decoration: BoxDecoration(
              color: hisbenewCard,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: hisbenewLine),
            ),
            child: Column(
              children: [
                for (var i = 0; i < children.length; i++) ...[
                  if (i > 0) const Divider(height: 1, color: hisbenewLine),
                  children[i],
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _QueueLine extends StatelessWidget {
  const _QueueLine({required this.when, required this.title, required this.units, required this.onTap, this.trail});

  final String when;
  final String title;
  final int units;
  final VoidCallback onTap;
  final String? trail;

  @override
  Widget build(BuildContext context) {
    final date = prettyWhen(when);
    final unitLabel = units == 1 ? phrase(context, '1 unit', '1 یونٹ') : phrase(context, '$units units', '$units یونٹس');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            if (date.isNotEmpty)
              SizedBox(
                width: 52,
                child: Text(date, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700, fontSize: 12)),
              ),
            Expanded(
              child: Text(
                title.isEmpty ? '—' : title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w700, color: hisbenewInk),
              ),
            ),
            if (trail != null && trail!.isNotEmpty) ...[
              const SizedBox(width: 8),
              Text(trail!, style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w700)),
            ],
            if (units > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFFE7F2EB),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: const Color(0xFFC5D9CC)),
                ),
                child: Text(unitLabel, style: const TextStyle(color: hisbenewForest, fontWeight: FontWeight.w800, fontSize: 12)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ChatIcon extends StatelessWidget {
  const _ChatIcon({required this.unread, required this.selected});

  final int unread;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final icon = Icon(selected ? Icons.forum_rounded : Icons.forum_outlined);
    if (unread <= 0) return icon;
    final label = unread > 9 ? '9+' : '$unread';
    return Badge(label: Text(label), child: icon);
  }
}

class _ChatCallBar extends StatelessWidget {
  const _ChatCallBar({required this.onTap, required this.unread});

  final VoidCallback onTap;
  final int unread;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: hisbenewCard,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: hisbenewLine),
          ),
          child: Row(
            children: [
              const Icon(Icons.forum_rounded, color: hisbenewForest),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  unread > 0 ? phrase(context, 'Chat and call · $unread new', 'چیٹ اور کال · $unread نئے') : phrase(context, 'Chat and call', 'چیٹ اور کال'),
                  style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewInk),
                ),
              ),
              const Icon(Icons.call_rounded, color: hisbenewBrass, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatementLine {
  _StatementLine({required this.when, required this.title, required this.detail, required this.kind, required this.signed});

  final DateTime when;
  final String title;
  final String detail;
  final String kind;
  final double signed;
  double balance = 0;
}

double _taskPay(Map<String, dynamic> task) {
  final status = asText(task['status']).toLowerCase();
  if (status != 'completed' && status != 'verified') return 0;
  final labor = asDouble(task['labor_cost']);
  if (labor > 0) return labor;
  final qty = asDouble(task['completed_quantity']);
  final assigned = asDouble(task['assigned_quantity']);
  final count = qty > 0 ? qty : assigned;
  return count * asDouble(task['rate_per_piece']);
}

DateTime _stamp(String raw) => DateTime.tryParse(raw)?.toLocal() ?? DateTime.fromMillisecondsSinceEpoch(0);

List<_StatementLine> _statementLines(
  List<Map<String, dynamic>> tasks,
  List<Map<String, dynamic>> payments,
  List<Map<String, dynamic>> expenses, {
  DateTime? from,
  DateTime? to,
}) {
  final lines = <_StatementLine>[
    for (final task in tasks)
      if (_taskPay(task) > 0)
        _StatementLine(
          when: _stamp(asText(task['completed_at']).isNotEmpty
              ? asText(task['completed_at'])
              : asText(task['updated_at']).isNotEmpty
                  ? asText(task['updated_at'])
                  : asText(task['created_at'])),
          title: asText(task['step_name']).isNotEmpty ? asText(task['step_name']) : asText(task['product_name']),
          detail: [
            asText(task['article_no']),
            asText(task['order_no']),
          ].where((part) => part.isNotEmpty).join(' · '),
          kind: 'work',
          signed: _taskPay(task),
        ),
    for (final row in expenses)
      _StatementLine(
        when: _stamp(asText(row['spent_at']).isNotEmpty ? asText(row['spent_at']) : asText(row['created_at'])),
        title: asText(row['note']),
        detail: '',
        kind: 'spend',
        signed: asDouble(row['amount']),
      ),
    for (final row in payments)
      _StatementLine(
        when: _stamp(asText(row['paid_at']).isNotEmpty ? asText(row['paid_at']) : asText(row['created_at'])),
        title: asText(row['note']).isNotEmpty ? asText(row['note']) : asText(row['payment_method']),
        detail: asText(row['payment_reference']),
        kind: 'payout',
        signed: -asDouble(row['amount']),
      ),
  ];
  final start = from;
  final end = to;
  if (start != null) {
    lines.retainWhere((line) => line.when.millisecondsSinceEpoch > 0 && !line.when.isBefore(start) && (end == null || line.when.isBefore(end)));
  }
  lines.sort((a, b) => a.when.compareTo(b.when));
  var running = 0.0;
  for (final line in lines) {
    running += line.signed;
    line.balance = running;
  }
  return lines.reversed.toList();
}

class _Statement extends StatefulWidget {
  const _Statement({required this.tasks, required this.payments, required this.expenses});

  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;

  @override
  State<_Statement> createState() => _StatementState();
}

class _StatementState extends State<_Statement> {
  var _period = 'all';

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final DateTime? from;
    final DateTime? to;
    if (_period == 'month') {
      from = DateTime(now.year, now.month);
      to = DateTime(now.year, now.month + 1);
    } else if (_period == 'last') {
      from = DateTime(now.year, now.month - 1);
      to = DateTime(now.year, now.month);
    } else {
      from = null;
      to = null;
    }
    final lines = _statementLines(widget.tasks, widget.payments, widget.expenses, from: from, to: to);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(phrase(context, 'Statement', 'بیان'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: hisbenewInk))),
            IconButton(
              onPressed: () => _share(context, lines),
              icon: const Icon(Icons.ios_share_rounded, color: hisbenewInk),
              tooltip: phrase(context, 'Share', 'شیئر'),
            ),
          ],
        ),
        Wrap(
          spacing: 8,
          children: [
            _PeriodChip(label: phrase(context, 'All', 'سب'), selected: _period == 'all', onTap: () => setState(() => _period = 'all')),
            _PeriodChip(label: phrase(context, 'This month', 'اس مہینے'), selected: _period == 'month', onTap: () => setState(() => _period = 'month')),
            _PeriodChip(label: phrase(context, 'Last month', 'پچھلا مہینہ'), selected: _period == 'last', onTap: () => setState(() => _period = 'last')),
          ],
        ),
        const SizedBox(height: 8),
        if (lines.isEmpty)
          Text(phrase(context, 'No transactions yet.', 'ابھی کوئی لین دین نہیں۔'), style: const TextStyle(color: hisbenewMuted))
        else
          Container(
            decoration: BoxDecoration(
              color: hisbenewCard,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: hisbenewLine),
            ),
            child: Column(
              children: [
                for (var i = 0; i < lines.length; i++) ...[
                  if (i > 0) const Divider(height: 1, color: hisbenewLine),
                  _StatementRow(line: lines[i]),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _share(BuildContext context, List<_StatementLine> lines) async {
    final heading = switch (_period) {
      'month' => phrase(context, 'This month', 'اس مہینے'),
      'last' => phrase(context, 'Last month', 'پچھلا مہینہ'),
      _ => phrase(context, 'All', 'سب'),
    };
    final buffer = StringBuffer('Hisbenew statement · $heading\n');
    if (lines.isEmpty) {
      buffer.writeln(phrase(context, 'No transactions yet.', 'ابھی کوئی لین دین نہیں۔'));
    }
    for (final line in lines.reversed) {
      final when = line.when.millisecondsSinceEpoch == 0 ? '' : DateFormat.yMMMd().format(line.when);
      final sign = line.signed >= 0 ? '+' : '−';
      buffer.writeln('${line.title.isEmpty ? line.kind : line.title} · $when · $sign${_pkr(line.signed.abs())}');
    }
    await Share.share(buffer.toString(), subject: 'Hisbenew statement');
  }
}

class _PeriodChip extends StatelessWidget {
  const _PeriodChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? hisbenewForest : hisbenewCard,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? hisbenewForest : hisbenewLine),
          ),
          child: Text(label, style: TextStyle(fontWeight: FontWeight.w800, color: selected ? Colors.white : hisbenewInk, fontSize: 13)),
        ),
      ),
    );
  }
}

class _StatementRow extends StatelessWidget {
  const _StatementRow({required this.line});

  final _StatementLine line;

  @override
  Widget build(BuildContext context) {
    final incoming = line.signed >= 0;
    final color = incoming ? hisbenewForest : const Color(0xFFA43A2D);
    final icon = switch (line.kind) {
      'spend' => Icons.shopping_bag_outlined,
      'payout' => Icons.payments_outlined,
      _ => Icons.handyman_outlined,
    };
    final kind = switch (line.kind) {
      'spend' => phrase(context, 'Spending', 'خرچ'),
      'payout' => phrase(context, 'Payout', 'ادائیگی'),
      _ => phrase(context, 'Work', 'کام'),
    };
    final when = line.when.millisecondsSinceEpoch == 0 ? '' : DateFormat.MMMd().format(line.when);
    final meta = [kind, when, line.detail].where((part) => part.isNotEmpty).join(' · ');
    final sign = incoming ? '+' : '−';
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 14, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
            child: Icon(icon, size: 18, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(line.title.isEmpty ? kind : line.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewInk)),
                const SizedBox(height: 2),
                Text(meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('$sign${_pkr(line.signed.abs())}', style: TextStyle(fontWeight: FontWeight.w800, color: color)),
              const SizedBox(height: 2),
              Text(_pkr(line.balance), style: const TextStyle(color: hisbenewMuted, fontSize: 11, fontWeight: FontWeight.w700)),
            ],
          ),
        ],
      ),
    );
  }
}

class _WorkerSettings extends StatelessWidget {
  const _WorkerSettings({required this.model, required this.onProducts, required this.onOrders});

  final AppModel model;
  final VoidCallback onProducts;
  final VoidCallback onOrders;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final session = model.session;
    final name = session?.name.trim().isNotEmpty == true ? session!.name.trim() : session?.username ?? '';
    final company = session == null ? '' : (session.tenantName.isNotEmpty ? session.tenantName : session.tenantSlug);
    final initial = name.isEmpty ? 'H' : name.characters.first.toUpperCase();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 28),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
          decoration: BoxDecoration(
            color: hisbenewCard,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: hisbenewLine),
          ),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 56,
                alignment: Alignment.center,
                decoration: const BoxDecoration(color: hisbenewForest, shape: BoxShape.circle),
                child: Text(initial, style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 22, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.3, color: hisbenewInk)),
                    const SizedBox(height: 2),
                    Text(session?.username ?? '', style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w600)),
                    if (company.isNotEmpty) Text(company, style: const TextStyle(color: hisbenewMuted, fontSize: 13)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        WorkCard(child: Column(children: [
          if (model.canAccess('Products')) ...[
            ListTile(leading: const Icon(Icons.inventory_2_outlined), title: const Text('Products'), subtitle: const Text('Browse the product catalog'), trailing: const Icon(Icons.chevron_right), onTap: onProducts),
            const Divider(height: 1),
          ],
          if (model.canAccess('Orders'))
            ListTile(leading: const Icon(Icons.receipt_long_outlined), title: const Text('Orders'), trailing: const Icon(Icons.chevron_right), onTap: onOrders),
        ])),
        const CallPermissionTile(),
        Text(copy.switchLanguage, style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewInk)),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          style: SegmentedButton.styleFrom(
            selectedBackgroundColor: hisbenewForest,
            selectedForegroundColor: Colors.white,
          ),
          segments: [
            ButtonSegment(value: 'en', label: Text(copy.english)),
            ButtonSegment(value: 'ur', label: Text(copy.urdu)),
          ],
          selected: {model.locale.languageCode},
          onSelectionChanged: (value) => model.setLocale(Locale(value.first)),
        ),
        const SizedBox(height: 28),
        OutlinedButton.icon(
          onPressed: model.signOut,
          icon: const Icon(Icons.logout_rounded, size: 18),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            foregroundColor: const Color(0xFFA43A2D),
            side: const BorderSide(color: Color(0xFFE7C8C2)),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          label: Text(copy.signOut),
        ),
      ],
    );
  }
}

class _TodaySummary extends StatelessWidget {
  const _TodaySummary({required this.waiting, required this.moving, required this.tasks, required this.onTap});
  final int waiting, moving, tasks;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF123F35), Color(0xFF236451)], begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: BorderRadius.circular(26)),
    child: Material(color: Colors.transparent, child: InkWell(borderRadius: BorderRadius.circular(26), onTap: onTap,
      child: Padding(padding: const EdgeInsets.all(22), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [Expanded(child: Text('TODAY AT A GLANCE', style: TextStyle(color: Color(0xFFA9D3BF), fontSize: 11, letterSpacing: 1.5, fontWeight: FontWeight.w700))), Icon(Icons.north_east, color: Colors.white70, size: 20)]),
        const SizedBox(height: 20),
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Text('$waiting', style: const TextStyle(color: Colors.white, fontSize: 54, fontWeight: FontWeight.w700, height: 1, letterSpacing: -2)),
          const SizedBox(width: 16), const Expanded(child: Text('Orders ready\nto dispatch', style: TextStyle(color: Colors.white, fontSize: 17, height: 1.4))),
        ]),
        const SizedBox(height: 22), const Divider(color: Color(0xFF4A7968), height: 1), const SizedBox(height: 16),
        Row(children: [Expanded(child: Text('$moving  In transit', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600))), Expanded(child: Text('$tasks  Active tasks', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)))]),
      ])),
    )),
  );
}

class _HomeAction extends StatelessWidget {
  const _HomeAction({required this.icon, required this.title, required this.subtitle, required this.onTap});
  final IconData icon;
  final String title, subtitle;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Material(color: Colors.white, borderRadius: BorderRadius.circular(18), child: InkWell(
    borderRadius: BorderRadius.circular(18), onTap: onTap, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 18), child: Column(children: [
      Icon(icon, color: hisbenewForest, size: 26), const SizedBox(height: 12),
      Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)), const SizedBox(height: 4),
      Text(subtitle, textAlign: TextAlign.center, style: const TextStyle(color: hisbenewMuted, fontSize: 10)),
    ])),
  ));
}
