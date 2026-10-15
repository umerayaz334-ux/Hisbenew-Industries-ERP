int asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.round();
  return int.tryParse('${value ?? ''}') ?? 0;
}

double asDouble(Object? value) {
  if (value is num) return value.toDouble();
  return double.tryParse('${value ?? ''}') ?? 0;
}

String asText(Object? value) => '${value ?? ''}'.trim();

class OrderBrief {
  const OrderBrief({
    required this.orderNo,
    required this.customer,
    required this.platform,
    required this.status,
    required this.amountUsd,
    required this.orderDate,
  });

  final String orderNo;
  final String customer;
  final String platform;
  final String status;
  final double amountUsd;
  final String orderDate;

  factory OrderBrief.fromJson(Map<String, dynamic> json) {
    return OrderBrief(
      orderNo: asText(json['order_no']),
      customer: asText(json['customer_name']),
      platform: asText(json['platform']),
      status: asText(json['status']),
      amountUsd: asDouble(json['total_amount_usd']),
      orderDate: asText(json['order_date']),
    );
  }
}

class ShipBrief {
  const ShipBrief({
    required this.orderNo,
    required this.customer,
    required this.platform,
    required this.status,
  });

  final String orderNo;
  final String customer;
  final String platform;
  final String status;

  factory ShipBrief.fromJson(Map<String, dynamic> json) {
    return ShipBrief(
      orderNo: asText(json['order_no']),
      customer: asText(json['customer_name']),
      platform: asText(json['platform']),
      status: asText(json['shipping_status']),
    );
  }
}

class DashboardData {
  const DashboardData({
    required this.companyName,
    required this.greeting,
    required this.newOrdersToday,
    required this.pendingShippingOrders,
    required this.lowStockCount,
    required this.factoryStock,
    required this.weekSales,
    required this.activeWorkers,
    required this.orders,
    required this.shipments,
  });

  final String companyName;
  final String greeting;
  final int newOrdersToday;
  final int pendingShippingOrders;
  final int lowStockCount;
  final int factoryStock;
  final double weekSales;
  final int activeWorkers;
  final List<OrderBrief> orders;
  final List<ShipBrief> shipments;

  factory DashboardData.fromJson(Map<String, dynamic> json) {
    return DashboardData(
      companyName: asText(json['company_name']),
      greeting: asText(json['greeting']),
      newOrdersToday: asInt(json['new_orders_today']),
      pendingShippingOrders: asInt(json['pending_shipping_orders']),
      lowStockCount: asInt(json['low_stock_count']),
      factoryStock: asInt(json['total_factory_stock']),
      weekSales: weekSalesOf(json),
      activeWorkers: asInt(json['active_workers']),
      orders: mapList(json['recent_week_orders'], OrderBrief.fromJson),
      shipments: mapList(json['pending_shipping_list'], ShipBrief.fromJson),
    );
  }
}

double weekSalesOf(Map<String, dynamic> json) {
  final days = json['sales_last_7_days'];
  if (days is List) {
    var total = 0.0;
    for (final day in days) {
      if (day is Map) {
        total += asDouble(day['sales_amount']);
      }
    }
    return total;
  }
  return asDouble(json['sales_14_days_total']);
}

List<T> mapList<T>(Object? raw, T Function(Map<String, dynamic> json) decode) {
  if (raw is! List) return const [];
  return [
    for (final item in raw)
      if (item is Map) decode(Map<String, dynamic>.from(item)),
  ];
}

String normalizeServerUrl(String value) {
  var text = value.trim();
  if (text.isEmpty) return '';
  if (!text.contains('://')) text = 'http://$text';
  while (text.endsWith('/')) {
    text = text.substring(0, text.length - 1);
  }
  return text;
}
