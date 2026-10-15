import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import 'app_model.dart';
import 'dashboard_data.dart';
import 'theme.dart';

class DashboardView extends StatelessWidget {
  const DashboardView({required this.model, super.key});

  final AppModel model;

  @override
  Widget build(BuildContext context) {
    final copy = AppLocalizations.of(context);
    final data = model.dashboard;
    final locale = Localizations.localeOf(context).toString();
    final numbers = NumberFormat.decimalPattern(locale);
    final money = NumberFormat.simpleCurrency(name: 'USD', locale: locale);
    final session = model.session;
    final title = data?.companyName.isNotEmpty == true
        ? data!.companyName
        : (session?.tenantName.isNotEmpty == true ? session!.tenantName : 'Hisbenew');

    return RefreshIndicator(
      color: hisbenewForest,
      onRefresh: model.refreshDashboard,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: [
          Text(
            title,
            style: const TextStyle(
              color: hisbenewInk,
              fontSize: 28,
              fontWeight: FontWeight.w500,
              letterSpacing: -0.8,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            DateFormat.yMMMEd(locale).format(DateTime.now()),
            style: const TextStyle(color: hisbenewMuted, fontSize: 13, letterSpacing: 0.2),
          ),
          const SizedBox(height: 22),
          if (model.loadingDashboard && data == null)
            const Padding(
              padding: EdgeInsets.only(top: 72),
              child: Center(child: CircularProgressIndicator(color: hisbenewForest, strokeWidth: 1.6)),
            )
          else if (model.dashboardError != null && data == null)
            _QuietCard(
              child: TextButton(onPressed: model.refreshDashboard, child: Text(copy.retry)),
            )
          else if (data != null) ...[
            _SalesCard(points: data.sales, total: money.format(data.weekSales), locale: locale),
            const SizedBox(height: 14),
            _FigureRow(
              figures: [
                _Figure(copy.newOrders, numbers.format(data.newOrdersToday), hisbenewForest),
                _Figure(copy.shipQueue, numbers.format(data.pendingShippingOrders), hisbenewBrass),
                _Figure(copy.factoryStock, numbers.format(data.factoryStock), hisbenewInk),
                _Figure(copy.lowStock, numbers.format(data.lowStockCount), data.lowStockCount > 0 ? hisbenewClay : hisbenewMuted),
              ],
            ),
            if (data.amazonConfigured || data.amazonOpen > 0) ...[
              const SizedBox(height: 14),
              _AmazonStrip(
                open: numbers.format(data.amazonOpen),
                pending: numbers.format(data.amazonPending),
                unshipped: numbers.format(data.amazonUnshipped),
              ),
            ],
            if (data.orders.isNotEmpty) ...[
              const SizedBox(height: 26),
              _SectionLabel(copy.orders),
              const SizedBox(height: 10),
              for (final order in data.orders.take(6))
                _Line(
                  lead: order.customer.isNotEmpty ? order.customer : order.orderNo,
                  trail: order.amountUsd > 0 ? money.format(order.amountUsd) : order.status,
                  note: order.orderNo,
                ),
            ],
            if (data.shipments.isNotEmpty) ...[
              const SizedBox(height: 22),
              _SectionLabel(copy.shipping),
              const SizedBox(height: 10),
              for (final shipment in data.shipments.take(5))
                _Line(
                  lead: shipment.customer.isNotEmpty ? shipment.customer : shipment.orderNo,
                  trail: shipment.status,
                  note: shipment.orderNo,
                ),
            ],
          ],
        ],
      ),
    );
  }
}

class _SalesCard extends StatelessWidget {
  const _SalesCard({required this.points, required this.total, required this.locale});

  final List<SalesPoint> points;
  final String total;
  final String locale;

