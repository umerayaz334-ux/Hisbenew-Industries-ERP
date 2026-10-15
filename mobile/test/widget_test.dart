import 'package:flutter_test/flutter_test.dart';
import 'package:hisbenew_erp/src/dashboard_data.dart';

void main() {
  test('dashboard reads company totals and this week orders', () {
    final data = DashboardData.fromJson({
      'company_name': 'Hisbenew Industries',
      'new_orders_today': 3,
      'pending_shipping_orders': '4',
      'low_stock_count': 2,
      'total_factory_stock': 120.4,
      'active_workers': 8,
      'sales_last_7_days': [
        {'sales_amount': 10.5},
        {'sales_amount': 4},
      ],
      'recent_week_orders': [
        {
          'order_no': '10021',
          'customer_name': 'Northline',
          'platform': 'Amazon',
          'status': 'New',
          'total_amount_usd': 80,
        },
      ],
      'pending_shipping_list': [
        {
          'order_no': '10020',
          'customer_name': 'Atlas',
          'platform': 'ERP',
          'shipping_status': 'Pending',
        },
      ],
    });

    expect(data.companyName, 'Hisbenew Industries');
    expect(data.newOrdersToday, 3);
    expect(data.pendingShippingOrders, 4);
    expect(data.factoryStock, 120);
    expect(data.weekSales, 14.5);
    expect(data.orders.single.orderNo, '10021');
    expect(data.shipments.single.status, 'Pending');
    expect(normalizeServerUrl('192.168.1.10:8000/'), 'http://192.168.1.10:8000');
  });
}
