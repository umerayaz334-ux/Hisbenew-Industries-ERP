import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';

class FactoryOrder {
  const FactoryOrder({
    required this.orderNo,
    required this.customer,
    required this.when,
    required this.status,
    required this.payment,
    required this.shipping,
    required this.platform,
    required this.total,
    required this.notes,
    required this.units,
    required this.items,
  });

  final String orderNo;
  final String customer;
  final String when;
  final String status;
  final String payment;
  final String shipping;
  final String platform;
  final double total;
  final String notes;
  final int units;
  final List<ItemShot> items;

  factory FactoryOrder.fromJson(Map<String, dynamic> json) {
    final lines = itemShotsOf(json['items']);
    final units = lines.fold<int>(0, (sum, item) => sum + item.qty);
    return FactoryOrder(
      orderNo: asText(json['order_no']),
      customer: asText(json['customer_name']),
      when: asText(json['order_date']),
      status: asText(json['status']),
      payment: asText(json['payment_status']),
      shipping: asText(json['shipping_status']),
      platform: asText(json['platform']),
      total: asDouble(json['order_total_usd']),
      notes: asText(json['notes']),
      units: units,
      items: lines,
    );
  }
}

class OrdersPage extends StatefulWidget {
  const OrdersPage({required this.model, super.key});

  final AppModel model;

  @override
  State<OrdersPage> createState() => _OrdersPageState();
}

class _OrdersPageState extends State<OrdersPage> {
  final _search = TextEditingController();
  var _loading = true;
  var _error = false;
  List<FactoryOrder> _orders = const [];

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
      final rows = await widget.model.api.orders(session);
      if (!mounted) return;
      setState(() {
        _orders = [for (final row in rows) FactoryOrder.fromJson(row)];
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
    final visible = _orders.where((order) {
      if (query.isEmpty) return true;
      return '${order.orderNo} ${order.customer} ${order.status} ${order.platform}'.toLowerCase().contains(query);
    }).toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: WorkSearch(controller: _search, hint: phrase(context, 'Order or customer', 'آرڈر یا گاہک')),
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
                      for (final order in visible)
                        SummaryCard(
                          sheetTitle: order.customer.isEmpty ? order.orderNo : order.customer,
                          summary: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      [
                                        if (prettyWhen(order.when).isNotEmpty) prettyWhen(order.when),
                                        if (order.customer.isNotEmpty) order.customer,
                                      ].join('  ·  '),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                                    ),
                                    if (order.orderNo.isNotEmpty)
                                      Text(
                                        '#${order.orderNo}',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(color: hisbenewMuted, fontSize: 12, fontWeight: FontWeight.w600),
                                      ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              OrderPhotos(items: order.items),
                            ],
                          ),
                          details: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              DetailLine(phrase(context, 'Date', 'تاریخ'), prettyWhen(order.when)),
                              DetailLine(phrase(context, 'Platform', 'پلیٹ فارم'), order.platform),
                              DetailLine(phrase(context, 'Payment', 'ادائیگی'), order.payment),
                              DetailLine(phrase(context, 'Shipping', 'شپنگ'), order.shipping),
                              DetailLine(phrase(context, 'Note', 'نوٹ'), order.notes),
                              for (final line in order.items) ProductLine(item: line),
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
}

class OrderPhotos extends StatelessWidget {
  const OrderPhotos({required this.items, super.key});

  final List<ItemShot> items;

  @override
  Widget build(BuildContext context) {
    final pictured = items.where((item) => item.image.isNotEmpty).toList();
    if (pictured.isEmpty) return const SizedBox.shrink();
    final shown = pictured.take(3).toList();
    final extra = pictured.length - shown.length;
    const size = 38.0;
    const step = 24.0;
    final slots = shown.length + (extra > 0 ? 1 : 0);
    return SizedBox(
      width: size + (slots - 1) * step,
      height: size,
      child: Stack(
        children: [
          for (var i = 0; i < shown.length; i++)
            Positioned(
              left: i * step,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white, width: 2),
                ),
                child: ProductThumb(path: shown[i].image, size: size - 4),
              ),
            ),
          if (extra > 0)
            Positioned(
              left: shown.length * step,
              child: Container(
                width: size,
                height: size,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFEEF2FF),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.white, width: 2),
                ),
                child: Text('+$extra', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: hisbenewInk)),
              ),
            ),
        ],
      ),
    );
  }
}
