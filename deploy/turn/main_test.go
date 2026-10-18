package main

import (
	"net"
	"testing"
	"time"
)

func TestExpiryAndPrivatePeers(t *testing.T) {
	now := time.Unix(1000, 0)
	for _, user := range []string{"bad", "999:1", "1000000:1"} {
		if validUser(user, now) {
			t.Fatalf("accepted %q", user)
		}
	}
	if !validUser("2000:1", now) {
		t.Fatal("valid user rejected")
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1"} {
		if publicPeer(nil, net.ParseIP(ip)) {
			t.Fatalf("private peer accepted: %s", ip)
		}
	}
	if !publicPeer(nil, net.ParseIP("8.8.8.8")) {
		t.Fatal("public peer rejected")
	}
	if credential([]byte("test-secret"), "2000:1") != "bUaNLeteNeGUpjxml9ZCqOF6Hoo=" {
		t.Fatal("REST credential mismatch")
	}
}

func TestAuthenticatedRelay(t *testing.T) {
	secret := []byte("test-only-secret-that-is-long-enough-for-the-relay")
	server, err := serve(net.ParseIP("127.0.0.1"), "127.0.0.1:3478", secret, func(net.Addr, net.IP) bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	for _, tcp := range []bool{false, true} {
		if err := probe("127.0.0.1:3478", secret, tcp); err != nil {
			t.Fatalf("TCP=%v: %v", tcp, err)
		}
	}
}
