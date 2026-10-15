import 'package:flutter/material.dart';

const hisbenewInk = Color(0xFF1C1917);
const hisbenewMuted = Color(0xFF7A7268);
const hisbenewLine = Color(0xFFE4DDD2);
const hisbenewCanvas = Color(0xFFF3EFE7);
const hisbenewCard = Color(0xFFFFFCF7);
const hisbenewForest = Color(0xFF1F3D34);
const hisbenewBrass = Color(0xFFA68456);
const hisbenewClay = Color(0xFF9C4A3C);

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
      indicatorColor: const Color(0xFFE8EDF5),
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
