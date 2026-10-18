import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Product photos belong in persistent support storage, not the OS image cache.
class ProductImageCache {
  ProductImageCache({this.directory, http.Client? client}) : _client = client ?? http.Client();
  static final instance = ProductImageCache();
  final Directory? directory;
  final http.Client _client;
  final Map<String, Future<File?>> _pending = {};
  Future<Directory>? _root;
  int _generation = 0;
  Future<int> storageBytes() async {
    var total = 0;
    await for (final entry in (await _folder()).list()) {
      if (entry is File && entry.path.endsWith('.image')) total += await entry.length();
    }
    return total;
  }
  Future<void> clearDownloads() async {
    _generation++;
    await Future.wait(_pending.values.toList());
    await for (final entry in (await _folder()).list()) {
      if (entry is File && (entry.path.endsWith('.image') || entry.path.endsWith('.part'))) await entry.delete();
    }
  }
  Future<Directory> _folder() => _root ??= () async {
    final root = directory ?? Directory('${(await getApplicationSupportDirectory()).path}/product-photos');
    await root.create(recursive: true);
    return root;
  }();

  static String? url(String raw, {int width = 160}) {
    if (raw.trim().isEmpty) return null;
    final uri = Uri.tryParse(raw.startsWith('http') ? raw : 'https://api.hisbenew.com/${raw.replaceFirst(RegExp(r'^/'), '')}');
    if (uri == null || !['http', 'https'].contains(uri.scheme)) return null;
    if (const {'api.hisbenew.com', 'app.hisbenew.com', 'hisbenew.com', 'www.hisbenew.com'}.contains(uri.host)) {
      return uri.replace(scheme: 'https', host: 'api.hisbenew.com', queryParameters: {...uri.queryParameters, 'w': '$width'}).toString();
    }
    return uri.toString();
  }

  Future<File?> get(String raw, {int width = 160}) {
    final source = url(raw, width: width.clamp(48, 960));
    if (source == null) return Future.value();
    return _pending.putIfAbsent(source, () => _load(source).whenComplete(() { _pending.remove(source); }));
  }

  Future<File?> _load(String source) async {
    final generation = _generation;
    try {
      final folder = await _folder();
      final file = File('${folder.path}/${sha256.convert(utf8.encode(source))}.image');
      if (await file.exists() && await file.length() > 0) return file;
      final response = await _client.get(Uri.parse(source)).timeout(const Duration(seconds: 12));
      if (response.statusCode != 200 || response.bodyBytes.isEmpty || response.bodyBytes.length > 8 * 1024 * 1024 || !(response.headers['content-type'] ?? '').startsWith('image/')) return null;
      final temp = File('${file.path}.part');
      if (generation != _generation) return null;
      await temp.writeAsBytes(response.bodyBytes, flush: true);
      return await temp.rename(file.path);
    } catch (_) {
      return null;
    }
  }

  Future<void> prefetch(Object? data, {int limit = 8}) async {
    final generation = _generation;
    final paths = <String>{};
    void collect(Object? value) {
      if (value is Map) {
        for (final entry in value.entries) {
          if ('${entry.key}'.endsWith('image_url') && entry.value is String) paths.add(entry.value as String);
          if (entry.value is Map || entry.value is List) collect(entry.value);
        }
      } else if (value is List) {
        for (final entry in value) { collect(entry); }
      }
    }
    collect(data);
    final queue = paths.take(limit).toList();
    for (final path in queue) {
      if (generation != _generation) return;
      await get(path, width: 160);
    }
  }
}

class OfflineProductImage extends StatefulWidget {
  const OfflineProductImage({required this.path, this.fit = BoxFit.cover, this.decodeWidth, this.requestWidth = 160, super.key});
  final String path;
  final BoxFit fit;
  final int? decodeWidth;
  final int requestWidth;
  @override
  State<OfflineProductImage> createState() => _OfflineProductImageState();
}

class _OfflineProductImageState extends State<OfflineProductImage> {
  late Future<File?> _image = ProductImageCache.instance.get(widget.path, width: widget.requestWidth);
  @override
  void didUpdateWidget(OfflineProductImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.path != widget.path || oldWidget.requestWidth != widget.requestWidth) {
      _image = ProductImageCache.instance.get(widget.path, width: widget.requestWidth);
    }
  }
  @override
  Widget build(BuildContext context) => FutureBuilder<File?>(future: _image, builder: (context, snapshot) {
    final file = snapshot.data;
    if (file != null) return Image.file(file, fit: widget.fit, cacheWidth: widget.decodeWidth, errorBuilder: (_, _, _) => const Icon(Icons.image_not_supported_outlined));
    return ColoredBox(color: const Color(0xFFEDF1EF), child: Center(child: Icon(snapshot.connectionState == ConnectionState.waiting ? Icons.downloading_outlined : Icons.image_outlined, color: const Color(0xFF7A8781))));
  });
}
