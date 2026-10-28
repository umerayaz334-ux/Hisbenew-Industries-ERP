import 'order_tasks_page.dart';
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';

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
import 'workspace_menu.dart';
import 'manufacturing_page.dart';

class WorkerPortal extends StatefulWidget {
  const WorkerPortal({required this.model, super.key});

  final AppModel model;

  @override
  State<WorkerPortal> createState() => _WorkerPortalState();
}

class _WorkerPortalState extends State<WorkerPortal> with WidgetsBindingObserver {
  late final CallDesk _calls = CallDesk(widget.model);
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  var _index = 0;
  var _notifications = false;
  var _loading = true;
  var _error = false;
  bool _fetching = false;
  bool _hasData = false;
  List<PendingShip> _pending = const [];
  List<Map<String, dynamic>> _needs = const [];
  List<Map<String, dynamic>> _tasks = const [];
  List<Map<String, dynamic>> _payments = const [];
  List<Map<String, dynamic>> _expenses = const [];
  var _unread = 0;
  final _openPages = <int>{};
  final _pageKeys = <int, GlobalKey>{};
  final _pageVisits = <int, int>{};
  Timer? _unreadTimer;
  Timer? _syncTimer;
  Timer? _firstSync;

  @override
  void initState() {
    super.initState();
    widget.model.addListener(_onAccess);
    notificationChat.addListener(_openNotificationChat);
    if (notificationChat.value != null) _index = 2;
    WidgetsBinding.instance.addObserver(this);
    _load();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _calls.startWatch();
      PhonePermissions.askOnce();
      _refreshUnread();
      _unreadTimer = Timer.periodic(const Duration(seconds: 8), (_) => _refreshUnread());
      _syncTimer = Timer.periodic(const Duration(seconds: 20), (_) => _syncOffline());
      _firstSync = Timer(const Duration(seconds: 3), () {
        if (mounted) _syncOffline();
      });
    });
  }

  @override
  void dispose() {
    widget.model.removeListener(_onAccess);
    notificationChat.removeListener(_openNotificationChat);
    _unreadTimer?.cancel();
    _syncTimer?.cancel();
    _firstSync?.cancel();
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

  Future<void> _showPendingSync() async {
    final session = widget.model.session;
    if (session == null) return;
    final rows = await widget.model.api.pendingSync(session);
    if (!mounted) return;
    await showWorkSheet(context: context, title: 'Saved on this phone', child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('These entries stay saved until the server confirms them. Retrying will use the same entry IDs.'),
      const SizedBox(height: 16),
      for (final row in rows) ListTile(contentPadding: EdgeInsets.zero,
        title: Text(row['kind'] == 'Spending' ? '${row['note']} · PKR ${row['amount']}' : asText(row['body'])),
        subtitle: Text(asText(row['sync_error']).isNotEmpty ? asText(row['sync_error']) : widget.model.api.offline.syncNotice.isNotEmpty ? widget.model.api.offline.syncNotice : 'Waiting to sync'),
        leading: Icon(row['kind'] == 'Spending' ? Icons.receipt_long_outlined : Icons.chat_bubble_outline),
      ),
      FilledButton.icon(onPressed: () async { Navigator.pop(context); await _syncOffline(); }, icon: const Icon(Icons.sync), label: const Text('Retry saved entries')),
    ]));
  }

  Future<void> _paintSaved() async {
    final session = widget.model.session;
    if (session == null || _hasData) return;
    final api = widget.model.api;
    final worker = session.workerId;
    final saved = await Future.wait([
      api.savedList(session, '/shipping/pending'),
      api.savedList(session, '/production/tasks?worker_id=$worker'),
      api.savedList(session, '/order-workflow/tasks?worker_id=$worker'),
      api.savedList(session, '/worker-payments?worker_id=$worker'),
      api.savedList(session, '/worker-expenses?worker_id=$worker'),
    ]);
    if (!mounted || _hasData || saved.every((rows) => rows == null)) return;
    final pending = saved[0] ?? const <Map<String, dynamic>>[];
    final tasks = saved[1] ?? const <Map<String, dynamic>>[];
    final orderTasks = saved[2] ?? const <Map<String, dynamic>>[];
    setState(() {
      _pending = [for (final row in pending) PendingShip.fromJson(row)];
      _tasks = [...tasks, ...orderTasks];
      _payments = saved[3] ?? const [];
      _expenses = saved[4] ?? const [];
      _loading = false;
      _hasData = true;
    });
  }

  Future<List<Map<String, dynamic>>> _keepList(Future<List<Map<String, dynamic>>> request) async {
    try {
      return await request;
    } on ErpException catch (error) {
      if (error.code == 'invalidLogin') rethrow;
      return const [];
    }
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null || _fetching) return;
    _fetching = true;
    await _paintSaved();
    if (!mounted) { _fetching = false; return; }
    setState(() {
      _loading = !_hasData;
      _error = false;
    });
    try {
      final pendingFuture = _allow('Shipping') ? widget.model.api.pendingShipping(session) : Future.value(const <Map<String, dynamic>>[]);
      final tasksFuture = _allow('My Tasks') ? widget.model.api.workerTasks(session) : Future.value(const <Map<String, dynamic>>[]);
      final orderTasksFuture = _allow('My Tasks') ? widget.model.api.workerOrderTasks(session) : Future.value(const <Map<String, dynamic>>[]);
      final paymentsFuture = _allow('Worker Payouts') ? widget.model.api.workerPayments(session) : Future.value(const <Map<String, dynamic>>[]);
      final expensesFuture = _allow('Worker Payouts') ? widget.model.api.workerExpenses(session) : Future.value(const <Map<String, dynamic>>[]);
      final needsFuture = widget.model.api.manufacturingNeeds(session);
      // Attach error handlers to every request immediately: a revoked page
      // must not produce an unhandled error while another request is loading.
      final results = await Future.wait<Object>([
        _keepList(pendingFuture),
        _keepList(tasksFuture),
        _keepList(orderTasksFuture),
        _keepList(paymentsFuture),
        _keepList(expensesFuture),
        _keepList(needsFuture),
      ]);
      final pending = results[0] as List<Map<String, dynamic>>;
      final tasks = results[1] as List<Map<String, dynamic>>;
      final orderTasks = results[2] as List<Map<String, dynamic>>;
      final payments = results[3] as List<Map<String, dynamic>>;
      final expenses = results[4] as List<Map<String, dynamic>>;
      final needs = results[5] as List<Map<String, dynamic>>;
      if (!mounted) return;
      setState(() {
        _pending = [for (final row in pending) PendingShip.fromJson(row)];
        _needs = [
          for (final row in needs)
            if (asInt(row['shortage']) > 0) row,
        ];
        _tasks = [...tasks, ...orderTasks];
        _payments = payments;
        _expenses = expenses;
        _loading = false;
        _hasData = true;
      });
    } on ErpException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = true;
      });
    } finally { _fetching = false; }
  }

  void _onAccess() {
    if (!mounted) return;
    var index = _index;
    if (index == 1 && !_allow('Shipping')) index = 0;
    if (index == 2 && !_allow('Messages')) index = 0;
    if (index == 3 && !_allow('Worker Payouts')) index = 0;
    if (index == 5 && !_allow('Orders')) index = 0;
    if (index == 6 && !_allow('Products')) index = 0;
    if (index == 8 && !_allow('Manufacturing')) index = 0;
    if (index == 9 && !_allow('My Tasks')) index = 0;
    if (index != _index) setState(() => _index = index);
  }

  bool _allow(String page) => widget.model.canAccess(page);

  void _open(int index) {
    if (index == 1 && !_allow('Shipping')) index = 0;
    if (index == 2 && !_allow('Messages')) index = 0;
    if (index == 3 && !_allow('Worker Payouts')) index = 0;
    if (index == 5 && !_allow('Orders')) index = 0;
    if (index == 6 && !_allow('Products')) index = 0;
    if (index == 8 && !_allow('Manufacturing')) index = 0;
    if (index == 9 && !_allow('My Tasks')) index = 0;
    setState(() {
      _index = index;
      _notifications = false;
      if (index != 0) {
        _openPages.add(index);
        _pageVisits[index] = (_pageVisits[index] ?? 0) + 1;
      }
    });
  }

  Widget _keptPage(int index) {
    final key = _pageKeys.putIfAbsent(index, GlobalKey.new);
    final tick = _pageVisits[index] ?? 0;
    final page = switch (index) {
      1 => ShippingPage(key: key, model: widget.model, refreshTick: tick),
      2 => WorkerChat(key: key, model: widget.model, calls: _calls, refreshTick: tick),
      5 => OrdersPage(key: key, model: widget.model, refreshTick: tick),
      6 => ProductsPage(key: key, model: widget.model, refreshTick: tick),
      9 => OrderTasksPage(key: key, model: widget.model, refreshTick: tick),
      8 => ManufacturingPage(key: key, model: widget.model, refreshTick: tick),
      _ => ProfilePage(key: key, model: widget.model),
    };
    final visible = !_notifications && _index == index;
    return Offstage(
      offstage: !visible,
      child: TickerMode(enabled: visible, child: page),
    );
  }

  @override
  Widget build(BuildContext context) {
    final pages = <int, Widget>{
      3: _PayoutPage(
        model: widget.model,
        loading: _loading,
        error: _error,
        tasks: _tasks,
        payments: _payments,
        expenses: _expenses,
        onRetry: _load,
        onChanged: _load,
      ),
      4: ProfilePage(model: widget.model),
      7: PreferencesPage(model: widget.model),
    };

    return ListenableBuilder(
      listenable: _calls,
      builder: (context, _) {
        return Scaffold(
      key: _scaffoldKey,
      drawer: WorkspaceDrawer(model: widget.model, onSelect: _open, onNotifications: () => setState(() => _notifications = true)),
      backgroundColor: hisbenewCanvas,
      body: Stack(
        children: [
          ListenableBuilder(listenable: widget.model.api.offline, builder: (context, _) {
            final store = widget.model.api.offline;
            final showSync = store.offline || store.pending > 0;
            final top = MediaQuery.paddingOf(context).top;
            final home = _index == 0 && !_notifications;
            final notchHeader = home && !showSync;
            return AnnotatedRegion<SystemUiOverlayStyle>(
              value: notchHeader
                  ? SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.light, statusBarBrightness: Brightness.dark)
                  : SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent, statusBarIconBrightness: Brightness.dark, statusBarBrightness: Brightness.light),
              child: Column(children: [
                if (showSync) Padding(
                  padding: EdgeInsets.only(top: top),
                  child: Material(color: const Color(0xFFFFF3D5), child: ListTile(dense: true,
                    onTap: store.pending > 0 ? _showPendingSync : null,
                    leading: Icon(store.offline ? Icons.cloud_off : Icons.cloud_upload_outlined, size: 20),
                    title: Text(store.offline
                        ? 'Offline · showing saved data'
                        : '${store.pending} saved item${store.pending == 1 ? '' : 's'} waiting to sync'),
                    subtitle: Text(store.pending > 0
                        ? (store.syncNotice.isNotEmpty
                            ? store.syncNotice
                            : 'Tap to review saved entries. Sync retries automatically.')
                        : 'Only previously downloaded information is available.'),
                    trailing: IconButton(tooltip: 'Sync now', icon: const Icon(Icons.sync), onPressed: () async { await _syncOffline(); await _load(); }),
                  )),
                ),
                Expanded(child: Stack(children: [
                        if (home) _WorkerHome(
                            model: widget.model,
                            loading: _loading,
                            error: _error,
                            pending: _pending,
                            tasks: _tasks,
                            payments: _payments,
                            expenses: _expenses,
                            needs: _needs,
                            onRetry: _load,
                            onOpenPayouts: () => _open(3),
                            onOpenShipping: () => _open(1),
                            onOpenManufacturing: () => _open(8),
                            onOpenChat: () => _open(2),
                            onOpenOrders: () => _open(5),
                            onOpenTasks: () => _open(9),
                            onOpenProducts: () => _open(6),
                            unread: _unread,
                            topInset: showSync ? 0 : top,
                          ),
                        for (final index in _openPages)
                          if (const {1, 2, 5, 6, 8, 9}.contains(index))
                            Padding(padding: EdgeInsets.only(top: showSync ? 0 : top), child: _keptPage(index)),
                        if (!home && !_notifications && pages.containsKey(_index))
                          Padding(padding: EdgeInsets.only(top: showSync ? 0 : top), child: pages[_index]!),
                        if (_notifications) Padding(
                          padding: EdgeInsets.only(top: showSync ? 0 : top),
                          child: NotificationInbox(model: widget.model, onClose: () => setState(() => _notifications = false), onChat: () => _open(2), onShipping: () => _open(1)),
                        ),
                      ])),
              ]),
            );
          }),
          if (_calls.phase != 'idle') CallCover(desk: _calls),
        ],
      ),
      bottomNavigationBar: _calls.phase != 'idle' ? null : Builder(builder: (context) {
        final nav = <int>[
          0,
          1,
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
        onDestinationSelected: (slot) { if (nav[slot] == 4) { _scaffoldKey.currentState?.openDrawer(); } else { _open(nav[slot]); } },
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.space_dashboard_outlined),
            selectedIcon: const Icon(Icons.space_dashboard_rounded),
            label: phrase(context, 'Today', 'آج'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.local_shipping_outlined),
            selectedIcon: const Icon(Icons.local_shipping_rounded),
            label: phrase(context, 'Shipping', 'شپنگ'),
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

(String, String) helloFor(DateTime now) {
  final hour = now.hour;
  if (hour >= 5 && hour < 12) return ('Good morning', 'صبح بخیر');
  if (hour >= 12 && hour < 17) return ('Good afternoon', 'دوپہر بخیر');
  if (hour >= 17 && hour < 21) return ('Good evening', 'شام بخیر');
  return ('Hello', 'سلام');
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
    required this.tasks,
    required this.payments,
    required this.expenses,
    required this.needs,
    required this.onRetry,
    required this.onOpenPayouts,
    required this.onOpenShipping,
    required this.onOpenManufacturing,
    required this.onOpenChat,
    required this.onOpenOrders,
    required this.onOpenTasks,
    required this.onOpenProducts,
    required this.unread,
    required this.topInset,
  });

  final AppModel model;
  final bool loading;
  final bool error;
  final List<PendingShip> pending;
  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;
  final List<Map<String, dynamic>> needs;
  final Future<void> Function() onRetry;
  final VoidCallback onOpenPayouts;
  final VoidCallback onOpenShipping;
  final VoidCallback onOpenManufacturing;
  final VoidCallback onOpenChat;
  final VoidCallback onOpenOrders;
  final VoidCallback onOpenTasks;
  final VoidCallback onOpenProducts;
  final int unread;
  final double topInset;

  @override
  Widget build(BuildContext context) {
    final name = model.session?.name.split(' ').first ?? '';
    final hello = helloFor(DateTime.now());
    final money = _moneyOf(tasks, payments, expenses);
    final shipping = model.canAccess('Shipping');
    final payouts = model.canAccess('Worker Payouts');
    final stats = <_DashStat>[
      if (shipping) _DashStat(phrase(context, 'To ship', 'بھیجنا'), '${pending.length}', onOpenShipping),
      if (payouts) _DashStat(phrase(context, 'Balance', 'بقایا'), _pkr(money.balance), onOpenPayouts),
    ];
    return RefreshIndicator(
      color: Colors.white,
      backgroundColor: hisbenewForest,
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: [
          DecoratedBox(
            decoration: const BoxDecoration(
              color: hisbenewForest,
              borderRadius: BorderRadius.vertical(bottom: Radius.circular(32)),
            ),
            child: Padding(
              padding: EdgeInsets.fromLTRB(20, topInset + 18, 20, 22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    DateFormat('EEEE, d MMMM').format(DateTime.now()).toUpperCase(),
                    style: const TextStyle(fontSize: 11, letterSpacing: 1.6, fontWeight: FontWeight.w700, color: Color(0xFFE7C98A)),
                  ),
                  const SizedBox(height: 8),
                  Text('${phrase(context, hello.$1, hello.$2)}, $name', style: const TextStyle(fontSize: 30, height: 1.05, letterSpacing: -0.8, fontWeight: FontWeight.w800, color: Colors.white)),
                  const SizedBox(height: 6),
                  Text(phrase(context, 'Orders, pay, and messages in one place.', 'آرڈر، رقم اور پیغام ایک جگہ۔'), style: const TextStyle(color: Color(0xFFC9DDD4), fontSize: 14)),
                  if (stats.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        for (var i = 0; i < stats.length; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          Expanded(child: _NotchStat(stat: stats[i])),
                        ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (loading && pending.isEmpty)
                  const Padding(padding: EdgeInsets.only(bottom: 12), child: LinearProgressIndicator(color: hisbenewForest, backgroundColor: Color(0xFFE7DDD0), minHeight: 2)),
                if (error && pending.isEmpty)
                  OutlinedButton(onPressed: onRetry, child: const Text('Reload dashboard'))
                else ...[
                  if (shipping) ...[
                    _SectionHead(title: phrase(context, 'To ship', 'بھیجنا'), action: phrase(context, 'Queue', 'قطار'), count: pending.length, onAction: onOpenShipping),
                    if (pending.isEmpty)
                      const WorkCard(child: Padding(padding: EdgeInsets.all(20), child: Text('All caught up. No orders waiting to dispatch.')))
                    else
                      for (final row in pending) _OpenOrderCard(
                        when: row.when,
                        customer: row.customer,
                        orderNo: row.orderNo,
                        items: row.items,
                        onTap: () => openPendingShip(context, model: model, row: row, onChanged: onRetry),
                      ),
                    const SizedBox(height: 8),
                  ],
                  if (model.canAccess('My Tasks')) Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _QuickTile(icon: Icons.assignment_outlined, label: phrase(context, 'My Tasks', 'میرے کام'), onTap: onOpenTasks),
                  ),
                  _SectionHead(title: phrase(context, 'To make', 'بنانا'), action: phrase(context, 'Make', 'بنائیں'), count: needs.length, onAction: onOpenManufacturing),
                  if (needs.isEmpty)
                    const WorkCard(child: Padding(padding: EdgeInsets.all(20), child: Text('Nothing to make right now.')))
                  else
                    for (final row in needs) _MakeRow(sku: asText(row['article_no']), image: asText(row['image_url']), units: asInt(row['shortage'])),
                  const SizedBox(height: 8),
                  Row(children: [
                    if (model.canAccess('Orders')) Expanded(child: _QuickTile(icon: Icons.receipt_long_outlined, label: phrase(context, 'Orders', 'آرڈر'), onTap: onOpenOrders)),
                    if (model.canAccess('Orders') && model.canAccess('Products')) const SizedBox(width: 10),
                    if (model.canAccess('Products')) Expanded(child: _QuickTile(icon: Icons.inventory_2_outlined, label: phrase(context, 'Products', 'مصنوعات'), onTap: onOpenProducts)),
                    if (payouts && (model.canAccess('Orders') || model.canAccess('Products'))) const SizedBox(width: 10),
                    if (payouts) Expanded(child: _QuickTile(icon: Icons.add_rounded, label: phrase(context, 'Spending', 'خرچ'), onTap: onOpenPayouts)),
                  ]),
                  const SizedBox(height: 16),
                  if (model.canAccess('Messages')) _ChatCallBar(onTap: onOpenChat, unread: unread),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DashStat {
  const _DashStat(this.label, this.value, this.onTap);

  final String label;
  final String value;
  final VoidCallback onTap;
}

class _NotchStat extends StatelessWidget {
  const _NotchStat({required this.stat});

  final _DashStat stat;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0x1AFFFFFF),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: stat.onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0x33FFFFFF)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(stat.value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: -0.3)),
              const SizedBox(height: 2),
              Text(stat.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xFFC9DDD4), fontSize: 11, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionHead extends StatelessWidget {
  const _SectionHead({required this.title, required this.action, required this.count, required this.onAction});

  final String title;
  final String action;
  final int count;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        Expanded(child: Text('$title · $count', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: hisbenewInk))),
        TextButton(onPressed: onAction, child: Text(action)),
      ]),
    );
  }
}

class _OpenOrderCard extends StatelessWidget {
  const _OpenOrderCard({
    required this.when,
    required this.customer,
    required this.orderNo,
    required this.items,
    required this.onTap,
  });

  final String when;
  final String customer;
  final String orderNo;
  final List<ItemShot> items;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final headline = [prettyWhen(when), customer].where((part) => part.isNotEmpty).join('  ·  ');
    return WorkCard(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(headline.isEmpty ? '#$orderNo' : headline, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
              if (orderNo.isNotEmpty) Text('#$orderNo', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w600)),
            ])),
            const SizedBox(width: 8),
            OrderPhotos(items: items),
          ]),
        ),
      ),
    );
  }
}

