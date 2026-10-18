// Hisbenew's authenticated WebRTC relay. No message or audio content is logged.
package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	"github.com/pion/turn/v5"
)

func credential(secret []byte, username string) string {
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func validUser(username string, now time.Time) bool {
	expiry, _, ok := strings.Cut(username, ":")
	timestamp, err := strconv.ParseInt(expiry, 10, 64)
	return ok && err == nil && timestamp > now.Unix() && timestamp <= now.Add(25*time.Hour).Unix()
}

func publicPeer(_ net.Addr, ip net.IP) bool {
	// A relay must never become an entry point into the server's private network.
	return ip.To4() != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() &&
		!ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!(ip.To4()[0] == 100 && ip.To4()[1] >= 64 && ip.To4()[1] <= 127)
}

func serve(publicIP net.IP, address string, secret []byte, policy turn.PermissionHandler) (*turn.Server, error) {
	udp, err := net.ListenPacket("udp4", address)
	if err != nil {
		return nil, err
	}
	tcp, err := net.Listen("tcp4", address)
	if err != nil {
		udp.Close()
		return nil, err
	}
	generator := func() *turn.RelayAddressGeneratorPortRange {
		return &turn.RelayAddressGeneratorPortRange{RelayAddress: publicIP, Address: "0.0.0.0", MinPort: 50000, MaxPort: 50199, MaxRetries: 50}
	}
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: "hisbenew.com",
		AuthHandler: func(request *turn.RequestAttributes) (string, []byte, bool) {
			if !validUser(request.Username, time.Now()) {
				return "", nil, false
			}
			return request.Username, turn.GenerateAuthKey(request.Username, "hisbenew.com", credential(secret, request.Username)), true
		},
		PacketConnConfigs: []turn.PacketConnConfig{{PacketConn: udp, RelayAddressGenerator: generator(), PermissionHandler: policy}},
		ListenerConfigs:   []turn.ListenerConfig{{Listener: tcp, RelayAddressGenerator: generator(), PermissionHandler: policy}},
	})
	if err != nil {
		udp.Close()
		tcp.Close()
	}
	return server, err
}

func main() {
	public := flag.String("public-ip", "", "Public IPv4 relay address")
	secretPath := flag.String("secret-file", "", "Path to protected shared secret")
	listen := flag.String("listen", "0.0.0.0:3478", "TURN UDP/TCP listener")
	check := flag.Bool("check", false, "Verify UDP and TCP relay without starting a server")
	flag.Parse()
	ip := net.ParseIP(*public)
	if ip == nil || ip.To4() == nil {
		log.Fatal("A public IPv4 address is required")
	}
	raw, err := os.ReadFile(*secretPath)
	secret := []byte(strings.TrimSpace(string(raw)))
	if err != nil || len(secret) < 32 {
		log.Fatal("Relay secret file unavailable or too short")
	}
	if *check {
		timer := time.AfterFunc(25*time.Second, func() { log.Fatal("relay verification timed out") })
		defer timer.Stop()
		for _, tcp := range []bool{false, true} {
			if err := probe(net.JoinHostPort(*public, "3478"), secret, tcp); err != nil {
				log.Fatal(err)
			}
		}
		fmt.Println("UDP and TCP relay: bidirectional synthetic packets verified")
		return
	}
	server, err := serve(ip, *listen, secret, publicPeer)
	if err != nil {
		log.Fatal(fmt.Errorf("relay startup: %w", err))
	}
	defer server.Close()
	log.Print("Authenticated TURN relay listening; media ports 50000-50199")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
}
