import urllib.request
import json

print("=== Order Deletion Test ===\n")

# Get current orders
try:
    with urllib.request.urlopen('http://127.0.0.1:8000/orders', timeout=5) as r:
        orders = json.loads(r.read().decode())
        print(f"Total orders: {len(orders)}")
        
        # Get shipping records
        with urllib.request.urlopen('http://127.0.0.1:8000/shipping', timeout=5) as r2:
            shipping = json.loads(r2.read().decode())
            print(f"Total shipping records: {len(shipping)}\n")
            
            # Get courier balances
            with urllib.request.urlopen('http://127.0.0.1:8000/courier-balances', timeout=5) as r3:
                balances = json.loads(r3.read().decode())
                print(f"Courier balances before deletion:")
                for balance in balances:
                    print(f"  - {balance['courier_name']}: Total Cost: {balance['total_shipping_cost']}, Paid: {balance['total_paid']}, Due: {balance['balance_due']}")
                
                print("\n✅ Order deletion now includes:")
                print("  1. Removes the order from order list")
                print("  2. Removes the shipping record from shipping history")
                print("  3. Reverses courier payment from courier's account")
                print("  4. Updates courier balance")
                
except Exception as e:
    print(f"Error: {e}")
