import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';

class CustomerRow {
  const CustomerRow({
    required this.id,
    required this.name,
    required this.company,
    required this.email,
    required this.phone,
    required this.country,
    required this.address,
    required this.shippingAddress,
    required this.platform,
  });

  final int id;
  final String name;
  final String company;
  final String email;
  final String phone;
  final String country;
  final String address;
  final String shippingAddress;
  final String platform;

  factory CustomerRow.fromJson(Map<String, dynamic> json) {
    return CustomerRow(
      id: asInt(json['id']),
      name: asText(json['name']),
      company: asText(json['company_name']),
      email: asText(json['email']),
      phone: asText(json['phone']),
      country: asText(json['country']),
      address: asText(json['address']),
      shippingAddress: asText(json['shipping_address']),
      platform: asText(json['platform']),
    );
  }

  Map<String, String> toBody() {
    return {
      'name': name,
      'company_name': company,
      'email': email,
      'phone': phone,
      'country': country,
      'address': address,
      'shipping_address': shippingAddress,
      'platform': platform,
    };
  }
}

class CustomersPage extends StatefulWidget {
  const CustomersPage({required this.model, super.key});

  final AppModel model;

  @override
  State<CustomersPage> createState() => _CustomersPageState();
}

class _CustomersPageState extends State<CustomersPage> {
  final _search = TextEditingController();
  var _loading = true;
  var _error = false;
  List<CustomerRow> _customers = const [];

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
      final rows = await widget.model.api.customers(session);
      if (!mounted) return;
      setState(() {
        _customers = [for (final row in rows) CustomerRow.fromJson(row)];
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
    final visible = _customers.where((row) {
      if (query.isEmpty) return true;
      return '${row.name} ${row.company} ${row.phone} ${row.country} ${row.platform}'.toLowerCase().contains(query);
    }).toList();

    return Stack(
      children: [
        Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: WorkSearch(controller: _search, hint: phrase(context, 'Name or phone', 'نام یا فون')),
        ),
        Expanded(
          child: RefreshIndicator(
            color: hisbenewForest,
            onRefresh: _load,
            child: _loading || _error
                ? ListView(children: [SizedBox(height: 180, child: LoadState(loading: _loading, error: _error, empty: false, onRetry: _load, child: const SizedBox.shrink()))])
                : ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 88),
                    children: [
                      for (final row in visible)
                        WorkCard(
                          child: ExpansionTile(
                            tilePadding: const EdgeInsets.symmetric(horizontal: 14),
                            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
                            shape: const Border(),
                            title: Text(row.name.isEmpty ? '—' : row.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text([row.company, row.phone, row.country].where((part) => part.isNotEmpty).join('  ·  '), style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
                            children: [
                              DetailLine(phrase(context, 'Email', 'ای میل'), row.email),
                              DetailLine(phrase(context, 'Platform', 'پلیٹ فارم'), row.platform),
                              DetailLine(phrase(context, 'Address', 'پتہ'), row.address),
                              DetailLine(phrase(context, 'Shipping', 'شپنگ'), row.shippingAddress),
                              Row(
                                children: [
                                  TextButton(onPressed: () => _edit(context, row), child: Text(phrase(context, 'Edit', 'ترمیم'))),
                                  TextButton(
                                    onPressed: () => _remove(row),
                                    child: Text(phrase(context, 'Delete', 'حذف'), style: const TextStyle(color: hisbenewClay)),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
        ),
      ],
    ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton(
            backgroundColor: hisbenewForest,
            foregroundColor: Colors.white,
            onPressed: () => _edit(context),
            child: const Icon(Icons.add_rounded),
          ),
        ),
      ],
    );
  }

  Future<void> _edit(BuildContext context, [CustomerRow? current]) async {
    final name = TextEditingController(text: current?.name ?? '');
    final company = TextEditingController(text: current?.company ?? '');
    final phone = TextEditingController(text: current?.phone ?? '');
    final email = TextEditingController(text: current?.email ?? '');
    final country = TextEditingController(text: current?.country ?? '');
    final address = TextEditingController(text: current?.address ?? '');
    final shipping = TextEditingController(text: current?.shippingAddress ?? '');
    final platform = TextEditingController(text: current?.platform ?? '');
    await showWorkSheet(
      context: context,
      title: current == null ? phrase(context, 'New customer', 'نیا گاہک') : current.name,
      child: Column(
        children: [
          TextField(controller: name, decoration: InputDecoration(labelText: phrase(context, 'Name', 'نام'))),
          const SizedBox(height: 10),
          TextField(controller: company, decoration: InputDecoration(labelText: phrase(context, 'Company', 'کمپنی'))),
          const SizedBox(height: 10),
          TextField(controller: phone, decoration: InputDecoration(labelText: phrase(context, 'Phone', 'فون'))),
          const SizedBox(height: 10),
          TextField(controller: email, decoration: InputDecoration(labelText: phrase(context, 'Email', 'ای میل'))),
          const SizedBox(height: 10),
          TextField(controller: country, decoration: InputDecoration(labelText: phrase(context, 'Country', 'ملک'))),
          const SizedBox(height: 10),
          TextField(controller: address, decoration: InputDecoration(labelText: phrase(context, 'Address', 'پتہ'))),
          const SizedBox(height: 10),
          TextField(controller: shipping, decoration: InputDecoration(labelText: phrase(context, 'Shipping address', 'شپنگ پتہ'))),
          const SizedBox(height: 10),
          TextField(controller: platform, decoration: InputDecoration(labelText: phrase(context, 'Platform', 'پلیٹ فارم'))),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: () async {
              if (name.text.trim().isEmpty) return;
              final session = widget.model.session;
              if (session == null) return;
              final body = CustomerRow(
                id: current?.id ?? 0,
                name: name.text.trim(),
                company: company.text.trim(),
                email: email.text.trim(),
                phone: phone.text.trim(),
                country: country.text.trim(),
                address: address.text.trim(),
                shippingAddress: shipping.text.trim(),
                platform: platform.text.trim(),
              ).toBody();
              await widget.model.api.saveCustomer(session, body, id: current?.id);
              if (context.mounted) Navigator.pop(context);
              await _load();
            },
            child: Text(phrase(context, 'Save', 'محفوظ')),
          ),
        ],
      ),
    );
    name.dispose();
    company.dispose();
    phone.dispose();
    email.dispose();
    country.dispose();
    address.dispose();
    shipping.dispose();
    platform.dispose();
  }

  Future<void> _remove(CustomerRow row) async {
    final session = widget.model.session;
    if (session == null) return;
    await widget.model.api.deleteCustomer(session, row.id);
    await _load();
  }
}
