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
  const ProductsPage({required this.model, this.refreshTick = 0, super.key});

  final AppModel model;
  final int refreshTick;

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

  @override
  void didUpdateWidget(ProductsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshTick != widget.refreshTick) _load();
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    if (_products.isEmpty) {
      final saved = await widget.model.api.rememberedList(session, '/products');
      if (!mounted) return;
      if (saved != null && saved.isNotEmpty) {
        setState(() {
          _products = [for (final row in saved) ProductRow.fromJson(row)];
          _loading = false;
          _error = false;
        });
      }
    }
    if (_products.isEmpty && mounted) {
      setState(() {
        _loading = true;
        _error = false;
      });
    }
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
    final worker = widget.model.isWorker;
    final query = _search.text.trim().toLowerCase();
    final visible = _products.where((row) {
      if (query.isEmpty) return true;
      final haystack = worker ? row.article : '${row.name} ${row.article} ${row.category}';
      return haystack.toLowerCase().contains(query);
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: WorkSearch(controller: _search, hint: phrase(context, worker ? 'SKU' : 'Name or article', worker ? 'آرٹیکل' : 'نام یا آرٹیکل')),
        ),
        Expanded(
          child: RefreshIndicator(
            color: hisbenewForest,
            onRefresh: _load,
            child: _loading || _error
                ? ListView(children: [SizedBox(height: 180, child: LoadState(loading: _loading, error: _error, empty: false, onRetry: _load, child: const SizedBox.shrink()))])
                : ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final row = visible[index];
                      final title = worker || row.name.isEmpty ? row.article : row.name;
                      return SummaryCard(
                          tint: row.lowStock ? const Color(0xFFFFF1F2) : null,
                          sheetTitle: title.trim().isEmpty ? '—' : title,
                          summary: Row(
                            children: [
                              ProductThumb(path: row.image, size: 42),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(title.trim().isEmpty ? '—' : title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                                    if (!worker) Text(row.article, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text('${row.factory}', style: TextStyle(fontWeight: FontWeight.w800, color: row.lowStock ? hisbenewClay : hisbenewForest)),
                            ],
                          ),
                          details: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              DetailLine(phrase(context, 'Category', 'قسم'), row.category),
                              DetailLine(phrase(context, 'Factory', 'فیکٹری'), '${row.factory}'),
                              DetailLine(phrase(context, 'USA', 'امریکہ'), '${row.usa}'),
                              DetailLine(phrase(context, 'Front room', 'سامنے'), '${row.front}'),
                              DetailLine(phrase(context, 'Price', 'قیمت'), row.price > 0 ? usd(row.price) : ''),
                              DetailLine(phrase(context, 'Cost', 'لاگت'), row.cost > 0 ? usd(row.cost) : ''),
                              const SizedBox(height: 6),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: TextButton(onPressed: () => _stock(context, row), child: Text(phrase(context, 'Update stock', 'اسٹاک'))),
                              ),
                            ],
                          ),
                        );
                    },
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
      title: widget.model.isWorker || row.name.isEmpty ? row.article : row.name,
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
