import 'package:flutter/material.dart';
import 'app_model.dart';
import 'phone_permissions.dart';
import 'page_kit.dart';
import 'product_image_cache.dart';

class WorkspaceDrawer extends StatelessWidget {
  const WorkspaceDrawer({required this.model, required this.onSelect, required this.onNotifications, super.key});
  final AppModel model;
  final ValueChanged<int> onSelect;
  final VoidCallback onNotifications;
  @override
  Widget build(BuildContext context) => Drawer(child: SafeArea(child: ListView(padding: const EdgeInsets.all(16), children: [
    const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Text('Workspace', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800))),
    for (final entry in <(int, String, String, IconData)>[
      (0, 'Dashboard', 'Dashboard', Icons.space_dashboard_outlined),
      (5, 'Orders', 'Orders', Icons.receipt_long_outlined),
      (1, 'Shipping', 'Shipping', Icons.local_shipping_outlined),
      (8, 'Manufacturing', 'Manufacturing', Icons.precision_manufacturing_outlined),
      (6, 'Products', 'Products', Icons.inventory_2_outlined),
      (2, 'Messages', 'Chats', Icons.chat_bubble_outline),
      (3, 'Worker Payouts', 'Spending & pay', Icons.account_balance_wallet_outlined),
    ]) if (model.canAccess(entry.$2)) ListTile(leading: Icon(entry.$4), title: Text(entry.$3), onTap: () { Navigator.pop(context); onSelect(entry.$1); }),
    const Divider(height: 32),
    ListTile(leading: const Icon(Icons.notifications_outlined), title: const Text('Notifications'), onTap: () { Navigator.pop(context); onNotifications(); }),
    ListTile(leading: const Icon(Icons.person_outline), title: const Text('Account'), onTap: () { Navigator.pop(context); onSelect(4); }),
  ])));
}

class ProfilePage extends StatelessWidget {
  const ProfilePage({required this.model, super.key});
  final AppModel model;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(24), children: [
    const Text('Account', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
    const SizedBox(height: 24),
    const CircleAvatar(radius: 38, child: Icon(Icons.person_outline, size: 38)),
    const SizedBox(height: 24),
    DetailLine('Name', model.session?.name ?? ''),
    DetailLine('Username', model.session?.username ?? ''),
    DetailLine('Company', model.session?.tenantName ?? ''),
    DetailLine('Role', model.session?.role ?? ''),
    const SizedBox(height: 8),
    const CallPermissionTile(),
    const PhotoStorageTile(),
    const SizedBox(height: 16),
    const Text('Language', style: TextStyle(fontWeight: FontWeight.w700)),
    const SizedBox(height: 12),
    SegmentedButton<String>(segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ur', label: Text('اردو'))], selected: {model.locale.languageCode}, onSelectionChanged: (value) => model.setLocale(Locale(value.first))),
    const SizedBox(height: 24),
    OutlinedButton.icon(onPressed: model.signOut, icon: const Icon(Icons.logout), label: const Text('Sign out')),
  ]);
}

class PreferencesPage extends StatelessWidget {
  const PreferencesPage({required this.model, super.key});
  final AppModel model;
  @override
  Widget build(BuildContext context) => ProfilePage(model: model);
}

class PhotoStorageTile extends StatefulWidget {
  const PhotoStorageTile({super.key});
  @override
  State<PhotoStorageTile> createState() => _PhotoStorageTileState();
}
class _PhotoStorageTileState extends State<PhotoStorageTile> {
  late Future<int> _bytes = ProductImageCache.instance.storageBytes();
  bool _clearing = false;
  @override
  Widget build(BuildContext context) => FutureBuilder<int>(future: _bytes, builder: (context, snapshot) => ListTile(
    contentPadding: EdgeInsets.zero,
    leading: const Icon(Icons.photo_library_outlined),
    title: const Text('Downloaded product photos'),
    subtitle: Text('${((snapshot.data ?? 0) / 1048576).toStringAsFixed(1)} MB · Available offline'),
    trailing: TextButton(onPressed: _clearing ? null : () async {
      final confirmed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(title: const Text('Clear downloaded photos?'), content: const Text('Photos will need internet to download again. Saved spending and messages will stay on this phone.'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')), TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Clear photos'))]));
      if (confirmed != true || !mounted) return;
      setState(() => _clearing = true);
      try { await ProductImageCache.instance.clearDownloads(); } finally {
        if (mounted) setState(() { _clearing = false; _bytes = ProductImageCache.instance.storageBytes(); });
      }
    }, child: Text(_clearing ? 'Clearing…' : 'Clear')),
  ));
}
