import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'products_page.dart';
import 'theme.dart';

class LabelsPage extends StatefulWidget {
  const LabelsPage({required this.model, super.key});

  final AppModel model;

  @override
  State<LabelsPage> createState() => _LabelsPageState();
}

class _LabelsPageState extends State<LabelsPage> {
  final _search = TextEditingController();
  var _loading = true;
  var _printing = false;
  var _copies = 1;
  String? _notice;
  String? _printer;
  List<String> _printers = const [];
  List<ProductRow> _products = const [];
  ProductRow? _selected;

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
    setState(() => _loading = true);
    try {
      final products = await widget.model.api.products(session);
      final printers = await widget.model.api.labelPrinters(session);
      if (!mounted) return;
      setState(() {
        _products = [for (final row in products) ProductRow.fromJson(row)];
        _printers = printers;
        _printer = printers.isEmpty ? null : printers.first;
        _loading = false;
      });
    } on ErpException {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _print() async {
    final session = widget.model.session;
    final product = _selected;
    final printer = _printer;
    if (session == null || product == null || printer == null) return;
    setState(() {
      _printing = true;
      _notice = null;
    });
    try {
      await widget.model.api.printLabel(
        session: session,
        printerName: printer,
        title: product.name,
        sku: product.article,
        copies: _copies,
      );
      if (!mounted) return;
      setState(() {
        _printing = false;
        _notice = phrase(context, 'Sent', 'بھیج دیا');
      });
    } on ErpException {
      if (!mounted) return;
      setState(() {
        _printing = false;
        _notice = phrase(context, 'Could not print', 'پرنٹ نہیں ہوا');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final visible = _products.where((row) {
      if (query.isEmpty) return _selected == null;
      return '${row.name} ${row.article}'.toLowerCase().contains(query);
    }).take(30).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        WorkSearch(controller: _search, hint: phrase(context, 'Product', 'پروڈکٹ')),
        const SizedBox(height: 12),
        if (_selected != null)
          WorkCard(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_selected!.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                  Text(_selected!.article, style: const TextStyle(color: hisbenewMuted)),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      IconButton(onPressed: _copies > 1 ? () => setState(() => _copies -= 1) : null, icon: const Icon(Icons.remove_rounded)),
                      Text('$_copies', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                      IconButton(onPressed: () => setState(() => _copies += 1), icon: const Icon(Icons.add_rounded)),
                      const Spacer(),
                      if (_printers.isNotEmpty)
                        DropdownButton<String>(
                          value: _printer,
                          items: [for (final name in _printers) DropdownMenuItem(value: name, child: Text(name, overflow: TextOverflow.ellipsis))],
                          onChanged: (value) => setState(() => _printer = value),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: _printing || _printer == null ? null : _print,
                    child: Text(_printing ? phrase(context, 'Sending', 'بھیج رہے ہیں') : phrase(context, 'Print', 'پرنٹ')),
                  ),
                  if (_notice != null) ...[
                    const SizedBox(height: 8),
                    Text(_notice!, style: const TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ],
              ),
            ),
          ),
        if (_loading)
          const Padding(padding: EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator(color: hisbenewForest, strokeWidth: 2.4)))
        else
          for (final row in visible)
            WorkCard(
              child: ListTile(
                title: Text(row.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(row.article),
                onTap: () => setState(() => _selected = row),
              ),
            ),
      ],
    );
  }
}

class AmazonPage extends StatefulWidget {
  const AmazonPage({required this.model, super.key});

  final AppModel model;

  @override
  State<AmazonPage> createState() => _AmazonPageState();
}

class _AmazonPageState extends State<AmazonPage> {
  var _loading = true;
  var _error = false;
  List<AmazonOrderBrief> _orders = const [];

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
      final orders = await widget.model.api.openAmazonOrders(session);
      if (!mounted) return;
      setState(() {
        _orders = orders;
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
    final data = widget.model.dashboard;
    return RefreshIndicator(
      color: hisbenewForest,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          if (data != null)
            WorkCard(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _Count('${data.amazonOpen}', phrase(context, 'Open', 'کھلے')),
                    _Count('${data.amazonPending}', phrase(context, 'Pending', 'زیر التوا')),
                    _Count('${data.amazonUnshipped}', phrase(context, 'Unshipped', 'نہیں بھیجے')),
                  ],
                ),
              ),
            ),
          if (_loading)
            const Padding(padding: EdgeInsets.only(top: 48), child: Center(child: CircularProgressIndicator(color: hisbenewForest, strokeWidth: 2.4)))
          else if (_error)
            TextButton(onPressed: _load, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش')))
          else
            for (final order in _orders)
              WorkCard(
                child: ListTile(
                  title: Text(order.orderId, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text('${prettyWhen(order.when)}  ·  ${order.status}'),
                  trailing: Text(order.units > 0 ? '${order.units}' : (order.total > 0 ? usd(order.total) : ''), style: const TextStyle(fontWeight: FontWeight.w800)),
                ),
              ),
        ],
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count(this.value, this.label);

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: hisbenewForest)),
        Text(label, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
      ],
    );
  }
}
