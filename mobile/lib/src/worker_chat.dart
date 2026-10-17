import 'dart:async';

import 'package:flutter/material.dart';

import 'app_model.dart';
import 'call_desk.dart';
import 'dashboard_data.dart';
import 'erp_api.dart';
import 'page_kit.dart';
import 'theme.dart';

class WorkerChat extends StatefulWidget {
  const WorkerChat({required this.model, required this.calls, super.key});

  final AppModel model;
  final CallDesk calls;

  @override
  State<WorkerChat> createState() => _WorkerChatState();
}

class _WorkerChatState extends State<WorkerChat> {
  final _search = TextEditingController();
  final _draft = TextEditingController();
  Timer? _poll;
  var _loading = true;
  var _sending = false;
  int? _personId;
  String _personName = '';
  List<Map<String, dynamic>> _people = const [];
  String _error = '';
  List<Map<String, dynamic>> _thread = const [];

  @override
  void initState() {
    super.initState();
    _loadPeople();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_personId == null) {
        _loadPeople(quiet: true);
      } else {
        _loadThread(quiet: true);
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _search.dispose();
    _draft.dispose();
    super.dispose();
  }

  Future<void> _loadPeople({bool quiet = false}) async {
    final session = widget.model.session;
    if (session == null) return;
    if (!quiet) setState(() => _loading = true);
    try {
      final people = await widget.model.api.messageUsers(session);
      if (!mounted) return;
      setState(() {
        _people = people;
        _error = '';
        _loading = false;
      });
    } on ErpException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load messages. Check your connection and refresh.';
      });
    }
  }

  Future<void> _loadThread({bool quiet = false}) async {
    final session = widget.model.session;
    final personId = _personId;
    if (session == null || personId == null) return;
    if (!quiet) setState(() => _loading = true);
    try {
      final thread = await widget.model.api.messages(session, personId);
      if (!mounted || _personId != personId) return;
      setState(() {
        _thread = thread;
        _error = '';
        _loading = false;
      });
    } on ErpException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load messages. Retrying shortly…';
      });
    }
  }

  Future<void> _openPerson(Map<String, dynamic> person) async {
    setState(() {
      _personId = asInt(person['id']);
      _personName = asText(person['name']);
      _thread = const [];
      _loading = true;
    });
    await _loadThread();
  }

  Future<void> _send() async {
    final session = widget.model.session;
    final personId = _personId;
    final body = _draft.text.trim();
    if (session == null || personId == null || body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.model.api.sendMessage(
        session: session,
        userId: personId,
        body: body,
      );
      if (!mounted) return;
      if (_personId == personId && _draft.text.trim() == body) _draft.clear();
      await _loadThread(quiet: true);
    } on ErpException {
      if (mounted)
        setState(
          () =>
              _error = 'Message not sent. Check your connection and try again.',
        );
    }
    if (mounted) setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_personId != null) return _threadView(context);
    final query = _search.text.trim().toLowerCase();
    final people = _people
        .where(
          (person) =>
              '${person['name']} ${person['username']} ${person['role']}'
                  .toLowerCase()
                  .contains(query),
        )
        .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 4),
          child: Row(
            children: [
              const Expanded(
                child: Text(
                  'Messages',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                '${_people.length} coworkers',
                style: const TextStyle(color: hisbenewMuted),
              ),
            ],
          ),
        ),
        if (_error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(_error, style: const TextStyle(color: Colors.red)),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _search,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    hintText: 'Search coworkers',
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                onPressed: _loadPeople,
                tooltip: 'Refresh',
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(
                  child: CircularProgressIndicator(
                    color: hisbenewForest,
                    strokeWidth: 2,
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  children: [
                    if (people.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 28),
                        child: Text(
                          phrase(
                            context,
                            'No coworkers found.',
                            'کوئی ساتھی نہیں ملا۔',
                          ),
                          style: const TextStyle(color: hisbenewMuted),
                        ),
                      ),
                    for (final person in people)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        onTap: () => _openPerson(person),
                        leading: CircleAvatar(
                          backgroundColor: hisbenewForest,
                          child: Text(
                            asText(person['name']).isEmpty
                                ? 'H'
                                : asText(person['name']).characters.first
                                      .toUpperCase(),
                            style: const TextStyle(
                              color: Color(0xFFF3E6C8),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        title: Text(
                          asText(person['name']),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        subtitle: Text(
                          asText(person['role']),
                          style: const TextStyle(color: hisbenewMuted),
                        ),
                        trailing: asInt(person['unread_count']) > 0
                            ? CircleAvatar(
                                radius: 12,
                                backgroundColor: hisbenewBrass,
                                child: Text(
                                  '${asInt(person['unread_count'])}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              )
                            : const Icon(
                                Icons.chevron_right_rounded,
                                color: hisbenewMuted,
                              ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _threadView(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) setState(() => _personId = null);
      },
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 8, 4),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => setState(() => _personId = null),
                  icon: const Icon(Icons.arrow_back_rounded),
                ),
                Expanded(
                  child: Text(
                    _personName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () =>
                      widget.calls.startOutgoing(_personId!, _personName),
                  icon: const Icon(Icons.call_rounded, color: hisbenewForest),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: hisbenewForest,
                      strokeWidth: 2,
                    ),
                  )
                : ListView(
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                    children: [
                      if (_thread.isEmpty)
                        Text(
                          phrase(
                            context,
                            'No messages yet.',
                            'ابھی کوئی پیغام نہیں۔',
                          ),
                          style: const TextStyle(color: hisbenewMuted),
                        ),
                      for (final message in _thread.reversed)
                        Align(
                          alignment: message['is_mine'] == true
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 10,
                            ),
                            constraints: const BoxConstraints(maxWidth: 280),
                            decoration: BoxDecoration(
                              color: message['is_mine'] == true
                                  ? hisbenewForest
                                  : hisbenewCard,
                              borderRadius: BorderRadius.circular(16),
                              border: message['is_mine'] == true
                                  ? null
                                  : Border.all(color: hisbenewLine),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(
                                  asText(message['body']),
                                  style: TextStyle(
                                    color: message['is_mine'] == true
                                        ? Colors.white
                                        : hisbenewInk,
                                    fontSize: 15,
                                    height: 1.4,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _messageTime(message),
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: message['is_mine'] == true
                                        ? Colors.white70
                                        : hisbenewMuted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(8),
              child: Text(_error, style: const TextStyle(color: Colors.red)),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _draft,
                    minLines: 1,
                    maxLines: 4,
                    decoration: InputDecoration(
                      hintText: phrase(context, 'Message', 'پیغام'),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _sending ? null : _send,
                  icon: const Icon(Icons.send_rounded),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _messageTime(Map<String, dynamic> message) {
  final time = DateTime.tryParse(asText(message['created_at']))?.toLocal();
  if (time == null) return '';
  return '${time.day}/${time.month}  ${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
}
