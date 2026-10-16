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
                        WorkCard(
                          child: ExpansionTile(
                            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                            shape: const Border(),
                            leading: order.items.isEmpty ? null : ProductThumb(path: order.items.first.image, size: 48),
                            title: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(order.customer.isEmpty ? order.orderNo : order.customer, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${prettyWhen(order.when)}  ·  ${order.orderNo}  ·  ${order.status}', style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
                                ThumbStrip(items: order.items.skip(1).toList()),
                              ],
                            ),
                            trailing: Text(order.total > 0 ? usd(order.total) : '${order.units}', style: const TextStyle(fontWeight: FontWeight.w800, color: hisbenewForest)),
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
