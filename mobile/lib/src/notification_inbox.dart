import 'package:flutter/material.dart';

import 'app_model.dart';
import 'dashboard_data.dart';
import 'theme.dart';

class NotificationBell extends StatelessWidget {
  const NotificationBell({required this.count, required this.onTap, super.key});
  final int count;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: 'Notifications',
    onPressed: onTap,
    icon: Badge(
      isLabelVisible: count > 0,
      label: Text(count > 99 ? '99+' : '$count'),
      child: const Icon(Icons.notifications_none_rounded),
    ),
  );
}

class NotificationInbox extends StatefulWidget {
  const NotificationInbox({
    required this.model,
    required this.onClose,
    required this.onChat,
    required this.onShipping,
    super.key,
  });
  final AppModel model;
  final VoidCallback onClose;
  final VoidCallback onChat;
  final VoidCallback onShipping;
  @override
  State<NotificationInbox> createState() => _NotificationInboxState();
}

class _NotificationInboxState extends State<NotificationInbox> {
  bool _loading = true;
  bool _error = false;
  List<Map<String, dynamic>> _messages = [];
  int _shipments = 0;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final session = widget.model.session;
    if (session == null) return;
    try {
      final messages = await widget.model.api.messageUsers(session);
      final shipments = widget.model.isWorker
          ? await widget.model.api.pendingShipping(session)
          : <Map<String, dynamic>>[];
      if (mounted) {
        setState(() {
          _messages = messages
              .where((row) => asInt(row['unread_count']) > 0)
              .toList();
          _shipments = shipments.length;
          _loading = false;
          _error = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 20, 12),
        child: Row(
          children: [
            IconButton(
              onPressed: widget.onClose,
              tooltip: 'Back',
              icon: const Icon(Icons.arrow_back),
            ),
            const Expanded(
              child: Text(
                'Notifications',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
      Expanded(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              if (_loading)
                const Center(child: CircularProgressIndicator())
              else if (_error) ...[
                const Text('Notifications could not be loaded.'),
                TextButton(onPressed: _load, child: const Text('Try again')),
              ] else ...[
                if (_messages.isEmpty && _shipments == 0)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 70),
                    child: Column(
                      children: [
                        Icon(
                          Icons.notifications_active_outlined,
                          size: 60,
                          color: hisbenewMuted,
                        ),
                        SizedBox(height: 18),
                        Text(
                          'You’re all caught up',
                          style: TextStyle(
                            fontSize: 21,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        SizedBox(height: 8),
                        Text(
                          'New messages and work reminders appear here.',
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                for (final person in _messages)
                  Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      leading: const CircleAvatar(
                        child: Icon(Icons.chat_bubble_outline),
                      ),
                      title: Text(
                        asText(person['name']),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text(
                        '${asInt(person['unread_count'])} unread messages',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: widget.onChat,
                    ),
                  ),
                if (_shipments > 0)
                  Card(
                    child: ListTile(
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      leading: const CircleAvatar(
                        child: Icon(Icons.local_shipping_outlined),
                      ),
                      title: const Text(
                        'Ready to ship',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      subtitle: Text('$_shipments orders awaiting dispatch'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: widget.onShipping,
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    ],
  );
}
