import urllib.request
import urllib.parse
import json
import os

print("=== Testing Image Upload Feature ===\n")

API_BASE = "http://127.0.0.1:8000"

# Create a test image file
test_image_path = "test_product.jpg"
try:
    # Create a minimal JPG file (1x1 pixel)
    jpg_hex = (
        b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c'
        b'\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c'
        b'\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\xff\xc0\x00\x0b\x08\x00'
        b'\x01\x00\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01'
        b'\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06'
        b'\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03'
        b'\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06'
        b'\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t'
        b'\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz'
        b'\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a'
        b'\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9'
        b'\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8'
        b'\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5'
        b'\xf6\xf7\xf8\xf9\xfa\xff\xda\x08\x01\x01\x00\x00?\x00\xfb\xd0\xff\xd9'
    )
    with open(test_image_path, "wb") as f:
        f.write(jpg_hex)
    print(f"✓ Test image created: {test_image_path}\n")
except Exception as e:
    print(f"✗ Failed to create test image: {e}\n")
    exit(1)

# Get initial product count
try:
    with urllib.request.urlopen(f"{API_BASE}/products", timeout=5) as r:
        products = json.loads(r.read().decode())
        initial_count = len(products)
        print(f"Initial product count: {initial_count}")
except Exception as e:
    print(f"✗ Error fetching products: {e}")
    exit(1)

# Test image upload
print("\nTesting product creation with image...")
try:
    import subprocess
    result = subprocess.run([
        "curl", "-X", "POST",
        f"{API_BASE}/products",
        "-F", "article_no=TEST-IMG-001",
        "-F", "name=Test Product with Image",
        "-F", "category=Test",
        "-F", "factory_stock=10",
        "-F", "usa_stock=5",
        "-F", "reserved_stock=0",
        "-F", "cost_price=100",
        "-F", "selling_price=200",
        "-F", "low_stock_alert=5",
        "-F", "workflow_required=true",
        "-F", f"image=@{test_image_path}",
    ], capture_output=True, text=True, timeout=10)
    
    if result.returncode == 0:
        product = json.loads(result.stdout)
        print(f"✓ Product created successfully!")
        print(f"  - ID: {product.get('id')}")
        print(f"  - Article: {product.get('article_no')}")
        print(f"  - Name: {product.get('name')}")
        print(f"  - Image URL: {product.get('image_url')}")
        
        if product.get('image_url'):
            print(f"\n✓ Image saved at: {product.get('image_url')}")
            print(f"  Access at: {API_BASE}{product.get('image_url')}")
        else:
            print(f"\n✗ No image URL returned!")
    else:
        print(f"✗ Error creating product: {result.stderr}")
except Exception as e:
    print(f"✗ Error testing image upload: {e}")

# Verify image was saved
try:
    with urllib.request.urlopen(f"{API_BASE}/products", timeout=5) as r:
        products = json.loads(r.read().decode())
        final_count = len(products)
        print(f"\nFinal product count: {final_count} (added {final_count - initial_count})")
        
        if final_count > initial_count:
            latest = products[-1]
            print(f"\nLatest Product:")
            print(f"  - Name: {latest.get('name')}")
            print(f"  - Image URL: {latest.get('image_url')}")
            if latest.get('image_url'):
                print(f"\n✅ Image upload feature is working!")
                print(f"   Images are saved and accessible")
            else:
                print(f"\n⚠️ Product created but no image saved")
except Exception as e:
    print(f"✗ Error verifying products: {e}")

# Cleanup
try:
    os.remove(test_image_path)
    print(f"\nCleanup: Test image file removed")
except:
    pass
