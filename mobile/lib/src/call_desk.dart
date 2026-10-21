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
        'Calling',
        '\u06a9\u0627\u0644 \u06c1\u0648 \u0631\u06c1\u06cc \u06c1\u06d2',
      ),
      'connected' => desk.duration,
      'ended' => desk.notice.isEmpty ? 'Call ended' : desk.notice,
      _ => phrase(context, 'Call', '\u06a9\u0627\u0644'),
    };
    return Material(
      color: const Color(0xFF102C26),
      child: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: IntrinsicHeight(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 24, 24, 28),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            connected ? Icons.graphic_eq : Icons.call,
                            color: const Color(0xFF8BD6B8),
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            connected ? 'CALL IN PROGRESS' : 'HISBENEW VOICE',
                            style: const TextStyle(
                              color: Color(0xFF8BD6B8),
                              letterSpacing: 1.8,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                      const Spacer(),
                      Container(
                        width: 108,
                        height: 108,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: hisbenewForest,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: const Color(0xFF8BD6B8)
                                .withValues(alpha: .45),
                            width: 2,
                          ),
                        ),
                        child: Text(
                          desk.otherName.isEmpty
                              ? 'H'
                              : desk.otherName.characters.first.toUpperCase(),
                          style: const TextStyle(
                            color: Color(0xFFF3E6C8),
                            fontSize: 40,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      const SizedBox(height: 22),
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
                          fontSize: 30,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -.4,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: connected
                              ? const Color(0xFF8BD6B8)
                              : const Color(0xFFF3E6C8),
                          fontSize: connected ? 24 : 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
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
    return Column(
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          elevation: 6,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 76,
              height: 76,
              child: Icon(icon, color: Colors.white, size: 34),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
