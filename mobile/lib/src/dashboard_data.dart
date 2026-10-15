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

class ShipmentRecord {
  const ShipmentRecord({
    required this.orderNo,
    required this.customer,
    required this.when,
    required this.units,
    required this.status,
    required this.courier,
    required this.tracking,
    required this.weightKg,
    required this.note,
  });

  final String orderNo;
  final String customer;
  final String when;
  final int units;
  final String status;
  final String courier;
  final String tracking;
  final String weightKg;
  final String note;

  factory ShipmentRecord.fromJson(Map<String, dynamic> json, int units) {
    return ShipmentRecord(
      orderNo: asText(json['order_no']),
      customer: asText(json['customer_name']),
      when: asText(json['shipped_at']).isNotEmpty ? asText(json['shipped_at']) : asText(json['created_at']),
      units: units,
      status: asText(json['shipping_status']),
      courier: asText(json['courier_name']),
      tracking: asText(json['tracking_number']),
      weightKg: asText(json['package_weight_kg']),
      note: asText(json['shipping_note']),
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

class SalesPoint {
  const SalesPoint({
    required this.date,
    required this.amount,
    required this.orders,
    required this.amazonAmount,
    required this.erpAmount,
  });

  final String date;
  final double amount;
  final int orders;
  final double amazonAmount;
  final double erpAmount;
}

class AmazonOrderBrief {
  const AmazonOrderBrief({
    required this.orderId,
    required this.when,
    required this.status,
    required this.units,
    required this.total,
    required this.currency,
  });

  final String orderId;
  final String when;
  final String status;
  final int units;
  final double total;
  final String currency;

  factory AmazonOrderBrief.fromJson(Map<String, dynamic> json) {
    return AmazonOrderBrief(
      orderId: asText(json['amazon_order_id']),
      when: asText(json['purchase_date']),
      status: asText(json['order_status']),
      units: asInt(json['unit_count']),
      total: asDouble(json['order_total']),
      currency: asText(json['currency']),
    );
  }

  bool get isOpen {
    const open = {
      'PENDING_AVAILABILITY',
      'PENDING',
      'UNSHIPPED',
      'PARTIALLY_SHIPPED',
      'UNFULFILLABLE',
    };
    return open.contains(status.toUpperCase());
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
    required this.usaStock,
    required this.weekSales,
    required this.activeWorkers,
    required this.orders,
    required this.shipments,
    required this.sales,
    required this.amazonOpen,
    required this.amazonPending,
    required this.amazonUnshipped,
    required this.amazonConfigured,
  });

  final String companyName;
  final String greeting;
  final int newOrdersToday;
  final int pendingShippingOrders;
  final int lowStockCount;
  final int factoryStock;
  final int usaStock;
  final double weekSales;
  final int activeWorkers;
  final List<OrderBrief> orders;
  final List<ShipBrief> shipments;
  final List<SalesPoint> sales;
  final int amazonOpen;
  final int amazonPending;
  final int amazonUnshipped;
  final bool amazonConfigured;

  factory DashboardData.fromJson(Map<String, dynamic> json) {
    final amazon = json['amazon'];
    final amazonMap = amazon is Map ? Map<String, dynamic>.from(amazon) : const <String, dynamic>{};
    return DashboardData(
      companyName: asText(json['company_name']),
      greeting: asText(json['greeting']),
      newOrdersToday: asInt(json['new_orders_today']),
      pendingShippingOrders: asInt(json['pending_shipping_orders']),
      lowStockCount: asInt(json['low_stock_count']),
      factoryStock: asInt(json['total_factory_stock']),
      usaStock: asInt(json['total_usa_stock']),
      weekSales: weekSalesOf(json),
      activeWorkers: asInt(json['active_workers']),
      orders: mapList(json['recent_week_orders'], OrderBrief.fromJson),
      shipments: mapList(json['pending_shipping_list'], ShipBrief.fromJson),
      sales: salesPointsOf(json),
      amazonOpen: asInt(amazonMap['open_order_count']),
      amazonPending: asInt(amazonMap['pending_order_count']),
      amazonUnshipped: asInt(amazonMap['unshipped_order_count']),
      amazonConfigured: amazonMap['configured'] == true && amazonMap['visible'] != false,
    );
  }
}

List<SalesPoint> salesPointsOf(Map<String, dynamic> json) {
  final days = json['sales_last_7_days'];
  if (days is! List) return const [];
  return [
    for (final day in days)
      if (day is Map)
        SalesPoint(
          date: asText(day['date']),
          amount: asDouble(day['sales_amount']),
          orders: asInt(day['order_count']),
          amazonAmount: asDouble(day['amazon_sales_amount']),
          erpAmount: asDouble(day['erp_sales_amount']),
        ),
  ];
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
