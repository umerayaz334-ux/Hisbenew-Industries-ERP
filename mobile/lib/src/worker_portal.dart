import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'shipping_page.dart';
import 'theme.dart';

class WorkerPortal extends StatefulWidget {
  const WorkerPortal({required this.model, super.key});

  final AppModel model;

  @override
  State<WorkerPortal> createState() => _WorkerPortalState();
}

class _WorkerPortalState extends State<WorkerPortal> {
  var _index = 0;
  var _loading = true;
  var _error = false;
  var _toShip = 0;
  List<Map<String, dynamic>> _tasks = const [];
  List<Map<String, dynamic>> _payments = const [];
  List<Map<String, dynamic>> _expenses = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final results = await Future.wait([
        widget.model.api.pendingShipping(session),
        widget.model.api.workerTasks(session),
        widget.model.api.workerOrderTasks(session),
        widget.model.api.workerPayments(session),
        widget.model.api.workerExpenses(session),
      ]);
      if (!mounted) return;
      setState(() {
        _toShip = results[0].length;
        _tasks = [...results[1], ...results[2]];
        _payments = results[3];
        _expenses = results[4];
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

  @override
  Widget build(BuildContext context) {
    final labels = [
      phrase(context, 'Home', 'ہوم'),
      phrase(context, 'Shipping', 'شپنگ'),
      phrase(context, 'Payouts', 'ادائیگی'),
    ];
    final pages = [
      _WorkerHome(
        model: widget.model,
        loading: _loading,
        error: _error,
        toShip: _toShip,
        tasks: _tasks,
        payments: _payments,
        expenses: _expenses,
        onRetry: _load,
        onOpenPayouts: () => setState(() => _index = 2),
      ),
      ShippingPage(model: widget.model),
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
    ];

    return Scaffold(
      backgroundColor: const Color(0xFFF6F3EE),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      labels[_index],
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: -0.4, color: hisbenewInk),
                    ),
                  ),
                  IconButton(
                    onPressed: widget.model.signOut,
                    icon: const Icon(Icons.logout_rounded, color: hisbenewInk),
                    tooltip: phrase(context, 'Sign out', 'باہر'),
                  ),
                ],
              ),
            ),
            Expanded(child: pages[_index]),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        backgroundColor: Colors.white,
        indicatorColor: const Color(0xFFF3E6C8),
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_rounded), label: labels[0]),
          NavigationDestination(icon: const Icon(Icons.local_shipping_rounded), label: labels[1]),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_rounded), label: labels[2]),
        ],
      ),
    );
  }
}

class _Money {
  const _Money({required this.earned, required this.paid, required this.spent});

  final double earned;
  final double paid;
  final double spent;

  double get balance => earned + spent - paid;
}

