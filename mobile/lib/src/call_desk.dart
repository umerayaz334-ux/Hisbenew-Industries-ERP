import 'package:flutter/material.dart';

import 'page_kit.dart';
import 'phone_permissions.dart';
import 'theme.dart';
import 'call_desk_controller.dart';

export 'call_desk_controller.dart';

class CallCover extends StatelessWidget {
  const CallCover({required this.desk, super.key});

  final CallDesk desk;

  @override
  Widget build(BuildContext context) {
    final incoming = desk.phase == 'incoming';
    final ended = desk.phase == 'ended';
    final connected = desk.phase == 'connected';
    final ringing = incoming || desk.phase == 'outgoing';
    final title = switch (desk.phase) {
      'connecting' => phrase(
        context,
        'Connecting...',
        '\u0631\u0627\u0628\u0637\u06c1 \u06c1\u0648 \u0631\u06c1\u0627 \u06c1\u06d2',
      ),
      'incoming' => phrase(
        context,
        'Incoming call',
        '\u0622\u0646\u06d2 \u0648\u0627\u0644\u06cc \u06a9\u0627\u0644',
      ),
      'outgoing' => phrase(
        context,
        desk.deliveryText,
        desk.deliveryStatus == 'ringing'
            ? '\u0622\u067e \u06a9\u06cc \u0688\u06cc\u0648\u0627\u0626\u0633 \u067e\u0631 \u0631\u0646\u06af \u06c1\u0648 \u0631\u06c1\u06cc \u06c1\u06d2'
            : desk.deliveryStatus == 'unreachable'
            ? '\u0627\u0628\u06be\u06cc \u0627\u0646 \u062a\u06a9 \u06a9\u0627\u0644 \u0646\u06c1\u06cc\u06ba \u067e\u06c1\u0646\u0686\u06cc'
            : '\u06a9\u0627\u0644 \u06a9\u06cc \u06a9\u0648\u0634\u0634 \u062c\u0627\u0631\u06cc \u06c1\u06d2',
      ),
      'connected' => desk.duration,
      'ended' => desk.notice.isEmpty ? 'Call ended' : desk.notice,
      _ => phrase(context, 'Call', '\u06a9\u0627\u0644'),
    };
    return Material(
      color: const Color(0xFF0D201A),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF17392E), Color(0xFF0B1713)],
          ),
        ),
        child: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 18, 24, 24),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .08),
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: .12),
                          ),
                        ),
                        child: Wrap(
                          alignment: WrapAlignment.center,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Icon(
                              incoming
                                  ? Icons.call_received_rounded
                                  : connected
                                  ? Icons.graphic_eq_rounded
                                  : Icons.call_made_rounded,
                              color: const Color(0xFF9BE4C5),
                              size: 17,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              incoming
                                  ? 'INCOMING VOICE CALL'
                                  : connected
                                  ? 'CALL IN PROGRESS'
                                  : 'OUTGOING VOICE CALL',
                              style: const TextStyle(
                                color: Color(0xFFB8EBD4),
                                letterSpacing: 1.25,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Spacer(),
                      TweenAnimationBuilder<double>(
                        duration: const Duration(milliseconds: 420),
                        tween: Tween<double>(begin: .92, end: 1),
                        builder: (context, scale, child) => Transform.scale(
                          scale: ringing ? scale : 1,
                          child: child,
                        ),
                        child: Container(
                          width: 136,
                          height: 136,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: const LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [Color(0xFF32735A), Color(0xFF173B2E)],
                            ),
                            border: Border.all(
                              color: const Color(0xFF9BE4C5)
                                  .withValues(alpha: .55),
                              width: 2,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF53BE8D)
                                    .withValues(alpha: ringing ? .22 : .12),
                                blurRadius: 35,
                                spreadRadius: 5,
                              ),
                            ],
                          ),
                          child: Text(
                            desk.otherName.isEmpty
                                ? 'H'
                                : desk.otherName.characters.first.toUpperCase(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 46,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -1,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 26),
                      Text(
                        desk.otherName.isEmpty
                            ? phrase(
                                context,
                                'Hisbenew',
                                '\u06c1\u0632\u0628\u06cc\u0646\u06cc\u0648',
                              )
                            : desk.otherName,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 29,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.4,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 15,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .07),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Wrap(
                          alignment: WrapAlignment.center,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Container(
                              width: 7,
                              height: 7,
                              decoration: BoxDecoration(
                                color: connected
                                    ? const Color(0xFF75E3A7)
                                    : incoming
                                    ? const Color(0xFFF1C675)
                                    : const Color(0xFFB5C7BD),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 9),
                            Text(
                              title,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: connected
                                    ? const Color(0xFF9BE4C5)
                                    : desk.deliveryStatus == 'unreachable'
                                    ? const Color(0xFFFFD19A)
                                    : const Color(0xFFF3E6C8),
                                fontSize: connected ? 18 : 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (desk.phase == 'outgoing') ...[
                        const SizedBox(height: 9),
                        Text(
                          phrase(
                            context,
                            desk.deliveryHint,
                            desk.deliveryStatus == 'ringing'
                                ? '\u0627\u0646 \u06a9\u06cc \u0688\u06cc\u0648\u0627\u0626\u0633 \u067e\u0631 \u06a9\u0627\u0644 \u0622 \u0631\u06c1\u06cc \u06c1\u06d2'
                                : desk.deliveryStatus == 'unreachable'
                                ? '\u0627\u0646 \u06a9\u0627 \u0627\u06cc\u067e \u0622\u0641 \u0644\u0627\u0626\u0646 \u06c1\u0648 \u0633\u06a9\u062a\u0627 \u06c1\u06d2'
                                : '\u0627\u0646 \u06a9\u06d2 \u0627\u06cc\u067e \u062a\u06a9 \u067e\u06c1\u0646\u0686\u0646\u06d2 \u06a9\u06cc \u06a9\u0648\u0634\u0634 \u062c\u0627\u0631\u06cc \u06c1\u06d2',
                          ),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: desk.deliveryStatus == 'unreachable'
                                ? const Color(0xFFFFD19A)
                                : const Color(0xFFB5C7BD),
                            fontSize: 12,
                          ),
                        ),
                      ],
                      if (desk.notice.isNotEmpty && !ended) ...[
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: .08),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              Text(
                                desk.notice,
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Color(0xFFD6CBBA),
                                ),
                              ),
                              if (desk.notice.toLowerCase().contains(
                                'microphone',
                              ))
                                TextButton(
                                  onPressed: PhonePermissions.openSettings,
                                  child: const Text('Open phone settings'),
                                ),
                            ],
                          ),
                        ),
                      ],
                      const Spacer(),
                      if (!ended && !incoming) ...[
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            _AnswerButton(
                              icon: desk.muted ? Icons.mic_off : Icons.mic,
                              color: desk.muted
                                  ? const Color(0xFF647D72)
                                  : const Color(0xFF284A3F),
                              label: desk.muted ? 'Unmute' : 'Mute',
                              onTap: desk.toggleMute,
                            ),
                            _AnswerButton(
                              icon: desk.speaker
                                  ? Icons.volume_up
                                  : Icons.hearing,
                              color: desk.speaker
                                  ? const Color(0xFF647D72)
                                  : const Color(0xFF284A3F),
                              label: desk.speaker ? 'Speaker on' : 'Earpiece',
                              onTap: desk.toggleSpeaker,
                            ),
                          ],
                        ),
                        const SizedBox(height: 28),
                      ],
                      if (!ended && incoming)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            _AnswerButton(
                              icon: Icons.call_end_rounded,
                              color: const Color(0xFFE11D48),
                              label: phrase(context, 'Decline', '\u0631\u062f'),
                              onTap: desk.decline,
                            ),
                            _AnswerButton(
                              icon: Icons.call_rounded,
                              color: const Color(0xFF1F8A4C),
                              label: phrase(
                                context,
                                'Answer',
                                '\u062c\u0648\u0627\u0628',
                              ),
                              onTap: () => desk.accept(),
                            ),
                          ],
                        )
                      else if (!ended)
                        _AnswerButton(
                          icon: Icons.call_end_rounded,
                          color: const Color(0xFFE11D48),
                          label: phrase(context, 'End', '\u06a9\u0627\u0644'),
                          onTap: desk.hangUp,
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      ),
    );
  }
}

class _AnswerButton extends StatelessWidget {
  const _AnswerButton({
    required this.icon,
    required this.color,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      child: Semantics(
        button: true,
        label: label,
        child: Column(
          children: [
            Material(
              color: color,
              shape: const CircleBorder(),
              elevation: 7,
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onTap,
                child: SizedBox(
                  width: 82,
                  height: 82,
                  child: Icon(icon, color: Colors.white, size: 35),
                ),
              ),
            ),
            const SizedBox(height: 9),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
