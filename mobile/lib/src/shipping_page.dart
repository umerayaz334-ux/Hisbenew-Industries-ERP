import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';
import 'orders_page.dart';

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
    if (_pending.isEmpty && _shipped.isEmpty) {
      setState(() {
        _loading = true;
        _error = false;
      });
    } else {
      setState(() => _error = false);
    }
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
            child: _error && pending.isEmpty && shipped.isEmpty
                ? ListView(children: [SizedBox(height: 180, child: LoadState(loading: false, error: true, empty: false, onRetry: _load, child: const SizedBox.shrink()))])
                : ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: _historyTab ? shipped.length : pending.length,
                    itemBuilder: (context, index) => _historyTab
                        ? _ShippedTile(row: shipped[index], onChanged: _load, model: widget.model)
                        : _PendingTile(row: pending[index], onChanged: _load, model: widget.model),
                  ),
          ),
        ),
      ],
    );
  }
}

class ShippingSummary extends StatelessWidget {
  const ShippingSummary({required this.when, required this.customer, required this.units, required this.orderNo, required this.items, super.key});

  final String when;
  final String customer;
  final int units;
  final String orderNo;
  final List<ItemShot> items;

  @override
  Widget build(BuildContext context) => Row(children: [
    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text([prettyWhen(when), customer].where((part) => part.isNotEmpty).join(' · '), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
      const SizedBox(height: 4),
      Text('#$orderNo · $units units', style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
    ])),
    const SizedBox(width: 10),
    OrderPhotos(items: items),
  ]);
}

Future<void> openPendingShip(
  BuildContext context, {
  required AppModel model,
  required PendingShip row,
  required Future<void> Function() onChanged,
}) {
  final title = row.customer.isEmpty ? row.orderNo : row.customer;
  return showWorkSheet(
    context: context,
    title: title.isEmpty ? phrase(context, 'Shipment', 'شپمنٹ') : title,
    child: _PendingBody(row: row, model: model, onChanged: onChanged),
  );
}

Future<void> openShippedShip(
  BuildContext context, {
  required AppModel model,
  required ShipmentRecord row,
  required Future<void> Function() onChanged,
}) {
  final title = row.customer.isEmpty ? row.orderNo : row.customer;
  return showWorkSheet(
    context: context,
    title: title.isEmpty ? phrase(context, 'Shipment', 'شپمنٹ') : title,
    child: _ShippedBody(row: row, model: model, onChanged: onChanged),
  );
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
      summary: ShippingSummary(when: row.when, customer: row.customer, units: row.units, orderNo: row.orderNo, items: row.items),
      details: _PendingBody(row: row, model: model, onChanged: onChanged),
    );
  }
}

class _PendingBody extends StatelessWidget {
  const _PendingBody({required this.row, required this.onChanged, required this.model});

  final PendingShip row;
  final Future<void> Function() onChanged;
  final AppModel model;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final item in row.items) _PackLine(item: item),
        const SizedBox(height: 4),
        _FactBoard(
          facts: [
            _Fact(phrase(context, 'Order', 'آرڈر'), row.orderNo),
            _Fact(phrase(context, 'Phone', 'فون'), row.phone),
            if (!model.isWorker) _Fact(phrase(context, 'Address', 'پتہ'), row.address),
          ],
        ),
        const SizedBox(height: 14),
        if (!model.isWorker) FilledButton(
          onPressed: () => _ship(context),
          child: Text(phrase(context, 'Mark shipped', 'بھیج دیا')),
        ),
      ],
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
      summary: ShippingSummary(when: row.when, customer: row.customer, units: row.units, orderNo: row.orderNo, items: row.items),
      details: _ShippedBody(row: row, model: model, onChanged: onChanged),
    );
  }
}

class _ShippedBody extends StatelessWidget {
  const _ShippedBody({required this.row, required this.onChanged, required this.model});

