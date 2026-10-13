import urllib.request
import json

# First, get orders to find one to delete
try:
    with urllib.request.urlopen('http://127.0.0.1:8000/orders', timeout=5) as r:
        orders = json.loads(r.read().decode())
        if orders:
            order_to_delete = orders[0]
            print(f"Found order: #{order_to_delete['id']} - {order_to_delete['order_no']} (Status: {order_to_delete['shipping_status']})")
            
            # Try to delete it
            delete_url = f'http://127.0.0.1:8000/orders/{order_to_delete["id"]}'
            req = urllib.request.Request(delete_url, method='DELETE')
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    response = json.loads(r.read().decode())
                    print(f"DELETE successful: {response}")
            except urllib.error.HTTPError as e:
                error_response = e.read().decode()
                print(f"DELETE failed with status {e.code}: {error_response}")
        else:
            print("No orders found to test delete")
except Exception as e:
    print(f"Error: {e}")
