import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'call_desk.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'phone_permissions.dart';
import 'shipping_page.dart';
import 'theme.dart';
import 'worker_chat.dart';

class WorkerPortal extends StatefulWidget {
  const WorkerPortal({required this.model, super.key});

  final AppModel model;

  @override
  State<WorkerPortal> createState() => _WorkerPortalState();
}

class _WorkerPortalState extends State<WorkerPortal> with WidgetsBindingObserver {
  late final CallDesk _calls = CallDesk(widget.model);
  var _index = 0;
  var _loading = true;
  var _error = false;
  List<PendingShip> _pending = const [];
  List<ShipmentRecord> _moving = const [];
  List<Map<String, dynamic>> _tasks = const [];
  List<Map<String, dynamic>> _payments = const [];
  List<Map<String, dynamic>> _expenses = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    _calls.startWatch();
    PhonePermissions.askOnce();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _calls.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _calls.answerIfWaiting();
    }
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final pendingFuture = widget.model.api.pendingShipping(session);
      final tasksFuture = widget.model.api.workerTasks(session);
      final orderTasksFuture = widget.model.api.workerOrderTasks(session);
      final paymentsFuture = widget.model.api.workerPayments(session);
      final expensesFuture = widget.model.api.workerExpenses(session);
      final shippedFuture = widget.model.api.shipments(session);
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

  void _open(int index) => setState(() => _index = index);

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
      _WorkerSettings(model: widget.model),
    ];

    return ListenableBuilder(
      listenable: _calls,
      builder: (context, _) {
        return Scaffold(
      backgroundColor: hisbenewCanvas,
      body: Stack(
        children: [
          SafeArea(child: pages[_index]),
          if (_calls.phase != 'idle') CallCover(desk: _calls),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        height: 68,
        backgroundColor: Colors.white,
        indicatorColor: const Color(0xFFF3E6C8),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        onDestinationSelected: _open,
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.space_dashboard_outlined),
            selectedIcon: const Icon(Icons.space_dashboard_rounded),
            label: phrase(context, 'Today', 'آج'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.local_shipping_outlined),
            selectedIcon: const Icon(Icons.local_shipping_rounded),
            label: phrase(context, 'Queue', 'قطار'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.forum_outlined),
            selectedIcon: const Icon(Icons.forum_rounded),
            label: phrase(context, 'Chat', 'چیٹ'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: const Icon(Icons.account_balance_wallet_rounded),
            label: phrase(context, 'Pay', 'رقم'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline_rounded),
            selectedIcon: const Icon(Icons.person_rounded),
            label: phrase(context, 'Account', 'اکاؤنٹ'),
          ),
        ],
      ),
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
            const Padding(padding: EdgeInsets.only(top: 64), child: Center(child: CircularProgressIndicator(color: hisbenewForest, strokeWidth: 2)))
          else if (error)
            FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else ...[
            _BalanceCard(money: money, onOpen: onOpenPayouts),
            const SizedBox(height: 12),
            _ChatCallBar(onTap: onOpenChat),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _CountTile(
                    count: pending.length,
                    label: phrase(context, 'Waiting', 'باقی'),
                    tint: const Color(0xFFF3E6C8),
                    onTap: onOpenShipping,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _CountTile(
                    count: moving.length,
                    label: phrase(context, 'On the road', 'راستے میں'),
                    tint: const Color(0xFFE7F2EB),
                    onTap: onOpenShipping,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
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
                    onTap: onOpenShipping,
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
                    onTap: onOpenShipping,
                  ),
              ],
            ),
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
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator(color: hisbenewInk, strokeWidth: 2)))
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
              FilledButton(
                onPressed: () async {
                  final value = double.tryParse(amount.text.trim()) ?? 0;
                  if (value <= 0 || note.text.trim().isEmpty) return;
                  final session = model.session;
                  if (session == null) return;
                  try {
                    await model.api.sendWorkerExpense(
                      session: session,
                      amount: value,
                      note: note.text,
                      spentAt: DateTime(spent.year, spent.month, spent.day, 12),
                    );
                  } on ErpException {
                    return;
                  }
                  if (context.mounted) Navigator.pop(context);
                  await onChanged();
                },
                child: Text(phrase(context, 'Send', 'بھیجیں')),
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
  const _BalanceCard({required this.money, this.onOpen});

  final _Money money;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: hisbenewForest,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: onOpen,
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

class _CountTile extends StatelessWidget {
  const _CountTile({required this.count, required this.label, required this.tint, required this.onTap});

  final int count;
  final String label;
  final Color tint;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: hisbenewCard,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: hisbenewLine),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 28,
                height: 4,
                decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(99)),
              ),
              const SizedBox(height: 10),
              Text('$count', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -0.6, color: hisbenewInk, height: 1)),
              const SizedBox(height: 4),
              Text(label, style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700, fontSize: 13)),
            ],
          ),
        ),
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

class _ChatCallBar extends StatelessWidget {
  const _ChatCallBar({required this.onTap});

  final VoidCallback onTap;

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
                child: Text(phrase(context, 'Chat and call', 'چیٹ اور کال'), style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewInk)),
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

List<_StatementLine> _statementLines(List<Map<String, dynamic>> tasks, List<Map<String, dynamic>> payments, List<Map<String, dynamic>> expenses) {
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
  ]..sort((a, b) => a.when.compareTo(b.when));
  var running = 0.0;
  for (final line in lines) {
    running += line.signed;
    line.balance = running;
  }
  return lines.reversed.toList();
}

class _Statement extends StatelessWidget {
  const _Statement({required this.tasks, required this.payments, required this.expenses});

  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;

  @override
  Widget build(BuildContext context) {
    final lines = _statementLines(tasks, payments, expenses);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(phrase(context, 'Statement', 'بیان'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: hisbenewInk))),
            Text('${lines.length}', style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700)),
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
  const _WorkerSettings({required this.model});

  final AppModel model;

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
