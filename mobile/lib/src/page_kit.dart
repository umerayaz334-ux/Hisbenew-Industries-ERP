import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'dashboard_data.dart';
import 'erp_api.dart';
import 'theme.dart';

String? productImageUrl(String path, {int width = 160}) {
  final value = path.trim();
  if (value.isEmpty || value.startsWith('data:') || value.startsWith('blob:')) return null;
  String route;
  if (value.startsWith('http://') || value.startsWith('https://')) {
    final uri = Uri.tryParse(value);
    if (uri == null) return value;
    final ownUpload = uri.path.startsWith('/static/uploads/') &&
        const {'api.hisbenew.com', 'app.hisbenew.com', 'hisbenew.com', 'www.hisbenew.com'}.contains(uri.host);
    if (!ownUpload) return value;
    route = uri.path;
  } else {
    route = value.startsWith('/') ? value : '/$value';
  }
  return '$erpApiBase$route?w=$width';
}

String phrase(BuildContext context, String en, String ur) {
  return Localizations.localeOf(context).languageCode == 'ur' ? ur : en;
}

String prettyWhen(String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null || raw.isEmpty) return raw;
  return DateFormat.MMMd().format(parsed.toLocal());
}

String usd(double value) => NumberFormat.simpleCurrency(name: 'USD').format(value);

class ProductThumb extends StatelessWidget {
  const ProductThumb({required this.path, this.size = 46, super.key});

  final String path;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = productImageUrl(path, width: (size * 3).round());
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: size,
        height: size,
        child: url == null
            ? const ColoredBox(color: Color(0xFFEEF2FF), child: Icon(Icons.image_outlined, size: 18, color: hisbenewMuted))
            : Image.network(
                url,
                fit: BoxFit.cover,
                cacheWidth: (size * 3).round(),
                errorBuilder: (context, error, stack) => const ColoredBox(
                  color: Color(0xFFEEF2FF),
                  child: Icon(Icons.image_outlined, size: 18, color: hisbenewMuted),
                ),
              ),
      ),
    );
  }
}

class ThumbStrip extends StatelessWidget {
  const ThumbStrip({required this.items, super.key});

  final List<ItemShot> items;

  @override
  Widget build(BuildContext context) {
    final pictured = items.where((item) => item.image.isNotEmpty).toList();
    if (pictured.isEmpty) return const SizedBox.shrink();
    final shown = pictured.take(4).toList();
    final extra = pictured.length - shown.length;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          for (final item in shown)
            Padding(
              padding: const EdgeInsets.only(right: 6),
              child: ProductThumb(path: item.image, size: 42),
            ),
          if (extra > 0) Text('+$extra', style: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

void openProductPhoto(BuildContext context, {required String path, String title = ''}) {
  final url = productImageUrl(path, width: 1400);
  if (url == null) return;
  showDialog<void>(
    context: context,
    barrierColor: const Color(0xF2000000),
    builder: (context) {
      final size = MediaQuery.sizeOf(context);
      return Stack(
        children: [
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => Navigator.pop(context),
            ),
          ),
          Center(
            child: SizedBox(
              width: size.width,
              height: size.height * 0.78,
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  loadingBuilder: (context, child, progress) {
                    if (progress == null) return child;
                    return const Center(child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2));
                  },
                  errorBuilder: (context, error, stack) => const Icon(Icons.broken_image_outlined, color: Colors.white54, size: 48),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close_rounded, color: Colors.white, size: 28),
              ),
            ),
          ),
          if (title.trim().isNotEmpty)
            SafeArea(
              child: Align(
                alignment: Alignment.bottomLeft,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 64, 12),
                  child: Text(
                    title.trim(),
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                ),
              ),
            ),
        ],
      );
    },
  );
}

class ProductLine extends StatelessWidget {
  const ProductLine({required this.item, super.key});

  final ItemShot item;

  @override
  Widget build(BuildContext context) {
    final title = item.name.isEmpty ? item.article : item.name;
    final detail = [
      if (item.article.isNotEmpty && item.article != title) item.article,
      if (item.qty > 0) '× ${item.qty}',
    ].join('  ');
    final canOpen = productImageUrl(item.image) != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          GestureDetector(
            onTap: canOpen ? () => openProductPhoto(context, path: item.image, title: title) : null,
            child: ProductThumb(path: item.image, size: 44),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title.isEmpty ? '—' : title, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
                if (detail.isNotEmpty) Text(detail, style: const TextStyle(color: hisbenewMuted, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class WorkSearch extends StatelessWidget {
  const WorkSearch({required this.controller, required this.hint, super.key});

  final TextEditingController controller;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      decoration: InputDecoration(
        hintText: hint,
        prefixIcon: const Icon(Icons.search_rounded, color: hisbenewMuted),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
    );
  }
}

class WorkCard extends StatelessWidget {
  const WorkCard({required this.child, this.tint, super.key});

  final Widget child;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: tint ?? Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: hisbenewLine),
        boxShadow: const [
          BoxShadow(color: Color(0x0F101828), blurRadius: 16, offset: Offset(0, 6)),
        ],
      ),
      child: child,
    );
  }
}

class SummaryCard extends StatelessWidget {
  const SummaryCard({
    required this.summary,
    required this.sheetTitle,
    required this.details,
    this.tint,
    super.key,
  });

  final Widget summary;
  final String sheetTitle;
  final Widget details;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    return WorkCard(
      tint: tint,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => showWorkSheet(context: context, title: sheetTitle, child: details),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
            child: Row(
              children: [
                Expanded(child: summary),
                const Icon(Icons.keyboard_arrow_up_rounded, color: hisbenewMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class DetailLine extends StatelessWidget {
  const DetailLine(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    if (value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 88, child: Text(label, style: const TextStyle(color: hisbenewMuted, fontSize: 12))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class LoadState extends StatelessWidget {
  const LoadState({required this.loading, required this.error, required this.empty, required this.onRetry, required this.child, super.key});

  final bool loading;
  final bool error;
  final bool empty;
  final VoidCallback onRetry;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(color: hisbenewForest, strokeWidth: 2.4));
    }
    if (error) {
      return Center(
        child: FilledButton(onPressed: onRetry, child: Text(phrase(context, 'Try again', 'دوبارہ کوشش'))),
      );
    }
    if (empty) return const SizedBox.shrink();
    return child;
  }
}

Future<void> showWorkSheet({
  required BuildContext context,
  required String title,
  required Widget child,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    showDragHandle: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (context) {
      return Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.82),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                const SizedBox(height: 14),
                child,
              ],
            ),
          ),
        ),
      );
    },
  );
}
