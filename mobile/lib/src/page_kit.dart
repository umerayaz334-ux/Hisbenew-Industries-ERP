import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'theme.dart';

String phrase(BuildContext context, String en, String ur) {
  return Localizations.localeOf(context).languageCode == 'ur' ? ur : en;
}

String prettyWhen(String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null || raw.isEmpty) return raw;
  return DateFormat.MMMd().format(parsed.toLocal());
}

String usd(double value) => NumberFormat.simpleCurrency(name: 'USD').format(value);

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
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (context) {
      return Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
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
      );
    },
  );
}
