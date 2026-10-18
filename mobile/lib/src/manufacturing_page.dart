import 'package:flutter/material.dart';
import 'app_model.dart';
import 'dashboard_data.dart';
import 'page_kit.dart';
import 'app_loader.dart';

class ManufacturingPage extends StatefulWidget {
  const ManufacturingPage({required this.model, super.key});
  final AppModel model;
  @override
  State<ManufacturingPage> createState() => _ManufacturingPageState();
}
class _ManufacturingPageState extends State<ManufacturingPage> {
  List<Map<String, dynamic>> _rows = [];
  bool _loading = true, _all = false;
  String _query = '', _error = '';
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    try {
      final rows = await widget.model.api.manufacturingNeeds(session);
      if (mounted) setState(() { _rows = rows; _loading = false; _error = ''; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _error = 'Could not load manufacturing needs. Pull down to retry.'; });
    }
  }
  @override
  Widget build(BuildContext context) {
    final rows = _rows.where((row) => (_all || asInt(row['shortage']) > 0) && '${row['article_no']} ${row['product_name']}'.toLowerCase().contains(_query.toLowerCase())).toList();
    return RefreshIndicator(onRefresh: _load, child: ListView(padding: const EdgeInsets.all(20), physics: const AlwaysScrollableScrollPhysics(), children: [
      const Text('Manufacturing', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      const Text('Production needed for pending dispatch. Stock includes factory, front room and USA; transfer may be needed between locations.'),
      const SizedBox(height: 16),
      TextField(onChanged: (value) => setState(() => _query = value), decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Product or article number')),
      SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Include products already in stock'), value: _all, onChanged: (value) => setState(() => _all = value)),
      if (_loading) const AppLoader(),
      if (_error.isNotEmpty) Text(_error),
      if (!_loading && _error.isEmpty && rows.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No production shortages to show.')),
      for (final row in rows) WorkCard(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [ProductThumb(path: asText(row['image_url']), size: 58), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(asText(row['product_name']), style: const TextStyle(fontWeight: FontWeight.w700)), Text(asText(row['article_no']))]))]),
        const SizedBox(height: 14),
        Text(asInt(row['shortage']) > 0 ? 'Make ${row['shortage']} units' : 'Stock available', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: asInt(row['shortage']) > 0 ? const Color(0xFFAE522C) : const Color(0xFF215C4A))),
        const SizedBox(height: 8),
        Text('Required ${row['required_quantity']} · Available ${row['available_stock']}'),
        Text('Factory ${row['factory_stock']} · Front room ${row['front_room_stock']} · USA ${row['usa_stock']}'),
        const Divider(height: 24),
        for (final order in (row['orders'] as List? ?? [])) Text('#${order['order_no']} · ${order['quantity']} units · ${order['stock_source'] ?? ''}'),
      ]))),
    ]));
  }
}
