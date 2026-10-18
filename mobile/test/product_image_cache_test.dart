import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:hisbenew_erp/src/product_image_cache.dart';

void main() {
  test('photo persists on disk across restart without internet', () async {
    final root = await Directory('build/test-photos').create(recursive: true);
    final folder = await root.createTemp('erp-photo-test-');
    try {
      var downloads = 0;
      final cache = ProductImageCache(directory: folder, client: MockClient((_) async {
        downloads++;
        return http.Response.bytes([1, 2, 3], 200, headers: {'content-type': 'image/png'});
      }));
      final saved = await cache.get('/static/uploads/chair.png?w=120');
      expect(await saved!.readAsBytes(), [1, 2, 3]);
      final restarted = ProductImageCache(directory: folder, client: MockClient((_) async => throw http.ClientException('offline')));
      final offline = await restarted.get('/static/uploads/chair.png?w=1400');
      expect(await offline!.readAsBytes(), [1, 2, 3]);
      expect(downloads, 1);
    } finally { await folder.delete(recursive: true); }
  });

  test('failed responses are never saved as image files', () async {
    final root = await Directory('build/test-photos').create(recursive: true);
    final folder = await root.createTemp('erp-photo-test-');
    try {
      final cache = ProductImageCache(directory: folder, client: MockClient((_) async => http.Response('<html>error</html>', 200, headers: {'content-type': 'text/html'})));
      expect(await cache.get('/static/uploads/photo.png'), isNull);
      expect(await folder.list().length, 0);
    } finally { await folder.delete(recursive: true); }
  });
}
