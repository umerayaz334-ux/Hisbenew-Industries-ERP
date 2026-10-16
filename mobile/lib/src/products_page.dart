import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';

class ProductRow {
  const ProductRow({
    required this.id,
    required this.article,
    required this.name,
    required this.category,
    required this.factory,
    required this.usa,
    required this.front,
    required this.price,
    required this.cost,
    required this.low,
    required this.image,
  });

  final int id;
  final String article;
  final String name;
  final String category;
  final int factory;
  final int usa;
  final int front;
  final double price;
  final double cost;
  final int low;
  final String image;

  factory ProductRow.fromJson(Map<String, dynamic> json) {
    return ProductRow(
      id: asInt(json['id']),
      article: asText(json['article_no']),
      name: asText(json['name']),
      category: asText(json['category']),
      factory: asInt(json['factory_stock']),
      usa: asInt(json['usa_stock']),
      front: asInt(json['front_room_stock']),
      price: asDouble(json['selling_price']),
      cost: asDouble(json['cost_price']),
      low: asInt(json['low_stock_alert']),
      image: asText(json['image_url']),
    );
  }

  bool get lowStock => low > 0 && factory <= low;
}

class ProductsPage extends StatefulWidget {
  const ProductsPage({required this.model, super.key});

  final AppModel model;

  @override
  State<ProductsPage> createState() => _ProductsPageState();
}

class _ProductsPageState extends State<ProductsPage> {
  final _search = TextEditingController();
  var _loading = true;
  var _error = false;
  List<ProductRow> _products = const [];

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
      final rows = await widget.model.api.products(session);
      if (!mounted) return;
      setState(() {
        _products = [for (final row in rows) ProductRow.fromJson(row)];
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
    final query = _search.text.trim().toLowerCase();
    final visible = _products.where((row) {
      if (query.isEmpty) return true;
      return '${row.name} ${row.article} ${row.category}'.toLowerCase().contains(query);
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: WorkSearch(controller: _search, hint: phrase(context, 'Name or article', 'نام یا آرٹیکل')),
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
                    children: [
                      for (final row in visible)
                        WorkCard(
                          tint: row.lowStock ? const Color(0xFFFFF1F2) : null,
                          child: ExpansionTile(
                            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                            shape: const Border(),
                            leading: ProductThumb(path: row.image, size: 52),
                            title: Text(row.name.isEmpty ? row.article : row.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text(row.article, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
                            trailing: Text('${row.factory}', style: TextStyle(fontWeight: FontWeight.w800, color: row.lowStock ? hisbenewClay : hisbenewForest)),
                            children: [
                              DetailLine(phrase(context, 'Category', 'قسم'), row.category),
                              DetailLine(phrase(context, 'Factory', 'فیکٹری'), '${row.factory}'),
                              DetailLine(phrase(context, 'USA', 'امریکہ'), '${row.usa}'),
                              DetailLine(phrase(context, 'Front room', 'سامنے'), '${row.front}'),
                              DetailLine(phrase(context, 'Price', 'قیمت'), row.price > 0 ? usd(row.price) : ''),
                              DetailLine(phrase(context, 'Cost', 'لاگت'), row.cost > 0 ? usd(row.cost) : ''),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton(onPressed: () => _stock(context, row), child: Text(phrase(context, 'Update stock', 'اسٹاک'))),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }

  Future<void> _stock(BuildContext context, ProductRow row) async {
    final factory = TextEditingController(text: '${row.factory}');
    final usa = TextEditingController(text: '${row.usa}');
    await showWorkSheet(
      context: context,
      title: row.name,
      child: Column(
        children: [
          TextField(controller: factory, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: phrase(context, 'Factory stock', 'فیکٹری اسٹاک'))),
          const SizedBox(height: 10),
          TextField(controller: usa, keyboardType: TextInputType.number, decoration: InputDecoration(labelText: phrase(context, 'USA stock', 'امریکہ اسٹاک'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () async {
              final session = widget.model.session;
              if (session == null) return;
              await widget.model.api.updateProductStock(
                session: session,
                productId: row.id,
                factoryStock: int.tryParse(factory.text.trim()) ?? row.factory,
                usaStock: int.tryParse(usa.text.trim()) ?? row.usa,
              );
              if (context.mounted) Navigator.pop(context);
              await _load();
            },
            child: Text(phrase(context, 'Save', 'محفوظ')),
          ),
        ],
      ),
    );
    factory.dispose();
    usa.dispose();
  }
}
