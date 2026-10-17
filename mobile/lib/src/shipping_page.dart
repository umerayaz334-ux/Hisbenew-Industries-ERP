import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';

class PendingShip {
  const PendingShip({
    required this.orderId,
    required this.orderNo,
    required this.customer,
    required this.when,
    required this.status,
    required this.platform,
    required this.units,
    required this.phone,
    required this.address,
    required this.items,
  });

  final int orderId;
  final String orderNo;
  final String customer;
  final String when;
  final String status;
  final String platform;
  final int units;
  final String phone;
  final String address;
  final List<ItemShot> items;

  factory PendingShip.fromJson(Map<String, dynamic> json) {
    final items = itemShotsOf(json['items']);
    final units = items.fold<int>(0, (sum, item) => sum + item.qty);
    return PendingShip(
      orderId: asInt(json['order_id']),
      orderNo: asText(json['order_no']),
      customer: asText(json['customer_name']),
      when: asText(json['order_date']),
      status: asText(json['shipping_status']),
      platform: asText(json['platform']),
      units: units,
      phone: asText(json['shipping_phone']),
      address: asText(json['customer_address']),
      items: items,
    );
  }
}

class ShippingPage extends StatefulWidget {
  const ShippingPage({required this.model, super.key});

  final AppModel model;

  @override
  State<ShippingPage> createState() => _ShippingPageState();
}

class _ShippingPageState extends State<ShippingPage> {
  final _search = TextEditingController();
  var _loading = true;
  var _error = false;
  var _historyTab = true;
  List<PendingShip> _pending = const [];
  List<ShipmentRecord> _shipped = const [];

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
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
        widget.model.api.shipments(session),
      ]);
      if (!mounted) return;
      setState(() {
        _pending = [
          for (final row in results[0] as List<Map<String, dynamic>>) PendingShip.fromJson(row),
        ];
        _shipped = results[1].cast<ShipmentRecord>();
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

  bool _matches(String query, List<String> parts) {
    if (query.isEmpty) return true;
    final haystack = parts.join(' ').toLowerCase();
    return haystack.contains(query);
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final pending = _pending.where((row) => _matches(query, [row.customer, row.orderNo, row.status])).toList();
    final shipped = _shipped.where((row) => _matches(query, [row.customer, row.orderNo, row.tracking, row.status])).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: WorkSearch(controller: _search, hint: phrase(context, 'Customer or order', 'گاہک یا آرڈر')),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: SegmentedButton<bool>(
            style: SegmentedButton.styleFrom(
              selectedBackgroundColor: hisbenewForest,
              selectedForegroundColor: Colors.white,
            ),
            segments: [
              ButtonSegment(value: true, label: Text('${phrase(context, 'History', 'تاریخ')} ${_shipped.length}')),
              ButtonSegment(value: false, label: Text('${phrase(context, 'To ship', 'بھیجنا')} ${_pending.length}')),
            ],
            selected: {_historyTab},
            onSelectionChanged: (value) => setState(() => _historyTab = value.first),
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            color: hisbenewForest,
            onRefresh: _load,
            child: _loading || _error
                ? ListView(children: [SizedBox(height: 180, child: LoadState(loading: _loading, error: _error, empty: false, onRetry: _load, child: const SizedBox.shrink()))])
                : ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    children: _historyTab
                        ? [
                            for (final row in shipped) _ShippedTile(row: row, onChanged: _load, model: widget.model),
                          ]
                        : [
                            for (final row in pending) _PendingTile(row: row, onChanged: _load, model: widget.model),
                          ],
                  ),
          ),
        ),
      ],
    );
  }
}

class _CollapsedTitle extends StatelessWidget {
  const _CollapsedTitle({required this.when, required this.customer, required this.units});

  final String when;
  final String customer;
  final int units;

  @override
  Widget build(BuildContext context) {
    final name = customer.trim().isEmpty ? '—' : customer.trim();
    final date = prettyWhen(when);
    final unitLabel = units == 1 ? phrase(context, '1 unit', '1 یونٹ') : phrase(context, '$units units', '$units یونٹس');
    return Row(
      children: [
        if (date.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Text(
              date,
              maxLines: 1,
              softWrap: false,
              style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700, fontSize: 12.5),
            ),
          ),
        Expanded(
          child: Text(
            name,
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: hisbenewInk),
          ),
        ),
        if (units > 0) ...[
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: const Color(0xFFE7F2EB),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFFC5D9CC)),
            ),
            child: Text(
              unitLabel,
              maxLines: 1,
              softWrap: false,
              style: const TextStyle(color: hisbenewForest, fontWeight: FontWeight.w800, fontSize: 12, height: 1.1),
            ),
          ),
        ],
      ],
    );
  }
}

class _PendingTile extends StatelessWidget {
  const _PendingTile({required this.row, required this.onChanged, required this.model});