  @override
  Widget build(BuildContext context) {
    return _QuietCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionLabel('7 days'),
          const SizedBox(height: 8),
          Text(
            total,
            style: const TextStyle(
              color: hisbenewInk,
              fontSize: 34,
              fontWeight: FontWeight.w500,
              letterSpacing: -1.1,
              height: 1,
            ),
          ),
          const SizedBox(height: 18),
          SizedBox(
            height: 112,
            child: CustomPaint(
              painter: _SalesPainter(points),
              child: const SizedBox.expand(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              for (final point in points)
                Text(
                  _dayMark(point.date, locale),
                  style: const TextStyle(color: hisbenewMuted, fontSize: 11, letterSpacing: 0.4),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FigureRow extends StatelessWidget {
  const _FigureRow({required this.figures});

  final List<_Figure> figures;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.55,
      children: [
        for (final figure in figures)
          _QuietCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(width: 18, height: 2, color: figure.tone),
                const Spacer(),
                Text(
                  figure.value,
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w500, letterSpacing: -0.6, color: hisbenewInk),
                ),
                const SizedBox(height: 2),
                Text(figure.label, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
              ],
            ),
          ),
      ],
    );
  }
}

class _Figure {
  const _Figure(this.label, this.value, this.tone);

  final String label;
  final String value;
  final Color tone;
}

class _AmazonStrip extends StatelessWidget {
  const _AmazonStrip({required this.open, required this.pending, required this.unshipped});

  final String open;
  final String pending;
  final String unshipped;

  @override
  Widget build(BuildContext context) {
    return _QuietCard(
      child: Row(
        children: [
          const Expanded(child: _SectionLabel('Amazon')),
          _Mini(open, 'Open'),
          _Mini(pending, 'Pending'),
          _Mini(unshipped, 'Unshipped'),
        ],
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini(this.value, this.label);

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500, letterSpacing: -0.3)),
          Text(label, style: const TextStyle(color: hisbenewMuted, fontSize: 11)),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.lead, required this.trail, required this.note});

  final String lead;
  final String trail;
  final String note;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      decoration: BoxDecoration(
        color: hisbenewCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: hisbenewLine),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(lead.isEmpty ? '—' : lead, style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15)),
                if (note.isNotEmpty && note != lead)
                  Text(note, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
              ],
            ),
          ),
          if (trail.isNotEmpty)
            Text(trail, style: const TextStyle(color: hisbenewForest, fontWeight: FontWeight.w500, fontSize: 13)),
        ],
      ),
    );
  }
}

class _QuietCard extends StatelessWidget {
  const _QuietCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: hisbenewCard,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: hisbenewLine),
      ),
      child: Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 14), child: child),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        color: hisbenewMuted,
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.4,
      ),
    );
  }
}

class _SalesPainter extends CustomPainter {
  _SalesPainter(this.points);

  final List<SalesPoint> points;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty || size.width <= 0) return;
    final values = [for (final point in points) point.amount];
    final peak = values.fold<double>(0, (max, value) => value > max ? value : max);
    final span = peak <= 0 ? 1.0 : peak;
    final step = points.length == 1 ? 0.0 : size.width / (points.length - 1);
    final spots = <Offset>[
      for (var i = 0; i < points.length; i++)
        Offset(step * i, size.height - (values[i] / span) * (size.height - 8) - 4),
    ];

    final line = Path()..moveTo(spots.first.dx, spots.first.dy);
    for (var i = 1; i < spots.length; i++) {
      final previous = spots[i - 1];
      final current = spots[i];
      final mid = (previous.dx + current.dx) / 2;
      line.cubicTo(mid, previous.dy, mid, current.dy, current.dx, current.dy);
    }

    final fill = Path.from(line)
      ..lineTo(spots.last.dx, size.height)
      ..lineTo(spots.first.dx, size.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()..color = hisbenewBrass.withValues(alpha: 0.16),
    );
    canvas.drawPath(
      line,
      Paint()
        ..color = hisbenewBrass
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(spots.last, 3.2, Paint()..color = hisbenewForest);
  }

  @override
  bool shouldRepaint(covariant _SalesPainter oldDelegate) => oldDelegate.points != points;
}

String _dayMark(String raw, String locale) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return '';
  final label = DateFormat.E(locale).format(parsed);
  return label.isEmpty ? '' : label.substring(0, 1);
}