class _MakeRow extends StatelessWidget {
  const _MakeRow({required this.sku, required this.image, required this.units});

  final String sku;
  final String image;
  final int units;

  @override
  Widget build(BuildContext context) {
    final label = units == 1 ? phrase(context, 'unit', 'یونٹ') : phrase(context, 'units', 'یونٹ');
    final skuLabel = sku.trim().isEmpty ? '—' : sku.trim();
    final canOpen = productImageUrl(image) != null;
    return WorkCard(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Row(
          children: [
            GestureDetector(
              onTap: canOpen ? () => openProductPhoto(context, path: image, title: skuLabel) : null,
              child: ProductThumb(path: image, size: 56),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                skuLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 22, height: 1.05, fontWeight: FontWeight.w800, letterSpacing: -0.4, color: hisbenewInk),
              ),
            ),
            const SizedBox(width: 10),
            Container(
              constraints: const BoxConstraints(minWidth: 64),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(color: hisbenewForest, borderRadius: BorderRadius.circular(14)),
              child: Column(
                children: [
                  Text('$units', style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 22, height: 1, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(label, style: const TextStyle(color: Color(0xFFD7E4DB), fontSize: 11, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickTile extends StatelessWidget {
  const _QuickTile({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: hisbenewLine)),
          child: Column(children: [
            Icon(icon, color: hisbenewForest, size: 22),
            const SizedBox(height: 6),
            Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12, color: hisbenewInk)),
          ]),
        ),
      ),
    );
  }
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
          if (error && tasks.isEmpty && payments.isEmpty && expenses.isEmpty)
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
          title: asText(task['article_no']).isNotEmpty
              ? asText(task['article_no'])
              : asText(task['step_name']),
          detail: asText(task['order_no']),
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
