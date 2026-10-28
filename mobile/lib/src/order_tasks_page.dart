import 'package:flutter/material.dart';
import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';

class OrderTasksPage extends StatefulWidget {
  const OrderTasksPage({required this.model, this.refreshTick = 0, super.key});
  final AppModel model;
  final int refreshTick;
  @override
  State<OrderTasksPage> createState() => _OrderTasksPageState();
}

class _OrderTasksPageState extends State<OrderTasksPage> {
  List<Map<String, dynamic>> _tasks = [];
  bool _loading = true, _history = false;
  int? _busy;
  String _error = '';

  @override
  void initState() { super.initState(); _load(); }
  @override
  void didUpdateWidget(OrderTasksPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshTick != widget.refreshTick) _load();
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    try {
      final rows = await widget.model.api.workerOrderTasks(session);
      if (mounted) setState(() { _tasks = rows; _loading = false; _error = ''; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _error = 'Could not refresh tasks. Pull down to retry.'; });
    }
  }

  Future<void> _act(Map<String, dynamic> task, String action, {Map<String, dynamic>? body}) async {
    final session = widget.model.session;
    if (session == null || _busy != null) return;
    setState(() { _busy = asInt(task['id']); _error = ''; });
    try {
      await widget.model.api.actOnOrderTask(session, asInt(task['id']), action, body: body);
      await _load();
    } on ErpException catch (error) {
      if (mounted) setState(() => _error = error.detail.isEmpty ? 'Could not save. Connect to the internet and retry.' : error.detail);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not save. Pull down to refresh before retrying.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _complete(Map<String, dynamic> task) async {
    final shipping = task['task_type'] == 'Shipping';
    final formKey = GlobalKey<FormState>();
    String courier = '', tracking = '', weight = '', note = '';
    final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: Text(shipping ? 'Submit shipment' : 'Finish preparation'),
      content: SingleChildScrollView(child: Form(key: formKey, child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('The sending company will verify your completed work.'),
        if (shipping) ...[
          TextFormField(decoration: const InputDecoration(labelText: 'Courier'), onChanged: (value) => courier = value,
            validator: (value) => (value ?? '').trim().isEmpty ? 'Enter courier' : null),
          TextFormField(decoration: const InputDecoration(labelText: 'Tracking number'), onChanged: (value) => tracking = value,
            validator: (value) => (value ?? '').trim().isEmpty ? 'Enter tracking number' : null),
          TextFormField(decoration: const InputDecoration(labelText: 'Package weight (kg)'), keyboardType: const TextInputType.numberWithOptions(decimal: true), onChanged: (value) => weight = value,
            validator: (value) => (double.tryParse(value ?? '') ?? 0) <= 0 ? 'Enter a positive weight' : null),
        ],
        TextFormField(decoration: const InputDecoration(labelText: 'Completion note'), maxLines: 2, onChanged: (value) => note = value),
      ]))),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        FilledButton(onPressed: () { if (formKey.currentState!.validate()) Navigator.pop(context, true); }, child: const Text('Submit'))],
    ));
    if (confirmed != true || !mounted) return;
    await _act(task, 'complete', body: {
      'verify': false, 'note': note.trim(),
      if (shipping) 'courier_name': courier.trim(),
      if (shipping) 'tracking_number': tracking.trim(),
      if (shipping) 'package_weight_kg': double.parse(weight),
    });
  }

  @override
  Widget build(BuildContext context) {
    final rows = _tasks.where((task) => _history || !{'Completed', 'Canceled'}.contains(task['status'])).toList();
    return RefreshIndicator(onRefresh: _load, child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(20), children: [
      const Text('My Tasks', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      const Text('Order work assigned to your login, including orders forwarded by other companies.'),
      SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Include completed and canceled'), value: _history, onChanged: (value) => setState(() => _history = value)),
      if (_loading) const Center(child: CircularProgressIndicator()),
      if (_error.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(_error, style: const TextStyle(color: Colors.red))),
      if (!_loading && rows.isEmpty) const WorkCard(child: Padding(padding: EdgeInsets.all(20), child: Text('No order tasks to show. Pull down to refresh.'))),
      for (final task in rows) WorkCard(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (asText(task['source_company_name']).isNotEmpty) Text('From ${task['source_company_name']}', style: const TextStyle(fontWeight: FontWeight.w700)),
        Text('#${asText(task['order_no'])}', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
        Text('${asText(task['task_type'])} · ${asText(task['status'])}'),
        if (asText(task['due_at']).isNotEmpty) Text('Due: ${DateTime.tryParse(asText(task['due_at']))?.toLocal().toString() ?? task['due_at']}'),
        const SizedBox(height: 10),
        for (final item in (task['items'] as List? ?? []).whereType<Map>()) Padding(padding: const EdgeInsets.only(bottom: 8), child: Row(children: [
          ProductThumb(path: asText(item['product_image_url']), size: 48),
          const SizedBox(width: 10),
          Expanded(child: Text('${asText(item['article_no'])} · ${asText(item['product_name'])}\n${asInt(item['quantity'])} pcs')),
        ])),
        if (asText(task['notes']).isNotEmpty) Text(asText(task['notes'])),
        if (task['task_type'] == 'Shipping' && asText(task['customer_address']).isNotEmpty) Text('Deliver to: ${asText(task['customer_address'])}'),
        if (task['task_type'] == 'Shipping' && asText(task['customer_phone']).isNotEmpty) Text(asText(task['customer_phone'])),
        const SizedBox(height: 10),
        if (task['status'] == 'New' || task['status'] == 'Ready') FilledButton(onPressed: _busy != null ? null : () => _act(task, 'start'), child: Text(_busy == asInt(task['id']) ? 'Saving…' : 'Accept task')),
        if (task['status'] == 'In Progress') FilledButton(onPressed: _busy != null ? null : () => _complete(task), child: Text(_busy == asInt(task['id']) ? 'Saving…' : 'Submit completed work')),
        if (task['status'] == 'Pending Verification') const Text('Waiting for the sending company to verify.'),
      ]))),
    ]));
  }
}