  final PendingShip row;
  final Future<void> Function() onChanged;
  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final title = row.customer.isEmpty ? row.orderNo : row.customer;
    return SummaryCard(
      sheetTitle: title.isEmpty ? phrase(context, 'Shipment', 'شپمنٹ') : title,
      summary: _CollapsedTitle(when: row.when, customer: row.customer, units: row.units),
      details: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in row.items) ProductLine(item: item),
          DetailLine(phrase(context, 'Order', 'آرڈر'), row.orderNo),
          DetailLine(phrase(context, 'Status', 'حالت'), row.status),
          DetailLine(phrase(context, 'Platform', 'پلیٹ فارم'), row.platform),
          DetailLine(phrase(context, 'Phone', 'فون'), row.phone),
          DetailLine(phrase(context, 'Address', 'پتہ'), row.address),
          const SizedBox(height: 6),
          FilledButton(
            onPressed: () => _ship(context),
            child: Text(phrase(context, 'Mark shipped', 'بھیج دیا')),
          ),
        ],
      ),
    );
  }

  Future<void> _ship(BuildContext context) async {
    final courier = TextEditingController();
    final tracking = TextEditingController();
    final weight = TextEditingController();
    final note = TextEditingController();
    await showWorkSheet(
      context: context,
      title: row.customer.isEmpty ? row.orderNo : row.customer,
      child: Column(
        children: [
          TextField(controller: courier, decoration: InputDecoration(labelText: phrase(context, 'Courier', 'کوریئر'))),
          const SizedBox(height: 10),
          TextField(controller: tracking, decoration: InputDecoration(labelText: phrase(context, 'Tracking', 'ٹریکنگ'))),
          const SizedBox(height: 10),
          TextField(controller: weight, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: phrase(context, 'Weight kg', 'وزن کلو'))),
          const SizedBox(height: 10),
          TextField(controller: note, decoration: InputDecoration(labelText: phrase(context, 'Note', 'نوٹ'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () async {
              final session = model.session;
              if (session == null) return;
              await model.api.markShipped(
                session: session,
                orderId: row.orderId,
                courier: courier.text.trim(),
                tracking: tracking.text.trim(),
                note: note.text.trim(),
                weightKg: double.tryParse(weight.text.trim()) ?? 0,
              );
              if (context.mounted) Navigator.pop(context);
              await onChanged();
            },
            child: Text(phrase(context, 'Save', 'محفوظ')),
          ),
        ],
      ),
    );
    courier.dispose();
    tracking.dispose();
    weight.dispose();
    note.dispose();
  }
}

class _ShippedTile extends StatelessWidget {
  const _ShippedTile({required this.row, required this.onChanged, required this.model});

  final ShipmentRecord row;
  final Future<void> Function() onChanged;
  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final title = row.customer.isEmpty ? row.orderNo : row.customer;
    return SummaryCard(
      sheetTitle: title.isEmpty ? phrase(context, 'Shipment', 'شپمنٹ') : title,
      summary: _CollapsedTitle(when: row.when, customer: row.customer, units: row.units),
      details: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in row.items) ProductLine(item: item),
          DetailLine(phrase(context, 'Order', 'آرڈر'), row.orderNo),
          DetailLine(phrase(context, 'Status', 'حالت'), row.status),
          DetailLine(phrase(context, 'Courier', 'کوریئر'), row.courier),
          DetailLine(phrase(context, 'Tracking', 'ٹریکنگ'), row.tracking),
          DetailLine(phrase(context, 'Weight', 'وزن'), row.weightKg.isEmpty ? '' : '${row.weightKg} kg'),
          DetailLine(phrase(context, 'Note', 'نوٹ'), row.note),
          Wrap(
            spacing: 8,
            children: [
              for (final stage in const ['waiting', 'in_transit', 'delivered', 'exception'])
                ActionChip(
                  label: Text(_stageLabel(context, stage)),
                  onPressed: () => _status(stage),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(onPressed: () => _edit(context), child: Text(phrase(context, 'Edit', 'ترمیم'))),
          ),
        ],
      ),
    );
  }

  String _stageLabel(BuildContext context, String stage) {
    return switch (stage) {
      'in_transit' => phrase(context, 'In transit', 'راستے میں'),
      'delivered' => phrase(context, 'Delivered', 'پہنچ گیا'),
      'exception' => phrase(context, 'Exception', 'مسئلہ'),
      _ => phrase(context, 'Waiting', 'انتظار'),
    };
  }

  Future<void> _status(String stage) async {
    final session = model.session;
    if (session == null || row.id == 0) return;
    await model.api.updateShipmentStatus(session: session, shippingId: row.id, stage: stage);
    await onChanged();
  }

  Future<void> _edit(BuildContext context) async {
    final courier = TextEditingController(text: row.courier);
    final tracking = TextEditingController(text: row.tracking);
    final weight = TextEditingController(text: row.weightKg);
    final note = TextEditingController(text: row.note);
    await showWorkSheet(
      context: context,
      title: row.orderNo,
      child: Column(
        children: [
          TextField(controller: courier, decoration: InputDecoration(labelText: phrase(context, 'Courier', 'کوریئر'))),
          const SizedBox(height: 10),
          TextField(controller: tracking, decoration: InputDecoration(labelText: phrase(context, 'Tracking', 'ٹریکنگ'))),
          const SizedBox(height: 10),
          TextField(controller: weight, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: phrase(context, 'Weight kg', 'وزن کلو'))),
          const SizedBox(height: 10),
          TextField(controller: note, decoration: InputDecoration(labelText: phrase(context, 'Note', 'نوٹ'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () async {
              final session = model.session;
              if (session == null) return;
              await model.api.updateShipment(
                session: session,
                shippingId: row.id,
                courier: courier.text.trim(),
                tracking: tracking.text.trim(),
                note: note.text.trim(),
                weightKg: double.tryParse(weight.text.trim()) ?? 0,
              );
              if (context.mounted) Navigator.pop(context);
              await onChanged();
            },
            child: Text(phrase(context, 'Save', 'محفوظ')),
          ),
        ],
      ),
    );
    courier.dispose();
    tracking.dispose();
    weight.dispose();
    note.dispose();
  }
}
