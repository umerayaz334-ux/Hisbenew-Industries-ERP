import 'package:flutter/material.dart';

const hisbenewInk = Color(0xFF1C1917);
const hisbenewMuted = Color(0xFF7A7168);
const hisbenewLine = Color(0xFFE6DDD0);
const hisbenewCanvas = Color(0xFFF4EFE6);
const hisbenewCard = Color(0xFFFFFCF7);
const hisbenewForest = Color(0xFF1F4D3A);
const hisbenewBrass = Color(0xFFC4A15A);
const hisbenewClay = Color(0xFFE11D48);
const hisbenewAmber = Color(0xFFF59E0B);

ThemeData hisbenewTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: hisbenewInk,
    primary: hisbenewInk,
    onPrimary: Colors.white,
    surface: Colors.white,
    error: const Color(0xFFA43A2D),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: hisbenewCanvas,
    appBarTheme: const AppBarTheme(
      backgroundColor: hisbenewCanvas,
      foregroundColor: hisbenewInk,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: hisbenewCard,
      labelStyle: const TextStyle(color: hisbenewMuted, fontWeight: FontWeight.w600),
      hintStyle: const TextStyle(color: Color(0xFF94A3B8)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: hisbenewLine),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: hisbenewLine),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: hisbenewInk, width: 1.4),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        backgroundColor: hisbenewForest,
        foregroundColor: Colors.white,
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: const Color(0xFFF3E6C8),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 12,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
          color: selected ? hisbenewInk : hisbenewMuted,
        );
      }),
    ),
  );
}