_Money _moneyOf(List<Map<String, dynamic>> tasks, List<Map<String, dynamic>> payments, List<Map<String, dynamic>> expenses) {
  var earned = 0.0;
  for (final task in tasks) {
    final status = asText(task['status']).toLowerCase();
    if (status != 'completed' && status != 'verified') continue;
    final labor = asDouble(task['labor_cost']);
    if (labor > 0) {
      earned += labor;
      continue;
    }
    final qty = asDouble(task['completed_quantity']);
    final assigned = asDouble(task['assigned_quantity']);
    final count = qty > 0 ? qty : assigned;
    earned += count * asDouble(task['rate_per_piece']);
  }
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
    required this.toShip,
    required this.tasks,
    required this.payments,
    required this.expenses,
    required this.onRetry,
    required this.onOpenPayouts,
  });

  final AppModel model;
  final bool loading;
  final bool error;
  final int toShip;
  final List<Map<String, dynamic>> tasks;
  final List<Map<String, dynamic>> payments;
  final List<Map<String, dynamic>> expenses;
  final Future<void> Function() onRetry;
  final VoidCallback onOpenPayouts;

  @override
  Widget build(BuildContext context) {
    final name = model.session?.name.trim().isNotEmpty == true ? model.session!.name.trim() : phrase(context, 'there', 'ورکر');
    final money = _moneyOf(tasks, payments, expenses);
    return RefreshIndicator(
      color: hisbenewInk,
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(phrase(context, 'Hello, $name', 'سلام، $name'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.6, color: hisbenewInk)),
          const SizedBox(height: 4),
          Text(DateFormat.yMMMEd().format(DateTime.now()), style: const TextStyle(color: hisbenewMuted)),
          const SizedBox(height: 18),
          if (loading)
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator(color: hisbenewInk, strokeWidth: 2)))
          else if (error)
            FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else ...[
            _BalanceCard(money: money, onOpen: onOpenPayouts),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _Stat(label: phrase(context, 'To ship', 'بھیجنا'), value: '$toShip')),
                const SizedBox(width: 10),
                Expanded(child: _Stat(label: phrase(context, 'Spent', 'خرچ'), value: _pkr(money.spent))),
              ],
            ),
          ],
        ],
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
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          if (loading)
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator(color: hisbenewInk, strokeWidth: 2)))
          else if (error)
            FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else if (!linked)
            Text(phrase(context, 'This login is not linked to a worker record yet.', 'یہ لاگ اِن ورکر سے منسلک نہیں۔'))
          else ...[
            _BalanceCard(money: money),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: _Stat(label: phrase(context, 'Earned', 'کمائی'), value: _pkr(money.earned))),
                const SizedBox(width: 8),
                Expanded(child: _Stat(label: phrase(context, 'Paid', 'ملا'), value: _pkr(money.paid))),
                const SizedBox(width: 8),
                Expanded(child: _Stat(label: phrase(context, 'Spent', 'خرچ'), value: _pkr(money.spent))),
              ],
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => _sendSpend(context),
              icon: const Icon(Icons.add_rounded),
              label: Text(phrase(context, 'Send factory spending', 'فیکٹری خرچ بھیجیں')),
            ),
            const SizedBox(height: 8),
            Text(
              phrase(context, 'Note, amount, and date go to the office payout page.', 'نوٹ، رقم اور تاریخ دفتر کی ادائیگی پر چلی جاتی ہے۔'),
              style: const TextStyle(color: hisbenewMuted, fontSize: 12),
            ),
            const SizedBox(height: 18),
            Text(phrase(context, 'Spending sent', 'بھیجا ہوا خرچ'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (expenses.isEmpty)
              Text(phrase(context, 'Nothing sent yet.', 'ابھی کچھ نہیں بھیجا۔'), style: const TextStyle(color: hisbenewMuted))
            else
              for (final row in expenses) _MoneyRow(when: asText(row['spent_at']), title: asText(row['note']), amount: asDouble(row['amount'])),
            const SizedBox(height: 16),
            Text(phrase(context, 'Payouts received', 'ملی ہوئی ادائیگی'), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            if (payments.isEmpty)
              Text(phrase(context, 'No payout recorded yet.', 'ابھی ادائیگی درج نہیں۔'), style: const TextStyle(color: hisbenewMuted))
            else
              for (final row in payments)
                _MoneyRow(
                  when: asText(row['paid_at']),
                  title: asText(row['note']).isEmpty ? asText(row['payment_method']) : asText(row['note']),
                  amount: asDouble(row['amount']),
                ),
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
      color: hisbenewInk,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(phrase(context, 'Balance', 'باقی'), style: const TextStyle(color: Color(0xFFD6CBBA), fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              Text(_pkr(money.balance), style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 32, fontWeight: FontWeight.w800, letterSpacing: -0.8)),
              const SizedBox(height: 6),
              Text(
                phrase(context, 'Work plus factory spending, minus what you were paid.', 'کام اور خرچ، منہا جو رقم مل چکی۔'),
                style: const TextStyle(color: Color(0xFFB7AFA4), fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: hisbenewLine),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: hisbenewInk)),
        ],
      ),
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({required this.when, required this.title, required this.amount});

  final String when;
  final String title;
  final double amount;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title.isEmpty ? '—' : title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                Text(prettyWhen(when), style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(_pkr(amount), style: const TextStyle(fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}