  final ShipmentRecord row;
  final Future<void> Function() onChanged;
  final AppModel model;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final item in row.items) _PackLine(item: item),
        const SizedBox(height: 4),
        _FactBoard(
          facts: [
            _Fact(phrase(context, 'Order', 'آرڈر'), row.orderNo),
            _Fact(phrase(context, 'Weight', 'وزن'), row.weightKg.isEmpty ? '' : '${row.weightKg} kg'),
            _Fact(phrase(context, 'Courier', 'کوریئر'), row.courier),
            _Fact(phrase(context, 'Tracking', 'ٹریکنگ'), row.tracking),
            if (row.note.trim().isNotEmpty) _Fact(phrase(context, 'Note', 'نوٹ'), row.note),
          ],
        ),
        if (model.isWorker) _FactBoard(facts: [_Fact('Status', row.status)]),
        if (!model.isWorker) ...[
        const SizedBox(height: 16),
        Text(phrase(context, 'Move this shipment', 'اسے آگے کریں'), style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewInk)),
        const SizedBox(height: 8),
        _StageBoard(
          current: _stageKey(row.status),
          onSelect: _status,
        ),
        const SizedBox(height: 10),
        OutlinedButton.icon(
          onPressed: () => _edit(context),
          icon: const Icon(Icons.edit_outlined, size: 18),
          label: Text(phrase(context, 'Edit courier and tracking', 'کوریئر اور ٹریکنگ')),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(48),
            foregroundColor: hisbenewInk,
            side: const BorderSide(color: hisbenewLine),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
        ],
      ],
    );
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

String _stageKey(String status) {
  final value = status.trim().toLowerCase();
  if (value.contains('transit')) return 'in_transit';
  if (value.contains('deliver')) return 'delivered';
  if (value.contains('exception') || value.contains('issue')) return 'exception';
  if (value.contains('wait')) return 'waiting';
  return '';
}

class _PackLine extends StatelessWidget {
  const _PackLine({required this.item});

  final ItemShot item;

  @override
  Widget build(BuildContext context) {
    final sku = item.article.trim();
    final canOpen = productImageUrl(item.image) != null;
    final units = item.qty;
    final unitLabel = units == 1 ? phrase(context, 'unit', 'یونٹ') : phrase(context, 'units', 'یونٹس');
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(10, 10, 12, 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF7F2EA),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: hisbenewLine),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: canOpen ? () => openProductPhoto(context, path: item.image) : null,
            child: ProductThumb(path: item.image, size: 72),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('SKU', style: TextStyle(color: hisbenewMuted, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
                const SizedBox(height: 2),
                Text(
                  sku.isEmpty ? '—' : sku,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 26, height: 1.05, fontWeight: FontWeight.w800, letterSpacing: -0.6, color: hisbenewInk),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            constraints: const BoxConstraints(minWidth: 72),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: hisbenewForest,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              children: [
                Text(
                  '$units',
                  style: const TextStyle(color: Color(0xFFF3E6C8), fontSize: 28, height: 1, fontWeight: FontWeight.w800, letterSpacing: -0.8),
                ),
                const SizedBox(height: 2),
                Text(unitLabel, style: const TextStyle(color: Color(0xFFD7E4DB), fontSize: 11, fontWeight: FontWeight.w700)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Fact {
  const _Fact(this.label, this.value);

  final String label;
  final String value;
}

class _FactBoard extends StatelessWidget {
  const _FactBoard({required this.facts});

  final List<_Fact> facts;

  @override
  Widget build(BuildContext context) {
    final shown = [for (final fact in facts) if (fact.value.trim().isNotEmpty) fact];
    if (shown.isEmpty) return const SizedBox.shrink();
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: hisbenewLine),
      ),
      child: Column(
        children: [
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const Divider(height: 1, color: hisbenewLine),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 78,
                    child: Text(shown[i].label, style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                  Expanded(
                    child: Text(
                      shown[i].value,
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: hisbenewInk),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _StageBoard extends StatelessWidget {
  const _StageBoard({required this.current, required this.onSelect});

  final String current;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    const stages = ['waiting', 'in_transit', 'delivered', 'exception'];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 2.7,
      children: [
        for (final stage in stages)
          _StageButton(
            label: _stageTitle(context, stage),
            selected: current == stage,
            onTap: () => onSelect(stage),
          ),
      ],
    );
  }

  String _stageTitle(BuildContext context, String stage) {
    return switch (stage) {
      'in_transit' => phrase(context, 'In transit', 'راستے میں'),
      'delivered' => phrase(context, 'Delivered', 'پہنچ گیا'),
      'exception' => phrase(context, 'Issue', 'مسئلہ'),
      _ => phrase(context, 'Waiting', 'انتظار'),
    };
  }
}

class _StageButton extends StatelessWidget {
  const _StageButton({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? hisbenewForest : const Color(0xFFF7F2EA),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? hisbenewForest : hisbenewLine),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: selected ? Colors.white : hisbenewInk,
            ),
          ),
        ),
      ),
    );
  }
}
