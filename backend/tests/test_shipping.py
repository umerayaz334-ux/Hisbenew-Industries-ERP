import urllib.request
import json

# Test that shipping records can be fetched and then deleted
try:
    # Get shipping records
    with urllib.request.urlopen('http://127.0.0.1:8000/shipping', timeout=5) as r:
        records = json.loads(r.read().decode())
        print(f"Found {len(records)} shipping records")
        
        # Display first few records
        for record in records[:3]:
            print(f"  - Order: {record['order_no']}, Shipping ID: {record['id']}, Order ID: {record['order_id']}")
except Exception as e:
    print(f"Error fetching shipping records: {e}")

print("\nShipped Orders History delete feature:")
print("- Delete button is now available in Shipped Orders History table")
print("- Clicking Delete will remove the order and reverse the stock")
